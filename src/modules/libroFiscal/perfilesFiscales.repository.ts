/* ============================================================
   Golden Touch · Retenciones · Perfiles fiscales de proveedores (R1)

   El perfil fiscal de cada proveedor con vigencia: cada cambio de fondo es una
   versión nueva «desde» una fecha; la base cierra la anterior el día antes y
   rechaza un «desde» que no sea posterior (RET_PERFIL_DESDE). Las retenciones
   ya registradas conservan los datos con que se emitieron.

   La lista sale de la vista `retencion_contraparte_estado`: una sola regla de
   «completo», en la base (faltan: perfil · actividad · licencia_vencida). El
   teléfono y el número de administración se leen del proveedor; el perfil no
   los duplica. Las actividades (N) llevan la CIIU del catálogo de Compras y/o
   el código de la ordenanza de un ente municipal.
   Depende del paquete R1; no se monta en pantalla hasta que BD lo confirme.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { norm } from '@/shared/lib/texto';
import type { SujetoRetenido } from './retencionesCalculo';
import { sujetoDeGt } from './retencionesFiscal.repository';
import { sujetoDesdePersona, type TipoPersona } from './residenciaSujeto';
import { errorRetencion } from './erroresRetencion';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { faltaEnCodigo, faltaEnFechaRango, normalizarCodigo } from './parametrosNumeros';

const T_PERFILES = 'retencion_contraparte_perfiles';
const T_ACTIVIDADES = 'retencion_contraparte_actividades';
const V_ESTADO = 'retencion_contraparte_estado';

export type TipoContribuyente = 'ordinario' | 'especial' | 'formal';
export type EstadoLicencia = 'por_solicitar' | 'solicitada' | 'vigente' | 'vencida' | 'no_aplica';
export type Falta = 'perfil' | 'actividad' | 'licencia_vencida';

export const ESTADOS_LICENCIA: { key: EstadoLicencia; label: string }[] = [
  { key: 'por_solicitar', label: 'Por solicitar' },
  { key: 'solicitada', label: 'Solicitada' },
  { key: 'vigente', label: 'Vigente' },
  { key: 'vencida', label: 'Vencida' },
  { key: 'no_aplica', label: 'No aplica' },
];

export const TEXTO_FALTA: Record<Falta, string> = {
  perfil: 'Sin perfil fiscal',
  actividad: 'Sin actividad económica',
  licencia_vencida: 'Licencia vencida',
};

const texto = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v));
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

/* ───────── La lista: proveedor + estado del perfil ───────── */

export interface FilaPerfil {
  proveedorId: string;
  razonSocial: string;
  rif: string | null;
  /** Para pedir la licencia o los datos: el número de administración y, si falta, el teléfono. */
  telefonoAdministracion: string | null;
  /** La actividad que trae la ficha del proveedor (texto, no siempre del catálogo): se propone, no se siembra. */
  actividadFicha: string | null;
  perfilId: string | null;
  sujeto: SujetoRetenido | null;
  tipoContribuyente: TipoContribuyente | null;
  licenciaEstado: EstadoLicencia | null;
  licenciaVence: string | null;
  actividades: number;
  faltan: Falta[];
  completo: boolean;
}

interface ProveedorBase { id: string; razon_social: string; rif?: string | null; telefono?: string | null; numero_administracion?: string | null; actividad_economica?: string | null; estado?: string }

/** Une los proveedores activos con su fila de la vista. Un proveedor sin fila en la vista cuenta como sin perfil. */
export function unirPerfiles(proveedores: ProveedorBase[], estados: Record<string, unknown>[]): FilaPerfil[] {
  const porProveedor = new Map(estados.map((e) => [String(e.proveedor_id), e]));
  return proveedores.filter((p) => (p.estado ?? 'activo') === 'activo').map((p) => {
    const e = porProveedor.get(p.id);
    const faltan = Array.isArray(e?.faltan) ? (e?.faltan as Falta[]) : ['perfil' as Falta, 'actividad' as Falta];
    return {
      proveedorId: p.id,
      razonSocial: p.razon_social,
      rif: texto(p.rif),
      telefonoAdministracion: texto(p.numero_administracion) ?? texto(p.telefono),
      actividadFicha: texto(p.actividad_economica),
      perfilId: texto(e?.perfil_id),
      sujeto: sujetoDeGt(e?.sujeto),
      tipoContribuyente: (texto(e?.tipo_contribuyente) as TipoContribuyente | null),
      licenciaEstado: (texto(e?.licencia_estado) as EstadoLicencia | null),
      licenciaVence: texto(e?.licencia_vence),
      actividades: Number(e?.actividades ?? 0) || 0,
      faltan,
      completo: e ? e.completo === true : false,
    };
  });
}

export interface FiltroPerfiles {
  texto?: string;
  soloIncompletos?: boolean;
  tipoContribuyente?: TipoContribuyente | '';
  licencia?: EstadoLicencia | '';
}

/** Filtra y ordena: primero los incompletos (los que más les falta), luego por nombre. */
export function filtrarPerfiles(filas: FilaPerfil[], f: FiltroPerfiles = {}): FilaPerfil[] {
  const q = norm(f.texto?.trim() ?? '');
  const qRif = (f.texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return filas.filter((r) => {
    if (f.soloIncompletos && r.completo) return false;
    if (f.tipoContribuyente && r.tipoContribuyente !== f.tipoContribuyente) return false;
    if (f.licencia && r.licenciaEstado !== f.licencia) return false;
    if (q) {
      const enNombre = norm(r.razonSocial).includes(q);
      const enRif = qRif.length > 0 && String(r.rif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(qRif);
      if (!enNombre && !enRif) return false;
    }
    return true;
  }).sort((a, b) => Number(a.completo) - Number(b.completo)
    || b.faltan.length - a.faltan.length
    || a.razonSocial.localeCompare(b.razonSocial, 'es'));
}

/** ¿Se muestra el teléfono junto a la licencia? Cuando hay que pedirla. */
export const pideLicencia = (r: Pick<FilaPerfil, 'licenciaEstado' | 'perfilId'>) => !r.perfilId || r.licenciaEstado === 'por_solicitar';

/** Proveedores activos con el estado de su perfil fiscal hoy. */
export async function listPerfiles(): Promise<FilaPerfil[]> {
  const [prov, est] = await Promise.all([
    supabase.from('proveedores').select('id, razon_social, rif, telefono, numero_administracion, actividad_economica, estado').order('razon_social'),
    supabase.from(V_ESTADO).select('*'),
  ]);
  if (prov.error) throw errorRetencion(prov.error, 'No se pudieron leer los proveedores.');
  if (est.error) throw errorRetencion(est.error, 'No se pudo leer el estado de los perfiles fiscales.');
  return unirPerfiles((prov.data ?? []) as ProveedorBase[], (est.data ?? []) as Record<string, unknown>[]);
}

/* ───────── El perfil y sus versiones ───────── */

export interface PerfilFiscal {
  id: string;
  proveedorId: string;
  tipoPersona: TipoPersona;
  residente: boolean;
  sujeto: SujetoRetenido | null;
  tipoContribuyente: TipoContribuyente;
  esAgenteRetencion: boolean;
  licenciaTipo: string | null;
  licenciaNumero: string | null;
  licenciaEstado: EstadoLicencia;
  licenciaVence: string | null;
  licenciaEnteId: string | null;
  datosSolicitadosEn: string | null;
  observacion: string | null;
  motivo: string | null;
  desde: string;
  hasta: string | null;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
}

export function aPerfil(r: Record<string, unknown>): PerfilFiscal {
  return {
    id: String(r.id), proveedorId: String(r.proveedor_id),
    tipoPersona: r.tipo_persona === 'natural' ? 'natural' : 'juridica',
    residente: r.residente !== false,
    sujeto: sujetoDeGt(r.sujeto),
    tipoContribuyente: (texto(r.tipo_contribuyente) as TipoContribuyente | null) ?? 'ordinario',
    esAgenteRetencion: r.es_agente_retencion === true,
    licenciaTipo: texto(r.licencia_tipo), licenciaNumero: texto(r.licencia_numero),
    licenciaEstado: (texto(r.licencia_estado) as EstadoLicencia | null) ?? 'por_solicitar',
    licenciaVence: texto(r.licencia_vence), licenciaEnteId: texto(r.licencia_ente_id),
    datosSolicitadosEn: texto(r.datos_solicitados_en), observacion: texto(r.observacion), motivo: texto(r.motivo),
    desde: String(r.desde ?? ''), hasta: texto(r.hasta),
    actualizadoEn: texto(r.actualizado_en), actualizadoPor: texto(r.actualizado_por),
  };
}

/** La versión vigente en una fecha, de una lista de versiones. */
export function perfilVigente(versiones: PerfilFiscal[], fecha: string = hoyIso()): PerfilFiscal | null {
  return versiones.find((v) => v.desde <= fecha && (!v.hasta || v.hasta >= fecha)) ?? null;
}

/** Todas las versiones del perfil de un proveedor, la más nueva primero. */
export async function versionesPerfil(proveedorId: string): Promise<PerfilFiscal[]> {
  const { data, error } = await supabase.from(T_PERFILES).select('*').eq('proveedor_id', proveedorId).order('desde', { ascending: false });
  if (error) throw errorRetencion(error, 'No se pudo leer el perfil fiscal.');
  return (data ?? []).map((r) => aPerfil(r as Record<string, unknown>));
}

export interface PerfilNuevo {
  tipoPersona: TipoPersona;
  residente: boolean;
  tipoContribuyente: TipoContribuyente;
  esAgenteRetencion: boolean;
  licenciaTipo?: string | null;
  licenciaNumero?: string | null;
  licenciaEstado: EstadoLicencia;
  licenciaVence?: string | null;
  licenciaEnteId?: string | null;
  observacion?: string | null;
}

/** El sujeto del ISLR que sale de la persona y la residencia (la base lo calcula igual). */
export const sujetoDelPerfil = (p: Pick<PerfilNuevo, 'tipoPersona' | 'residente'>): SujetoRetenido =>
  sujetoDesdePersona(p.tipoPersona, p.residente ? 'residente' : 'no_residente');

/**
 * El tipo de licencia tiene que estar activo en el catálogo (la base lo
 * revisa sin distinguir mayúsculas ni espacios al borde: RET_LICENCIA_TIPO).
 * Vacío = sin tipo. Sin la lista a mano (null) no se revisa aquí.
 */
export function faltaEnTipoLicencia(tipo: string | null | undefined, activos: string[] | null | undefined): string | null {
  const t = String(tipo ?? '').trim();
  if (!t || !activos) return null;
  const igual = (x: string) => x.trim().toLocaleLowerCase('es') === t.toLocaleLowerCase('es');
  return activos.some(igual) ? null : `El tipo de licencia «${t}» no está en el catálogo o está inactivo: elígelo de la lista o agrégalo en Parámetros → Tipos de licencia.`;
}

/** Lo que falta para guardar una versión, o null. Las mismas reglas que la tabla. */
export function faltaEnPerfil(p: PerfilNuevo, desde: string, motivo: string, tiposLicencia?: string[] | null): string | null {
  if (!FECHA.test(desde)) return 'Indica desde qué fecha vale el perfil.';
  if (!motivo.trim()) return 'Indica el motivo del cambio: queda en el historial del perfil.';
  if (p.licenciaEstado === 'vigente' && !p.licenciaNumero?.trim()) return 'Una licencia vigente lleva su número.';
  if (p.licenciaVence && !FECHA.test(p.licenciaVence)) return 'La fecha de vencimiento de la licencia no es válida.';
  return faltaEnFechaRango(p.licenciaVence, 'la fecha de vencimiento de la licencia') ?? faltaEnTipoLicencia(p.licenciaTipo, tiposLicencia);
}

/**
 * Guarda una versión nueva del perfil, vigente desde una fecha. Nunca pisa la
 * anterior: la base la cierra el día antes. El primer perfil también es una versión.
 */
export async function guardarPerfil(proveedorId: string, p: PerfilNuevo, desde: string, motivo: string): Promise<string> {
  const falta = faltaEnPerfil(p, desde, motivo);
  if (falta) throw new Error(falta);
  const { data, error } = await supabase.from(T_PERFILES).insert({
    proveedor_id: proveedorId,
    tipo_persona: p.tipoPersona, residente: p.residente,
    tipo_contribuyente: p.tipoContribuyente, es_agente_retencion: p.esAgenteRetencion,
    licencia_tipo: p.licenciaTipo?.trim() || null, licencia_numero: p.licenciaNumero?.trim() || null,
    licencia_estado: p.licenciaEstado, licencia_vence: p.licenciaVence || null, licencia_ente_id: p.licenciaEnteId || null,
    observacion: p.observacion?.trim() || null, motivo: motivo.trim(), desde,
  }).select('id');
  if (error) {
    throw errorRetencion(error, 'No se pudo guardar el perfil fiscal.', {
      unico: 'Ya hay una versión del perfil que empieza en esa fecha: elige una fecha posterior.',
      regla: 'Revisa el perfil: una licencia vigente lleva su número.',
    });
  }
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error('No se guardó el perfil: sin permiso de escritura en Retenciones.');
  return id;
}

/**
 * Anota en la versión vigente lo que no cambia el fondo: cuándo se le pidieron
 * los datos al proveedor y la observación. No crea versión.
 */
export async function anotarPerfil(perfilId: string, cambios: { datosSolicitadosEn?: string | null; observacion?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (cambios.datosSolicitadosEn !== undefined) patch.datos_solicitados_en = cambios.datosSolicitadosEn;
  if (cambios.observacion !== undefined) patch.observacion = cambios.observacion?.trim() || null;
  const { data, error } = await supabase.from(T_PERFILES).update(patch).eq('id', perfilId).select('id');
  if (error) throw errorRetencion(error, 'No se pudo guardar la nota del perfil.');
  if (!data?.length) throw new Error('No se guardó la nota: sin permiso de escritura en Retenciones, o el perfil ya no existe.');
}

/* ───────── Actividades económicas (N por proveedor) ───────── */

export interface ActividadContraparte {
  id: string;
  proveedorId: string;
  ciiuCodigo: string | null;
  enteId: string | null;
  ordenanzaCodigo: string | null;
  descripcion: string | null;
  principal: boolean;
  desde: string;
  hasta: string | null;
  activa: boolean;
  nota: string | null;
}

export function aActividad(r: Record<string, unknown>): ActividadContraparte {
  return {
    id: String(r.id), proveedorId: String(r.proveedor_id),
    ciiuCodigo: texto(r.ciiu_codigo), enteId: texto(r.ente_id), ordenanzaCodigo: texto(r.ordenanza_codigo),
    descripcion: texto(r.descripcion), principal: r.principal === true,
    desde: String(r.desde ?? ''), hasta: texto(r.hasta), activa: r.activa !== false, nota: texto(r.nota),
  };
}

/** Las actividades del proveedor: activas primero, la principal arriba. */
export async function listActividades(proveedorId: string): Promise<ActividadContraparte[]> {
  const { data, error } = await supabase.from(T_ACTIVIDADES).select('*').eq('proveedor_id', proveedorId)
    .order('activa', { ascending: false }).order('principal', { ascending: false }).order('desde', { ascending: false });
  if (error) throw errorRetencion(error, 'No se pudieron leer las actividades del proveedor.');
  return (data ?? []).map((r) => aActividad(r as Record<string, unknown>));
}

export interface ActividadNueva {
  ciiuCodigo?: string | null;
  enteId?: string | null;
  ordenanzaCodigo?: string | null;
  descripcion?: string | null;
  principal?: boolean;
  desde?: string;
  nota?: string | null;
}

/** Lo que falta para una actividad, o null. Las mismas reglas que la tabla. */
export function faltaEnActividad(a: ActividadNueva): string | null {
  const ciiu = a.ciiuCodigo?.trim(); const ord = normalizarCodigo(a.ordenanzaCodigo);
  if (!ciiu && !ord) return 'Indica la actividad: el código CIIU o el código de la ordenanza del municipio.';
  if (ord && !a.enteId) return 'El código de la ordenanza va con su alcaldía (el ente).';
  if (!ord && a.enteId) return 'Con la alcaldía va el código de su ordenanza.';
  if (ord) { const f = faltaEnCodigo(ord, 'el código de la ordenanza'); if (f) return f; }
  if (a.desde && !FECHA.test(a.desde)) return 'La fecha «desde» no es válida.';
  return null;
}

/**
 * Agrega una actividad. Si es la principal, primero quita esa marca a la que
 * la tenía (solo puede haber una principal activa).
 */
export async function agregarActividad(proveedorId: string, a: ActividadNueva): Promise<string> {
  const falta = faltaEnActividad(a);
  if (falta) throw new Error(falta);
  if (a.principal) await quitarPrincipal(proveedorId);
  // En MAYÚSCULAS y sin espacios al borde, como el catálogo de la alcaldía: así el enlace por igualdad coincide.
  const ordenanza = normalizarCodigo(a.ordenanzaCodigo) || null;
  const { data, error } = await supabase.from(T_ACTIVIDADES).insert({
    proveedor_id: proveedorId,
    ciiu_codigo: a.ciiuCodigo?.trim() || null,
    ente_id: ordenanza ? a.enteId : null,
    ordenanza_codigo: ordenanza,
    descripcion: a.descripcion?.trim() || null,
    principal: !!a.principal,
    desde: a.desde || undefined,
    nota: a.nota?.trim() || null,
  }).select('id');
  if (error) {
    throw errorRetencion(error, 'No se pudo agregar la actividad.', {
      unico: 'Esa actividad ya está cargada y activa para este proveedor.',
      regla: 'Revisa la actividad: lleva un código CIIU o el código de la ordenanza con su alcaldía.',
    });
  }
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error('No se agregó la actividad: sin permiso de escritura en Retenciones.');
  return id;
}

async function quitarPrincipal(proveedorId: string): Promise<void> {
  const { error } = await supabase.from(T_ACTIVIDADES).update({ principal: false })
    .eq('proveedor_id', proveedorId).eq('activa', true).eq('principal', true).select('id');
  if (error) throw errorRetencion(error, 'No se pudo cambiar la actividad principal.');
}

/** Marca una actividad como la principal del proveedor. */
export async function marcarPrincipal(proveedorId: string, actividadId: string): Promise<void> {
  await quitarPrincipal(proveedorId);
  const { data, error } = await supabase.from(T_ACTIVIDADES).update({ principal: true }).eq('id', actividadId).eq('activa', true).select('id');
  if (error) throw errorRetencion(error, 'No se pudo marcar la actividad principal.');
  if (!data?.length) throw new Error('No se marcó la actividad: sin permiso de escritura en Retenciones, o la actividad ya no está activa.');
}

/** Da de baja una actividad desde una fecha (no se borra: queda en el historial). */
export async function bajaActividad(actividadId: string, hasta: string = hoyIso(), nota?: string | null): Promise<void> {
  if (!FECHA.test(hasta)) throw new Error('La fecha de baja no es válida.');
  const patch: Record<string, unknown> = { activa: false, principal: false, hasta };
  if (nota !== undefined) patch.nota = nota?.trim() || null;
  const { data, error } = await supabase.from(T_ACTIVIDADES).update(patch).eq('id', actividadId).select('id');
  if (error) throw errorRetencion(error, 'No se pudo dar de baja la actividad.', { regla: 'La fecha de baja no puede ser anterior a la de alta.' });
  if (!data?.length) throw new Error('No se dio de baja la actividad: sin permiso de escritura en Retenciones, o la actividad ya no existe.');
}
