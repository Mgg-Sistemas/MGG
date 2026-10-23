import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const rpc = vi.fn();
let tablas = new Set<string>();

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
vi.mock('./disponibilidad', () => ({
  tablaDisponible: async (t: string) => tablas.has(t),
  r2Disponible: async () => false,
  v2rDisponible: async () => true,
}));

import { aplicarTramos, guardarTramos, nuevaVersionTarifa, publicarVersion, quitarTramo, revisarTramos } from './tarifas.repository';
import { aRegla, activarRegla, guardarCondicion, guardarPaso, quitarPaso } from './reglas.repository';
import { correrPrueba, loQueUsa, type DatosPrueba, type EntradaPrueba } from './probarRegla';
import { calcularConReglaVigente } from './reglaRegistro';
import { registrarRetencion, type NuevaRetencion } from './retencionesFiscal.repository';
import { CONFIG_RETENCION_DEFECTO } from './retencionesCalculo';
import { errorRetencion } from './erroresRetencion';
import { rifValido } from '@/shared/lib/rif';
import type { Regla } from './motorReglas';

// Datos inventados.
const RIF = (() => { for (let d = 0; d <= 9; d += 1) if (rifValido(`J-00000001-${d}`)) return `J-00000001-${d}`; throw new Error('sin RIF'); })();
beforeEach(() => { cola.length = 0; llamadas.length = 0; rpc.mockReset(); tablas = new Set(); });

describe('tarifas (R5)', () => {
  const t = (desde: number, hasta: number | null, pct: number, sustraendo = 0) => ({ desdeMonto: desde, hastaMonto: hasta, pct, sustraendo });

  it('revisión en vivo: las mismas faltas que revisa la base al publicar', () => {
    expect(revisarTramos([t(0, 1000, 6), t(1000, null, 9, 30)])).toEqual([]);
    expect(revisarTramos([])).toEqual(['la versión no tiene tramos']);
    expect(revisarTramos([t(10, 1000, 6), t(1000, null, 9)]).join(' | ')).toMatch(/empieza en 10/);
    expect(revisarTramos([t(0, 900, 6), t(1000, null, 9)]).join(' | ')).toMatch(/hueco o un solape/);
    expect(revisarTramos([t(0, null, 6), t(1000, null, 9)]).join(' | ')).toMatch(/no tiene tope y no es el último/);
    expect(revisarTramos([t(0, 1000, 6)]).join(' | ')).toMatch(/último tramo tiene tope/);
  });

  it('aplicar en UT: base a UT, sustraendo de vuelta a Bs (como la base)', () => {
    const r = aplicarTramos([t(0, 1000, 6), t(1000, null, 9, 30)], 'UT', 43 * 1200, 43);
    expect(r).toMatchObject({ pct: 9, sustraendo: 1290 });
    expect(r?.monto).toBe(Math.round((43 * 1200 * 0.09 - 1290) * 100) / 100);
  });

  it('guardar: los que tienen id se actualizan, los nuevos se insertan; exige filas', async () => {
    cola.push({ data: [{ id: 'x1' }], error: null });
    cola.push({ data: [{ id: 'n1' }], error: null });
    await guardarTramos('v-1', [{ id: 'x1', ...t(0, 1000, 6) }, t(1000, null, 9, 30)]);
    expect(llamadas[0].metodos).toContainEqual(['eq', 'id', 'x1']);
    expect(llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1]).toEqual([{ version_id: 'v-1', desde_monto: 1000, hasta_monto: null, pct: 9, sustraendo: 30, nota: null }]);
    cola.push({ data: [], error: null });
    await expect(quitarTramo('x1')).rejects.toThrow('sin publicar');
  });

  it('versión nueva copia tramos sin sus ids; publicar con error de la base lo explica', async () => {
    cola.push({ data: [{ id: 'v-2' }], error: null });
    cola.push({ data: [{ id: 'n' }, { id: 'm' }], error: null });
    await nuevaVersionTarifa('t-1', '2026-11-01', 'Tarifa nueva', { copiarTramos: [{ id: 'viejo', ...t(0, 1000, 6) }, { id: 'viejo2', ...t(1000, null, 9) }] });
    const ins = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>[];
    expect(ins.every((x) => !('id' in x))).toBe(true);
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_TARIFA_TRAMOS: no se puede publicar: la versión no tiene tramos.' } });
    await expect(publicarVersion('v-2')).rejects.toThrow('No se puede publicar: la versión no tiene tramos');
  });
});

describe('reglas (R7)', () => {
  it('mapea la regla con sus condiciones y pasos en orden', () => {
    const r = aRegla({ id: 'r-1', impuesto_clave: 'IVA', nombre: 'IVA', version: 2, estado: 'vigente', desde: '2026-10-16', prioridad: 100, motivo: 'x',
      retencion_regla_condiciones: [{ id: 'c2', pieza: 'direccion', operador: 'es', valor: 'practicada' }],
      retencion_regla_pasos: [{ paso: 8, operacion: 'redondear', valores: { decimales: 2 } }, { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'iva', signo: '+' }] } }] });
    expect(r.pasos.map((p) => p.paso)).toEqual([1, 8]);
    expect(r.idsCondiciones).toEqual(['c2']);
  });

  it('condición y paso se validan antes de guardar; el paso va con upsert por (regla, paso)', async () => {
    await expect(guardarCondicion('r-1', { pieza: 'sujeto', operador: 'es', valor: 'XX' })).rejects.toThrow('sujeto admite');
    expect(llamadas).toHaveLength(0);
    cola.push({ data: [{ id: 'p-1' }], error: null });
    await guardarPaso('r-1', { paso: 4, operacion: 'pct_fijo', valores: { pct: 2 } });
    expect(llamadas[0].metodos.find((m) => m[0] === 'upsert')?.[2]).toEqual({ onConflict: 'regla_id,paso' });
    cola.push({ data: [], error: null });
    await expect(quitarPaso('r-1', 4)).rejects.toThrow('en prueba');
  });

  it('activar va por la función de la base con motivo; una regla vigente no se edita', async () => {
    await expect(activarRegla('r-1', ' ')).rejects.toThrow('motivo');
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await activarRegla('r-1', 'Comparada con el cálculo de hoy');
    expect(rpc).toHaveBeenCalledWith('retencion_regla_activar', { p_regla: 'r-1', p_motivo: 'Comparada con el cálculo de hoy' });
    expect(errorRetencion({ code: 'P0001', message: 'RET_REGLA_NO_EDITABLE: la regla está vigente; para cambiarla, haga una versión nueva.' }).message).toMatch(/versión nueva/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_REGLA_PASO: el paso 4 admite: pct_fijo.' }).message).toBe('El paso no es válido: el paso 4 admite: pct_fijo.');
  });
});

describe('Probar la regla: motor contra el cálculo de hoy', () => {
  const islr: Regla = {
    impuestoClave: 'ISLR', nombre: 'ISLR por concepto', version: 1, estado: 'en_prueba', desde: '2026-10-16', hasta: null, prioridad: 100,
    condiciones: [{ pieza: 'clasificacion', operador: 'es', valor: { clasificacion: 'islr_conceptos' } }],
    pasos: [
      { paso: 1, operacion: 'componer_base', valores: { componentes: [{ campo: 'pago', signo: '+' }], porcion: 'clasificacion' } },
      { paso: 3, operacion: 'comparar_minimo', valores: { desde: 'clasificacion' } },
      { paso: 4, operacion: 'pct_clasificacion', valores: { clasificacion: 'islr_conceptos' } },
      { paso: 5, operacion: 'restar_sustraendo', valores: { desde: 'clasificacion' } },
      { paso: 7, operacion: 'topes', valores: { minimo: 0 } },
      { paso: 8, operacion: 'redondear', valores: { decimales: 2 } },
    ],
  };
  const entrada: EntradaPrueba = { fecha: '2026-10-16', direccion: 'practicada', sujeto: 'PNR', moneda: 'Bs', tasa: null, pago: 10000, baseImponible: 10000, iva: 0, supuesto: false, codigo: '001' };
  const datos = (over: Partial<DatosPrueba> = {}): DatosPrueba => ({
    ut: 43, parametros: {}, condicionesAgente: [], clasificacionClave: 'islr_conceptos', tarifas: {},
    valorClasificacion: { pct: 3, basePct: 100, minimo: 83.3334, minimoUnidad: 'UT', sustraendoFactor: 83.3334 },
    config: { ...CONFIG_RETENCION_DEFECTO, valorUt: 43 }, ...over,
  });

  it('qué usa la regla', () => {
    expect(loQueUsa(islr)).toEqual({ parametros: [], clasificacion: 'islr_conceptos', tarifas: [] });
  });

  it('ISLR de arranque: coinciden', () => {
    const r = correrPrueba(islr, entrada, datos());
    expect(r.condicionesQueFallan).toEqual([]);
    expect(r.motor.monto).toBe(192.5);
    expect(r.coinciden).toBe(true);
  });

  it('sin el código de la clasificación, la condición no se cumple y se dice', () => {
    expect(correrPrueba(islr, { ...entrada, codigo: null }, datos()).condicionesQueFallan[0]).toMatch(/clasificación/);
  });
});

describe('registrar: con R7 usa la regla vigente; sin R7, el cálculo de hoy intacto', () => {
  const nueva = (over: Partial<NuevaRetencion> = {}): NuevaRetencion => ({
    tipo: 'iva', direccion: 'practicada', docKind: 'manual', contraparteRif: RIF, contraparteNombre: 'Proveedor de prueba',
    facturaNumero: '000123', facturaFecha: '2026-10-05', periodo: '202610', quincena: 1, moneda: 'Bs',
    baseImponible: 1000, impuesto: 160, porcentaje: 75, montoRetenido: 120, actor: 'prueba@ejemplo.com', ...over,
  } as NuevaRetencion);
  const regla = { regla_id: 'r-1', foto: { pasos: [] } };

  it('sin R7: no busca reglas y el registro no lleva regla ni foto, aunque se le pasen', async () => {
    expect(await calcularConReglaVigente('IVA', { fecha: '2026-10-05', direccion: 'practicada', sujeto: null, moneda: 'Bs', tasa: null, pago: 0, baseImponible: 1000, iva: 160, supuesto: false, codigo: null })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'x', rol: 'practicada', tipo: 'IVA', estado: 'registrada', monto: 120 }, error: null });
    await registrarRetencion(nueva({ regla }), CONFIG_RETENCION_DEFECTO);
    const ins = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(ins.monto).toBe(120);
    expect('regla_id' in ins).toBe(false);
    expect('foto' in ins).toBe(false);
  });

  it('con R7: el registro guarda la regla y la foto', async () => {
    tablas = new Set(['retencion_reglas']);
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'x', rol: 'practicada', tipo: 'IVA', estado: 'registrada', monto: 120 }, error: null });
    await registrarRetencion(nueva({ regla }), CONFIG_RETENCION_DEFECTO);
    const ins = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(ins).toMatchObject({ regla_id: 'r-1', foto: { pasos: [] } });
  });

  it('con R7 pero sin regla vigente que aplique: null (el cálculo de hoy)', async () => {
    tablas = new Set(['retencion_reglas']);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await calcularConReglaVigente('IVA', { fecha: '2026-10-05', direccion: 'practicada', sujeto: null, moneda: 'Bs', tasa: null, pago: 0, baseImponible: 1000, iva: 160, supuesto: false, codigo: null })).toBeNull();
    expect(rpc).toHaveBeenCalledWith('retencion_reglas_vigentes', { p_impuesto: 'IVA', p_fecha: '2026-10-05', p_incluir_prueba: false });
  });
});
