import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import {
  armarCsv, borrarPlantilla, filtrarReporte, guardarPlantilla, leerPlantillas, numeroCsv, ordenarReporte,
  rangoDePeriodo, retenidoBs, tablaCruzada, tablaDeCruzada, tablaDetalle, totalesReporte, type FiltroReporte,
} from './reportesRetenciones';

// Datos inventados: ningún proveedor ni factura real.
const ret = (over: Partial<RetencionPracticada> = {}): RetencionPracticada => ({
  id: 'r-1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: null,
  contraparteId: 'p-1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Uno', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: '00-000123', facturaFecha: '2026-10-05', periodo: '202610', quincena: 1,
  numeroComprobante: '20261000000001', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120, montoBs: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, declaradaPor: null, actorName: null, createdAt: '2026-10-06T12:00:00Z', updatedAt: null, ...over,
});

const filtro = (over: Partial<FiltroReporte> = {}): FiltroReporte => ({
  impuestos: { iva: true, islr: true, isae: true, estadal: true, igtf: true },
  direccion: '', estado: '', moneda: '', proveedor: '', fechaBase: 'factura', ...over,
});

describe('rango del período', () => {
  it('atajos sobre un día de referencia', () => {
    expect(rangoDePeriodo('quincena_actual', '2026-10-16')).toEqual({ desde: '2026-10-16', hasta: '2026-10-31' });
    expect(rangoDePeriodo('quincena_anterior', '2026-10-16')).toEqual({ desde: '2026-10-01', hasta: '2026-10-15' });
    expect(rangoDePeriodo('quincena_anterior', '2026-10-03')).toEqual({ desde: '2026-09-16', hasta: '2026-09-30' });
    expect(rangoDePeriodo('mes_anterior', '2026-01-10')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    expect(rangoDePeriodo('semana_actual', '2026-10-16')).toEqual({ desde: '2026-10-12', hasta: '2026-10-18' });
    expect(rangoDePeriodo('anio_anterior', '2026-10-16')).toEqual({ desde: '2025-01-01', hasta: '2025-12-31' });
  });

  it('lo elegido a mano; incompleto da null', () => {
    expect(rangoDePeriodo('mes', '2026-10-16', { mes: '2026-02' })).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoDePeriodo('rango', '2026-10-16', { desde: '2026-10-20', hasta: '2026-10-01' })).toEqual({ desde: '2026-10-01', hasta: '2026-10-20' });
    expect(rangoDePeriodo('mes', '2026-10-16', {})).toBeNull();
    expect(rangoDePeriodo('rango', '2026-10-16', { desde: '2026-10-01' })).toBeNull();
  });
});

describe('filtros de la pantalla', () => {
  const rango = { desde: '2026-10-01', hasta: '2026-10-31' };
  const filas = [
    ret(),
    ret({ id: 'r-2', tipo: 'islr', contraparteNombre: 'Servicios Dos', contraparteRif: 'J-00000002-0' }),
    ret({ id: 'r-3', tipo: 'municipal', direccion: 'recibida' }),
    ret({ id: 'r-4', anulada: true }),
    ret({ id: 'r-5', estado: 'declarada', moneda: 'USD', tasa: 40, montoBs: null, montoRetenido: 3 }),
    ret({ id: 'r-6', facturaFecha: '2026-09-30' }),
  ];
  const ids = (f: Partial<FiltroReporte>) => filtrarReporte(filas, filtro(f), rango).map((r) => r.id);

  it('impuesto (ISAE = municipal), dirección, estado, moneda y rango', () => {
    expect(ids({ impuestos: { isae: true } })).toEqual(['r-3']);
    expect(ids({ direccion: 'recibida' })).toEqual(['r-3']);
    expect(ids({})).toEqual(['r-1', 'r-2', 'r-3', 'r-5']);              // sin anuladas ni fuera de rango
    expect(ids({ estado: 'anulada' })).toEqual(['r-4']);
    expect(ids({ estado: 'declarada' })).toEqual(['r-5']);
    expect(ids({ estado: 'todas' })).toEqual(['r-1', 'r-2', 'r-3', 'r-4', 'r-5']);
    expect(ids({ moneda: 'USD' })).toEqual(['r-5']);
  });

  it('proveedor por nombre (sin acentos) o por RIF escrito de cualquier forma', () => {
    expect(ids({ proveedor: 'servícios' })).toEqual(['r-2']);
    expect(ids({ proveedor: 'j000000020' })).toEqual(['r-2']);
  });

  it('la fecha de registro cambia qué entra al rango', () => {
    expect(filtrarReporte([ret({ id: 'x', facturaFecha: '2026-09-30', createdAt: '2026-10-02T10:00:00Z' })], filtro({ fechaBase: 'registro' }), rango)).toHaveLength(1);
  });
});

describe('montos en Bs y totales', () => {
  it('lo retenido en Bs: lo guardado, o el monto por la tasa; sin tasa, null', () => {
    expect(retenidoBs(ret({ montoBs: 99 }))).toBe(99);
    expect(retenidoBs(ret({ moneda: 'USD', tasa: 40, montoBs: null, montoRetenido: 3 }))).toBe(120);
    expect(retenidoBs(ret({ moneda: 'USD', tasa: null, montoBs: null }))).toBeNull();
  });

  it('totales: Bs primero, una entrada por moneda, sin anuladas; cuenta las que no tienen tasa', () => {
    const t = totalesReporte([ret(), ret({ moneda: 'USD', tasa: 40, montoBs: null, montoRetenido: 3 }), ret({ anulada: true }), ret({ moneda: 'USD', tasa: null, montoBs: null, montoRetenido: 1 })]);
    expect(t.retenidoBs).toBe(240);
    expect(t.sinTasa).toBe(1);
    expect(t.porMoneda).toEqual([
      { moneda: 'Bs', registros: 1, base: 1000, retenido: 120 },
      { moneda: 'USD', registros: 2, base: 2000, retenido: 4 },
    ]);
  });

  it('notas de crédito restan en totales, retenidoBs y tablaCruzada', () => {
    const fac = ret({ baseImponible: 1000, montoRetenido: 120, montoBs: 120, tipoDocumento: 'factura' });
    const nc = ret({ id: 'r-nc', baseImponible: 200, montoRetenido: 24, montoBs: 24, tipoDocumento: 'nota_credito' });
    expect(retenidoBs(nc)).toBe(-24);
    const t = totalesReporte([fac, nc]);
    expect(t.retenidoBs).toBe(96);
    expect(t.porMoneda).toEqual([{ moneda: 'Bs', registros: 2, base: 800, retenido: 96 }]);
    const c = tablaCruzada([fac, nc]);
    expect(c.total).toBe(96);
  });

  it('ordenar por monto retenido en Bs, mayor primero', () => {
    const xs = ordenarReporte([ret({ id: 'a', montoBs: 10 }), ret({ id: 'b', montoBs: 50 })], 'retenido', 'factura');
    expect(xs.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('tabla del detalle', () => {
  it('con un corte por proveedor: subtotal por grupo y total final en Bs', () => {
    const t = tablaDetalle([ret(), ret({ id: 'r-2', contraparteNombre: 'Servicios Dos', contraparteRif: 'J-00000002-0', montoBs: 30 })], ['nombre', 'retenido_bs'], 'proveedor', 'factura');
    expect(t.encabezados).toEqual(['Proveedor', 'Retenido (Bs)']);
    expect(t.filas).toEqual([
      ['Proveedor Uno', 120], ['Subtotal · Proveedor Uno · J-00000001-0', 120],
      ['Servicios Dos', 30], ['Subtotal · Servicios Dos · J-00000002-0', 30],
      ['Total', 150],
    ]);
    expect(t.totales).toEqual([1, 3, 4]);
    expect(t.numeros).toEqual([1]);
  });

  it('sin columnas no se arma', () => {
    expect(() => tablaDetalle([ret()], [], 'ninguno', 'factura')).toThrow('al menos una columna');
  });
});

describe('retenido por proveedor y período', () => {
  it('proveedor × período en Bs, de mayor a menor, con totales por período', () => {
    const c = tablaCruzada([
      ret({ periodo: '202609', montoBs: 100 }),
      ret({ periodo: '202610', montoBs: 50 }),
      ret({ contraparteNombre: 'Servicios Dos', contraparteRif: 'J-00000002-0', periodo: '202610', montoBs: 400 }),
      ret({ periodo: '202610', montoBs: 999, anulada: true }),
    ]);
    expect(c.periodos).toEqual(['202609', '202610']);
    expect(c.proveedores.map((p) => [p.nombre, p.porPeriodo, p.total])).toEqual([
      ['Servicios Dos', { 202610: 400 }, 400],
      ['Proveedor Uno', { 202609: 100, 202610: 50 }, 150],
    ]);
    expect(c.totalPorPeriodo).toEqual({ 202609: 100, 202610: 450 });
    expect(c.total).toBe(550);

    const t = tablaDeCruzada(c);
    expect(t.encabezados).toEqual(['Proveedor', 'RIF', 'septiembre 2026', 'octubre 2026', 'Total (Bs)']);
    expect(t.filas[1]).toEqual(['Proveedor Uno', 'J-00000001-0', 100, 50, 150]);
    expect(t.filas[2]).toEqual(['Total (Bs)', null, 100, 450, 550]);
    expect(t.totales).toEqual([2]);
    expect(t.numeros).toEqual([2, 3, 4]);
  });
});

describe('CSV', () => {
  it('«;» como separador, coma decimal sin miles, CRLF y comillas cuando hace falta', () => {
    const csv = armarCsv({
      encabezados: ['Proveedor', 'Monto'],
      filas: [['Uno; y "dos"', 1234.5], ['Tres', null], ['Cuatro', 0.1 + 0.2]],
      numeros: [1], totales: [],
    });
    expect(csv).toBe('Proveedor;Monto\r\n"Uno; y ""dos""";1234,50\r\nTres;\r\nCuatro;0,30\r\n');
  });

  it('un número en una columna de texto va tal cual', () => {
    expect(armarCsv({ encabezados: ['Período'], filas: [[202610]], numeros: [], totales: [] })).toBe('Período\r\n202610\r\n');
    expect(numeroCsv(-3.456)).toBe('-3,46');
  });
});

describe('mis plantillas', () => {
  const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  const p = {
    nombre: 'IVA de la quincena', base: 'relacion_iva', periodo: 'quincena_anterior' as const, eleccion: {},
    filtro: filtro(), agrupar: 'ninguno' as const, orden: 'fecha' as const, columnas: ['nombre'], orientacion: 'horizontal' as const,
  };

  it('guarda por usuario, reemplaza por nombre y borra', () => {
    const s = memoria();
    guardarPlantilla('a@ejemplo.com', p, s);
    const dos = guardarPlantilla('A@ejemplo.com', { ...p, nombre: ' iva de la QUINCENA ', agrupar: 'proveedor' }, s);
    expect(dos).toHaveLength(1);
    expect(dos[0].agrupar).toBe('proveedor');
    expect(leerPlantillas('otro@ejemplo.com', s)).toEqual([]);
    expect(borrarPlantilla('a@ejemplo.com', dos[0].id, s)).toEqual([]);
  });

  it('sin nombre, o con el almacenamiento bloqueado, avisa; lo ilegible se lee vacío', () => {
    const s = memoria();
    expect(() => guardarPlantilla('a@ejemplo.com', { ...p, nombre: '  ' }, s)).toThrow('nombre');
    expect(() => guardarPlantilla('a@ejemplo.com', p, { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } })).toThrow('no deja guardar');
    expect(leerPlantillas('a@ejemplo.com', { getItem: () => '{roto' })).toEqual([]);
  });
});
