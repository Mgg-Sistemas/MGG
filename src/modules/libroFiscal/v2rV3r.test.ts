import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const rpc = vi.fn();
let hayTablas = true;
let hayV2R = true;

function consulta(tabla: string) {
  const reg = { tabla, metodos: [] as unknown[][] };
  llamadas.push(reg);
  const resp = cola.shift() ?? { data: [], error: null };
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, ko);
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t), rpc: (...a: unknown[]) => rpc(...a) } }));
// Solo la tabla de impuestos (R2) y la de períodos (V3R) «existen»; R3 no.
vi.mock('./disponibilidad', () => ({
  tablaDisponible: async (t: string) => hayTablas && (t === 'retencion_impuestos' || t === 'retencion_periodos'),
  r2Disponible: async () => hayTablas,
  v2rDisponible: async () => hayV2R,
}));

import {
  aPeriodo, cambiarDeclara, cambiarVence, conteoDelPeriodo, estadoPeriodo, listPeriodos, nombrePeriodo,
} from './periodosRetencion.repository';
import { registrarRetencion, type NuevaRetencion } from './retencionesFiscal.repository';
import { CONFIG_RETENCION_DEFECTO, numeroConFormato } from './retencionesCalculo';
import { errorRetencion } from './erroresRetencion';
import { numerarSinV2R } from './retencionFacturas.repository';
import { rifValido } from '@/shared/lib/rif';

// Datos inventados: un RIF de prueba con su dígito verificador correcto.
const RIF = (() => {
  for (let d = 0; d <= 9; d += 1) if (rifValido(`J-00000001-${d}`)) return `J-00000001-${d}`;
  throw new Error('sin RIF de prueba');
})();
beforeEach(() => { cola.length = 0; llamadas.length = 0; rpc.mockReset(); hayTablas = true; hayV2R = true; });

describe('períodos (V3R): piezas puras', () => {
  const p = (over: Record<string, unknown> = {}) => aPeriodo({ id: 'p-1', tipo: 'IVA', periodo: '202610', tramo: 1, periodicidad: 'quincenal', desde: '2026-10-01', hasta: '2026-10-15', ...over });

  it('nombre del período según su periodicidad y tramo', () => {
    expect(nombrePeriodo(p())).toBe('Octubre 2026 · 1.ª quincena');
    expect(nombrePeriodo(p({ tramo: 0, periodicidad: 'mensual' }))).toBe('Octubre 2026');
    expect(nombrePeriodo(p({ tramo: 0, periodicidad: 'anual', periodo: '202601' }))).toBe('Año 2026');
  });

  it('estado: declarado, del otro sistema, vencido o abierto', () => {
    expect(estadoPeriodo(p({ declarado_en: '2026-10-20T10:00:00Z' }))).toBe('declarado');
    expect(estadoPeriodo(p({ declara: 'otro_sistema' }))).toBe('otro_sistema');
    expect(estadoPeriodo(p({ vence: '2026-10-20' }), '2026-10-21')).toBe('vencido');
    expect(estadoPeriodo(p({ vence: '2026-10-20' }), '2026-10-20')).toBe('abierto');
  });

  it('conteo: período fiscal y, si es quincenal, la quincena', () => {
    const rs = [
      { tipoGt: 'IVA', periodo: '202610', quincena: 1 as const, declarada: false },
      { tipoGt: 'IVA', periodo: '202610', quincena: 2 as const, declarada: false },
      { tipoGt: 'IVA', periodo: '202610', quincena: 1 as const, declarada: true },
      { tipoGt: 'ISLR', periodo: '202610', quincena: null, declarada: false },
    ];
    expect(conteoDelPeriodo(p(), rs)).toEqual({ total: 2, declaradas: 1 });
    expect(conteoDelPeriodo(p({ tipo: 'ISLR', tramo: 0, periodicidad: 'mensual' }), rs)).toEqual({ total: 1, declaradas: 0 });
  });
});

describe('períodos (V3R): base', () => {
  it('lista los del año (y de un impuesto)', async () => {
    cola.push({ data: [{ id: 'p-1', tipo: 'IVA', periodo: '202610', tramo: 1, periodicidad: 'quincenal', desde: '2026-10-01', hasta: '2026-10-15' }], error: null });
    const xs = await listPeriodos(2026, 'IVA');
    expect(llamadas[0].tabla).toBe('retencion_periodos');
    expect(llamadas[0].metodos).toContainEqual(['gte', 'periodo', '202601']);
    expect(llamadas[0].metodos).toContainEqual(['lte', 'periodo', '202612']);
    expect(llamadas[0].metodos).toContainEqual(['eq', 'tipo', 'IVA']);
    expect(xs[0].tramo).toBe(1);
  });

  it('quién declara: con motivo_cambio; vencimiento: solo la fecha; ambos exigen filas', async () => {
    await expect(cambiarDeclara('p-1', 'otro_sistema', ' ')).rejects.toThrow('por qué');
    cola.push({ data: [{ id: 'p-1' }], error: null });
    await cambiarDeclara('p-1', 'otro_sistema', 'Lo declara el sistema anterior este mes');
    expect(llamadas[0].metodos).toContainEqual(['update', { declara: 'otro_sistema', motivo_cambio: 'Lo declara el sistema anterior este mes' }]);
    cola.push({ data: [], error: null });
    await expect(cambiarVence('p-1', '2026-10-20')).rejects.toThrow('sin permiso');
    await expect(cambiarVence('p-1', '20/10/2026')).rejects.toThrow('no es válida');
    expect(errorRetencion({ code: 'P0001', message: 'RET_ANIO_INVALIDO: 1999' }).message).toMatch(/2020 y 2100/);
  });
});

describe('V2R: el número dado se valida con la serie de retencion_impuestos', () => {
  const nueva = (over: Partial<NuevaRetencion> = {}): NuevaRetencion => ({
    tipo: 'islr', direccion: 'practicada', docKind: 'manual', contraparteRif: RIF, contraparteNombre: 'Proveedor de prueba',
    facturaNumero: '000123', facturaFecha: '2026-10-05', periodo: '202610', baseImponible: 1000, porcentaje: 2, montoRetenido: 20,
    actor: 'prueba@ejemplo.com', ...over,
  } as NuevaRetencion);

  it('formato por la serie: un ISLR que en la tabla es AAAAMM8 pide 14 dígitos', async () => {
    cola.push({ data: [], error: null });                                   // doble registro
    cola.push({ data: { numera: true, serie_formato: 'AAAAMM8' }, error: null }); // serie del impuesto
    await expect(registrarRetencion(nueva({ numeroComprobante: '0000000120' }), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('14 dígitos');
    expect(llamadas[1].tabla).toBe('retencion_impuestos');
    expect(llamadas[1].metodos).toContainEqual(['eq', 'clave', 'ISLR']);
  });

  it('un impuesto que no numera (según la tabla) acepta el número tal cual', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: { numera: false, serie_formato: null }, error: null });
    cola.push({ data: { id: 'r-1', rol: 'practicada', tipo: 'ISLR', estado: 'registrada', comprobante_nro: 'X-1' }, error: null });
    const r = await registrarRetencion(nueva({ numeroComprobante: 'X-1' }), CONFIG_RETENCION_DEFECTO);
    expect(r.numeroComprobante).toBe('X-1');
  });

  it('sin R2, las reglas fijas (ISLR: 10 dígitos)', async () => {
    hayTablas = false;
    cola.push({ data: [], error: null });
    await expect(registrarRetencion(nueva({ numeroComprobante: '20261000000120' }), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('10 dígitos');
    expect(numeroConFormato('0000000120', 'N10')).toBe(true);
    expect(numeroConFormato('0000000120', 'AAAAMM8')).toBe(false);
  });
});

describe('sin V2R (la base de hoy): el front pide el número como hasta ahora', () => {
  const nuevaIva = (over: Partial<NuevaRetencion> = {}): NuevaRetencion => ({
    tipo: 'iva', direccion: 'practicada', docKind: 'manual', contraparteRif: RIF, contraparteNombre: 'Proveedor de prueba',
    facturaNumero: '000123', facturaFecha: '2026-10-05', periodo: '202610', quincena: 1, baseImponible: 1000, impuesto: 160,
    porcentaje: 75, montoRetenido: 120, actor: 'prueba@ejemplo.com', ...over,
  } as NuevaRetencion);

  it('suelto: pide siguiente_numero_retencion y lo arma AAAAMM + 8', async () => {
    hayV2R = false; hayTablas = false;
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-1', rol: 'practicada', tipo: 'IVA', estado: 'registrada', comprobante_nro: '20261000000007' }, error: null });
    rpc.mockResolvedValueOnce({ data: 7, error: null });
    await registrarRetencion(nuevaIva(), CONFIG_RETENCION_DEFECTO);
    expect(rpc).toHaveBeenCalledWith('siguiente_numero_retencion', { p_tipo: 'IVA', p_periodo: '202610' });
    const ins = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(ins).toMatchObject({ numero: 7, comprobante_nro: '20261000000007' });
  });

  it('suelto: una recibida no pide número', async () => {
    hayV2R = false; hayTablas = false;
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-2', rol: 'sufrida', tipo: 'IVA', estado: 'registrada', comprobante_nro: 'C-1' }, error: null });
    await registrarRetencion(nuevaIva({ direccion: 'recibida', numeroComprobante: 'C-1' }), CONFIG_RETENCION_DEFECTO);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('factura: cada línea practicada sin número (no IGTF) lo pide y viaja en comprobante_nro', async () => {
    hayV2R = false;
    rpc.mockResolvedValueOnce({ data: 7, error: null }).mockResolvedValueOnce({ data: 31, error: null });
    const ls = await numerarSinV2R({ direccion: 'practicada', periodo: '202610', facturaFecha: '2026-10-05' }, [
      { tipo: 'iva', base: 1000, porcentaje: 75, monto: 120 },
      { tipo: 'islr', base: 1000, porcentaje: 2, monto: 20 },
      { tipo: 'igtf', base: 100, porcentaje: 3, monto: 3 },
      { tipo: 'municipal', base: 1000, porcentaje: 1, monto: 10, comprobanteNro: '20261000000099' },
    ]);
    expect(ls.map((l) => l.comprobanteNro ?? null)).toEqual(['20261000000007', '20261000000031', null, '20261000000099']);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('factura: con V2R o en una recibida, no pide números', async () => {
    const l = [{ tipo: 'iva' as const, base: 1000, porcentaje: 75, monto: 120 }];
    expect(await numerarSinV2R({ direccion: 'practicada', periodo: '202610' }, l)).toBe(l);
    hayV2R = false;
    expect(await numerarSinV2R({ direccion: 'recibida', periodo: '202610' }, l)).toBe(l);
    expect(rpc).not.toHaveBeenCalled();
  });
});
