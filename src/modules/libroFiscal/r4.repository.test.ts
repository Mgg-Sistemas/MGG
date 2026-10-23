import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];

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

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t), rpc: vi.fn() } }));
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => true }));

import {
  aCodigo, cargarClasificador, codigosDeEnte, corregirValorCodigo, crearCodigo, faltaEnClasificacion, faltaEnValorCodigo,
  leerTablaPegada, nuevoValorCodigo, planCarga, resumenValor, valorVigenteCodigo, type DatosValorCodigo, type ValorCodigo,
} from './clasificaciones.repository';
import { errorRetencion } from './erroresRetencion';

// Datos inventados.
const valor = (id: string, sujeto: ValorCodigo['sujeto'], desde: string, pct: number, over: Partial<ValorCodigo> = {}): ValorCodigo => ({
  id, codigoId: 'c-1', sujeto, pct, basePct: 100, minimo: null, minimoUnidad: null, sustraendoFactor: null, tarifaId: null,
  desde, hasta: null, fuente: null, motivo: 'x', nota: null, actualizadoPor: null, ...over,
});
const datos = (over: Partial<DatosValorCodigo> = {}): DatosValorCodigo => ({
  sujeto: 'PNR', pct: 3, basePct: 100, minimo: 83.3334, minimoUnidad: 'UT', sustraendoFactor: 83.3334, ...over,
});

beforeEach(() => { cola.length = 0; llamadas.length = 0; });

describe('valores de un código', () => {
  it('el del sujeto en la fecha; si no hay, el de «todos» (como la base)', () => {
    const vs = [
      valor('a', 'PNR', '2020-01-01', 3, { hasta: '2026-10-15' }),
      valor('b', 'PNR', '2026-10-16', 4),
      valor('c', null, '2020-01-01', 2),
    ];
    expect(valorVigenteCodigo(vs, 'PNR', '2026-05-01')?.id).toBe('a');
    expect(valorVigenteCodigo(vs, 'PNR', '2026-10-20')?.id).toBe('b');
    expect(valorVigenteCodigo(vs, 'PJD', '2026-10-20')?.id).toBe('c');
    expect(valorVigenteCodigo(vs, null, '2019-01-01')).toBeNull();
  });

  it('reglas: %, porción, mínimo con su unidad, fecha y motivo', () => {
    expect(faltaEnValorCodigo(datos({ pct: 101 }), '2026-10-16', 'x')).toMatch(/0 a 100/);
    expect(faltaEnValorCodigo(datos({ basePct: 0 }), '2026-10-16', 'x')).toMatch(/porción/);
    expect(faltaEnValorCodigo(datos({ minimoUnidad: null }), '2026-10-16', 'x')).toMatch(/unidad/);
    expect(faltaEnValorCodigo(datos(), '2026-10-16', ' ')).toMatch(/motivo/);
    expect(faltaEnValorCodigo(datos({ pct: null }), '2026-10-16', 'x')).toBeNull();   // sin %: la tasa saldrá de una tarifa (R5)
    expect(faltaEnClasificacion({ nombre: 'Tabla de prueba', impuestoClave: null, enteId: null })).toMatch(/impuesto, de un ente/);
  });

  it('resumen para la pantalla', () => {
    expect(resumenValor(valor('a', 'PNR', '2020-01-01', 3, { minimo: 83.3334, minimoUnidad: 'UT', sustraendoFactor: 83.3334, basePct: 90 })))
      .toBe('3 % · base 90 % · mín. 83,3334 UT · sustraendo × 83,3334');
    expect(resumenValor(null)).toBe('—');
  });
});

describe('pegar el clasificador de una alcaldía', () => {
  it('lee tabulador o «;», salta los títulos, coma decimal y % opcional', () => {
    const r = leerTablaPegada('Código\tDescripción\tAlícuota\tMínimo\n1.01\tActividad uno\t2,5\t10\n1.02;Actividad dos;3%;\n');
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([
      { codigo: '1.01', descripcion: 'Actividad uno', alicuota: 2.5, minimo: 10 },
      { codigo: '1.02', descripcion: 'Actividad dos', alicuota: 3, minimo: null },
    ]);
  });

  it('repetidos, sin descripción o con números ilegibles van a errores', () => {
    const r = leerTablaPegada('1.01\tUno\t2\n1.01\tOtra vez\t2\n1.03\t\t2\n1.04\tCuatro\tabc\n1.05\tCinco\t150');
    expect(r.filas.map((f) => f.codigo)).toEqual(['1.01']);
    expect(r.errores).toHaveLength(4);
    expect(r.errores.join(' | ')).toMatch(/repetido/);
  });

  it('plan: nuevos, los que cambian (descripción o valor vigente) y los iguales', () => {
    const existentes = [
      aCodigo({ id: 'c-1', clasificacion_id: 'k', codigo: '1.01', descripcion: 'Actividad uno', retencion_clasificacion_valores: [{ id: 'v', codigo_id: 'c-1', sujeto: null, pct: 2.5, base_pct: 100, desde: '2020-01-01', motivo: 'x' }] }),
      aCodigo({ id: 'c-2', clasificacion_id: 'k', codigo: '1.02', descripcion: 'Nombre viejo' }),
    ];
    const p = planCarga(existentes, [
      { codigo: '1.01', descripcion: 'Actividad uno', alicuota: 2.5, minimo: null },
      { codigo: '1.02', descripcion: 'Actividad dos', alicuota: null, minimo: null },
      { codigo: '1.03', descripcion: 'Nueva', alicuota: 1, minimo: null },
    ], '2026-10-16');
    expect(p.iguales.map((f) => f.codigo)).toEqual(['1.01']);
    expect(p.cambian.map((c) => [c.fila.codigo, c.cambiaDescripcion, c.cambiaValor])).toEqual([['1.02', true, false]]);
    expect(p.nuevos.map((f) => f.codigo)).toEqual(['1.03']);
  });

  it('carga: crea códigos y su valor para todos; sigue si una fila falla y la reporta', async () => {
    cola.push({ data: [{ id: 'c-9' }], error: null });                                   // crear 1.03
    cola.push({ data: [{ id: 'v-9' }], error: null });                                   // valor de 1.03
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });        // crear 1.04 (ya existe)
    const r = await cargarClasificador('k', {
      nuevos: [{ codigo: '1.03', descripcion: 'Nueva', alicuota: 1, minimo: 5 }, { codigo: '1.04', descripcion: 'Otra', alicuota: null, minimo: null }],
      cambian: [], iguales: [],
    }, { desde: '2026-10-16', motivo: 'Clasificador revisado', minimoUnidad: 'UT' });
    expect(r).toMatchObject({ creados: 1, valores: 1 });
    expect(r.fallas[0]).toMatch(/1.04: El código 1.04 ya está/);
    expect(llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ codigo_id: 'c-9', sujeto: null, pct: 1, minimo: 5, minimo_unidad: 'UT', desde: '2026-10-16' });
  });
});

describe('escritura', () => {
  it('valor nuevo con solo «desde»; corregir sin tocar el sujeto ni la fecha; exigen filas', async () => {
    cola.push({ data: [{ id: 'v-1' }], error: null });
    await nuevoValorCodigo('c-1', datos(), '2026-10-16', 'Alícuota nueva');
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ codigo_id: 'c-1', sujeto: 'PNR', pct: 3, desde: '2026-10-16', motivo: 'Alícuota nueva' });
    cola.push({ data: [{ id: 'v-1' }], error: null });
    await corregirValorCodigo('v-1', datos({ pct: 5 }), 'Se cargó mal');
    const upd = llamadas[1].metodos.find((m) => m[0] === 'update')?.[1] as Record<string, unknown>;
    expect(upd.sujeto).toBeUndefined();
    expect(upd.desde).toBeUndefined();
    expect(upd.pct).toBe(5);
    cola.push({ data: [], error: null });
    await expect(nuevoValorCodigo('c-1', datos(), '2026-10-17', 'x')).rejects.toThrow('sin permiso');
  });

  it('RET_CLASIFICACION_DESDE con la fecha; código repetido con su texto', async () => {
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_CLASIFICACION_DESDE: el valor nuevo tiene que empezar después del 16/10/2026. Para corregir el vigente, edítelo.' } });
    await expect(nuevoValorCodigo('c-1', datos(), '2026-10-01', 'x')).rejects.toThrow('después del 16/10/2026');
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(crearCodigo('k', { codigo: '1.01', descripcion: 'Uno' })).rejects.toThrow('ya está en esta clasificación');
    expect(errorRetencion({ code: 'P0001', message: 'RET_CLASIFICACION_DESDE' }).message).toMatch(/Corregir/);
  });

  it('los códigos de un ente: sus clasificaciones activas y sus códigos activos', async () => {
    cola.push({ data: [{ id: 'k-1' }], error: null });
    cola.push({ data: [{ id: 'c-1', clasificacion_id: 'k-1', codigo: '1.01', descripcion: 'Uno' }], error: null });
    const xs = await codigosDeEnte('e-1');
    expect(llamadas[0].metodos).toContainEqual(['eq', 'ente_id', 'e-1']);
    expect(llamadas[1].metodos).toContainEqual(['in', 'clasificacion_id', ['k-1']]);
    expect(xs[0].codigo).toBe('1.01');
    cola.push({ data: [], error: null });
    expect(await codigosDeEnte('e-2')).toEqual([]);
  });
});
