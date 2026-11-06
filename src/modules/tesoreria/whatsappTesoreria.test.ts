/* ============================================================
   Golden Touch · Tesorería · Test del aviso de WhatsApp del reporte
   Fija el formato puntual CON emojis de textoWhatsappTesoreria: encabezado por
   ámbito (emoji + título), un ítem por renglón con su marcador de flujo y su
   moneda, total consolidado en $/Bs con 💰, respeto de los interruptores
   de moneda, método de pago, tope de ítems y etiqueta de respaldo.
   ============================================================ */
import { describe, it, expect } from 'vitest';
import { textoWhatsappTesoreria } from './whatsappTesoreria';
import type { FilaReporteTesoreria } from './reporteTesoreriaMoldeable';

/** Fila mínima para el test; lo que el builder no usa queda en valores neutros. */
function mkFila(p: Partial<FilaReporteTesoreria>): FilaReporteTesoreria {
  return {
    id: p.id ?? 'x',
    ambito: p.ambito ?? 'por_pagar',
    fecha: p.fecha ?? '2026-11-01',
    moneda_original: p.moneda_original ?? 'USD',
    monto_original: p.monto_original ?? 0,
    tipo_movimiento: p.tipo_movimiento ?? 'egreso',
    categoria: p.categoria ?? '',
    contraparte: p.contraparte ?? '',
    concepto: p.concepto ?? '',
    origen_documento: p.origen_documento ?? 'OC',
    tasa_bcv_aplicada: p.tasa_bcv_aplicada ?? 36,
    monto_usd: p.monto_usd ?? 0,
    monto_bs: p.monto_bs ?? 0,
    ...p,
  } as FilaReporteTesoreria;
}

const RANGO = { desde: '2026-11-01', hasta: '2026-11-02' } as const;

describe('textoWhatsappTesoreria', () => {
  it('encabeza con emoji+título, marca cada ítem por flujo y cierra con el total consolidado', () => {
    const filas = [
      mkFila({ contraparte: 'FERRETERIA CENTRAL', tipo_movimiento: 'egreso', moneda_original: 'USD', monto_original: 100, monto_usd: 100, monto_bs: 3600 }),
      mkFila({ contraparte: 'PROVEEDOR X', tipo_movimiento: 'ingreso', moneda_original: 'Bs', monto_original: 846, monto_usd: 23.5, monto_bs: 846 }),
    ];
    const t = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO });
    const lineas = t.split('\n');
    expect(lineas[0]).toBe('🧾 *Reporte de Tesorería — Pendientes por pagar*');
    expect(lineas[1]).toMatch(/^_.+ · 01\/11\/2026 al 02\/11\/2026_$/);
    expect(lineas[2]).toBe('');
    expect(lineas[3]).toBe('1. 🔻 FERRETERIA CENTRAL — *$ 100,00 (Bs 3.600,00)*');
    expect(lineas[4]).toBe('2. 🔺 PROVEEDOR X — *Bs 846,00 ($ 23,50)*');
    expect(lineas[lineas.length - 1]).toBe('💰 *Total consolidado (2):* $ 123,50 · Bs 4.446,00');
  });

  it('sin filas, avisa que no hay registros', () => {
    const t = textoWhatsappTesoreria([], { ambito: 'movimientos', ...RANGO });
    expect(t).toContain('📊 *Reporte de Tesorería — Movimientos de caja*');
    expect(t).toContain('al 02/11/2026');
    expect(t).toContain('Sin registros en este ámbito.');
    expect(t).not.toMatch(/Total/);
  });

  it('respeta los interruptores de moneda en los ítems y en el total', () => {
    const filas = [mkFila({ contraparte: 'A', monto_usd: 50, monto_bs: 1800 })];
    const soloUsd = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO, mostrarBs: false });
    expect(soloUsd).toContain('— *$ 50,00*');
    expect(soloUsd).not.toContain('Bs');
    expect(soloUsd).toMatch(/💰 \*Total consolidado \(1\):\* \$ 50,00$/);

    const soloBs = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO, mostrarUsd: false });
    expect(soloBs).toContain('— *Bs 1.800,00*');
    expect(soloBs).not.toContain('$');
    expect(soloBs).toMatch(/💰 \*Total consolidado \(1\):\* Bs 1\.800,00$/);
  });

  it('muestra la tasa BCV en el encabezado cuando se suministra', () => {
    const filas = [mkFila({ contraparte: 'A', monto_usd: 50, monto_bs: 1800 })];
    const t = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO, tasaRef: 896.12 });
    expect(t).toContain('💱 _Tasa BCV: Bs 896,12 / $_');
  });

  it('lleva el código de la OC y método de pago en el renglón correspondiente', () => {
    const t = textoWhatsappTesoreria([mkFila({
      contraparte: 'HIERROS SAN FELIX',
      codigo: 'OC-2026-0191',
      moneda_original: 'USD',
      monto_original: 10,
      monto_usd: 10,
      metodo_pago: 'Transferencia — Banco Banesco 0134',
    })], { ambito: 'por_pagar', ...RANGO, mostrarBs: false });
    expect(t).toContain('1. 🔻 OC-2026-0191 · HIERROS SAN FELIX — *$ 10,00*');
    expect(t).toContain('🏦 Transferencia — Banco Banesco 0134');
  });

  it('usa la categoría cuando no hay proveedor', () => {
    const filas = [mkFila({ contraparte: '—', categoria: 'Combustible', tipo_movimiento: 'egreso', moneda_original: 'USD', monto_original: 12, monto_usd: 12, monto_bs: 432 })];
    const t = textoWhatsappTesoreria(filas, { ambito: 'movimientos', ...RANGO, mostrarBs: false });
    expect(t).toContain('1. 🔻 Combustible — *$ 12,00*');
  });

  it('corta en 40 ítems pero suma el total con todos', () => {
    const filas = Array.from({ length: 41 }, (_, i) =>
      mkFila({ id: String(i), contraparte: `P${i}`, monto_usd: 1, monto_bs: 36 }));
    const t = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO });
    expect(t).toContain('40. 🔻 P39 — *$ 0,00 (Bs 36,00)*');
    expect(t).not.toContain('41. ');
    expect(t).toContain('(+1 ítem(s) más)');
    expect(t).toMatch(/💰 \*Total consolidado \(41\):\* \$ 41,00 · Bs 1\.476,00$/);
  });

  it('con «Por preparar» muestra resumen por método alineado con generarBloquesPreparacion', () => {
    const filas = [mkFila({ contraparte: 'A', moneda_original: 'USD', monto_original: 100, monto_usd: 100, monto_bs: 3600 })];
    const preparacion = {
      porMetodoMoneda: [
        { metodo: 'transferencia', metodoLabel: 'Transferencia', moneda: 'Bs', monto: 3600, nOrdenes: 1 },
        { metodo: 'zelle', metodoLabel: 'Zelle', moneda: 'USD', monto: 100, nOrdenes: 1 },
      ],
      totalesPorMoneda: [
        { moneda: 'USD', monto: 100, nOrdenes: 1 },
        { moneda: 'Bs', monto: 3600, nOrdenes: 1 },
      ],
      sinMetodo: { usd: 0, bs: 0, nOrdenes: 0 },
    };
    const t = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO, preparacion });
    expect(t).toContain('📋 *Resumen de pagos por método:*');
    expect(t).toContain('• Zelle: $ 100,00');
    expect(t).toContain('• Transferencia: Bs 3.600,00');
    expect(t).toContain('💰 *Total consolidado (1):* $ 100,00 · Bs 3.600,00');
  });

  it('«Por preparar» respeta la opción Solo USD: no muestra Bolívares en el desglose', () => {
    const filas = [mkFila({ moneda_original: 'USD', monto_original: 100, monto_usd: 100, monto_bs: 3600 })];
    const preparacion = {
      porMetodoMoneda: [
        { metodo: 'zelle', metodoLabel: 'Zelle', moneda: 'USD', monto: 100, nOrdenes: 1 },
      ],
      totalesPorMoneda: [
        { moneda: 'USD', monto: 100, nOrdenes: 1 },
      ],
      sinMetodo: { usd: 0, bs: 0, nOrdenes: 0 },
    };
    const t = textoWhatsappTesoreria(filas, { ambito: 'por_pagar', ...RANGO, mostrarBs: false, preparacion });
    expect(t).toContain('DIVISA · USD: $ 100,00');
    expect(t).not.toContain('🪙');
    expect(t).not.toContain('Bs');
  });
});
