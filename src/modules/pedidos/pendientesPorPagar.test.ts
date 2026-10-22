import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrdenPorPagar } from './pedidos.repository';
import type { DirectoFila } from './DirectosPorPagarModal';
import { armarReportePorPagar, subtotalSegmento, textoPagoDirecto, textoPagoOrden } from './pendientesPorPagarReporte';
import { enlaceWhatsapp, mensajePendientesPorPagar } from './pendientesPorPagarMensaje';

// La vista previa no se abre en las pruebas: se captura el libro que se le entrega.
const capturado: { wb?: { SheetNames: string[]; Sheets: Record<string, Record<string, { v?: unknown; z?: string }>> }; nombre?: string } = {};
vi.mock('@/shared/lib/reportPreview', () => ({
  previewWorkbook: (_x: unknown, wb: never, nombre: string) => { capturado.wb = wb; capturado.nombre = nombre; },
}));

const TRANSFERENCIA = { metodo: 'transferencia', moneda: 'USD', monto: 1204.88, datos: { nombre: 'JOSE PEREZ', ci: 'V-12345678', banco: '0134', cuenta: '01340000000000000001' } };
const PAGO_MOVIL = { metodo: 'pago_movil', moneda: 'Bs', monto: 5000, datos: { ci_rif: 'J-506575140', banco: '0102', telefono: '04141234567' } };

const oc = (over: Partial<{ codigo: string; clase: string; nombre: string; monto: number; esperando: boolean; abonado: number; metodo: unknown[] }> = {}): OrdenPorPagar => ({
  orden: { codigo: over.codigo ?? 'SP-1', oc_codigo: over.codigo ?? 'OC-1', clase: over.clase ?? 'producto', abonado_total: over.abonado ?? 0, metodo_pago: over.metodo ?? null },
  proveedorNombre: over.nombre ?? 'PROVEEDOR UNO',
  esContraEntrega: false,
  montoAPagar: over.monto ?? 100,
  esperandoMetodo: over.esperando ?? false,
} as unknown as OrdenPorPagar);

const directo = (over: Partial<DirectoFila> = {}): DirectoFila => ({
  kind: 'compra', id: 'd1', codigo: 'CD-1', titulo: 'FERRETERIA', detalle: 'Tornillos', total: 50, moneda: 'USD',
  generoPor: '', categoria: '', pagoExterno: false, pagoExternoDatos: null, adjuntoPath: null, ...over,
} as DirectoFila);

const TASA = 40;

describe('armarReportePorPagar', () => {
  it('agrupa en los cuatro segmentos, en su orden, y no muestra los vacíos', () => {
    const r = armarReportePorPagar(
      [oc({ codigo: 'OC-1', monto: 100 }), oc({ codigo: 'OC-2', clase: 'servicio', monto: 30 })],
      [directo(), directo({ kind: 'servicio', codigo: 'SD-1', titulo: 'LAVADO', total: 20 })],
      [], TASA,
    );
    expect(r.segmentos.map((s) => s.key)).toEqual(['compras_directas', 'ordenes', 'servicios', 'servicios_directos']);
    expect(r.totalUsd).toBe(200);
    expect(r.pendientes).toBe(4);
    const solo = armarReportePorPagar([oc()], [], [], TASA);
    expect(solo.segmentos.map((s) => s.key)).toEqual(['ordenes']);
  });

  it('un directo en Bs se pasa a $ con la tasa; en $ queda igual', () => {
    const r = armarReportePorPagar([], [directo({ total: 4000, moneda: 'Bs' }), directo({ codigo: 'CD-2', total: 10, moneda: 'USD' })], [], TASA);
    expect(r.segmentos[0].filas.map((f) => f.montoUsd)).toEqual([100, 10]);
    expect(subtotalSegmento(r.segmentos[0])).toBe(110);
  });

  it('cada fila lleva cómo se paga: método, monto y datos del beneficiario', () => {
    const r = armarReportePorPagar([oc({ esperando: true }), oc({ codigo: 'OC-9', metodo: [TRANSFERENCIA] })], [], [], TASA);
    const pagos = r.segmentos[0].filas.map((f) => f.pago);
    expect(pagos[0]).toBe('Esperando método de pago');
    expect(pagos[1]).toBe('Transferencia · USD 1.204,88\n   JOSE PEREZ · V-12345678 · 0134 · Banesco · Cta 01340000000000000001');
  });

  it('multipago: una pata debajo de la otra, cada una con sus datos', () => {
    const t = textoPagoOrden({ metodo_pago: [TRANSFERENCIA, PAGO_MOVIL] } as never);
    const lineas = t.split('\n');
    expect(lineas).toHaveLength(4);
    expect(lineas[0]).toBe('Transferencia · USD 1.204,88');
    expect(lineas[2]).toMatch(/^Pago móvil · Bs 5\.000,00$/);
    expect(lineas[3]).toContain('04141234567');
  });

  it('una pata sin datos (efectivo) no inventa una línea de datos', () => {
    expect(textoPagoOrden({ metodo_pago: [{ metodo: 'divisas_efectivo', moneda: 'USD', monto: 50 }] } as never)).toBe('Divisas en efectivo · USD 50,00');
  });

  it('compra o servicio directo: se define al pagar, o REINTEGRO si lo puso un externo', () => {
    expect(textoPagoDirecto({ pagoExterno: false, pagoExternoDatos: null })).toBe('Se define al pagar');
    expect(textoPagoDirecto({ pagoExterno: true, pagoExternoDatos: 'MARIA · V-1 · Banesco' })).toBe('REINTEGRO a externo\n   MARIA · V-1 · Banesco');
    expect(textoPagoDirecto({ pagoExterno: true, pagoExternoDatos: null })).toBe('REINTEGRO a externo');
  });

  it('las cuentas a crédito también llevan su método de pago', () => {
    const r = armarReportePorPagar([], [], [oc({ codigo: 'OC-C', monto: 500, abonado: 120, metodo: [TRANSFERENCIA] })], TASA);
    expect(r.credito[0].pago).toContain('Transferencia');
  });

  it('las cuentas a crédito van aparte: no suman al total y llevan abonado y saldo', () => {
    const r = armarReportePorPagar([oc({ monto: 100 })], [], [oc({ codigo: 'OC-C', monto: 500, abonado: 120 })], TASA);
    expect(r.totalUsd).toBe(100);
    expect(r.credito).toEqual([{ codigo: 'OC-C', nombre: 'PROVEEDOR UNO', pago: 'Esperando método de pago', abonado: 120, total: 500, saldo: 380 }]);
    expect(r.creditoTotal).toBe(380);
  });

  it('sin tasa, un directo en Bs vale 0 $ (no se inventa la conversión)', () => {
    const r = armarReportePorPagar([], [directo({ total: 4000, moneda: 'Bs' })], [], 0);
    expect(r.segmentos[0].filas[0].montoUsd).toBe(0);
  });
});

describe('mensajePendientesPorPagar', () => {
  const rep = () => armarReportePorPagar(
    [oc({ codigo: 'OC-2026-0188', nombre: 'DISTRIBUIDORA EL TORETE J&M, C.A', monto: 1204.88 }), oc({ codigo: 'OC-2', clase: 'servicio', nombre: 'TALLER', monto: 30 })],
    [directo({ total: 50 }), directo({ kind: 'servicio', codigo: 'SD-1', titulo: 'LAVADO', total: 20 })],
    [oc({ codigo: 'OC-C', nombre: 'PROV CREDITO', monto: 500, abonado: 120 })],
    TASA,
  );
  const fecha = '2026-10-20T15:15:00.000Z';

  it('lleva título, fecha, tasa, cada segmento con su emoji, subtotal, total general y crédito', () => {
    const m = mensajePendientesPorPagar(rep(), { fecha, tasaFecha: '2026-10-20' });
    expect(m).toContain('📊 *PENDIENTES POR PAGAR*');
    expect(m).toContain('20/10/2026');
    expect(m).toContain('💱 Tasa BCV: Bs 40,00 por $ · 2026-10-20');
    for (const e of ['🛒', '📦', '🔧', '⚡', '💰', '💳', '🧾']) expect(m).toContain(e);
    expect(m).toContain('📦 *ÓRDENES DE COMPRA · 1*');
    expect(m).toContain('1. OC-2026-0188 · DISTRIBUIDORA EL TORETE J&M, C.A — $ 1.204,88 (Bs 48.195,20)');
    expect(m).toContain('*Subtotal:* $ 1.204,88 (Bs 48.195,20)');
    expect(m).toContain('💰 *TOTAL GENERAL*\n$ 1.304,88');
    expect(m).toContain('💳 *CUENTAS A CRÉDITO · 1*');
    expect(m).toContain('saldo $ 380,00 (Bs 15.200,00) (abonado $ 120,00 de $ 500,00)');
    expect(m).toContain('*Total a crédito:* $ 380,00 (Bs 15.200,00)');
  });

  it('debajo de cada fila va el método de pago con TODOS los datos (sin recortar), y 🏦 / ⏳ según falte', () => {
    const r = armarReportePorPagar(
      [oc({ codigo: 'OC-A', nombre: 'UNO', monto: 10, metodo: [TRANSFERENCIA, PAGO_MOVIL] }), oc({ codigo: 'OC-B', nombre: 'DOS', monto: 20 })],
      [directo({ pagoExterno: true, pagoExternoDatos: 'MARIA · V-1 · Banesco' })], [], TASA,
    );
    const m = mensajePendientesPorPagar(r, { fecha });
    expect(m).toContain('1. OC-A · UNO — $ 10,00 (Bs 400,00)\n   🏦 Transferencia · USD 1.204,88\n   JOSE PEREZ · V-12345678 · 0134 · Banesco · Cta 01340000000000000001\n   🏦 Pago móvil · Bs 5.000,00\n   J-506575140 · 0102 · Banco de Venezuela · 04141234567');
    expect(m).toContain('2. OC-B · DOS — $ 20,00 (Bs 800,00)\n   ⏳ Esperando método de pago');
    expect(m).toContain('   🏦 REINTEGRO a externo\n   MARIA · V-1 · Banesco');
    expect(m).toContain('   🏦 Se define al pagar'.slice(0, 3)); // sangría de la línea de método
  });

  it('el crédito NO muestra método de pago (se paga por abonos en Tesorería)', () => {
    const r = armarReportePorPagar([], [], [oc({ codigo: 'OC-C', nombre: 'PROV', monto: 500, abonado: 120, metodo: [TRANSFERENCIA] })], TASA);
    const m = mensajePendientesPorPagar(r, { fecha });
    expect(m).toContain('saldo $ 380,00 (Bs 15.200,00) (abonado $ 120,00 de $ 500,00)');
    expect(m).not.toContain('Transferencia');
    expect(m).not.toContain('JOSE PEREZ');
  });

  it('SIN el selector U+FE0F ni uniones invisibles: si no, WhatsApp muestra un cuadrito', () => {
    expect(/️|‍/.test(mensajePendientesPorPagar(rep(), { fecha }))).toBe(false);
  });

  it('cierra con el pie de la empresa', () => {
    expect(mensajePendientesPorPagar(rep(), { fecha }).trim().endsWith('🏢 *MINERAL GROUP GUAYANA C.A.*')).toBe(true);
  });

  it('el enlace va derecho a api.whatsapp.com (nunca wa.me) y el texto vuelve exacto', () => {
    const m = mensajePendientesPorPagar(rep(), { fecha });
    const url = enlaceWhatsapp(m);
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(url).not.toContain('wa.me');
    expect(decodeURIComponent(url.split('text=')[1])).toBe(m);
  });

  it('sin tasa solo habla en $', () => {
    const m = mensajePendientesPorPagar(armarReportePorPagar([oc({ monto: 10 })], [], [], 0), { fecha });
    expect(m).not.toContain('Bs');
    expect(m).not.toContain('💱');
  });

  it('con muchísimas filas lista hasta el máximo y manda al Excel o al PDF', () => {
    const muchas = Array.from({ length: 5 }, (_, i) => oc({ codigo: `OC-${i}`, monto: 1 }));
    const m = mensajePendientesPorPagar(armarReportePorPagar(muchas, [], [], TASA), { fecha, maxPorSegmento: 2 });
    expect(m).toContain('2. OC-1');
    expect(m).not.toContain('3. OC-2');
    expect(m).toContain('… y 3 más (mirá el Excel o el PDF)');
  });

  it('sin nada pendiente avisa y no inventa renglones', () => {
    const m = mensajePendientesPorPagar(armarReportePorPagar([], [], [], TASA), { fecha });
    expect(m).toContain('✅ No hay pendientes por pagar en este momento.');
    expect(m).not.toContain('TOTAL GENERAL');
  });

  it('recorta un nombre larguísimo con puntos suspensivos', () => {
    const m = mensajePendientesPorPagar(armarReportePorPagar([oc({ nombre: 'X'.repeat(200) })], [], [], TASA), { fecha });
    expect(m).toContain('…');
    expect(m).not.toContain('X'.repeat(100));
  });
});

describe('Excel de pendientes por pagar', () => {
  beforeEach(() => { capturado.wb = undefined; });

  it('arma dos hojas con los montos como NÚMERO y el TOTAL GENERAL que cuadra', async () => {
    const { exportarPendientesPorPagarExcel } = await import('./pendientesPorPagarExcel');
    const r = armarReportePorPagar(
      [oc({ codigo: 'OC-1', monto: 100 })], [directo({ total: 50 })], [oc({ codigo: 'OC-C', monto: 500, abonado: 120 })], TASA,
    );
    await exportarPendientesPorPagarExcel(r, '2026-10-20');
    const wb = capturado.wb!;
    expect(capturado.nombre).toBe('pendientes-por-pagar.xlsx');
    expect(wb.SheetNames).toEqual(['Por pagar', 'Resumen']);
    const hoja = wb.Sheets['Por pagar'];
    const celdas = Object.entries(hoja).filter(([k]) => !k.startsWith('!')).map(([, c]) => c.v);
    // Montos numéricos, no texto.
    expect(celdas).toContain(100);
    expect(celdas).toContain(4000);      // 100 $ × 40
    expect(celdas).toContain(150);       // total general en $
    expect(celdas).toContain(6000);      // total general en Bs
    expect(celdas).toContain(380);       // saldo a crédito
    expect(celdas).toContain('💰 TOTAL GENERAL');
    expect(celdas.some((v) => typeof v === 'string' && v.includes('CUENTAS A CRÉDITO'))).toBe(true);
    const resumen = Object.entries(wb.Sheets['Resumen']).filter(([k]) => !k.startsWith('!')).map(([, c]) => c.v);
    expect(resumen).toContain(150);
  });

  it('la columna MÉTODO DE PAGO / DATOS lleva el método con sus datos, en varias líneas', async () => {
    const { exportarPendientesPorPagarExcel } = await import('./pendientesPorPagarExcel');
    await exportarPendientesPorPagarExcel(armarReportePorPagar([oc({ monto: 100, metodo: [TRANSFERENCIA] })], [], [oc({ codigo: 'OC-C', monto: 500, abonado: 120, metodo: [PAGO_MOVIL] })], TASA), null);
    const hoja = capturado.wb!.Sheets['Por pagar'];
    const celdas = Object.entries(hoja).filter(([k]) => !k.startsWith('!')).map(([, c]) => c.v);
    expect(celdas).toContain('MÉTODO DE PAGO / DATOS');
    expect(celdas).toContain('Transferencia · USD 1.204,88\n   JOSE PEREZ · V-12345678 · 0134 · Banesco · Cta 01340000000000000001');
    expect(celdas.some((v) => typeof v === 'string' && v.startsWith('Pago móvil · Bs 5.000,00\n') && v.includes('04141234567'))).toBe(true);
    // Las celdas de método van con ajuste de texto para que se vean las varias líneas.
    const conAjuste = Object.entries(hoja).filter(([k, c]) => !k.startsWith('!') && typeof c.v === 'string' && c.v.startsWith('Transferencia')).map(([, c]) => (c as { s?: { alignment?: { wrapText?: boolean } } }).s?.alignment?.wrapText);
    expect(conAjuste).toEqual([true]);
  });

  it('sin tasa deja los Bs en blanco (no inventa la conversión)', async () => {
    const { exportarPendientesPorPagarExcel } = await import('./pendientesPorPagarExcel');
    await exportarPendientesPorPagarExcel(armarReportePorPagar([oc({ monto: 100 })], [], [], 0), null);
    const celdas = Object.entries(capturado.wb!.Sheets['Por pagar']).filter(([k]) => !k.startsWith('!')).map(([, c]) => c.v);
    expect(celdas).toContain(100);
    expect(celdas).not.toContain(0);
  });
});
