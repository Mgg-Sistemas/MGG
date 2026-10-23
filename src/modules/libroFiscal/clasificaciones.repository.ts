/* ============================================================
   Golden Touch · Retenciones · Clasificación común (R4)

   Una tabla de clasificación (conceptos del ISLR, actividades del ISAE de un
   municipio…) es de un impuesto y/o de un ente. Cada código tiene sus valores
   por sujeto (PJD, PJND, PNR, PNNR o todos) con vigencia: %, porción de la
   base, mínimo (en UT, Bs o MMV) y factor del sustraendo. Un valor nuevo se
   manda solo con «desde»: la base cierra el anterior. El vigente se corrige.
   Nada se borra: un código se desactiva.

   Convivencia: la base copia en los dos sentidos con retenciones_conceptos
   (lo que usan hoy el modal y Tesorería), así el cálculo de hoy no cambia.
   El clasificador de una alcaldía se carga pegando una tabla, con vista previa.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { faltaEnClaveMinusculas, faltaEnCodigo, leerOpcional, normalizarCodigo } from './parametrosNumeros';

const T_CLASIFICACIONES = 'retencion_clasificaciones';
const T_CODIGOS = 'retencion_clasificacion_codigos';
const T_VALORES = 'retencion_clasificacion_valores';

export const r4Disponible = async () => {
  const [clasif, codigos] = await Promise.all([
    tablaDisponible(T_CLASIFICACIONES),
    tablaDisponible(T_CODIGOS),
  ]);
  return Boolean(clasif && codigos);
};

export type SujetoGt = 'PJD' | 'PJND' | 'PNR' | 'PNNR';
export type UnidadMinimo = 'UT' | 'Bs' | 'MMV';
/** Las listas cerradas de la base (retencion_clasificacion_valores): lo que mandan los select, exacto. */
export const SUJETOS_VALIDOS: SujetoGt[] = ['PJD', 'PJND', 'PNR', 'PNNR'];
export const UNIDADES_MINIMO: UnidadMinimo[] = ['UT', 'Bs', 'MMV'];
export const SUJETOS_GT: { key: SujetoGt | null; label: string }[] = [
  { key: 'PJD', label: 'P. jurídica domiciliada' },
  { key: 'PJND', label: 'P. jurídica no domiciliada' },
  { key: 'PNR', label: 'P. natural residente' },
  { key: 'PNNR', label: 'P. natural no residente' },
  { key: null, label: 'Todos los sujetos' },
];

export interface Clasificacion {
  id: string;
  clave: string | null;
  nombre: string;
  impuestoClave: string | null;
  enteId: string | null;
  descripcion: string | null;
  fuente: string | null;
  activo: boolean;
}

export interface ValorCodigo {
  id: string;
  codigoId: string;
  sujeto: SujetoGt | null;
  pct: number | null;
  basePct: number;
  minimo: number | null;
  minimoUnidad: UnidadMinimo | null;
  sustraendoFactor: number | null;
  /** R5: la tasa sale de esta tarifa por tramos (y entonces no hay %). */
  tarifaId: string | null;
  desde: string;
  hasta: string | null;
  fuente: string | null;
  motivo: string;
  nota: string | null;
  actualizadoPor: string | null;
}

export interface CodigoClasificacion {
  id: string;
  clasificacionId: string;
  codigo: string;
  descripcion: string;
  orden: number;
  activo: boolean;
  nota: string | null;
  /** Sus valores, el más nuevo primero. */
  valores: ValorCodigo[];
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

/* ───────── Piezas puras ───────── */

export function aClasificacion(r: Record<string, unknown>): Clasificacion {
  return {
    id: String(r.id), clave: texto(r.clave), nombre: String(r.nombre ?? ''), impuestoClave: texto(r.impuesto_clave),
    enteId: texto(r.ente_id), descripcion: texto(r.descripcion), fuente: texto(r.fuente), activo: r.activo !== false,
  };
}

export function aValorCodigo(r: Record<string, unknown>): ValorCodigo {
  return {
    id: String(r.id), codigoId: String(r.codigo_id ?? ''), sujeto: (texto(r.sujeto) as SujetoGt | null),
    pct: num(r.pct), basePct: num(r.base_pct) ?? 100, minimo: num(r.minimo), minimoUnidad: (texto(r.minimo_unidad) as UnidadMinimo | null),
    sustraendoFactor: num(r.sustraendo_factor), tarifaId: texto(r.tarifa_id), desde: String(r.desde ?? ''), hasta: texto(r.hasta),
    fuente: texto(r.fuente), motivo: String(r.motivo ?? ''), nota: texto(r.nota), actualizadoPor: texto(r.actualizado_por),
  };
}

export function aCodigo(r: Record<string, unknown>): CodigoClasificacion {
  const vs = (r.retencion_clasificacion_valores as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(r.id), clasificacionId: String(r.clasificacion_id ?? ''), codigo: String(r.codigo ?? ''),
    descripcion: String(r.descripcion ?? ''), orden: Number(r.orden ?? 100) || 0, activo: r.activo !== false, nota: texto(r.nota),
    valores: vs.map(aValorCodigo).sort((a, b) => b.desde.localeCompare(a.desde)),
  };
}

/** El valor de un código para un sujeto en una fecha: el del sujeto o, si no hay, el de «todos». Igual que retencion_clasificacion_valor. */
export function valorVigenteCodigo(valores: ValorCodigo[], sujeto: SujetoGt | null, fecha: string = hoyIso()): ValorCodigo | null {
  const vale = (v: ValorCodigo) => v.desde <= fecha && (!v.hasta || v.hasta >= fecha);
  const orden = (xs: ValorCodigo[]) => xs.sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null;
  return (sujeto ? orden(valores.filter((v) => v.sujeto === sujeto && vale(v))) : null)
    ?? orden(valores.filter((v) => v.sujeto == null && vale(v)));
}

const n2 = (v: number) => v.toLocaleString('es-VE', { maximumFractionDigits: 4 });

/** «2 % · base 90 % · mín. 83,3334 UT · sustraendo × 83,3334». */
export function resumenValor(v: ValorCodigo | null): string {
  if (!v) return '—';
  const partes = [v.tarifaId ? 'tarifa por tramos' : v.pct == null ? 'sin %' : `${n2(v.pct)} %`];
  if (v.basePct !== 100) partes.push(`base ${n2(v.basePct)} %`);
  if (v.minimo != null) partes.push(`mín. ${n2(v.minimo)} ${v.minimoUnidad ?? ''}`.trim());
  if (v.sustraendoFactor != null) partes.push(`sustraendo × ${n2(v.sustraendoFactor)}`);
  return partes.join(' · ');
}

export interface DatosValorCodigo {
  sujeto: SujetoGt | null;
  pct: number | null;
  basePct: number;
  minimo: number | null;
  minimoUnidad: UnidadMinimo | null;
  sustraendoFactor: number | null;
  /** R5: tarifa por tramos en vez de %. Solo se manda si viene (sin R5 la columna no existe). */
  tarifaId?: string | null;
  fuente?: string | null;
  nota?: string | null;
}

export function faltaEnValorCodigo(v: DatosValorCodigo, desde: string, motivo: string): string | null {
  if (v.sujeto != null && !SUJETOS_VALIDOS.includes(v.sujeto)) return 'El sujeto es PJD, PJND, PNR, PNNR o todos.';
  if (v.minimoUnidad != null && !UNIDADES_MINIMO.includes(v.minimoUnidad)) return 'La unidad del mínimo es UT, Bs o MMV.';
  if (v.pct != null && (!Number.isFinite(v.pct) || v.pct < 0 || v.pct > 100)) return 'El % va de 0 a 100.';
  if (v.pct != null && v.tarifaId) return 'Un valor usa un % o una tarifa, no los dos.';
  if (!Number.isFinite(v.basePct) || v.basePct <= 0 || v.basePct > 100) return 'La porción de la base va de más de 0 a 100.';
  if ((v.minimo == null) !== (v.minimoUnidad == null)) return 'El mínimo va con su unidad (UT, Bs o MMV).';
  if (v.minimo != null && v.minimo < 0) return 'El mínimo no puede ser negativo.';
  if (v.sustraendoFactor != null && v.sustraendoFactor < 0) return 'El factor del sustraendo no puede ser negativo.';
  if (!FECHA.test(desde)) return 'Indica desde qué fecha vale.';
  if (!motivo.trim()) return 'Indica el motivo: queda en el historial.';
  return null;
}

/* ───────── Pegar una tabla (clasificador de una alcaldía) ───────── */

export interface FilaPegada { codigo: string; descripcion: string; alicuota: number | null; minimo: number | null }
export interface LecturaPegada { filas: FilaPegada[]; errores: string[] }


/**
 * Lee lo pegado desde Excel o un PDF: una fila por línea, columnas separadas
 * por tabulador o «;» (código, descripción, alícuota, mínimo). Una primera fila
 * de títulos se salta. Códigos repetidos o números ilegibles van a errores.
 */
export function leerTablaPegada(crudo: string): LecturaPegada {
  const lineas = crudo.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const filas: FilaPegada[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  lineas.forEach((linea, i) => {
    const cols = (linea.includes('\t') ? linea.split('\t') : linea.split(';')).map((c) => c.trim());
    const [crudoCodigo = '', descripcion = '', alic = '', min = ''] = cols;
    if (i === 0 && /c[oó]digo/i.test(crudoCodigo)) return;   // títulos
    const n = i + 1;
    // En MAYÚSCULAS y sin espacios al borde, como lo guarda la base: así se compara con lo que ya hay.
    const codigo = normalizarCodigo(crudoCodigo);
    if (!codigo) { errores.push(`Fila ${n}: falta el código.`); return; }
    const faltaCodigo = faltaEnCodigo(codigo);
    if (faltaCodigo) { errores.push(`Fila ${n} (${codigo}): ${faltaCodigo}`); return; }
    if (descripcion.length < 2) { errores.push(`Fila ${n} (${codigo}): falta la descripción.`); return; }
    // El lector de montos de todo el sistema (vacío = sin dato; el «%» pegado se ignora).
    const a = leerOpcional(alic, 'la alícuota'); const m = leerOpcional(min, 'el mínimo');
    if ('error' in a) { errores.push(`Fila ${n} (${codigo}): ${a.error}`); return; }
    if ('error' in m) { errores.push(`Fila ${n} (${codigo}): ${m.error}`); return; }
    const alicuota = a.valor; const minimo = m.valor;
    if (alicuota != null && (alicuota < 0 || alicuota > 100)) { errores.push(`Fila ${n} (${codigo}): la alícuota no va de 0 a 100.`); return; }
    if (minimo != null && minimo < 0) { errores.push(`Fila ${n} (${codigo}): el mínimo no puede ser negativo.`); return; }
    if (vistos.has(codigo)) { errores.push(`Fila ${n}: el código ${codigo} está repetido.`); return; }
    vistos.add(codigo);
    filas.push({ codigo, descripcion, alicuota, minimo });
  });
  return { filas, errores };
}

export interface PlanCarga {
  nuevos: FilaPegada[];
  /** Ya existen y cambia la descripción o la alícuota/mínimo vigentes. */
  cambian: { fila: FilaPegada; codigo: CodigoClasificacion; cambiaDescripcion: boolean; cambiaValor: boolean }[];
  iguales: FilaPegada[];
}

/** Qué hace la carga con lo que ya hay: lo nuevo, lo que cambia y lo que queda igual. */
export function planCarga(existentes: CodigoClasificacion[], filas: FilaPegada[], fecha: string = hoyIso()): PlanCarga {
  const porCodigo = new Map(existentes.map((c) => [normalizarCodigo(c.codigo), c]));
  const plan: PlanCarga = { nuevos: [], cambian: [], iguales: [] };
  for (const f of filas) {
    const c = porCodigo.get(normalizarCodigo(f.codigo));
    if (!c) { plan.nuevos.push(f); continue; }
    const v = valorVigenteCodigo(c.valores, null, fecha);
    const cambiaDescripcion = c.descripcion.trim() !== f.descripcion.trim();
    const cambiaValor = (f.alicuota != null && v?.pct !== f.alicuota) || (f.minimo != null && v?.minimo !== f.minimo);
    if (cambiaDescripcion || cambiaValor) plan.cambian.push({ fila: f, codigo: c, cambiaDescripcion, cambiaValor });
    else plan.iguales.push(f);
  }
  return plan;
}

/**
 * El valor que deja una fila pegada, desde la fecha de la carga. La tabla solo
 * trae alícuota y mínimo: lo que la fila no trae (el mínimo, o la alícuota o
 * tarifa) y la porción de la base y el factor del sustraendo se CONSERVAN del
 * valor vigente para todos, en vez de quedar vacíos.
 */
export function valorDeFilaPegada(f: FilaPegada, vigente: ValorCodigo | null, o: { minimoUnidad: UnidadMinimo; fuente?: string | null }): DatosValorCodigo {
  const conAlicuota = f.alicuota != null;
  const conMinimo = f.minimo != null;
  const tarifaVigente = !conAlicuota && vigente?.tarifaId ? vigente.tarifaId : null;
  return {
    sujeto: null,
    pct: conAlicuota ? f.alicuota : tarifaVigente ? null : vigente?.pct ?? null,
    basePct: vigente?.basePct ?? 100,
    minimo: conMinimo ? f.minimo : vigente?.minimo ?? null,
    minimoUnidad: conMinimo ? o.minimoUnidad : vigente?.minimo != null ? vigente.minimoUnidad : null,
    sustraendoFactor: vigente?.sustraendoFactor ?? null,
    ...(tarifaVigente ? { tarifaId: tarifaVigente } : {}),
    fuente: o.fuente,
  };
}

/* ───────── Lectura ───────── */

export async function listClasificaciones(): Promise<Clasificacion[]> {
  if (!(await r4Disponible())) return [];
  const { data, error } = await supabase.from(T_CLASIFICACIONES).select('*').order('nombre');
  if (error) throw errorRetencion(error, 'No se pudieron leer las clasificaciones.');
  return (data ?? []).map((r) => aClasificacion(r as Record<string, unknown>));
}

/** Los códigos de una clasificación con sus valores. */
export async function listCodigos(clasificacionId: string): Promise<CodigoClasificacion[]> {
  if (!(await r4Disponible())) return [];
  const { data, error } = await supabase.from(T_CODIGOS).select(`*, ${T_VALORES}(*)`)
    .eq('clasificacion_id', clasificacionId).order('orden').order('codigo');
  if (error) throw errorRetencion(error, 'No se pudieron leer los códigos.');
  return (data ?? []).map((r) => aCodigo(r as Record<string, unknown>));
}

/** Los códigos activos de las clasificaciones de un ente (las actividades del municipio, para el perfil del proveedor). */
export async function codigosDeEnte(enteId: string): Promise<CodigoClasificacion[]> {
  if (!(await r4Disponible())) return [];
  const { data: ks, error } = await supabase.from(T_CLASIFICACIONES).select('id').eq('ente_id', enteId).eq('activo', true);
  if (error) throw errorRetencion(error, 'No se pudo leer la clasificación del municipio.');
  const ids = ((ks ?? []) as { id: string }[]).map((k) => k.id);
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from(T_CODIGOS).select('*').in('clasificacion_id', ids).eq('activo', true).order('orden').order('codigo');
  if (e2) throw errorRetencion(e2, 'No se pudieron leer las actividades del municipio.');
  return (data ?? []).map((r) => aCodigo(r as Record<string, unknown>));
}

/* ───────── Escritura ───────── */

const exigir = (data: unknown, que: string) => {
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`No se guardó ${que}: sin permiso de escritura en Retenciones, o ya no existe.`);
  return id;
};

export interface ClasificacionNueva { clave?: string | null; nombre: string; impuestoClave: string | null; enteId: string | null; descripcion?: string | null; fuente?: string | null }

export function faltaEnClasificacion(k: ClasificacionNueva): string | null {
  if (k.nombre.trim().length < 3) return 'El nombre necesita al menos 3 letras.';
  if (!k.impuestoClave && !k.enteId) return 'Una clasificación es de un impuesto, de un ente o de ambos.';
  if (k.clave) return faltaEnClaveMinusculas(k.clave);
  return null;
}

export interface CodigoNuevo { codigo: string; descripcion: string; orden?: number; nota?: string | null }

/**
 * Lo que falta en un código nuevo, o null. El código se revisa ya normalizado
 * (normalizarCodigo: sin espacios al borde y en MAYÚSCULAS), como la base.
 */
export function faltaEnCodigoNuevo(c: CodigoNuevo): string | null {
  return faltaEnCodigo(normalizarCodigo(c.codigo))
    ?? (c.descripcion.trim().length < 2 ? 'Indica la descripción (al menos 2 letras).' : null)
    ?? (c.orden != null && c.orden < 0 ? 'El orden no puede ser negativo.' : null);
}

export async function crearClasificacion(k: ClasificacionNueva): Promise<string> {
  const falta = faltaEnClasificacion(k);
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_CLASIFICACIONES).insert({
    clave: k.clave || null, nombre: k.nombre.trim(), impuesto_clave: k.impuestoClave, ente_id: k.enteId,
    descripcion: k.descripcion?.trim() || null, fuente: k.fuente?.trim() || null,
  }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo crear la clasificación.', { unico: 'Ya hay una clasificación con esa clave.' });
  return exigir(data, 'la clasificación');
}

export async function crearCodigo(clasificacionId: string, c: CodigoNuevo): Promise<string> {
  const falta = faltaEnCodigoNuevo(c);
  if (falta) throw new Error(falta);
  const codigo = normalizarCodigo(c.codigo);
  const { data, error } = await supabase.from(T_CODIGOS).insert({
    clasificacion_id: clasificacionId, codigo, descripcion: c.descripcion.trim(), orden: c.orden ?? 100, nota: c.nota?.trim() || null,
  }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo crear el código.', { unico: `El código ${codigo} ya está en esta clasificación.` });
  return exigir(data, 'el código');
}

/** Cambia la descripción, el orden o la nota de un código; o lo activa o desactiva (con la nota como motivo). */
export async function editarCodigo(id: string, cambios: { descripcion?: string; orden?: number; nota?: string | null; activo?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (cambios.descripcion !== undefined) {
    if (cambios.descripcion.trim().length < 2) throw new Error('Indica la descripción.');
    patch.descripcion = cambios.descripcion.trim();
  }
  if (cambios.orden !== undefined) {
    if (!Number.isInteger(cambios.orden) || cambios.orden < 0) throw new Error('El orden es un entero desde 0.');
    patch.orden = cambios.orden;
  }
  if (cambios.nota !== undefined) patch.nota = cambios.nota?.trim() || null;
  if (cambios.activo !== undefined) patch.activo = cambios.activo;
  const { data, error } = await supabase.from(T_CODIGOS).update(patch).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar el código.');
  exigir(data, 'el código');
}

const filaValor = (v: DatosValorCodigo) => ({
  sujeto: v.sujeto, pct: v.pct, base_pct: v.basePct, minimo: v.minimo, minimo_unidad: v.minimo == null ? null : v.minimoUnidad,
  sustraendo_factor: v.sustraendoFactor, fuente: v.fuente?.trim() || null, nota: v.nota?.trim() || null,
  ...(v.tarifaId !== undefined ? { tarifa_id: v.tarifaId || null } : {}),
});
const TEXTOS_VALOR = {
  unico: 'Ya hay un valor de ese código y sujeto que empieza en esa fecha: elige otra fecha o corrige ese.',
  regla: 'Revisa el valor: % de 0 a 100, la porción de la base de más de 0 a 100 y el mínimo con su unidad.',
};

/** Valor nuevo de un código y sujeto desde una fecha (la base cierra el anterior). */
export async function nuevoValorCodigo(codigoId: string, v: DatosValorCodigo, desde: string, motivo: string): Promise<string> {
  const falta = faltaEnValorCodigo(v, desde, motivo);
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_VALORES).insert({ codigo_id: codigoId, ...filaValor(v), desde, motivo: motivo.trim() }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar el valor.', TEXTOS_VALOR);
  return exigir(data, 'el valor');
}

/** Corrige un valor ya cargado (sin cambiar su sujeto ni su «desde»). */
export async function corregirValorCodigo(id: string, v: DatosValorCodigo, motivo: string): Promise<void> {
  const falta = faltaEnValorCodigo(v, '2000-01-01', motivo);
  if (falta) throw new Error(falta);
  const { sujeto: _s, ...resto } = filaValor(v);
  void _s;
  const { data, error } = await supabase.from(T_VALORES).update({ ...resto, motivo: motivo.trim() }).eq('id', id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo corregir el valor.', TEXTOS_VALOR);
  exigir(data, 'el valor');
}

export interface ResultadoCarga { creados: number; actualizados: number; valores: number; fallas: string[] }

/**
 * Carga lo pegado según el plan: crea los códigos nuevos, actualiza la
 * descripción de los que cambian y, si traen alícuota o mínimo, les da un
 * valor nuevo para todos los sujetos desde la fecha (lo que la fila no trae
 * se conserva del vigente: valorDeFilaPegada). Sigue con el resto si una
 * fila falla, y la reporta.
 */
export async function cargarClasificador(
  clasificacionId: string, plan: PlanCarga,
  o: { desde: string; motivo: string; minimoUnidad: UnidadMinimo; fuente?: string | null },
): Promise<ResultadoCarga> {
  if (!FECHA.test(o.desde)) throw new Error('Indica desde qué fecha valen las alícuotas.');
  if (!o.motivo.trim()) throw new Error('Indica el motivo de la carga: queda en el historial.');
  const r: ResultadoCarga = { creados: 0, actualizados: 0, valores: 0, fallas: [] };
  for (const f of plan.nuevos) {
    try {
      const id = await crearCodigo(clasificacionId, { codigo: f.codigo, descripcion: f.descripcion });
      r.creados += 1;
      if (f.alicuota != null || f.minimo != null) { await nuevoValorCodigo(id, valorDeFilaPegada(f, null, o), o.desde, o.motivo); r.valores += 1; }
    } catch (e) { r.fallas.push(`${f.codigo}: ${e instanceof Error ? e.message : 'error'}`); }
  }
  for (const c of plan.cambian) {
    try {
      if (c.cambiaDescripcion) { await editarCodigo(c.codigo.id, { descripcion: c.fila.descripcion, nota: o.motivo }); r.actualizados += 1; }
      if (c.cambiaValor) {
        const vigente = valorVigenteCodigo(c.codigo.valores, null, o.desde);
        await nuevoValorCodigo(c.codigo.id, valorDeFilaPegada(c.fila, vigente, o), o.desde, o.motivo); r.valores += 1;
      }
    } catch (e) { r.fallas.push(`${c.fila.codigo}: ${e instanceof Error ? e.message : 'error'}`); }
  }
  return r;
}
