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
  entradaDePrueba, faltaEnEnteros, filasATramos, leerEntero, leerOpcional, leerPrioridad, leerSupuestoNumeros, leerValorCodigo,
  noSeEntiende, pistaLeido,
} from './parametrosNumeros';
import { aCodigo, cargarClasificador, leerTablaPegada, planCarga, valorDeFilaPegada, type ValorCodigo } from './clasificaciones.repository';
import { leerValor } from './parametros.repository';

// Datos inventados.
const ILEGIBLE = /No se entiende .+: escribe 1\.234,56 o 1234,56\./;

beforeEach(() => { cola.length = 0; llamadas.length = 0; });

describe('un solo lector de números en Parámetros', () => {
  it('formato venezolano; vacío según el campo; lo ilegible nunca pasa a 0, null ni NaN', () => {
    expect(leerOpcional('36.500', 'el mínimo')).toEqual({ valor: 36500 });
    expect(leerOpcional('1.234,56', 'el mínimo')).toEqual({ valor: 1234.56 });
    expect(leerOpcional('0.125', 'el %')).toEqual({ valor: 0.125 });
    expect(leerOpcional('  ', 'el mínimo')).toEqual({ valor: null });
    expect(leerOpcional('12,5%', 'el %')).toEqual({ valor: 12.5 });
    expect(leerOpcional('1,2,3', 'el mínimo')).toEqual({ error: noSeEntiende('el mínimo') });
    expect(noSeEntiende('el mínimo')).toBe('No se entiende el mínimo: escribe 1.234,56 o 1234,56.');
  });

  it('la pista dice cómo se leyó, solo si hay punto o coma', () => {
    expect(pistaLeido('36.500')).toBe('Se leyó 36.500,00');
    expect(pistaLeido('1234,5')).toBe('Se leyó 1.234,50');
    expect(pistaLeido('100')).toBeNull();
    expect(pistaLeido('1,2,3')).toBeNull();
  });
});

describe('tramos de una tarifa', () => {
  const fila = (o: Partial<{ desde: string; hasta: string; pct: string; sustraendo: string }> = {}) => ({ desde: '0', hasta: '1.000', pct: '6', sustraendo: '0', ...o });

  it('«Hasta» vacío = sin tope; los montos con miles se leen bien', () => {
    const r = filasATramos([fila(), fila({ desde: '1.000', hasta: '', pct: '9', sustraendo: '30,5' })]);
    expect(r).toEqual({ valor: [
      { id: undefined, desdeMonto: 0, hastaMonto: 1000, pct: 6, sustraendo: 0 },
      { id: undefined, desdeMonto: 1000, hastaMonto: null, pct: 9, sustraendo: 30.5 },
    ] });
  });

  it('«Hasta» ilegible bloquea (no se vuelve «sin tope»)', () => {
    const r = filasATramos([fila({ hasta: '1.0.0' })]);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(ILEGIBLE);
    expect((r as { error: string }).error).toContain('«Hasta» del tramo 1');
  });

  it('sustraendo ilegible bloquea (no se vuelve 0); vacío sí es 0', () => {
    const r = filasATramos([fila({ sustraendo: 'abc' })]);
    expect((r as { error: string }).error).toContain('el sustraendo del tramo 1');
    expect(filasATramos([fila({ sustraendo: '' })])).toMatchObject({ valor: [{ sustraendo: 0 }] });
  });

  it('el % y «Más de» vacíos faltan', () => {
    expect(filasATramos([fila({ pct: '' })])).toEqual({ error: 'Indica el % del tramo 1.' });
    expect(filasATramos([fila({ desde: '' })])).toEqual({ error: 'Indica «Más de» del tramo 1.' });
  });
});

describe('valor de un código de clasificación', () => {
  const textos = { pct: '3', basePct: '100', minimo: '83,3334', sustraendo: '83,3334' };

  it('mínimo y factor del sustraendo ilegibles bloquean', () => {
    expect(leerValorCodigo({ ...textos, minimo: '8.3.3' }, false)).toEqual({ error: noSeEntiende('el mínimo') });
    expect(leerValorCodigo({ ...textos, sustraendo: 'x' }, false)).toEqual({ error: noSeEntiende('el factor del sustraendo') });
    expect(leerValorCodigo({ ...textos, pct: '2,5,1' }, false)).toEqual({ error: noSeEntiende('el %') });
  });

  it('vacíos son «sin dato»; con tarifa no hay %', () => {
    expect(leerValorCodigo({ ...textos, minimo: '', sustraendo: '' }, false))
      .toEqual({ valor: { pct: 3, basePct: 100, minimo: null, sustraendoFactor: null } });
    expect(leerValorCodigo({ ...textos, pct: 'cualquier cosa' }, true)).toMatchObject({ valor: { pct: null } });
    expect(leerValorCodigo({ ...textos, basePct: '' }, false)).toEqual({ error: 'Indica la porción de la base (%).' });
  });
});

describe('carga pegada de una clasificación', () => {
  const vigente = (over: Partial<ValorCodigo> = {}): ValorCodigo => ({
    id: 'v-1', codigoId: 'c-1', sujeto: null, pct: 2.5, basePct: 90, minimo: 10, minimoUnidad: 'UT', sustraendoFactor: 1.5, tarifaId: null,
    desde: '2020-01-01', hasta: null, fuente: null, motivo: 'x', nota: null, actualizadoPor: null, ...over,
  });

  it('un número ilegible va a errores con el nombre del campo', () => {
    const r = leerTablaPegada('1.01\tUno\t2,5,1\t10\n1.02\tDos\t3\t1.0.0');
    expect(r.filas).toEqual([]);
    expect(r.errores[0]).toBe(`Fila 1 (1.01): ${noSeEntiende('la alícuota')}`);
    expect(r.errores[1]).toBe(`Fila 2 (1.02): ${noSeEntiende('el mínimo')}`);
  });

  it('el mínimo con miles se lee como miles', () => {
    expect(leerTablaPegada('1.01\tUno\t2\t36.500').filas[0].minimo).toBe(36500);
  });

  it('solo el mínimo: la alícuota (y la porción y el sustraendo) se conservan del vigente', () => {
    expect(valorDeFilaPegada({ codigo: '1.01', descripcion: 'Uno', alicuota: null, minimo: 12 }, vigente(), { minimoUnidad: 'Bs', fuente: 'Ordenanza' }))
      .toEqual({ sujeto: null, pct: 2.5, basePct: 90, minimo: 12, minimoUnidad: 'Bs', sustraendoFactor: 1.5, fuente: 'Ordenanza' });
  });

  it('solo la alícuota: el mínimo vigente se conserva con SU unidad', () => {
    expect(valorDeFilaPegada({ codigo: '1.01', descripcion: 'Uno', alicuota: 3, minimo: null }, vigente(), { minimoUnidad: 'Bs' }))
      .toMatchObject({ pct: 3, minimo: 10, minimoUnidad: 'UT' });
  });

  it('solo el mínimo de un código con tarifa: se conserva la tarifa, sin %', () => {
    expect(valorDeFilaPegada({ codigo: '1.01', descripcion: 'Uno', alicuota: null, minimo: 12 }, vigente({ pct: null, tarifaId: 't-1' }), { minimoUnidad: 'UT' }))
      .toMatchObject({ pct: null, tarifaId: 't-1', minimo: 12 });
  });

  it('código nuevo (sin vigente): lo que no trae queda vacío, como antes', () => {
    expect(valorDeFilaPegada({ codigo: '1.09', descripcion: 'Nueva', alicuota: 1, minimo: null }, null, { minimoUnidad: 'UT' }))
      .toEqual({ sujeto: null, pct: 1, basePct: 100, minimo: null, minimoUnidad: null, sustraendoFactor: null, fuente: undefined });
  });

  it('la carga manda a la base el valor con el dato vigente conservado (no null)', async () => {
    const existentes = [aCodigo({
      id: 'c-1', clasificacion_id: 'k', codigo: '1.01', descripcion: 'Uno',
      retencion_clasificacion_valores: [{ id: 'v-1', codigo_id: 'c-1', sujeto: null, pct: 2.5, base_pct: 100, minimo: 10, minimo_unidad: 'UT', desde: '2020-01-01', motivo: 'x' }],
    })];
    const plan = planCarga(existentes, leerTablaPegada('1.01\tUno\t\t12').filas, '2026-10-21');
    expect(plan.cambian.map((c) => c.cambiaValor)).toEqual([true]);
    cola.push({ data: [{ id: 'v-2' }], error: null });
    const r = await cargarClasificador('k', plan, { desde: '2026-10-21', motivo: 'Mínimo nuevo', minimoUnidad: 'UT' });
    expect(r).toMatchObject({ valores: 1, fallas: [] });
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ codigo_id: 'c-1', pct: 2.5, minimo: 12, minimo_unidad: 'UT' });
  });
});

describe('supuestos, reglas, códigos e impuestos', () => {
  it('supuesto: % vacío falta (no se guarda 0 %); ilegible bloquea; orden vacío = 10', () => {
    expect(leerSupuestoNumeros('', '10')).toEqual({ error: 'Indica el %.' });
    expect(leerSupuestoNumeros('1,0,0', '10')).toEqual({ error: noSeEntiende('el %') });
    expect(leerSupuestoNumeros('75', '')).toEqual({ valor: { pct: 75, orden: 10 } });
    expect(leerSupuestoNumeros('0', '3')).toEqual({ valor: { pct: 0, orden: 3 } });   // «0» escrito sí es 0
  });

  it('regla: prioridad «0» es 0, vacío = 100, ilegible bloquea', () => {
    expect(leerPrioridad('0')).toEqual({ valor: 0 });
    expect(leerPrioridad('')).toEqual({ valor: 100 });
    expect(leerPrioridad('5')).toEqual({ valor: 5 });
    expect(leerPrioridad('abc')).toEqual({ error: noSeEntiende('la prioridad') });
    expect(leerPrioridad('2,5')).toEqual({ error: 'La prioridad va sin decimales.' });
  });

  it('orden de un código nuevo: «0» es 0, vacío = 100, ilegible bloquea', () => {
    expect(leerEntero('0', 'el orden', 100)).toEqual({ valor: 0 });
    expect(leerEntero(' ', 'el orden', 100)).toEqual({ valor: 100 });
    expect(leerEntero('1.000', 'el orden', 100)).toEqual({ valor: 1000 });
    expect(leerEntero('x1', 'el orden', 100)).toEqual({ error: noSeEntiende('el orden') });
  });

  it('impuesto: orden, plazo o primer número que no se entienden bloquean', () => {
    expect(faltaEnEnteros({ orden: 3, plazoEntregaDias: 2, serieInicial: 1 })).toBeNull();
    expect(faltaEnEnteros({ orden: NaN })).toBe(noSeEntiende('la posición en la lista'));
    expect(faltaEnEnteros({ plazoEntregaDias: NaN })).toBe(noSeEntiende('el plazo de entrega'));
    expect(faltaEnEnteros({ serieInicial: NaN })).toBe(noSeEntiende('el primer número de la serie'));
  });
});

describe('«Probar la regla»', () => {
  const base = { fecha: '2026-10-21', direccion: 'practicada' as const, sujeto: 'PJD' as const, moneda: 'USD', supuesto: false, codigo: null };

  it('tasa, pago, base e IVA con decimales en formato venezolano', () => {
    expect(entradaDePrueba(base, { tasa: '36,5', pago: '1.234,56', base: '1064.28', iva: '170,28' })).toEqual({
      valor: { ...base, tasa: 36.5, pago: 1234.56, baseImponible: 1064.28, iva: 170.28 },
    });
  });

  it('lo ilegible bloquea la prueba con el nombre del campo', () => {
    expect(entradaDePrueba(base, { tasa: '36,5', pago: '1,2,3', base: '1', iva: '0' })).toEqual({ error: noSeEntiende('el pago') });
    expect(entradaDePrueba(base, { tasa: 'x', pago: '1', base: '1', iva: '0' })).toEqual({ error: noSeEntiende('la tasa') });
  });

  it('en Bs no se lee la tasa; vacío = 0 en los montos', () => {
    expect(entradaDePrueba({ ...base, moneda: 'Bs' }, { tasa: 'x', pago: '', base: '100', iva: '' }))
      .toEqual({ valor: { ...base, moneda: 'Bs', tasa: null, pago: 0, baseImponible: 100, iva: 0 } });
  });
});

describe('Valores (R3): el mismo lector', () => {
  it('coma o punto según leerMonto; ilegible y vacío bloquean', () => {
    expect(leerValor('numero', '1.234')).toEqual({ valor: 1234 });
    expect(leerValor('numero', '0,125')).toEqual({ valor: 0.125 });
    expect(leerValor('numero', '43.5')).toEqual({ valor: 43.5 });
    expect(leerValor('numero', '9,00')).toEqual({ valor: 9 });
    expect(leerValor('numero', '1,2,3')).toEqual({ error: noSeEntiende('el valor') });
    expect(leerValor('numero', '')).toEqual({ error: 'Escribe el valor.' });
  });
});
