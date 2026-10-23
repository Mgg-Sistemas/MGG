import { beforeEach, describe, expect, it, vi } from 'vitest';

/* D41, Lote 2: el front valida en Parámetros lo mismo que la base (CHECK de R1-R9) antes de mandar. */

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

const subir = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { from: (t: string) => consulta(t), rpc: vi.fn(), storage: { from: () => ({ upload: subir, remove: vi.fn() }) } },
}));
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => true, r2Disponible: async () => false }));

import {
  faltaEnClaveMinusculas, faltaEnCodigo, faltaEnFechaRango, faltaNoNegativo, faltaPct, faltaPositivo, leerPrioridad,
  normalizarClave, normalizarClaveImpuesto, normalizarCodigo, normalizarCodigoSupuesto, pistaClave,
} from './parametrosNumeros';
import { MENSAJE_RIF_ENTE, crearEnte, editarEnte, enteRepetido, faltaEnEnte, leerRifEnte, subirImagenAgente, subirLogoEnte } from './entes.repository';
import { faltaEnClave, faltaEnRangoValor, nuevoValor } from './parametros.repository';
import { faltaEnTarifa, faltaEnTramos, guardarTramos } from './tarifas.repository';
import { faltaEnSupuesto, supuestoRepetido } from './motivosSupuestos.repository';
import { crearCodigo, faltaEnClasificacion, faltaEnCodigoNuevo, faltaEnValorCodigo, leerTablaPegada, planCarga, aCodigo } from './clasificaciones.repository';
import { agregarActividad, faltaEnActividad, faltaEnPerfil, faltaEnTipoLicencia, type PerfilNuevo } from './perfilesFiscales.repository';
import { faltaEnImpuesto, type FichaImpuesto } from './impuestos.repository';
import { faltaEnEstadoRegla, faltaEnReglaNueva } from './reglas.repository';
import { completarRif, digitoVerificadorRif } from '@/shared/lib/rif';

// Datos inventados.
beforeEach(() => { cola.length = 0; llamadas.length = 0; subir.mockReset(); });

const insertado = (i = 0) => (llamadas[i].metodos.find((m) => m[0] === 'insert')?.[1]) as Record<string, unknown>;
const actualizado = (i = 0) => (llamadas[i].metodos.find((m) => m[0] === 'update')?.[1]) as Record<string, unknown>;

describe('rangos (los CHECK de la base)', () => {
  it('% de 0 a 100, montos no negativos, UT mayor que 0; null = sin dato', () => {
    expect(faltaPct(100, 'el %')).toBeNull();
    expect(faltaPct(100.01, 'el % del tramo 2')).toBe('El % del tramo 2 va de 0 a 100.');
    expect(faltaPct(-1, 'el %')).toMatch(/0 a 100/);
    expect(faltaPct(null, 'el %')).toBeNull();
    expect(faltaNoNegativo(0, 'el mínimo')).toBeNull();
    expect(faltaNoNegativo(-0.01, 'el mínimo')).toBe('El mínimo no puede ser negativo.');
    expect(faltaPositivo(0, 'la UT')).toBe('La UT tiene que ser mayor que 0.');
    expect(faltaPositivo(Number.NaN, 'la UT')).toMatch(/mayor que 0/);
  });

  it('valores R3 por unidad: % de 0 a 100; la clave «ut» y lo que va en UT, mayor que 0; Bs y días, no negativos', () => {
    expect(faltaEnRangoValor({ clave: 'pct_retencion', nombre: '% de retención', unidad: '%' }, 101)).toBe('El valor de «% de retención» va de 0 a 100.');
    expect(faltaEnRangoValor({ clave: 'pct_retencion', nombre: '% de retención', unidad: '%' }, 75)).toBeNull();
    expect(faltaEnRangoValor({ clave: 'ut', nombre: 'Unidad tributaria', unidad: 'Bs' }, 0)).toMatch(/mayor que 0/);
    expect(faltaEnRangoValor({ clave: 'minimo_x', nombre: 'Mínimo', unidad: 'UT' }, 0)).toMatch(/mayor que 0/);
    expect(faltaEnRangoValor({ clave: 'tope', nombre: 'Tope', unidad: 'Bs' }, -5)).toMatch(/no puede ser negativo/);
    expect(faltaEnRangoValor({ clave: 'plazo', nombre: 'Plazo', unidad: 'dias' }, -1)).toMatch(/no puede ser negativo/);
    expect(faltaEnRangoValor({ clave: 'nota', nombre: 'Nota', unidad: null }, 'texto')).toBeNull();
  });

  it('nuevoValor no manda un % fuera de rango', async () => {
    await expect(nuevoValor({ ambito: 'impuesto', clave: 'pct_retencion', nombre: '% de retención', unidad: '%' },
      { impuestoClave: 'IVA', clave: 'pct_retencion', valor: 150, desde: '2026-10-21', motivo: 'Prueba' })).rejects.toThrow('0 a 100');
    expect(llamadas).toHaveLength(0);
  });

  it('tramos AL GUARDAR: «Más de», «Hasta» y sustraendo ≥ 0, «Hasta» > «Más de», % de 0 a 100', async () => {
    const t = (desde: number, hasta: number | null, pct: number, sustraendo = 0) => ({ desdeMonto: desde, hastaMonto: hasta, pct, sustraendo });
    expect(faltaEnTramos([t(0, 1000, 6), t(1000, null, 9, 30)])).toBeNull();
    expect(faltaEnTramos([t(0, 1000, 6), t(1000, null, 120)])).toBe('El % del tramo 2 va de 0 a 100.');
    expect(faltaEnTramos([t(0, 1000, 6), t(1000, 1000, 9)])).toBe('«Hasta» del tramo 2 tiene que ser mayor que «Más de» (1000).');
    expect(faltaEnTramos([t(-1, 1000, 6)])).toBe('«Más de» del tramo 1 no puede ser negativo.');
    expect(faltaEnTramos([t(0, null, 6, -3)])).toBe('El sustraendo del tramo 1 no puede ser negativo.');
    await expect(guardarTramos('v-1', [t(0, null, 101)])).rejects.toThrow('0 a 100');
    expect(llamadas).toHaveLength(0);
  });

  it('% y porción de un código, % y orden de un supuesto, orden y prioridad', () => {
    const v = { sujeto: null, pct: 2, basePct: 100, minimo: null, minimoUnidad: null, sustraendoFactor: null };
    expect(faltaEnValorCodigo({ ...v, pct: 101 }, '2026-10-21', 'x')).toMatch(/0 a 100/);
    expect(faltaEnValorCodigo({ ...v, basePct: 0 }, '2026-10-21', 'x')).toMatch(/porción de la base/);
    expect(faltaEnValorCodigo({ ...v, minimo: -1, minimoUnidad: 'UT' }, '2026-10-21', 'x')).toMatch(/mínimo no puede ser negativo/);
    expect(faltaEnValorCodigo({ ...v, sustraendoFactor: -1 }, '2026-10-21', 'x')).toMatch(/sustraendo no puede ser negativo/);
    const s = { impuestoClave: 'IVA', codigo: 'exportacion', texto: 'Supuesto de prueba', pct: 100, desde: '2026-10-21' };
    expect(faltaEnSupuesto({ ...s, pct: 100.5 }, 'x')).toMatch(/0 a 100/);
    expect(faltaEnSupuesto({ ...s, orden: -1 }, 'x')).toBe('El orden no puede ser negativo.');
    expect(leerPrioridad('-1')).toEqual({ error: 'La prioridad no puede ser negativa.' });
    expect(leerPrioridad('0')).toEqual({ valor: 0 });
    expect(faltaEnReglaNueva({ nombre: 'Regla', desde: '2026-10-21', prioridad: -2, motivo: 'x' })).toMatch(/desde 0/);
    expect(faltaEnCodigoNuevo({ codigo: '1.01', descripcion: 'Uno', orden: -1 })).toBe('El orden no puede ser negativo.');
    const ficha: FichaImpuesto = {
      clave: 'IVA', nombre: 'IVA', enteId: null, admitePracticada: true, admiteSufrida: true, numera: false, serieFormato: null,
      serieModo: 'automatica', serieInicial: 1, serieUltimoOtroSistema: null, numeraOperacion: false, agrupa: false, exporta: 'ninguno', orden: -1, activo: true,
    };
    expect(faltaEnImpuesto(ficha)).toBe('El orden no puede ser negativo.');
    expect(faltaEnImpuesto({ ...ficha, orden: 0 })).toBeNull();
  });
});

describe('RIF del ente (retencion_entes_rif_forma: V, E, J, P o G, sin la C)', () => {
  const rifCon = (letra: string, ocho: string) => `${letra}${ocho}${digitoVerificadorRif(letra, ocho)}`;

  it('vacío = sin RIF; se guarda sin guiones; con 8 números se completa el verificador', () => {
    expect(leerRifEnte('  ')).toEqual({ valor: null });
    const g = rifCon('G', '20000001');
    expect(leerRifEnte(`${g[0]}-${g.slice(1, 9)}-${g[9]}`)).toEqual({ valor: g });
    expect(leerRifEnte('g 20000001')).toEqual({ valor: g });
  });

  it('con la C (válida para un proveedor) no va en un ente; verificador equivocado tampoco', () => {
    const c = completarRif('C12345678');
    expect(c).not.toBeNull();
    expect(leerRifEnte(c)).toEqual({ error: MENSAJE_RIF_ENTE });
    const j = rifCon('J', '12345678');
    const malo = `${j.slice(0, 9)}${(Number(j[9]) + 1) % 10}`;
    expect(leerRifEnte(malo)).toEqual({ error: MENSAJE_RIF_ENTE });
    expect(MENSAJE_RIF_ENTE).toBe('El RIF del ente no es válido: letra (V, E, J, P o G), 8 dígitos y el verificador.');
    expect(faltaEnEnte({ nombre: 'SENIAT', tipo: 'nacional', rif: 'X-1' })).toBe(MENSAJE_RIF_ENTE);
  });

  it('alta y edición mandan el RIF normalizado; uno inválido no sale', async () => {
    const g = rifCon('G', '20000001');
    cola.push({ data: [{ id: 'e-1' }], error: null });
    await crearEnte({ nombre: 'Ente de prueba', tipo: 'nacional', rif: 'g-20000001', impuestos: [] });
    expect(insertado().rif).toBe(g);
    cola.push({ data: [{ id: 'e-1' }], error: null });
    await editarEnte('e-1', { rif: '' });
    expect(actualizado(1).rif).toBeNull();
    await expect(editarEnte('e-1', { rif: completarRif('C12345678') })).rejects.toThrow(MENSAJE_RIF_ENTE);
    expect(llamadas).toHaveLength(2);
  });
});

describe('fechas entre 2000 y 2100 (*_desde_rango, *_licencia_vence_rango)', () => {
  it('los bordes valen; afuera, el mensaje nombra el campo', () => {
    expect(faltaEnFechaRango('2000-01-01', 'la fecha')).toBeNull();
    expect(faltaEnFechaRango('2100-12-31', 'la fecha')).toBeNull();
    expect(faltaEnFechaRango('1999-12-31', 'la fecha «vale desde» del logo')).toBe('La fecha «vale desde» del logo tiene que estar entre el 01/01/2000 y el 31/12/2100.');
    expect(faltaEnFechaRango('2101-01-01', 'la fecha')).toMatch(/entre el 01\/01\/2000 y el 31\/12\/2100/);
    expect(faltaEnFechaRango('2026-02-30', 'la fecha')).toBe('La fecha no es una fecha válida.');
    expect(faltaEnFechaRango('', 'la fecha')).toBeNull();
  });

  it('logo del ente, imágenes de la empresa, licencia y «desde» del ente: no se manda una fecha fuera de rango', async () => {
    const png = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await expect(subirLogoEnte('e-1', png, '1999-12-31')).rejects.toThrow('del logo tiene que estar entre');
    await expect(subirImagenAgente('sello', png, '2101-01-01')).rejects.toThrow('del sello tiene que estar entre');
    await expect(crearEnte({ nombre: 'Ente de prueba', tipo: 'nacional', impuestos: [], desde: '1999-01-01' })).rejects.toThrow('«desde» del ente');
    expect(subir).not.toHaveBeenCalled();
    expect(llamadas).toHaveLength(0);
    const p: PerfilNuevo = { tipoPersona: 'juridica', residente: true, tipoContribuyente: 'ordinario', esAgenteRetencion: false, licenciaEstado: 'solicitada', licenciaVence: '2101-01-01' };
    expect(faltaEnPerfil(p, '2026-10-21', 'x')).toBe('La fecha de vencimiento de la licencia tiene que estar entre el 01/01/2000 y el 31/12/2100.');
    expect(faltaEnPerfil({ ...p, licenciaVence: '2100-12-31' }, '2026-10-21', 'x')).toBeNull();
  });
});

describe('claves con su convención (R9) y su normalización', () => {
  it('minúsculas snake_case (R3, R4, R5): se normaliza y se dice qué cambió', () => {
    expect(normalizarClave('  Mínimo ISAE-2 ')).toBe('minimo_isae_2');
    expect(pistaClave('Mínimo ISAE', 'minimo_isae')).toBe('Se guardará como: minimo_isae');
    expect(pistaClave('minimo_isae', 'minimo_isae')).toBeNull();
    expect(faltaEnClaveMinusculas('minimo#x')).toBe('La clave va en minúsculas, sin espacios (letras sin acento, números y _); sobra «#».');
    expect(faltaEnClaveMinusculas('1abc')).toBe('La clave empieza con una letra.');
    expect(faltaEnClaveMinusculas('a')).toMatch(/de 2 a 41/);
    expect(faltaEnClave({ clave: normalizarClave('Mínimo ISAE'), nombre: 'Mínimo' })).toBeNull();
    expect(faltaEnTarifa({ clave: normalizarClave('ISLR Tarifa 2'), nombre: 'Tarifa N° 2', unidad: 'UT' })).toBeNull();
    expect(faltaEnTarifa({ clave: 'islr.2', nombre: 'Tarifa N° 2', unidad: 'UT' })).toMatch(/sobra «\.»/);
    expect(faltaEnClasificacion({ clave: '9isae', nombre: 'Actividades', impuestoClave: 'MUNICIPAL', enteId: null })).toMatch(/empieza con una letra/);
  });

  it('clave de impuesto en MAYÚSCULAS (^[A-Z][A-Z0-9_]{1,29}$)', () => {
    expect(normalizarClaveImpuesto('timbre x')).toBe('TIMBRE_X');
    const ficha = { clave: 'TIMBRE_X', nombre: 'Timbre', admitePracticada: true, admiteSufrida: true };
    expect(faltaEnImpuesto(ficha)).toBeNull();
    expect(faltaEnImpuesto({ ...ficha, clave: 'TIMBRE.X' })).toMatch(/mayúsculas/);
  });

  it('código de supuesto en camelCase; no se repite cambiando solo mayúsculas', () => {
    expect(normalizarCodigoSupuesto(' exportación total ')).toBe('exportacion_total');
    expect(normalizarCodigoSupuesto('exportacionTotal')).toBe('exportacionTotal');
    const lista = [{ id: 's-1', impuestoClave: 'IVA', codigo: 'exportacionTotal' }];
    expect(supuestoRepetido({ impuestoClave: 'IVA', codigo: 'ExportacionTOTAL' }, lista)).toMatch(/cambiando solo mayúsculas/);
    expect(supuestoRepetido({ impuestoClave: 'ISLR', codigo: 'exportacionTotal' }, lista)).toBeNull();
    expect(supuestoRepetido({ impuestoClave: 'IVA', codigo: 'exportacionTotal' }, lista, 's-1')).toBeNull();
  });

  it('nombre de ente: único por tipo sin distinguir mayúsculas; tipo de licencia: del catálogo activo', () => {
    const entes = [{ id: 'e-1', nombre: 'Alcaldía de Prueba', tipo: 'municipal' as const }];
    expect(enteRepetido({ nombre: '  alcaldía de prueba ', tipo: 'municipal' }, entes)).toMatch(/Ya hay un ente municipal/);
    expect(enteRepetido({ nombre: 'Alcaldía de Prueba', tipo: 'estadal' }, entes)).toBeNull();
    expect(enteRepetido({ nombre: 'Alcaldía de Prueba', tipo: 'municipal' }, entes, 'e-1')).toBeNull();
    expect(faltaEnTipoLicencia(' licencia de prueba ', ['Licencia de Prueba'])).toBeNull();
    expect(faltaEnTipoLicencia('Otra', ['Licencia de Prueba'])).toMatch(/no está en el catálogo/);
    expect(faltaEnTipoLicencia('Otra', null)).toBeNull();
    expect(faltaEnTipoLicencia('', ['Licencia de Prueba'])).toBeNull();
  });

  it('listas cerradas: tipo de ente, ámbito y unidad (R3), sujeto y unidad del mínimo (R4), unidad de tarifa (R5)', () => {
    expect(faltaEnEnte({ nombre: 'Ente de prueba', tipo: 'federal' as never })).toMatch(/nacional, estadal o municipal/);
    expect(faltaEnClave({ clave: 'x_y', nombre: 'XY', ambito: 'otro' as never })).toMatch(/ámbito/);
    expect(faltaEnClave({ clave: 'x_y', nombre: 'XY', tipoValor: 'numero', unidad: 'kg' as never })).toMatch(/%, Bs, UT o días/);
    const v = { sujeto: null, pct: 2, basePct: 100, minimo: null, minimoUnidad: null, sustraendoFactor: null };
    expect(faltaEnValorCodigo({ ...v, sujeto: 'PJ' as never }, '2026-10-21', 'x')).toMatch(/PJD, PJND, PNR, PNNR/);
    expect(faltaEnValorCodigo({ ...v, minimo: 1, minimoUnidad: 'USD' as never }, '2026-10-21', 'x')).toMatch(/UT, Bs o MMV/);
    expect(faltaEnTarifa({ clave: 'islr_x', nombre: 'Tarifa X', unidad: 'USD' as never })).toBe('La unidad de la tarifa es UT o Bs.');
  });
});

describe('códigos de clasificación y de ordenanza en MAYÚSCULAS (K2, K3)', () => {
  it('trim y mayúsculas; de 1 a 30, una sola línea', () => {
    expect(normalizarCodigo('  1.01a ')).toBe('1.01A');
    expect(pistaClave(' 1.01a', normalizarCodigo(' 1.01a'))).toBe('Se guardará como: 1.01A');
    expect(faltaEnCodigo('')).toBe('Indica el código.');
    expect(faltaEnCodigo('A'.repeat(31))).toBe('El código lleva hasta 30 caracteres.');
    expect(faltaEnCodigo('A\nB')).toBe('El código va en una sola línea.');
    expect(faltaEnCodigoNuevo({ codigo: ' x1 ', descripcion: 'Uno' })).toBeNull();
  });

  it('la carga pegada normaliza y compara con lo que hay; el alta manda el código en mayúsculas', async () => {
    const r = leerTablaPegada('a.01\tUno\t2\nA.01 \tOtra vez\t2\nb.02\tDos\t3');
    expect(r.filas.map((f) => f.codigo)).toEqual(['A.01', 'B.02']);
    expect(r.errores).toEqual(['Fila 2: el código A.01 está repetido.']);
    const existentes = [aCodigo({ id: 'c-1', clasificacion_id: 'k', codigo: 'B.02', descripcion: 'Dos' })];
    const plan = planCarga(existentes, r.filas);
    expect(plan.nuevos.map((f) => f.codigo)).toEqual(['A.01']);
    cola.push({ data: [{ id: 'c-9' }], error: null });
    await crearCodigo('k', { codigo: ' a.03 ', descripcion: 'Tres' });
    expect(insertado().codigo).toBe('A.03');
  });

  it('el código de ordenanza de una actividad se guarda igual que en el catálogo', async () => {
    expect(faltaEnActividad({ enteId: 'e-1', ordenanzaCodigo: 'X'.repeat(31) })).toBe('El código de la ordenanza lleva hasta 30 caracteres.');
    cola.push({ data: [{ id: 'a-1' }], error: null });
    await agregarActividad('p-1', { enteId: 'e-1', ordenanzaCodigo: ' 1.2b ' });
    expect(insertado()).toMatchObject({ ordenanza_codigo: '1.2B', ente_id: 'e-1' });
  });
});

describe('unidad según el tipo de la clave (R3)', () => {
  it('texto o sí/no no llevan unidad; un número sí', () => {
    expect(faltaEnClave({ clave: 'nota_x', nombre: 'Nota', tipoValor: 'texto', unidad: '%' })).toMatch(/tipo texto no lleva unidad \(%\)/);
    expect(faltaEnClave({ clave: 'aplica_x', nombre: 'Aplica', tipoValor: 'si_no', unidad: 'UT' })).toMatch(/tipo sí\/no no lleva unidad \(UT\)/);
    expect(faltaEnClave({ clave: 'aplica_x', nombre: 'Aplica', tipoValor: 'si_no', unidad: 'Bs' })).toMatch(/no lleva unidad/);
    expect(faltaEnClave({ clave: 'aplica_x', nombre: 'Aplica', tipoValor: 'si_no', unidad: null })).toBeNull();
    expect(faltaEnClave({ clave: 'pct_x', nombre: 'Pct', tipoValor: 'numero', unidad: '%' })).toBeNull();
  });
});

describe('botones que se apagaban sin decir por qué', () => {
  it('estado de una regla: lo que falta, con el campo', () => {
    expect(faltaEnEstadoRegla('activar', '', ' ')).toBe('Indica el motivo de la activación.');
    expect(faltaEnEstadoRegla('retirar', '', 'x')).toBe('Indica hasta qué fecha vale.');
    expect(faltaEnEstadoRegla('version', '2026-10-21', '')).toBe('Indica el motivo.');
    expect(faltaEnEstadoRegla('version', '2026-10-21', 'x')).toBeNull();
    expect(faltaEnReglaNueva({ nombre: 'R', desde: '2026-10-21', motivo: 'x' })).toMatch(/2 letras/);
  });
});
