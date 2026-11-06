/* ============================================================
   «Pendientes por pagar»: un solo armado para las tres salidas.
   Aquí se fija lo que no se ve en pantalla: los segmentos y su orden, las
   conversiones a $ y Bs, que el crédito vaya aparte y fuera del total, y el
   texto de WhatsApp (se copia y se pega en el chat: si el formato se rompe,
   nadie lo ve hasta que ya se mandó) y las celdas del Excel.
   ============================================================ */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
// La vista previa abre una ventana del navegador: aquí solo interesa el documento que se le entrega.
const previa = vi.hoisted(() => ({ doc: null as unknown as { getNumberOfPages: () => number } | null, nombre: '' }));
vi.mock('@/shared/lib/reportePreview', () => ({
  previewPdf: (doc: { getNumberOfPages: () => number }, nombre: string) => { previa.doc = doc; previa.nombre = nombre; },
  previewExcelArchivo: async () => undefined,
}));

import type { Orden } from '@/shared/lib/types';
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import type { CompraDirecta } from '@/modules/pedidos/compras.repository';
import type { ServicioDirecto } from '@/modules/pedidos/serviciosDirectos.repository';
import { armarPendientesPorPagar, lineasDePago, calcularPreparacion, generarBloquesPreparacion, type PreparacionPorPagar } from './pendientesPorPagar';
import { textoPendientesPorPagarWhatsapp } from './pendientesPorPagarWhatsapp';
import { construirPendientesPorPagarExcel } from './pendientesPorPagarExcel';
import { descargarPendientesPorPagarPdf } from './ordenesPorPagarPdf';

const GEN = '2026-10-20T12:00:00Z';

const oc = (patch: Record<string, unknown> = {}, extra: Partial<OrdenPorPagar> = {}): OrdenPorPagar => ({
  orden: {
    id: crypto.randomUUID(), codigo: 'SP-2026-0001', oc_codigo: 'OC-2026-0150', estado: 'oc_aprobada',
    tipo: 'compra', total: 100, proveedor_id: 'pA',
    metodo_pago: [{ metodo: 'divisas_efectivo', moneda: 'USD', monto: 0 }],
    ...patch,
  } as unknown as Orden,
  proveedorNombre: 'FERRETERIA CENTRAL', esContraEntrega: false,
  montoAPagar: 100, esperandoMetodo: false,
  ...extra,
});
const compra = (patch: Record<string, unknown> = {}): CompraDirecta => ({
  id: 'c1', codigo: 'CD-2026-0012', proveedor_id: 'pB', proveedor_nombre: 'AGROPECUARIA EL LLANO',
  estado: 'por_pagar', gasto: 3600, moneda: 'Bs', ...patch,
} as unknown as CompraDirecta);
const servicio = (patch: Record<string, unknown> = {}): ServicioDirecto => ({
  id: 's1', codigo: 'SD-2026-0003', proveedor_id: 'pC', proveedor_nombre: 'TALLER MIRANDA',
  estado: 'por_pagar', gasto: 1000, moneda: 'USD', con_abonos: true, abonado_total: 250, ...patch,
} as unknown as ServicioDirecto);

const entrada = () => ({
  rows: [
    oc(),
    oc({ oc_codigo: 'OC-2026-0151', total: 50 }, { montoAPagar: 50, esperandoMetodo: true }),
    oc({ oc_codigo: 'CS-2026-0010', tipo: 'servicio' }, { montoAPagar: 24.65, proveedorNombre: 'EXTINTORES RC' }),
  ],
  creditos: [oc({ oc_codigo: 'OC-2026-0120', total: 410.59, estado: 'cuenta_abierta' }, { proveedorNombre: 'FRANGOS DE ORIENTE' })],
  comprasDir: [compra(), compra({ id: 'c2', codigo: 'CD-2026-0099', estado: 'finalizada' })],
  serviciosDir: [servicio()],
  tasa: 36, tasaFecha: '2026-10-20', generadoEn: GEN,
});

describe('calcularPreparacion · «Por preparar» nativo por método y moneda', () => {
  const met = (metodo: string, moneda: string, monto = 0) => ({ metodo, moneda, monto });

  it('método único: USD va al total USD; Bs va al total Bs; USDT al total USDT (nativo, sin reconvertir)', () => {
    const p = calcularPreparacion({
      ocRows: [
        oc({ metodo_pago: [met('divisas_efectivo', 'USD')] }, { montoAPagar: 100 }),
        oc({ metodo_pago: [met('transferencia', 'Bs')] }, { montoAPagar: 10 }),   // 10 $ → 360 Bs a tasa 36
        oc({ metodo_pago: [met('binance', 'USDT')] }, { montoAPagar: 50 }),
      ],
      comprasPP: [], serviciosPP: [], tasa: 36,
    });
    const tot = (m: string) => p.totalesPorMoneda.find((t) => t.moneda === m)?.monto ?? 0;
    expect(tot('USD')).toBe(100);
    expect(tot('Bs')).toBe(360);
    expect(tot('USDT')).toBe(50);
    // Independientes: el pago en Bs NO aparece en el total de divisa y viceversa.
    expect(tot('USD')).not.toBe(360);
    expect(p.sinMetodo.nOrdenes).toBe(0);
  });

  it('pago partido: cada pata suma en su propia moneda y método', () => {
    const p = calcularPreparacion({
      ocRows: [oc({ metodo_pago: [met('zelle', 'USD', 30), met('transferencia', 'Bs', 360)] }, { montoAPagar: 99 })],
      comprasPP: [], serviciosPP: [], tasa: 36,
    });
    expect(p.totalesPorMoneda.find((t) => t.moneda === 'USD')?.monto).toBe(30);
    expect(p.totalesPorMoneda.find((t) => t.moneda === 'Bs')?.monto).toBe(360);
    expect(p.porMetodoMoneda.some((l) => l.metodo === 'zelle' && l.moneda === 'USD' && l.monto === 30)).toBe(true);
  });

  it('esperando método y compras/servicios directos → «Sin método asignado» (no entran en los totales nativos)', () => {
    const p = calcularPreparacion({
      ocRows: [oc({ metodo_pago: [met('divisas_efectivo', 'USD')] }, { montoAPagar: 20, esperandoMetodo: true })],
      comprasPP: [compra({ gasto: 3600, moneda: 'Bs' })],   // 3600 Bs → 100 $
      serviciosPP: [], tasa: 36,
    });
    expect(p.porMetodoMoneda).toHaveLength(0);
    expect(p.totalesPorMoneda).toHaveLength(0);
    expect(p.sinMetodo.nOrdenes).toBe(2);
    expect(p.sinMetodo.usd).toBe(120);    // 20 + 100
    expect(p.sinMetodo.bs).toBe(4320);    // 20*36 + 3600
  });

  it('agrega varias órdenes del mismo método y moneda en una sola línea', () => {
    const p = calcularPreparacion({
      ocRows: [
        oc({ metodo_pago: [met('transferencia', 'Bs')] }, { montoAPagar: 10 }),
        oc({ metodo_pago: [met('transferencia', 'Bs')] }, { montoAPagar: 5 }),
      ],
      comprasPP: [], serviciosPP: [], tasa: 36,
    });
    const linea = p.porMetodoMoneda.filter((l) => l.metodo === 'transferencia' && l.moneda === 'Bs');
    expect(linea).toHaveLength(1);
    expect(linea[0].monto).toBe(540);      // (10 + 5) * 36
    expect(linea[0].nOrdenes).toBe(2);
  });
});

describe('armarPendientesPorPagar', () => {
  it('arma los segmentos en orden, sin los vacíos, y deja fuera lo que no está por pagar', () => {
    const d = armarPendientesPorPagar(entrada());
    expect(d.segmentos.map((s) => s.clave)).toEqual(['compras_directas', 'oc', 'servicios', 'servicios_directos']);
    expect(d.segmentos[0].filas.map((f) => f.codigo)).toEqual(['CD-2026-0012']);  // la finalizada no entra
    expect(d.segmentos[1].filas.map((f) => f.codigo)).toEqual(['OC-2026-0150', 'OC-2026-0151']);
    expect(d.segmentos[2].filas.map((f) => f.codigo)).toEqual(['CS-2026-0010']);
    const sinNada = armarPendientesPorPagar({ rows: [], tasa: 36 });
    expect(sinNada.segmentos).toEqual([]);
    expect(sinNada.credito).toBeNull();
  });

  it('convierte a $ y Bs con la tasa del día (Bs → $ y $ → Bs)', () => {
    const d = armarPendientesPorPagar(entrada());
    const cd = d.segmentos[0].filas[0];          // 3600 Bs
    expect(cd.usd).toBe(100);
    expect(cd.bs).toBe(3600);
    const o = d.segmentos[1].filas[0];           // 100 $
    expect(o.usd).toBe(100);
    expect(o.bs).toBe(3600);
  });

  it('un servicio directo con abonos pendiente = el saldo, y lo dice en el estado', () => {
    const f = armarPendientesPorPagar(entrada()).segmentos[3].filas[0];
    expect(f.usd).toBe(750);                     // 1000 − 250
    expect(f.estado).toBe('Por pagar · saldo con abonos');
  });

  it('esperando método ≠ lista para pagar', () => {
    const f = armarPendientesPorPagar(entrada()).segmentos[1].filas;
    expect(f[0]).toMatchObject({ estado: 'Lista para pagar', listaParaPagar: true });
    expect(f[1]).toMatchObject({ estado: 'Esperando método', listaParaPagar: false });
  });

  it('el crédito va aparte y NO suma al total', () => {
    const d = armarPendientesPorPagar(entrada());
    expect(d.credito?.filas).toHaveLength(1);
    expect(d.credito?.subUsd).toBe(410.59);
    // 100 (CD) + 100 + 50 (OC) + 24,65 (CS) + 750 (SD) = 1024,65 · sin los 410,59 del crédito.
    expect(d.totUsd).toBeCloseTo(1024.65, 2);
    expect(d.totCant).toBe(5);
  });

  it('sin tasa no inventa conversiones: la otra moneda queda en 0', () => {
    const d = armarPendientesPorPagar({ ...entrada(), tasa: 0 });
    expect(d.tasa).toBe(0);
    expect(d.segmentos[1].filas[0].bs).toBe(0);                 // $ sin tasa → sin Bs
    expect(d.segmentos[0].filas[0]).toMatchObject({ usd: 0, bs: 3600 });  // Bs sin tasa → sin $
  });
});

describe('lineasDePago', () => {
  it('con método en el documento: una línea por método; el monto por pata solo si van varios', () => {
    const uno = lineasDePago([{ metodo: 'divisas_efectivo', moneda: 'USD', monto: 100 }], 'pA', {});
    expect(uno).toEqual([{ metodo: 'divisas_efectivo', texto: 'Divisas en efectivo', registrado: false }]);
    const dos = lineasDePago([
      { metodo: 'divisas_efectivo', moneda: 'USD', monto: 60 },
      { metodo: 'efectivo_bs', moneda: 'Bs', monto: 3600 },
    ], 'pA', {});
    expect(dos.map((l) => l.texto)).toEqual(['Divisas en efectivo · $ 60,00', 'Efectivo (Bs) · Bs 3.600,00']);
  });

  it('sin método: los datos guardados del proveedor, marcados «(registrado)»', () => {
    const l = lineasDePago(null, 'pA', { pA: { pago_movil: { ci_rif: 'V-123', banco: '0102', telefono: '04141234567' } } });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ metodo: 'pago_movil', registrado: true });
    expect(l[0].texto).toContain('(registrado)');
    expect(l[0].texto).toContain('04141234567');
    expect(lineasDePago(null, 'otro', {})).toEqual([]);
  });
});

describe('textoPendientesPorPagarWhatsapp', () => {
  it('arma encabezado, tasa, segmento con emoji, viñeta, estado, método, subtotal y total', () => {
    const d = armarPendientesPorPagar({ rows: [oc()], tasa: 36, tasaFecha: '2026-10-20', generadoEn: GEN });
    expect(textoPendientesPorPagarWhatsapp(d).split('\n')).toEqual([
      '🧾 *PENDIENTES POR PAGAR*',
      '_MINERAL GROUP GUAYANA C.A. · 20/10/2026_',
      '💱 _Tasa BCV: Bs 36,00 / $ · 20/10/2026_',
      '',
      '📄 *ÓRDENES DE COMPRA (OC) (1)*',
      '• *OC-2026-0150* — FERRETERIA CENTRAL — *$100,00 · Bs 3.600,00*',
      '   ✅ Lista para pagar',
      '   💵 Divisas en efectivo',
      '   _Subtotal: $100,00 · Bs 3.600,00_',
      '',
      '💰 *TOTAL POR PAGAR:* 1 ítem(s) · *$100,00 · Bs 3.600,00*',
    ]);
  });

  it('un emoji por segmento y por estado; el crédito aparte, con su aviso y fuera del total', () => {
    const t = textoPendientesPorPagarWhatsapp(armarPendientesPorPagar(entrada()));
    for (const e of ['🛒 *COMPRAS DIRECTAS (1)*', '📄 *ÓRDENES DE COMPRA (OC) (2)*', '🔧 *SERVICIOS (CONTROL DE SERVICIO · CS) (1)*', '🧰 *SERVICIOS DIRECTOS (1)*']) {
      expect(t).toContain(e);
    }
    expect(t).toContain('⏳ Esperando método');
    expect(t).toContain('✅ Lista para pagar');
    expect(t).toContain('💰 *TOTAL POR PAGAR:* 5 ítem(s)');
    const iTotal = t.indexOf('TOTAL POR PAGAR');
    const iCredito = t.indexOf('💳 *CUENTAS A CRÉDITO');
    expect(iCredito).toBeGreaterThan(iTotal);                         // después del total
    expect(t).toContain('_No entran en el total de arriba; se saldan por abonos._');
    expect(t).toContain('🔁 Crédito · se salda por abonos');
  });

  it('emoji por método de pago', () => {
    const d = armarPendientesPorPagar({
      rows: [oc({ metodo_pago: [{ metodo: 'zelle', moneda: 'USD', monto: 0, datos: { correo: 'a@b.c' } }] })], tasa: 36, generadoEn: GEN,
    });
    expect(textoPendientesPorPagarWhatsapp(d)).toMatch(/\n {3}⚡ Zelle/);
  });

  it('sin tasa solo muestra la moneda que se conoce; sin nada, el aviso', () => {
    const d = armarPendientesPorPagar({ rows: [oc()], compras: undefined, tasa: 0, generadoEn: GEN } as never);
    const t = textoPendientesPorPagarWhatsapp(d);
    expect(t).toContain('*$100,00*');
    expect(t).not.toContain('Bs 0,00');
    expect(t).not.toContain('Tasa BCV');
    expect(textoPendientesPorPagarWhatsapp(armarPendientesPorPagar({ rows: [], generadoEn: GEN })))
      .toContain('No hay pendientes por pagar en este momento. ✅');
  });

  it('solo crédito: lo dice y no inventa total', () => {
    const t = textoPendientesPorPagarWhatsapp(armarPendientesPorPagar({ rows: [], creditos: [oc({ estado: 'cuenta_abierta' })], tasa: 36, generadoEn: GEN }));
    expect(t).toContain('Solo quedan cuentas a crédito abiertas');
    expect(t).not.toContain('TOTAL POR PAGAR');
  });

  it('el proveedor con saltos de línea no parte la viñeta', () => {
    const d = armarPendientesPorPagar({ rows: [oc({}, { proveedorNombre: 'FERRETERIA\nCENTRAL' })], tasa: 36, generadoEn: GEN });
    expect(textoPendientesPorPagarWhatsapp(d)).toContain('— FERRETERIA CENTRAL —');
  });
});

describe('construirPendientesPorPagarExcel', () => {
  async function leer(bytes: ArrayBuffer) {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    return wb.worksheets[0];
  }

  it('hoja con título, encabezado, un bloque por segmento, subtotales, total y el crédito aparte', async () => {
    const ws = await leer(await construirPendientesPorPagarExcel(armarPendientesPorPagar(entrada())));
    expect(String(ws.getCell('A1').value)).toContain('PENDIENTES POR PAGAR');
    expect(['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4'].map((c) => ws.getCell(c).value)).toEqual(
      ['TIPO', 'CÓDIGO', 'PROVEEDOR', 'ESTADO', 'MÉTODO Y DATOS DE PAGO', 'MONTO $', 'MONTO Bs']);

    // Los arreglos de ExcelJS son «ralos» (hueco en el índice 0): Array.from los rellena.
    const col1 = Array.from(ws.getColumn(1).values as unknown[], (v) => String(v ?? ''));
    for (const t of ['COMPRAS DIRECTAS (1)', 'ÓRDENES DE COMPRA (OC) (2)', 'SERVICIOS (CONTROL DE SERVICIO · CS) (1)', 'SERVICIOS DIRECTOS (1)']) {
      expect(col1).toContain(t);
    }
    expect(col1.filter((v) => v === 'SUBTOTAL')).toHaveLength(5);   // 4 segmentos + el crédito
    const filaTotal = col1.indexOf('TOTAL GENERAL');
    expect(filaTotal).toBeGreaterThan(0);
    expect(ws.getCell(filaTotal, 6).value).toBeCloseTo(1024.65, 2);
    expect(ws.getCell(filaTotal, 7).value).toBeCloseTo(1024.65 * 36, 1);

    // El crédito queda DESPUÉS del total, con su aviso, y no lo suma.
    const filaCredito = col1.findIndex((v) => v.startsWith('CUENTAS A CRÉDITO'));
    expect(filaCredito).toBeGreaterThan(filaTotal);
    expect(col1[filaCredito]).toContain('NO entran en el total');
  });

  it('el método de pago va en su celda, una línea por método', async () => {
    const e = entrada();
    e.rows = [oc({ metodo_pago: [
      { metodo: 'divisas_efectivo', moneda: 'USD', monto: 60 },
      { metodo: 'efectivo_bs', moneda: 'Bs', monto: 3600 },
    ] })];
    const ws = await leer(await construirPendientesPorPagarExcel(armarPendientesPorPagar(e)));
    const fila = ws.getColumn(2).values.findIndex((v) => v === 'OC-2026-0150');
    expect(String(ws.getCell(fila, 5).value)).toBe('Divisas en efectivo · $ 60,00\nEfectivo (Bs) · Bs 3.600,00');
    expect(ws.getCell(fila, 6).value).toBe(100);
  });

  it('sin tasa deja vacía la moneda que no se conoce (no un 0)', async () => {
    const ws = await leer(await construirPendientesPorPagarExcel(armarPendientesPorPagar({ ...entrada(), tasa: 0 })));
    const fila = ws.getColumn(2).values.findIndex((v) => v === 'CD-2026-0012');   // 3600 Bs
    expect(ws.getCell(fila, 7).value).toBe(3600);
    expect(ws.getCell(fila, 6).value).toBe('');
  });

  it('sin nada por pagar no rompe', async () => {
    const ws = await leer(await construirPendientesPorPagarExcel(armarPendientesPorPagar({ rows: [], generadoEn: GEN })));
    expect(String(ws.getCell('A5').value)).toBe('No hay pendientes por pagar.');
  });
});

describe('descargarPendientesPorPagarPdf (los mismos datos, ahora dibujados desde el armado común)', () => {
  it('genera el documento con segmentos, crédito y un método de pago con texto largo', async () => {
    const e = entrada();
    e.rows = [oc({ metodo_pago: [
      { metodo: 'transferencia', moneda: 'USD', monto: 60, datos: { nombre: 'FERRETERIA CENTRAL C.A. ñandú ⚠', ci: 'J-123456789', banco: '0102', cuenta: '01020000000000000000' } },
      { metodo: 'efectivo_bs', moneda: 'Bs', monto: 1440 },
    ] }), ...e.rows.slice(1)];
    await descargarPendientesPorPagarPdf(armarPendientesPorPagar(e));
    expect(previa.doc).not.toBeNull();
    expect(previa.doc!.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(previa.nombre).toMatch(/^pendientes-por-pagar-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('sin nada por pagar igual entrega el documento', async () => {
    previa.doc = null;
    await descargarPendientesPorPagarPdf(armarPendientesPorPagar({ rows: [], generadoEn: GEN }));
    expect(previa.doc).not.toBeNull();
  });

  it('con muchas filas pasa de una página y no rompe', async () => {
    const muchas = Array.from({ length: 40 }, (_, i) => oc({ oc_codigo: 'OC-2026-' + (1000 + i) }));
    previa.doc = null;
    await descargarPendientesPorPagarPdf(armarPendientesPorPagar({ rows: muchas, tasa: 36, generadoEn: GEN }));
    expect(previa.doc!.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe('generarBloquesPreparacion · representación opcional (Bs, USD o Ambos)', () => {
  const prepEjemplo: PreparacionPorPagar = {
    totalesPorMoneda: [
      { moneda: 'Bs', monto: 1928638.42, nOrdenes: 9 },
    ],
    porMetodoMoneda: [
      { metodo: 'pago_movil', metodoLabel: 'Pago móvil', moneda: 'Bs', monto: 413398.08, nOrdenes: 3 },
      { metodo: 'transferencia', metodoLabel: 'Transferencia', moneda: 'Bs', monto: 1515240.34, nOrdenes: 6 },
    ],
    sinMetodo: { usd: 183.28, bs: 164240.87, nOrdenes: 1 },
  };
  const tasaRef = 896.12;

  it('Modo Solo Bolívares (Bs): título en Bolívares, montos en Bs nativo, sin conversión a dólares', () => {
    const res = generarBloquesPreparacion(prepEjemplo, tasaRef, { mostrarUsd: false, mostrarBs: true });
    expect(res.tituloSeccion).toBe('RESUMEN DE PAGOS — por método (expresado en Bolívares)');
    expect(res.bloques).toHaveLength(1);
    const b = res.bloques[0];
    expect(b.etiqueta).toBe('BOLIVARES · Bs');
    expect(b.totalTexto).toBe('Bs 1.928.638,42');
    expect(b.totalTexto).not.toContain('$');
    expect(b.metodos[0].montoTexto).toBe('Bs 413.398,08');
    expect(b.metodos[1].montoTexto).toBe('Bs 1.515.240,34');
    expect(res.sinMetodoTexto).toContain('Bs 164.240,87');
    expect(res.sinMetodoTexto).not.toContain('$');
  });

  it('Modo Solo Dólares ($): título en USD, montos convertidos a USD a tasa BCV, sin Bolívares', () => {
    const res = generarBloquesPreparacion(prepEjemplo, tasaRef, { mostrarUsd: true, mostrarBs: false });
    expect(res.tituloSeccion).toBe('RESUMEN DE PAGOS — por método (expresado en $ USD)');
    expect(res.bloques).toHaveLength(1);
    const b = res.bloques[0];
    expect(b.etiqueta).toBe('DÓLARES ($ USD · ref. BCV)');
    expect(b.totalTexto).toBe('$ 2.152,21');
    expect(b.totalTexto).not.toContain('Bs');
    expect(b.metodos[0].montoTexto).toBe('$ 461,32');
    expect(b.metodos[1].montoTexto).toBe('$ 1.690,89');
    expect(res.sinMetodoTexto).toContain('$ 183,28');
  });

  it('Modo Ambos (Bs y $): título con ambas monedas, monto nativo con equivalente en paréntesis limpio sin ≈', () => {
    const res = generarBloquesPreparacion(prepEjemplo, tasaRef, { mostrarUsd: true, mostrarBs: true });
    expect(res.tituloSeccion).toBe('RESUMEN DE PAGOS — por moneda y método (Bolívares y $ USD)');
    expect(res.bloques).toHaveLength(1);
    const b = res.bloques[0];
    expect(b.etiqueta).toBe('BOLIVARES · Bs');
    expect(b.totalTexto).toBe('Bs 1.928.638,42  ($ 2.152,21)');
    expect(b.totalTexto).not.toContain('≈');
    expect(b.metodos[0].montoTexto).toBe('Bs 413.398,08  ($ 461,32)');
    expect(b.metodos[1].montoTexto).toBe('Bs 1.515.240,34  ($ 1.690,89)');
    expect(res.sinMetodoTexto).toContain('$ 183,28');
    expect(res.sinMetodoTexto).toContain('Bs 164.240,87');
  });
});
