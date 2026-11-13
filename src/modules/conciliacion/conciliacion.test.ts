import { describe, expect, it } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import {
  armarFila, celda, comprobanteDePago, hayFiltrosActivos, datosConciliacion, estadoConciliacion, filtrar, ordenesConciliables, referenciaDePago, retencionDeOrden,
  tarjetas, textoReferenciaPago, textoRetencion, textoWhatsappConciliacion, tieneReferencia, COLUMNAS_CONCILIACION,
} from './conciliacion';

// Record suelto: la traza real trae claves extra (referencia_bs, binance_orden) que el tipo no lista.
const oc = (p: Record<string, unknown>): Orden => ({
  id: 'o1', codigo: 'SP-1', oc_codigo: 'OC-2026-0001', estado: 'pagada', total: 100, moneda: 'USD',
  items: [], historial: [], oc_creada_en: '2026-11-10T12:00:00Z', ...p,
} as unknown as Orden);

describe('conciliación · estado de Compras', () => {
  it('«Confirmada pagar» se lee como ESPERANDO PAGO', () => {
    expect(estadoConciliacion('oc_aprobada').label).toBe('Esperando pago');
    expect(estadoConciliacion('confirmada_metodo').grupo).toBe('esperando_pago');
    expect(estadoConciliacion('recibida').label).toBe('Recibida');
    expect(estadoConciliacion('finalizada').label).toBe('Finalizada');
  });
  it('solo entran las OC con código y que no estén canceladas, las más nuevas primero', () => {
    const r = ordenesConciliables([
      oc({ id: 'a', oc_codigo: null as unknown as string }),
      oc({ id: 'b', estado: 'cancelada' }),
      oc({ id: 'c', oc_creada_en: '2026-11-01T00:00:00Z' }),
      oc({ id: 'd', oc_creada_en: '2026-11-11T00:00:00Z' }),
      oc({ id: 'e', oc_creada_en: '2026-10-31T12:00:00Z' }), // Excluida por ser anterior a noviembre
      oc({ id: 'f', oc_creada_en: '2026-09-15T08:00:00Z' }), // Excluida
      oc({ id: 'g', oc_creada_en: '2026-10-20T00:00:00Z', pagada_en: '2026-11-02T10:00:00Z' }), // Entra por fecha de pago en noviembre
    ]);
    expect(r.map((o) => o.id)).toEqual(['d', 'c', 'g']);
  });
});

describe('conciliación · referencia y retención', () => {
  it('toma la referencia que Tesorería cargó al pagar', () => {
    expect(referenciaDePago([{ evento: 'pagada', referencia_bs: '4821' }])).toEqual({ bs: '4821', binance: null, manual: null });
    expect(referenciaDePago([{ evento: 'metodo_pago' }])).toEqual({ bs: null, binance: null, manual: null });
    expect(referenciaDePago(null)).toEqual({ bs: null, binance: null, manual: null });
  });
  it('la referencia colocada con el lápiz en Conciliación se suma a la de Tesorería (la última manda)', () => {
    const h = [
      { evento: 'pagada', referencia_bs: '4821' },
      { evento: 'referencia_conciliacion', referencia: '000111' },
      { evento: 'referencia_conciliacion', referencia: ' 000222 ' },
    ];
    const r = referenciaDePago(h);
    expect(r).toEqual({ bs: '4821', binance: null, manual: '000222' });
    expect(textoReferenciaPago(r)).toBe('Bs …4821 · Ref. 000222');
    expect(tieneReferencia(referenciaDePago([{ evento: 'referencia_conciliacion', referencia: '9' }]))).toBe(true);
    // Vaciarla la quita.
    expect(referenciaDePago([...h, { evento: 'referencia_conciliacion', referencia: null }]).manual).toBeNull();
  });
  it('comprobante de pago: manda el de Tesorería; si no, el cargado en Conciliación', () => {
    const conc = { evento: 'referencia_conciliacion', referencia: '1', comprobante_path: 'o1/conciliacion-pago-1-a.pdf', comprobante_nombre: 'a.pdf' };
    expect(comprobanteDePago([conc])).toEqual({ path: 'o1/conciliacion-pago-1-a.pdf', nombre: 'a.pdf', fuente: 'conciliacion' });
    expect(comprobanteDePago([{ evento: 'pagada', comprobante_path: 'o1/pago-t.pdf', comprobante_nombre: 't.pdf' }, conc]))
      .toEqual({ path: 'o1/pago-t.pdf', nombre: 't.pdf', fuente: 'tesoreria' });
    expect(comprobanteDePago([{ evento: 'pagada' }])).toBeNull();
    expect(datosConciliacion([conc, { evento: 'referencia_conciliacion', referencia: '2' }])?.comprobante).toBeNull();
  });
  it('junta los tipos de Compras y del libro fiscal con el N° de comprobante', () => {
    const r = retencionDeOrden(oc({ retenciones: [{ tipo: 'IVA', modo: 'pct', valor: 75, monto: 12 }] as unknown }), [{ tipo: 'islr', numero: '20261100000012' }]);
    expect(r.lleva).toBe(true);
    expect(r.tipos).toEqual(['IVA', 'ISLR']);
    expect(textoRetencion(r)).toBe('IVA, ISLR · N° 20261100000012');
    expect(retencionDeOrden(oc({})).lleva).toBe(false);
    expect(textoRetencion(retencionDeOrden(oc({ retencion_momento: 'antes' })))).toBe('Sí · pendiente');
  });
});

describe('conciliación · montos, tarjetas y filtros', () => {
  it('pagada: Bs a la tasa del día de pago; sin pagar: a la de hoy', () => {
    const p = armarFila({ orden: oc({ pagada_en: '2026-11-10T15:00:00Z' }), proveedor: 'X', tasaPago: 40, tasaHoy: 45 }, 1);
    expect(p.montoBs).toBe(4000);
    expect(p.tasaEsDeHoy).toBe(false);
    const s = armarFila({ orden: oc({ estado: 'oc_aprobada' }), proveedor: 'X', tasaPago: null, tasaHoy: 45 }, 2);
    expect(s.montoBs).toBe(4500);
    expect(s.tasaEsDeHoy).toBe(true);
    expect(s.pagado).toBe(false);
    expect(celda(s, 'tasa')).toContain('(hoy)');
  });
  it('las tarjetas suman total, pagado y con retención', () => {
    const filas = [
      armarFila({ orden: oc({ id: 'a', pagada_en: '2026-11-10T15:00:00Z', historial: [{ evento: 'pagada', referencia_bs: '1111' }] }), proveedor: 'A', tasaPago: 40, tasaHoy: 45 }, 1),
      armarFila({ orden: oc({ id: 'b', estado: 'oc_aprobada', retencion_momento: 'antes' }), proveedor: 'B', tasaPago: null, tasaHoy: 45 }, 2),
    ];
    const t = tarjetas(filas);
    expect(t.totalOc).toMatchObject({ cantidad: 2, usd: 200 });
    expect(t.pagado).toMatchObject({ cantidad: 1, usd: 100, bs: 4000, ids: ['a'] });
    expect(t.conRetencion.ids).toEqual(['b']);
    expect(filtrar(filas, { referencia: ['con'] }).map((f) => f.id)).toEqual(['a']);
    expect(filtrar(filas, { grupo: ['esperando_pago'] })[0]).toMatchObject({ id: 'b', item: 1 });
    // Casillas: varias marcadas suman; ninguna = todas.
    expect(filtrar(filas, { referencia: ['con', 'sin'] })).toHaveLength(filas.length);
    expect(filtrar(filas, { grupo: [] })).toHaveLength(filas.length);
    expect(hayFiltrosActivos({ grupo: [], texto: '' })).toBe(false);
    expect(hayFiltrosActivos({ pago: ['pagadas'] })).toBe(true);
    expect(filtrar(filas, { texto: 'proveedor b' }).length).toBe(0);
    expect(filtrar(filas, { texto: '1111' }).map((f) => f.id)).toEqual(['a']);
  });
  it('el WhatsApp trae el resumen y cada OC', () => {
    const filas = [armarFila({ orden: oc({ pagada_en: '2026-11-10T15:00:00Z', historial: [{ evento: 'pagada', binance_orden: '7730' }] }), proveedor: 'ACME', tasaPago: 40, tasaHoy: 45 }, 1)];
    const t = textoWhatsappConciliacion(filas);
    expect(t).toContain('*Total de órdenes:* 1 (1 OC) · $100,00');
    expect(t).toContain('1. *OC-2026-0001* ACME');
    expect(t).toContain('Ref.: Binance …7730');
    expect(t).not.toMatch(/️/);
  });
});

describe('conciliación · rango de fechas del reporte', () => {
  const filas = [
    armarFila({ orden: oc({ id: 'a', oc_creada_en: '2026-10-05T15:00:00Z', pagada_en: '2026-11-03T15:00:00Z' }), proveedor: 'A', tasaPago: 40, tasaHoy: 45 }, 1),
    armarFila({ orden: oc({ id: 'b', oc_creada_en: '2026-11-02T15:00:00Z', estado: 'oc_aprobada' }), proveedor: 'B', tasaPago: null, tasaHoy: 45 }, 2),
  ];
  it('por fecha de la OC (día de Venezuela)', () => {
    expect(filtrar(filas, { desde: '2026-11-01', hasta: '2026-11-30' }).map((f) => f.id)).toEqual(['b']);
    // 01:00Z del 1-nov aún es 31-oct en Caracas
    const tarde = armarFila({ orden: oc({ id: 'c', oc_creada_en: '2026-11-01T01:00:00Z' }), proveedor: 'C', tasaPago: null, tasaHoy: 45 }, 1);
    expect(filtrar([tarde], { desde: '2026-11-01' })).toHaveLength(0);
  });
  it('por fecha de pago: solo las pagadas dentro del rango', () => {
    expect(filtrar(filas, { desde: '2026-11-01', hasta: '2026-11-30', fechaBase: 'pago' }).map((f) => f.id)).toEqual(['a']);
  });
});

describe('conciliación · órdenes de servicio', () => {
  const sv = (p: Record<string, unknown>) => oc({ clase: 'servicio', codigo: 'SV-2026-0039', oc_codigo: null, ...p });
  it('entran las de servicio ya en control (sin código de OC); no las que siguen en solicitud', () => {
    const r = ordenesConciliables([
      sv({ id: 's1', oc_creada_en: '2026-11-12T12:00:00Z' }),
      sv({ id: 's2', oc_creada_en: null, estado: 'pendiente' }),
      sv({ id: 's3', estado: 'cancelada' }),
      oc({ id: 'p1', clase: 'producto', oc_codigo: null }),
    ]);
    expect(r.map((o) => o.id)).toEqual(['s1']);
  });
  it('se marcan como servicio, se filtran por tipo y el total las desglosa', () => {
    const filas = [
      armarFila({ orden: sv({ id: 's1' }), proveedor: 'TALLER', tasaPago: null, tasaHoy: 45 }, 1),
      armarFila({ orden: oc({ id: 'o1' }), proveedor: 'ACME', tasaPago: null, tasaHoy: 45 }, 2),
    ];
    expect(filas[0]).toMatchObject({ tipo: 'servicio', codigo: 'SV-2026-0039' });
    expect(celda(filas[0], 'tipo')).toBe('Servicio');
    expect(filtrar(filas, { tipo: ['servicio'] }).map((f) => f.id)).toEqual(['s1']);
    expect(filtrar(filas, { tipo: ['oc'] }).map((f) => f.id)).toEqual(['o1']);
    expect(tarjetas(filas).totalOc).toMatchObject({ cantidad: 2, oc: 1, servicios: 1 });
    const w = textoWhatsappConciliacion(filas);
    expect(w).toContain('(1 OC · 1 servicio)');
    expect(w).toContain('🔧 *SV-2026-0039* (servicio) TALLER');
  });

  it('DRIVE/BANCO es la última columna en la tabla y reportes', () => {
    const claves = COLUMNAS_CONCILIACION.map((c) => c.clave);
    expect(claves[claves.length - 1]).toBe('drive');
    const idxDrive = claves.indexOf('drive');
    expect(claves.indexOf('retencion')).toBeLessThan(idxDrive);
    expect(claves.indexOf('factura')).toBeLessThan(idxDrive);
    expect(claves.indexOf('estado')).toBeLessThan(idxDrive);
  });
});
