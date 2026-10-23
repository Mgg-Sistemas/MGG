/* ============================================================
   Golden Touch · Retenciones · Entes y logos (R1)

   Quién crea y cobra cada impuesto (SENIAT, alcaldía, gobernación), con su
   territorio; qué impuestos cobra cada uno; su logo por versiones; y las
   imágenes de la empresa como agente (logo, firma, sello), también por
   versiones. Una sola fuente: la base. Nada se borra: un ente se desactiva, un
   logo nuevo es una versión nueva desde una fecha, y un comprobante viejo
   conserva el logo de su fecha de emisión.

   Qué impuestos cobra cada ente: hasta R2, el puente retencion_ente_impuestos;
   desde R2, retencion_impuestos.ente_id (el puente queda de solo lectura). Se
   elige con el detector de tablas.

   Archivos en el bucket privado `retenciones-logos` (PNG o JPG, hasta 1 MB).
   Se sube sin reemplazar; si la versión no se guarda, se borra el archivo
   (la política solo deja borrar un archivo que ninguna versión usa).
   Depende del paquete R1; no se monta en pantalla hasta que BD lo confirme.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { errorRetencion } from './erroresRetencion';
import { r2Disponible, tablaDisponible } from './disponibilidad';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { completarRif } from '@/shared/lib/rif';
import { faltaEnFechaRango } from './parametrosNumeros';

export const BUCKET_LOGOS = 'retenciones-logos';
const T_ENTES = 'retencion_entes';
const T_ENTE_IMPUESTOS = 'retencion_ente_impuestos';
const T_ENTE_LOGOS = 'retencion_ente_logos';
const T_AGENTE_IMAGENES = 'retencion_agente_imagenes';
export const MAX_IMAGEN_BYTES = 1024 * 1024;

export type TipoEnte = 'nacional' | 'estadal' | 'municipal';
/** Clave del impuesto en la base (la de `retenciones.tipo`). Con R2 puede haber claves nuevas. */
export type ClaveImpuesto = 'IVA' | 'ISLR' | 'MUNICIPAL' | 'ESTADAL' | 'IGTF' | (string & {});
export const CLAVES_IMPUESTO: ClaveImpuesto[] = ['IVA', 'ISLR', 'MUNICIPAL', 'ESTADAL', 'IGTF'];
const T_IMPUESTOS = 'retencion_impuestos';
export type ClaseImagenAgente = 'logo' | 'firma' | 'sello';

export interface VersionImagen {
  id: string;
  ruta: string;
  nombreArchivo: string | null;
  desde: string;
  activo: boolean;
  motivo: string | null;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

export interface Ente {
  id: string;
  nombre: string;
  tipo: TipoEnte;
  estado: string | null;
  municipio: string | null;
  rif: string | null;
  activo: boolean;
  desde: string;
  hasta: string | null;
  motivo: string | null;
  /** Impuestos activos que crea o cobra. */
  impuestos: ClaveImpuesto[];
  /** Versiones del logo, la más nueva primero. */
  logos: VersionImagen[];
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

export interface ImagenAgente extends VersionImagen {
  clase: ClaseImagenAgente;
  firmante: string | null;
}

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

/* ───────── Piezas puras ───────── */

/** Las cinco de siempre en su orden; las nuevas (R2), después y por nombre. */
function ordenClaves(a: string, b: string): number {
  const ia = CLAVES_IMPUESTO.indexOf(a); const ib = CLAVES_IMPUESTO.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

/** Con R2: los impuestos de cada ente salen de retencion_impuestos.ente_id (solo los activos). */
export function impuestosPorEnte(impuestos: { clave: string; ente_id: string | null; activo?: boolean }[]): Map<string, ClaveImpuesto[]> {
  const m = new Map<string, ClaveImpuesto[]>();
  for (const i of impuestos) {
    if (!i.ente_id || i.activo === false) continue;
    m.set(i.ente_id, [...(m.get(i.ente_id) ?? []), i.clave].sort(ordenClaves));
  }
  return m;
}

function aVersion(r: Record<string, unknown>): VersionImagen {
  return {
    id: String(r.id), ruta: String(r.ruta ?? ''), nombreArchivo: texto(r.nombre_archivo),
    desde: String(r.desde ?? ''), activo: r.activo !== false, motivo: texto(r.motivo),
    actualizadoEn: texto(r.actualizado_en), actualizadoPor: texto(r.actualizado_por),
  };
}

export function aEnte(r: Record<string, unknown>): Ente {
  const id = String(r.id ?? r.ente ?? '');
  const imps = (r.retencion_ente_impuestos as Record<string, unknown>[] | undefined) ?? [];
  const logos = (r.retencion_ente_logos as Record<string, unknown>[] | undefined) ?? [];
  return {
    id, nombre: String(r.nombre ?? ''), tipo: (r.tipo as TipoEnte) ?? 'nacional',
    estado: texto(r.estado), municipio: texto(r.municipio), rif: texto(r.rif),
    activo: r.activo !== false, desde: String(r.desde ?? r.created_at ?? '').slice(0, 10), hasta: texto(r.hasta), motivo: texto(r.motivo),
    impuestos: imps.filter((i) => i.activo !== false).map((i) => String(i.impuesto_clave) as ClaveImpuesto)
      .sort(ordenClaves),
    logos: logos.map(aVersion).sort((a, b) => b.desde.localeCompare(a.desde)),
    actualizadoEn: texto(r.actualizado_en), actualizadoPor: texto(r.actualizado_por),
  };
}

/** La versión que vale en una fecha: la activa más nueva con «desde» hasta esa fecha. Igual que retencion_ente_logo_vigente. */
export function versionVigente<T extends Pick<VersionImagen, 'desde' | 'activo'>>(versiones: T[], fecha: string = hoyIso()): T | null {
  return versiones.filter((v) => v.activo && v.desde <= fecha).sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null;
}

export const TIPOS_ENTE_VALIDOS: TipoEnte[] = ['nacional', 'estadal', 'municipal'];

/** Las letras que la base acepta en el RIF de un ente (retencion_entes_rif_forma: sin la C). */
export const LETRAS_RIF_ENTE = ['V', 'E', 'J', 'P', 'G'];
export const MENSAJE_RIF_ENTE = 'El RIF del ente no es válido: letra (V, E, J, P o G), 8 dígitos y el verificador.';

/**
 * El RIF del ente como se guarda: sin guiones ni espacios (J123456789). Vacío
 * = sin RIF (null). Con la letra y hasta 8 números se completa el dígito
 * verificador, como en el registro; lo demás no se guarda.
 */
export function leerRifEnte(texto: string | null | undefined): { valor: string | null } | { error: string } {
  const t = String(texto ?? '').trim();
  if (!t) return { valor: null };
  const completo = completarRif(t);
  if (!completo || !LETRAS_RIF_ENTE.includes(completo[0])) return { error: MENSAJE_RIF_ENTE };
  return { valor: completo };
}

/** Lo que falta o sobra en los datos de un ente, o null si está bien. Las mismas reglas que la tabla. */
export function faltaEnEnte(e: { nombre: string; tipo: TipoEnte; estado?: string | null; municipio?: string | null; rif?: string | null }): string | null {
  if (e.nombre.trim().length < 3) return 'El nombre del ente necesita al menos 3 letras.';
  if (!TIPOS_ENTE_VALIDOS.includes(e.tipo)) return 'El tipo del ente es nacional, estadal o municipal.';
  if (e.tipo === 'municipal' && (!e.estado?.trim() || !e.municipio?.trim())) return 'Un ente municipal lleva su estado y su municipio.';
  if (e.tipo === 'estadal' && !e.estado?.trim()) return 'Un ente estadal lleva su estado.';
  if (e.rif !== undefined) {
    const rif = leerRifEnte(e.rif);
    if ('error' in rif) return rif.error;
  }
  return null;
}

/**
 * ¿Ya hay otro ente del mismo tipo con ese nombre? La base no distingue
 * mayúsculas ni espacios al borde (retencion_entes_unico). Con la lista a mano
 * se avisa antes de mandar.
 */
export function enteRepetido(e: { nombre: string; tipo: TipoEnte }, entes: Pick<Ente, 'id' | 'nombre' | 'tipo'>[], idPropio?: string): string | null {
  const n = e.nombre.trim().toLocaleLowerCase('es');
  const otro = entes.find((x) => x.id !== idPropio && x.tipo === e.tipo && x.nombre.trim().toLocaleLowerCase('es') === n);
  return otro ? `Ya hay un ente ${e.tipo} con ese nombre: «${otro.nombre}» (sin distinguir mayúsculas).` : null;
}

/** Revisa la imagen antes de subirla: PNG o JPG, hasta 1 MB. */
export function faltaEnImagen(f: { type: string; size: number }): string | null {
  if (f.type !== 'image/png' && f.type !== 'image/jpeg') return 'La imagen tiene que ser PNG o JPG.';
  if (f.size > MAX_IMAGEN_BYTES) return 'La imagen pasa de 1 MB: redúcela antes de subirla.';
  return null;
}

/** «Logo Alcaldía (1).png» → «logo-alcaldia-1.png». */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/-\./g, '.').replace(/^-|-$/g, '');
  return limpio || 'imagen';
}

export const rutaLogoEnte = (enteId: string, desde: string, archivo: string) => `entes/${enteId}/${desde}-${nombreSeguro(archivo)}`;
export const rutaImagenAgente = (clase: ClaseImagenAgente, desde: string, archivo: string) => `agente/${clase}/${desde}-${nombreSeguro(archivo)}`;

/* ───────── Lectura ───────── */

/** Todos los entes (activos primero), con sus impuestos y las versiones de su logo. */
export async function listEntes(): Promise<Ente[]> {
  const [hayPuente, hayLogos] = await Promise.all([
    tablaDisponible(T_ENTE_IMPUESTOS),
    tablaDisponible(T_ENTE_LOGOS),
  ]);
  const res = (hayPuente && hayLogos)
    ? await supabase.from(T_ENTES).select('*, retencion_ente_impuestos(*), retencion_ente_logos(*)').order('activo', { ascending: false }).order('nombre')
    : await supabase.from(T_ENTES).select('*').order('activo', { ascending: false }).order('nombre');
  if (res.error) throw errorRetencion(res.error, 'No se pudieron leer los entes.');
  const entes = (res.data ?? []).map((r) => aEnte(r as Record<string, unknown>));
  if (!(await r2Disponible())) return entes;
  
  // En MGG la columna es `ente`; en GT es `ente_id`
  let imps: { clave: string; ente_id: string | null; activo?: boolean }[] = [];
  try {
    const { data: dMgg, error: errMgg } = await supabase.from(T_IMPUESTOS).select('clave, ente, activo');
    if (!errMgg && dMgg) {
      imps = dMgg.map((i: { clave: string; ente: string | null; activo?: boolean }) => ({
        clave: i.clave.toUpperCase(),
        ente_id: i.ente,
        activo: i.activo,
      }));
    }
  } catch { /* fallback */ }

  if (!imps.length) {
    try {
      const { data: dGt } = await supabase.from(T_IMPUESTOS).select('clave, ente_id, activo');
      if (dGt) {
        imps = dGt as { clave: string; ente_id: string | null; activo?: boolean }[];
      }
    } catch { /* fallback */ }
  }

  const porEnte = impuestosPorEnte(imps);
  return entes.map((e) => ({ ...e, impuestos: porEnte.get(e.id) ?? [] }));
}

/** Los impuestos que se pueden asignar a un ente: con R2, los activos del catálogo con su nombre. */
export async function opcionesImpuestoEnte(): Promise<{ clave: ClaveImpuesto; nombre: string | null }[]> {
  if (!(await r2Disponible())) return CLAVES_IMPUESTO.map((clave) => ({ clave, nombre: null }));
  const nombresDefecto: Record<string, string> = {
    iva: 'Impuesto al Valor Agregado (IVA)',
    islr: 'Impuesto Sobre la Renta (ISLR)',
    municipal: 'Impuesto a las Actividades Económicas (ISAE)',
    regional: 'Impuesto / Timbre Fiscal Estadal',
    igtf: 'Impuesto a las Grandes Transacciones Financieras (IGTF)',
  };
  try {
    const { data, error } = await supabase.from(T_IMPUESTOS).select('clave, activo').eq('activo', true).order('orden').order('clave');
    if (!error && data) {
      return (data as { clave: string }[]).map((i) => ({
        clave: i.clave.toUpperCase() as ClaveImpuesto,
        nombre: nombresDefecto[i.clave.toLowerCase()] ?? i.clave.toUpperCase(),
      }));
    }
  } catch { /* fallback */ }
  return CLAVES_IMPUESTO.map((clave) => ({ clave, nombre: nombresDefecto[clave.toLowerCase()] ?? clave }));
}

/** URL firmada (10 minutos) de una imagen del bucket. */
export async function urlImagen(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_LOGOS).createSignedUrl(ruta, 60 * 10);
  if (error) throw errorRetencion(error, 'No se pudo abrir la imagen.');
  return data.signedUrl;
}

/** La ruta del logo de un ente que vale en una fecha (la de emisión del comprobante). */
export async function logoEnteVigente(enteId: string, fecha: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('retencion_ente_logo_vigente', { p_ente: enteId, p_fecha: fecha });
    if (!error) return texto(data);
  } catch { /* RPC fallback */ }
  return null;
}

/* ───────── Entes ───────── */

export interface EnteNuevo {
  nombre: string;
  tipo: TipoEnte;
  estado?: string | null;
  municipio?: string | null;
  rif?: string | null;
  impuestos: ClaveImpuesto[];
  desde?: string;
  motivo?: string | null;
}

const TEXTOS_ENTE = {
  unico: 'Ya hay un ente de ese tipo con ese nombre.',
  regla: 'Revisa los datos del ente: un municipal lleva estado y municipio; un estadal, el estado.',
};

/**
 * Crea un ente y le asigna sus impuestos. Son dos pasos: si el segundo falla,
 * el ente queda creado sin impuestos (no se borra) y el aviso lo dice.
 */
export async function crearEnte(e: EnteNuevo): Promise<string> {
  const falta = faltaEnEnte(e);
  if (falta) throw new Error(falta);
  if (e.desde && !FECHA.test(e.desde)) throw new Error('La fecha «desde» no es válida.');
  const faltaDesde = faltaEnFechaRango(e.desde, 'la fecha «desde» del ente');
  if (faltaDesde) throw new Error(faltaDesde);
  const rif = leerRifEnte(e.rif);
  if ('error' in rif) throw new Error(rif.error);
  
  // Intento en esquema MGG: retencion_entes(ente, nombre, usar_en_comprobante)
  const clave = nombreSeguro(e.nombre).replace(/-/g, '_');
  try {
    const { data: dMgg, error: errMgg } = await supabase.from(T_ENTES).insert({
      ente: clave,
      nombre: e.nombre.trim(),
      usar_en_comprobante: false,
      activo: true,
    }).select('ente');
    if (!errMgg && dMgg?.length) {
      const id = String((dMgg[0] as { ente: string }).ente);
      if (e.impuestos.length) {
        await fijarImpuestosEnte(id, e.impuestos).catch(() => {});
      }
      return id;
    }
  } catch { /* fallback */ }

  const { data, error } = await supabase.from(T_ENTES).insert({
    nombre: e.nombre.trim(), tipo: e.tipo,
    estado: e.tipo === 'nacional' ? null : e.estado?.trim() || null,
    municipio: e.tipo === 'municipal' ? e.municipio?.trim() || null : null,
    rif: rif.valor,
    desde: e.desde || undefined,
    motivo: e.motivo?.trim() || null,
  }).select('id');
  if (error) throw errorRetencion(error, 'No se pudo crear el ente.', TEXTOS_ENTE);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error('No se creó el ente: sin permiso de escritura en Retenciones.');
  if (e.impuestos.length) {
    try {
      await fijarImpuestosEnte(id, e.impuestos);
    } catch (err) {
      throw new Error(`El ente quedó creado, pero sin sus impuestos: ${err instanceof Error ? err.message : 'error'}. Asígnalos desde «Editar».`);
    }
  }
  return id;
}

/** Cambia los datos de un ente. */
export async function editarEnte(id: string, cambios: Partial<Pick<EnteNuevo, 'nombre' | 'tipo' | 'estado' | 'municipio' | 'rif' | 'motivo'>>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) patch.nombre = cambios.nombre.trim();
  if (cambios.tipo !== undefined) patch.tipo = cambios.tipo;
  if (cambios.estado !== undefined) patch.estado = cambios.estado?.trim() || null;
  if (cambios.municipio !== undefined) patch.municipio = cambios.municipio?.trim() || null;
  if (cambios.rif !== undefined) {
    const rif = leerRifEnte(cambios.rif);
    if ('error' in rif) throw new Error(rif.error);
    patch.rif = rif.valor;
  }
  if (cambios.tipo !== undefined && !TIPOS_ENTE_VALIDOS.includes(cambios.tipo)) throw new Error('El tipo del ente es nacional, estadal o municipal.');
  if (cambios.motivo !== undefined) patch.motivo = cambios.motivo?.trim() || null;
  if (cambios.nombre !== undefined && cambios.tipo !== undefined) {
    const falta = faltaEnEnte({ nombre: cambios.nombre, tipo: cambios.tipo, estado: cambios.estado, municipio: cambios.municipio });
    if (falta) throw new Error(falta);
  }
  // Intenta por PK `ente` o por `id`
  const { data: dMgg, error: errMgg } = await supabase.from(T_ENTES).update(patch).eq('ente', id).select('ente');
  if (!errMgg && dMgg?.length) return;

  const { data, error } = await supabase.from(T_ENTES).update(patch).eq('id', id).select('id');
  if (error) throw errorRetencion(errMgg || error, 'No se pudo guardar el ente.', TEXTOS_ENTE);
  if (!data?.length) throw new Error('No se guardó el ente: sin permiso de escritura en Retenciones, o el ente ya no existe.');
}

/** Activa o desactiva un ente (nunca se borra: hay comprobantes emitidos con él). */
export async function activarEnte(id: string, activo: boolean, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new Error(activo ? 'Indica por qué se reactiva el ente.' : 'Indica por qué se desactiva el ente.');
  const { data: dMgg, error: errMgg } = await supabase.from(T_ENTES)
    .update({ activo }).eq('ente', id).select('ente');
  if (!errMgg && dMgg?.length) return;

  const { data, error } = await supabase.from(T_ENTES)
    .update({ activo, hasta: activo ? null : hoyIso(), motivo: m }).eq('id', id).select('id');
  if (error) throw errorRetencion(errMgg || error, 'No se pudo cambiar el estado del ente.');
  if (!data?.length) throw new Error('No se cambió el ente: sin permiso de escritura en Retenciones, o el ente ya no existe.');
}

/**
 * Deja activos exactamente los impuestos indicados: activa (o crea) los
 * elegidos y desactiva los demás. Nada se borra.
 */
export async function fijarImpuestosEnte(enteId: string, claves: ClaveImpuesto[], motivo = 'Impuestos del ente'): Promise<void> {
  const elegidos = [...new Set(claves)];
  if (await r2Disponible()) {
    await fijarImpuestosEnteR2(enteId, elegidos, motivo);
    return;
  }
  if (elegidos.length) {
    const { data, error } = await supabase.from(T_ENTE_IMPUESTOS)
      .upsert(elegidos.map((c) => ({ ente_id: enteId, impuesto_clave: c, activo: true })), { onConflict: 'ente_id,impuesto_clave' })
      .select('id');
    if (error) throw errorRetencion(error, 'No se pudieron guardar los impuestos del ente.');
    if ((data?.length ?? 0) < elegidos.length) throw new Error('No se guardaron los impuestos del ente: sin permiso de escritura en Retenciones.');
  }
  let q = supabase.from(T_ENTE_IMPUESTOS).update({ activo: false }).eq('ente_id', enteId).eq('activo', true);
  if (elegidos.length) q = q.not('impuesto_clave', 'in', `(${elegidos.join(',')})`);
  const { error } = await q.select('id');
  if (error) throw errorRetencion(error, 'No se pudieron quitar los impuestos que ya no cobra el ente.');
}

/**
 * Con R2: el ente de cada impuesto es retencion_impuestos.ente (o ente_id).
 */
async function fijarImpuestosEnteR2(enteId: string, elegidos: string[], motivo: string): Promise<void> {
  const m = motivo.trim() || 'Impuestos del ente';
  const elegidosMin = elegidos.map((c) => c.toLowerCase());
  // MGG usa columna `ente`
  try {
    if (elegidosMin.length) {
      await supabase.from(T_IMPUESTOS).update({ ente: enteId }).in('clave', elegidosMin);
    }
    let q = supabase.from(T_IMPUESTOS).update({ ente: null }).eq('ente', enteId);
    if (elegidosMin.length) q = q.not('clave', 'in', `(${elegidosMin.join(',')})`);
    await q;
    return;
  } catch { /* fallback a GT */ }

  if (elegidos.length) {
    const { data, error } = await supabase.from(T_IMPUESTOS)
      .update({ ente_id: enteId, motivo_cambio: m }).in('clave', elegidos).select('clave');
    if (error) throw errorRetencion(error, 'No se pudieron asignar los impuestos al ente.');
    if ((data?.length ?? 0) < elegidos.length) throw new Error('No se asignaron los impuestos al ente: sin permiso de escritura en Retenciones.');
  }
  let q = supabase.from(T_IMPUESTOS).update({ ente_id: null, motivo_cambio: m }).eq('ente_id', enteId);
  if (elegidos.length) q = q.not('clave', 'in', `(${elegidos.join(',')})`);
  const { error } = await q.select('clave');
  if (error) throw errorRetencion(error, 'No se pudieron quitar los impuestos que ya no cobra el ente.');
}

/* ───────── Imágenes (logo del ente, logo/firma/sello del agente) ───────── */

/** Sube sin reemplazar y guarda la versión; si la versión no queda, borra el archivo subido. */
async function subirVersion(ruta: string, archivo: File, insertar: () => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>, textos: { unico: string }): Promise<string> {
  const falta = faltaEnImagen(archivo);
  if (falta) throw new Error(falta);
  const { error: errSubida } = await supabase.storage.from(BUCKET_LOGOS)
    .upload(ruta, archivo, { upsert: false, contentType: archivo.type });
  if (errSubida) {
    const ya = /exist|duplicate/i.test(errSubida.message ?? '');
    throw new Error(ya ? textos.unico : `No se pudo subir la imagen: ${errSubida.message}`);
  }
  const { data, error } = await insertar();
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (error || !id) {
    await supabase.storage.from(BUCKET_LOGOS).remove([ruta]).catch(() => { /* queda huérfano; la política deja borrarlo después */ });
    if (error) throw errorRetencion(error, 'No se pudo guardar la imagen.', textos);
    throw new Error('No se guardó la imagen: sin permiso de escritura en Retenciones.');
  }
  return id;
}

/** Logo nuevo de un ente, vigente desde una fecha. */
export async function subirLogoEnte(enteId: string, archivo: File, desde: string, motivo?: string | null): Promise<string> {
  if (!FECHA.test(desde)) throw new Error('Indica desde qué fecha vale el logo.');
  const faltaDesde = faltaEnFechaRango(desde, 'la fecha «vale desde» del logo');
  if (faltaDesde) throw new Error(faltaDesde);
  const ruta = rutaLogoEnte(enteId, desde, archivo.name);
  return subirVersion(ruta, archivo, () => supabase.from(T_ENTE_LOGOS).insert({
    ente_id: enteId, ruta, nombre_archivo: archivo.name, desde, motivo: motivo?.trim() || null,
  }).select('id'), { unico: 'Ese ente ya tiene un logo que empieza en esa fecha: elige otra fecha.' });
}

/** Desactiva una versión de logo (por ejemplo, cargada por error). El archivo se conserva. */
export async function desactivarLogoEnte(logoId: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica por qué se desactiva el logo.');
  const { data, error } = await supabase.from(T_ENTE_LOGOS).update({ activo: false, motivo: motivo.trim() }).eq('id', logoId).select('id');
  if (error) throw errorRetencion(error, 'No se pudo desactivar el logo.');
  if (!data?.length) throw new Error('No se cambió el logo: sin permiso de escritura en Retenciones.');
}

export function aImagenAgente(r: Record<string, unknown>): ImagenAgente {
  return { ...aVersion(r), clase: r.clase as ClaseImagenAgente, firmante: texto(r.firmante) };
}

/** Logo, firma y sello de la empresa, con sus versiones (la más nueva primero). */
export async function listImagenesAgente(): Promise<ImagenAgente[]> {
  if (!(await tablaDisponible(T_AGENTE_IMAGENES))) return [];
  const { data, error } = await supabase.from(T_AGENTE_IMAGENES).select('*').order('clase').order('desde', { ascending: false });
  if (error) throw errorRetencion(error, 'No se pudieron leer el logo, la firma y el sello de la empresa.');
  return (data ?? []).map((r) => aImagenAgente(r as Record<string, unknown>));
}

/** Nueva versión del logo, la firma o el sello de la empresa. La firma lleva el nombre y cargo de quien firma. */
export async function subirImagenAgente(clase: ClaseImagenAgente, archivo: File, desde: string, opciones: { firmante?: string | null; motivo?: string | null } = {}): Promise<string> {
  if (!FECHA.test(desde)) throw new Error('Indica desde qué fecha vale la imagen.');
  const faltaDesde = faltaEnFechaRango(desde, `la fecha «vale desde» ${clase === 'logo' ? 'del logo' : clase === 'firma' ? 'de la firma' : 'del sello'}`);
  if (faltaDesde) throw new Error(faltaDesde);
  if (clase === 'firma' && !opciones.firmante?.trim()) throw new Error('Indica el nombre y el cargo de quien firma.');
  const ruta = rutaImagenAgente(clase, desde, archivo.name);
  return subirVersion(ruta, archivo, () => supabase.from(T_AGENTE_IMAGENES).insert({
    clase, ruta, nombre_archivo: archivo.name, desde,
    firmante: clase === 'firma' ? opciones.firmante?.trim() : null, motivo: opciones.motivo?.trim() || null,
  }).select('id'), { unico: `Ya hay una versión de ${clase === 'logo' ? 'logo' : clase === 'firma' ? 'firma' : 'sello'} que empieza en esa fecha: elige otra fecha.` });
}

/** La ruta del logo, la firma o el sello de la empresa que vale en una fecha. */
export async function imagenAgenteVigente(clase: ClaseImagenAgente, fecha: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('retencion_agente_imagen_vigente', { p_clase: clase, p_fecha: fecha });
    if (!error) return texto(data);
  } catch { /* RPC fallback */ }
  return null;
}
