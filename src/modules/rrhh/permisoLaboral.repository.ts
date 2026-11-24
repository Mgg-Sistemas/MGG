/* ============================================================
   MGG · RRHH · Guardar la Solicitud de Permiso Laboral (20-11-2026)

   Un solo lugar para: crear el evento, generar su PDF con el estilo del
   sistema, subir los soportes (PDF/imagen, máx. 4) y dejar todo grabado.
   Si algo falla, se limpia lo subido y NO se avisa que se guardó.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { AdjuntoPermisoLaboral, RrhhEvento, SolicitudPermisoLaboral } from '@/shared/lib/types';
import { subirConReintento } from '@/shared/lib/storageReintento';
import {
  nombreSeguroAdjunto,
  validarTandaAdjuntos,
  type AdjuntoSalida,
} from '@/modules/salidas/adjuntosSalida';
import { actualizarEventoAdjuntos, crearEvento, eliminarEvento } from './eventos.repository';
import { solicitudSinPersonal, type SolicitudPermisoForm } from './permisoLaboral';
import { construirSolicitudPermisoPdf } from './solicitudPermisoPdf';

/** Bucket privado new. Los enlaces son firmados y caducan (no va público). */
export const BUCKET_PERMISOS = 'rrhh-permisos-adjuntos';

function slug(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function sufijo(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function subirUno(path: string, archivo: File, contentType: string): Promise<void> {
  await subirConReintento(async () => {
    const { error } = await supabase.storage.from(BUCKET_PERMISOS).upload(path, archivo, {
      upsert: false,
      contentType: archivo.type || contentType,
    });
    if (error) throw error;
  });
}

async function subirTanda(
  eventoId: string,
  empresa: string,
  archivos: readonly File[],
): Promise<AdjuntoPermisoLaboral[]> {
  const subidos: AdjuntoPermisoLaboral[] = [];
  for (const [i, archivo] of archivos.entries()) {
    const filename = nombreSeguroAdjunto(archivo.name);
    const path = `permisos/${empresa}/${eventoId}/adjuntos/${i + 1}-${sufijo()}-${filename}`;
    try {
      await subirUno(path, archivo, archivo.type.startsWith('image/') ? 'image/jpeg' : 'application/pdf');
    } catch (e) {
      if (subidos.length) await supabase.storage.from(BUCKET_PERMISOS).remove(subidos.map((a) => a.path)).catch(() => undefined);
      throw new Error(`No se pudo subir «${archivo.name}»: ${e instanceof Error ? e.message : String(e)}`);
    }
    subidos.push({ path, filename, size: archivo.size, type: archivo.type });
  }
  return subidos;
}

/** Crea el evento con todo: solicitud, PDF generado y até 4 soportes. */
export async function guardarSolicitudPermiso(
  form: SolicitudPermisoForm,
  archivos: readonly File[],
  actor: string,
  actorName: string | null,
): Promise<RrhhEvento> {
  const mal = validarTandaAdjuntos(archivos);
  if (mal) throw new Error(mal);

  const solicitud = solicitudSinPersonal(form);
  let eventoId: string | null = null;
  const rutas: string[] = [];
  try {
    const evento = await crearEvento({
      personal_id: form.personal_id,
      tipo: 'permiso',
      fecha_desde: form.fecha_inicio,
      fecha_hasta: form.fecha_fin,
      dias: form.tiempo_solicitado.match(/\d+/)?.[0] ? Number(form.tiempo_solicitado.match(/\d+/)?.[0]) : null,
      descripcion: form.motivo,
      solicitud,
      adjuntos: [],
    }, actor, actorName);
    eventoId = evento.id;

    const doc = await construirSolicitudPermisoPdf(form, form.empresa);
    const pdfPath = `permisos/${form.empresa}/${evento.id}/solicitud-${slug(`${form.trabajador.nombre}-${form.trabajador.apellido}`) || 'trabajador'}.pdf`;
    const pdf = new File([doc.output('arraybuffer')], 'solicitud-permiso.pdf', { type: 'application/pdf' });
    await subirUno(pdfPath, pdf, 'application/pdf');
    rutas.push(pdfPath);

    const adjuntos = await subirTanda(evento.id, form.empresa, archivos);
    rutas.push(...adjuntos.map((a) => a.path));
    await actualizarEventoAdjuntos(evento.id, { solicitud_path: pdfPath, adjuntos });
    return { ...evento, solicitud_path: pdfPath, adjuntos };
  } catch (e) {
    if (rutas.length) await supabase.storage.from(BUCKET_PERMISOS).remove(rutas).catch(() => undefined);
    if (eventoId) await eliminarEvento(eventoId).catch(() => undefined);
    throw e;
  }
}

/** Agrega soportes a una solicitud ya creada (sin borrar los que ya están) y guarda la firma si cambió. */
export async function agregarAdjuntosPermiso(
  evento: RrhhEvento,
  archivos: readonly File[],
  solicitud?: SolicitudPermisoLaboral | null,
): Promise<AdjuntoPermisoLaboral[]> {
  const existentes: AdjuntoSalida[] = (evento.adjuntos ?? []).map((a) => ({ path: a.path, filename: a.filename }));
  const mal = validarTandaAdjuntos(archivos, existentes);
  if (mal) throw new Error(mal);

  const empresa = evento.empresa ?? 'MGG';
  const nuevos = archivos.length ? await subirTanda(evento.id, empresa, archivos) : [];
  const todos = [...existentes.map((a) => evento.adjuntos?.find((x) => x.path === a.path)).filter((a): a is AdjuntoPermisoLaboral => !!a), ...nuevos];
  const cambios: { adjuntos?: AdjuntoPermisoLaboral[]; solicitud?: SolicitudPermisoLaboral | null } = {};
  if (nuevos.length) cambios.adjuntos = todos;
  if (solicitud !== undefined) cambios.solicitud = solicitud;
  try {
    await actualizarEventoAdjuntos(evento.id, cambios);
  } catch (e) {
    if (nuevos.length) await supabase.storage.from(BUCKET_PERMISOS).remove(nuevos.map((a) => a.path)).catch(() => undefined);
    throw e;
  }
  return todos;
}

/** Enlace temporal para ver el PDF o un soporte (el bucket es privado). */
export async function urlArchivoPermiso(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_PERMISOS).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
