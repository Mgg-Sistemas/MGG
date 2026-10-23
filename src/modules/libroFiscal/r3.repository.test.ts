import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supabase falso: from() toma la siguiente respuesta de la cola; rpc responde por (impuesto, clave). R3 se controla aparte. */
const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
let valoresRpc: Record<string, unknown> = {};
let hayR3 = true;

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
const rpc = vi.fn(async (_f: string, a: { p_impuesto: string | null; p_clave: string; p_fecha: string }) =>
  ({ data: valoresRpc[`${a.p_impuesto ?? '*'}:${a.p_clave}`] ?? null, error: null }));

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t), rpc: (f: string, a: never) => rpc(f, a) } }));
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => hayR3, r2Disponible: async () => false }));

import {
  aValor, configDeFecha, corregirValor, faltaEnClave, faltaEnValor, leerValor, mostrarValor, nuevoValor, renglones, valorEnFecha,
  type ClaveParametro, type ValorParametro,
} from './parametros.repository';
import { guardarTiposLicencia, listTiposLicencia } from './retencionesFiscal.repository';
import { CONFIG_RETENCION_DEFECTO } from './retencionesCalculo';
import { errorRetencion } from './erroresRetencion';

// Datos inventados.
const clave = (over: Partial<ClaveParametro> = {}): ClaveParametro => ({
  clave: 'ut', nombre: 'Unidad tributaria', ambito: 'general', tipoValor: 'numero', unidad: 'Bs', descripcion: null, orden: 1, activo: true, ...over,
});
const val = (id: string, desde: string, valor: number, over: Partial<ValorParametro> = {}): ValorParametro => ({
  id, impuestoClave: null, clave: 'ut', valor, desde, hasta: null, fuente: null, motivo: 'x', actualizadoEn: null, actualizadoPor: null, ...over,
});

beforeEach(() => { cola.length = 0; llamadas.length = 0; valoresRpc = {}; hayR3 = true; rpc.mockClear(); });

describe('valores: piezas puras', () => {
  it('el valor de una fecha (sin vigente antes de la primera)', () => {
    const xs = [val('a', '2025-06-02', 9, { hasta: '2026-10-15' }), val('b', '2026-10-16', 43)];
    expect(valorEnFecha(xs, null, 'ut', '2026-01-10')?.valor).toBe(9);
    expect(valorEnFecha(xs, null, 'ut', '2026-10-16')?.valor).toBe(43);
    expect(valorEnFecha(xs, null, 'ut', '2025-01-01')).toBeNull();
  });

  it('lee lo escrito según el tipo: coma decimal, miles, sí/no', () => {
    expect(leerValor('numero', '43,5')).toEqual({ valor: 43.5 });
    expect(leerValor('numero', '1.234,56')).toEqual({ valor: 1234.56 });
    expect(leerValor('numero', '75')).toEqual({ valor: 75 });
    expect(leerValor('numero', 'abc')).toHaveProperty('error');
    expect(leerValor('si_no', 'si')).toEqual({ valor: true });
    expect(leerValor('texto', '  ')).toHaveProperty('error');
  });

  it('muestra con su unidad', () => {
    expect(mostrarValor(75, '%')).toBe('75 %');
    expect(mostrarValor(30, 'dias')).toBe('30 días');
    expect(mostrarValor(true, null)).toBe('Sí');
    expect(mostrarValor(null, 'Bs')).toBe('—');
  });

  it('ámbito: general sin impuesto, de impuesto con impuesto; claves en minúsculas', () => {
    expect(faltaEnValor(clave(), 'IVA', '2026-10-16', 'x')).toMatch(/general/);
    expect(faltaEnValor(clave({ ambito: 'impuesto', clave: 'alicuota' }), null, '2026-10-16', 'x')).toMatch(/indica cuál/);
    expect(faltaEnValor(clave(), null, '2026-10-16', ' ')).toMatch(/motivo/);
    expect(faltaEnClave({ clave: 'Minimo X', nombre: 'Mínimo' })).toMatch(/minúsculas/);
  });

  it('renglones: uno por (impuesto, clave), los generales primero', () => {
    const ks = [clave(), clave({ clave: 'alicuota', nombre: 'Alícuota', ambito: 'impuesto', orden: 2 })];
    const r = renglones(ks, [
      aValor({ id: 'a', impuesto_clave: 'IVA', clave: 'alicuota', valor: 16, desde: '2020-01-01', motivo: 'x' }),
      aValor({ id: 'b', impuesto_clave: null, clave: 'ut', valor: 43, desde: '2026-10-16', motivo: 'x' }),
      aValor({ id: 'c', impuesto_clave: null, clave: 'ut', valor: 9, desde: '2025-06-02', motivo: 'x' }),
    ]);
    expect(r.map((x) => `${x.impuesto ?? '*'}:${x.clave.clave}`)).toEqual(['*:ut', 'IVA:alicuota']);
    expect(r[0].versiones.map((v) => v.id)).toEqual(['b', 'c']);
  });
});

describe('valores: escritura', () => {
  it('nuevo valor: solo «desde» (la base cierra el anterior), con .select(id)', async () => {
    cola.push({ data: [{ id: 'v-1' }], error: null });
    await nuevoValor(clave(), { impuestoClave: null, clave: 'ut', valor: 43, desde: '2026-10-16', fuente: ' Providencia de prueba ', motivo: 'UT nueva' });
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toEqual({
      impuesto_clave: null, clave: 'ut', valor: 43, desde: '2026-10-16', fuente: 'Providencia de prueba', motivo: 'UT nueva',
    });
    cola.push({ data: [], error: null });
    await expect(nuevoValor(clave(), { impuestoClave: null, clave: 'ut', valor: 43, desde: '2026-10-17', motivo: 'x' })).rejects.toThrow('sin permiso');
  });

  it('RET_PARAMETRO_DESDE se explica con la fecha', async () => {
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_PARAMETRO_DESDE: el valor nuevo de «ut» tiene que empezar después del 16/10/2026. Para corregir el vigente, edítelo.' } });
    await expect(nuevoValor(clave(), { impuestoClave: null, clave: 'ut', valor: 43, desde: '2026-10-01', motivo: 'x' })).rejects.toThrow('después del 16/10/2026');
    expect(errorRetencion({ code: 'P0001', message: 'RET_PARAMETRO_TIPO: x' }).message).toMatch(/tipo/);
  });

  it('corregir: update con motivo, sin tocar «desde»', async () => {
    await expect(corregirValor('v-1', 43, null, '')).rejects.toThrow('motivo');
    cola.push({ data: [{ id: 'v-1' }], error: null });
    await corregirValor('v-1', 43, 'Gaceta de prueba', 'Se escribió 34');
    const upd = llamadas[0].metodos.find((m) => m[0] === 'update')?.[1] as Record<string, unknown>;
    expect(upd).toEqual({ valor: 43, fuente: 'Gaceta de prueba', motivo: 'Se escribió 34' });
  });
});

describe('valores de la fecha de la factura', () => {
  it('con R3, la UT y los % del IVA son los de esa fecha', async () => {
    valoresRpc = { '*:ut': 9, 'IVA:pct_retencion': 75, 'IVA:pct_retencion_art5': 100, 'IGTF:alicuota': 3 };
    const c = await configDeFecha({ ...CONFIG_RETENCION_DEFECTO, valorUt: 43 }, '2026-09-30', ['islr']);
    expect(c.valorUt).toBe(9);
    expect(rpc).toHaveBeenCalledWith('retencion_parametro', { p_impuesto: null, p_clave: 'ut', p_fecha: '2026-09-30' });
  });

  it('sin UT para esa fecha, no se registra (y lo dice con la fecha)', async () => {
    valoresRpc = { 'IVA:pct_retencion': 75, 'IVA:pct_retencion_art5': 100 };
    await expect(configDeFecha(CONFIG_RETENCION_DEFECTO, '2025-05-31', ['islr']))
      .rejects.toThrow('No hay UT cargada para el 31/05/2025. Cárguela en Parámetros → Valores (con su fecha y fuente) antes de registrar.');
  });

  it('IVA sin su % para esa fecha: tampoco; otro impuesto, sí', async () => {
    valoresRpc = { '*:ut': 43 };
    await expect(configDeFecha(CONFIG_RETENCION_DEFECTO, '2026-10-16', ['iva'])).rejects.toThrow('% de retención de IVA');
    await expect(configDeFecha(CONFIG_RETENCION_DEFECTO, '2026-10-16', ['islr'])).resolves.toMatchObject({ valorUt: 43 });
  });

  it('sin R3, la configuración de siempre y sin preguntar a la base', async () => {
    hayR3 = false;
    const base = { ...CONFIG_RETENCION_DEFECTO, valorUt: 43 };
    expect(await configDeFecha(base, '2026-10-16', ['iva'])).toBe(base);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('tipos de licencia', () => {
  it('con R3 se leen de su tabla', async () => {
    cola.push({ data: [{ id: '00000000-0000-4000-8000-000000000001', nombre: 'Licencia de prueba', activo: true }], error: null });
    expect(await listTiposLicencia()).toEqual([{ id: '00000000-0000-4000-8000-000000000001', nombre: 'Licencia de prueba', activo: true }]);
    expect(llamadas[0].tabla).toBe('retencion_licencia_tipos');
  });

  it('con R3 se guardan por fila: los existentes por id, los nuevos insertados; exige filas', async () => {
    cola.push({ data: [{ id: '00000000-0000-4000-8000-000000000001' }], error: null });
    cola.push({ data: [{ id: 'n-1' }], error: null });
    await guardarTiposLicencia([
      { id: '00000000-0000-4000-8000-000000000001', nombre: ' Licencia de prueba ', activo: false },
      { id: 'tmp-1', nombre: 'Licencia temporal de prueba', activo: true },
    ]);
    expect(llamadas[0].metodos.find((m) => m[0] === 'upsert')?.[1]).toEqual([{ id: '00000000-0000-4000-8000-000000000001', nombre: 'Licencia de prueba', activo: false, orden: 0 }]);
    expect(llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1]).toEqual([{ nombre: 'Licencia temporal de prueba', activo: true, orden: 1 }]);
    cola.push({ data: [], error: null });
    await expect(guardarTiposLicencia([{ id: '00000000-0000-4000-8000-000000000001', nombre: 'X1', activo: true }])).rejects.toThrow('sin permiso');
  });

  it('sin R3, siguen en el JSON', async () => {
    hayR3 = false;
    cola.push({ data: { value: { licencia_tipos: [{ id: 'a', nombre: 'Del JSON', activo: true }] } }, error: null });
    expect(await listTiposLicencia()).toEqual([{ id: 'a', nombre: 'Del JSON', activo: true }]);
    expect(llamadas[0].tabla).toBe('config');
  });
});
