import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supabase falso: cada from() toma la siguiente respuesta de la cola. El detector de R2 se controla aparte. */
const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
let hayR2 = true;

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
vi.mock('./disponibilidad', () => ({ r2Disponible: async () => hayR2, tablaDisponible: async () => hayR2 }));

import {
  aImpuesto, crearImpuesto, faltaEnImpuesto, faltaEnVersion, guardarImpuesto, nuevaVersion, corregirVersion,
  plazoEntrega, sumarDiasHabiles, versionDeFecha, type DatosVersion, type FichaImpuesto, type VersionImpuesto,
} from './impuestos.repository';
import { fijarImpuestosEnte, impuestosPorEnte, listEntes } from './entes.repository';
import { errorRetencion } from './erroresRetencion';
import { cambiosTexto, resumenVersion } from './parametrosR2';

// Datos inventados.
const version = (over: Partial<DatosVersion> = {}): DatosVersion => ({
  periodicidad: 'mensual', venceDia: 15, venceSiInhabil: 'siguiente_habil', plazoEntregaDias: 2, plazoDiasHabiles: true,
  convive: false, otroSistemaNombre: null, otroSistemaEnTotales: false, baseLegal: null, fuente: null, ...over,
});
const ficha = (over: Partial<FichaImpuesto> = {}): FichaImpuesto => ({
  clave: 'PRUEBA_X', nombre: 'Impuesto de prueba', enteId: null, admitePracticada: true, admiteSufrida: true, numera: true,
  serieFormato: 'N10', serieModo: 'automatica', serieInicial: 1, serieUltimoOtroSistema: null, numeraOperacion: false,
  agrupa: false, exporta: 'ninguno', orden: 9, activo: true, ...over,
});
const v = (id: string, desde: string, hasta: string | null = null): VersionImpuesto => ({
  id, impuestoClave: 'IVA', desde, hasta, ...version(), motivo: 'x', actualizadoEn: null, actualizadoPor: null,
});

beforeEach(() => { cola.length = 0; llamadas.length = 0; hayR2 = true; });

describe('impuestos: piezas puras', () => {
  it('mapea la ficha con sus versiones (la más nueva primero)', () => {
    const i = aImpuesto({
      clave: 'MUNICIPAL', nombre: 'ISAE', numera: true, serie_formato: 'N10', numera_operacion: true, exporta: 'planilla', orden: 3,
      retencion_impuesto_versiones: [{ id: 'a', desde: '2026-01-01', periodicidad: 'mensual', motivo: 'x' }, { id: 'b', desde: '2026-10-16', periodicidad: 'mensual', motivo: 'y' }],
    });
    expect(i).toMatchObject({ clave: 'MUNICIPAL', nombre: 'ISAE', numeraOperacion: true, exporta: 'planilla', serieModo: 'automatica', serieInicial: 1 });
    expect(i.versiones.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('la versión de una fecha; antes de la primera, la primera (como la base)', () => {
    const xs = [v('a', '2026-01-01', '2026-10-15'), v('b', '2026-10-16')];
    expect(versionDeFecha(xs, '2026-05-01')?.id).toBe('a');
    expect(versionDeFecha(xs, '2026-10-20')?.id).toBe('b');
    expect(versionDeFecha(xs, '2025-01-01')?.id).toBe('a');
    expect(versionDeFecha([], '2026-10-16')).toBeNull();
  });

  it('días hábiles: lunes a viernes, sin feriados; plazo corrido si no son hábiles', () => {
    expect(sumarDiasHabiles('2026-10-16', 2)).toBe('2026-10-20');   // viernes + 2 hábiles = martes
    expect(sumarDiasHabiles('2026-10-14', 2)).toBe('2026-10-16');
    expect(plazoEntrega({ plazoEntregaDias: 2, plazoDiasHabiles: false }, '2026-10-16')).toBe('2026-10-18');
    expect(plazoEntrega({ plazoEntregaDias: 0, plazoDiasHabiles: true }, '2026-10-16')).toBe('2026-10-16');
  });

  it('reglas de la ficha (las mismas que la tabla)', () => {
    expect(faltaEnImpuesto(ficha({ clave: 'iva x' }))).toMatch(/mayúsculas/);
    expect(faltaEnImpuesto(ficha({ admitePracticada: false, admiteSufrida: false }))).toMatch(/practicadas, recibidas/);
    expect(faltaEnImpuesto(ficha({ numera: true, serieFormato: null }))).toMatch(/formato/);
    expect(faltaEnImpuesto(ficha({ serieInicial: 100, serieUltimoOtroSistema: 100 }))).toMatch(/mayor que el último/);
    expect(faltaEnImpuesto(ficha({ numera: false, serieFormato: null }))).toBeNull();
  });

  it('reglas de la versión', () => {
    expect(faltaEnVersion(version(), '2026-10-16', ' ')).toMatch(/motivo/);
    expect(faltaEnVersion(version({ venceDia: 32 }), '2026-10-16', 'x')).toMatch(/1 al 31/);
    expect(faltaEnVersion(version({ plazoEntregaDias: 61 }), '2026-10-16', 'x')).toMatch(/0 a 60/);
    expect(faltaEnVersion(version({ convive: true }), '2026-10-16', 'x')).toMatch(/cuál/);
    expect(faltaEnVersion(version(), '16/10/2026', 'x')).toMatch(/desde qué fecha/);
  });

  it('resumen y cambios del historial para la pantalla', () => {
    expect(resumenVersion(v('a', '2026-10-16'))).toBe('Mensual · vence el día 15 · entrega en 2 días hábiles');
    expect(resumenVersion(null)).toBe('Sin versión');
    expect(cambiosTexto({ antes: { nombre: 'A', orden: 1 }, despues: { nombre: 'B', orden: 1 } })).toBe(' · cambió: el nombre');
    expect(cambiosTexto({ antes: null, despues: { nombre: 'B' } })).toBe('');
  });
});

describe('impuestos: escritura', () => {
  it('guardar la ficha manda motivo_cambio y exige filas', async () => {
    await expect(guardarImpuesto('IVA', { nombre: 'IVA' }, ' ')).rejects.toThrow('motivo');
    cola.push({ data: [{ clave: 'IVA' }], error: null });
    await guardarImpuesto('IVA', { nombre: 'IVA', serieInicial: 501, serieUltimoOtroSistema: 500 }, 'Seguir la serie del otro sistema');
    expect(llamadas[0].metodos.find((m) => m[0] === 'update')?.[1]).toMatchObject({
      nombre: 'IVA', serie_inicial: 501, serie_ultimo_otro_sistema: 500, motivo_cambio: 'Seguir la serie del otro sistema',
    });
    expect(llamadas[0].metodos).toContainEqual(['eq', 'clave', 'IVA']);
    cola.push({ data: [], error: null });
    await expect(guardarImpuesto('IVA', { activo: false }, 'x')).rejects.toThrow('sin permiso');
  });

  it('RET_SERIE_INICIAL y RET_SERIE_EN_USO de la base llegan legibles', async () => {
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_SERIE_INICIAL: el primer número de IVA tiene que ser mayor que el último del otro sistema (500).' } });
    await expect(guardarImpuesto('IVA', { serieInicial: 400 }, 'x')).rejects.toThrow('mayor que 500');
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_SERIE_EN_USO: la serie de IVA ya dio números: no cambia de formato.' } });
    await expect(guardarImpuesto('IVA', { serieFormato: 'N10' }, 'x')).rejects.toThrow('ya dio números');
  });

  it('versión nueva: solo «desde» (la base cierra la anterior); RET_VERSION_DESDE con la fecha', async () => {
    cola.push({ data: [{ id: 'v-9' }], error: null });
    expect(await nuevaVersion('IVA', version({ convive: true, otroSistemaNombre: ' Otro ' }), '2026-11-01', 'Cambio de calendario')).toBe('v-9');
    const ins = llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(ins).toMatchObject({ impuesto_clave: 'IVA', desde: '2026-11-01', periodicidad: 'mensual', otro_sistema_nombre: 'Otro', motivo: 'Cambio de calendario' });
    expect(ins.hasta).toBeUndefined();
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_VERSION_DESDE: la versión nueva de IVA tiene que empezar después del 16/10/2026. Para corregir la vigente, edítela.' } });
    await expect(nuevaVersion('IVA', version(), '2026-10-01', 'x')).rejects.toThrow('después del 16/10/2026');
  });

  it('corregir la vigente: update con motivo, sin tocar «desde»; sin convivencia, sin nombre de otro sistema', async () => {
    cola.push({ data: [{ id: 'v-1' }], error: null });
    await corregirVersion('v-1', version({ otroSistemaNombre: 'No va' }), 'Se cargó mal el día');
    const upd = llamadas[0].metodos.find((m) => m[0] === 'update')?.[1] as Record<string, unknown>;
    expect(upd.desde).toBeUndefined();
    expect(upd.otro_sistema_nombre).toBeNull();
    expect(upd.motivo).toBe('Se cargó mal el día');
    cola.push({ data: [], error: null });
    await expect(corregirVersion('v-1', version(), 'x')).rejects.toThrow('sin permiso');
  });

  it('crear: ficha y primera versión; si la versión falla, lo dice', async () => {
    cola.push({ data: [{ clave: 'PRUEBA_X' }], error: null });
    cola.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(crearImpuesto(ficha(), version(), '2026-10-16', 'Alta')).rejects.toThrow('quedó creado, pero sin su versión');
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ clave: 'PRUEBA_X', motivo_cambio: 'Alta' });
  });
});

describe('entes con R2: el ente de cada impuesto es retencion_impuestos.ente_id', () => {
  it('impuestosPorEnte: solo activos, en orden', () => {
    const m = impuestosPorEnte([
      { clave: 'IGTF', ente_id: 'e-1' }, { clave: 'IVA', ente_id: 'e-1' }, { clave: 'NUEVO', ente_id: 'e-1' },
      { clave: 'ISLR', ente_id: 'e-1', activo: false }, { clave: 'MUNICIPAL', ente_id: 'e-2' }, { clave: 'ESTADAL', ente_id: null },
    ]);
    expect(m.get('e-1')).toEqual(['IVA', 'IGTF', 'NUEVO']);
    expect(m.get('e-2')).toEqual(['MUNICIPAL']);
  });

  it('con R2, fijar impuestos escribe retencion_impuestos (no el puente) con motivo', async () => {
    cola.push({ data: [{ clave: 'IVA' }, { clave: 'ISLR' }], error: null });
    cola.push({ data: [], error: null });
    await fijarImpuestosEnte('e-1', ['IVA', 'ISLR'], 'Impuestos del SENIAT');
    expect(llamadas.map((l) => l.tabla)).toEqual(['retencion_impuestos', 'retencion_impuestos']);
    expect(llamadas[0].metodos).toContainEqual(['update', { ente_id: 'e-1', motivo_cambio: 'Impuestos del SENIAT' }]);
    expect(llamadas[0].metodos).toContainEqual(['in', 'clave', ['IVA', 'ISLR']]);
    expect(llamadas[1].metodos).toContainEqual(['update', { ente_id: null, motivo_cambio: 'Impuestos del SENIAT' }]);
    expect(llamadas[1].metodos).toContainEqual(['not', 'clave', 'in', '(IVA,ISLR)']);
  });

  it('con R2, si no se asignaron todos, avisa', async () => {
    cola.push({ data: [{ clave: 'IVA' }], error: null });
    await expect(fijarImpuestosEnte('e-1', ['IVA', 'ISLR'])).rejects.toThrow('sin permiso');
  });

  it('sin R2, sigue escribiendo el puente', async () => {
    hayR2 = false;
    cola.push({ data: [{ id: 'i-1' }], error: null });
    cola.push({ data: [], error: null });
    await fijarImpuestosEnte('e-1', ['IVA']);
    expect(llamadas[0].tabla).toBe('retencion_ente_impuestos');
  });

  it('con R2, la lista de entes toma los impuestos del catálogo', async () => {
    cola.push({ data: [{ id: 'e-1', nombre: 'SENIAT', tipo: 'nacional', retencion_ente_impuestos: [{ impuesto_clave: 'IVA', activo: true }], retencion_ente_logos: [] }], error: null });
    cola.push({ data: [{ clave: 'ISLR', ente_id: 'e-1', activo: true }], error: null });
    const [e] = await listEntes();
    expect(e.impuestos).toEqual(['ISLR']);
  });
});

describe('traductor: RET_* de R2', () => {
  it('sin detalle, el texto general', () => {
    expect(errorRetencion({ code: 'P0001', message: 'RET_VERSION_DESDE' }).message).toMatch(/Corregir/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_SERIE_INICIAL' }).message).toMatch(/último del otro sistema/);
  });
});
