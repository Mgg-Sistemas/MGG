/* ============================================================
   MGG · RRHH · Minutas ya hechas (05-11-2026)

   Pedido de la administradora: cargar minutas que ya existen (en papel o en
   PDF), verlas en vista previa y encontrarlas con los mismos filtros. Una
   minuta cargada es una fila de `minutas` con origen 'cargada' y su archivo
   (PDF o foto) como adjunto: así hereda el visor, el borrado y los permisos.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { previewArchivo } from '@/shared/lib/reportePreview';
import type { Minuta, MinutaParticipante } from '@/shared/lib/types';
import { borradorDesdeMinuta } from './minutaBorrador';
import { filasAGuardar } from './minutas.repository';
import { borrarArchivosDeMinuta, errorArchivoAdjunto, listAdjuntos, subirAdjunto, urlAdjunto } from './minutaAdjuntos.repository';
import { hoyVE, numeroMinuta } from './minutaModelo';

export interface MinutaACargar {
  /** El número que trae el documento; vacío = el correlativo del sistema. */
  numero: string;
  fecha: string;
  lugar: string;
  hora_inicio: string;
  /** Tema u objetivo de la reunión. */
  objetivo: string;
  /** Nombres, uno por renglón o separados por coma. */
  participantes: string;
  observaciones: string;
  archivos: File[];
}

/** Los nombres escritos a mano, como participantes externos. */
export function participantesDeTexto(t: string): MinutaParticipante[] {
  return t.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
    .map((nombre) => ({ personal_id: null, nombre, cargo: '' }));
}

/** Qué falta para cargarla (null = bien). */
export function errorMinutaCargada(m: MinutaACargar, hoy = hoyVE()): string | null {
  if (!m.fecha) return 'Indica la fecha de la reunión.';
  if (m.fecha > hoy) return 'La fecha de una minuta ya hecha no puede ser futura.';
  if (!m.objetivo.trim()) return 'Escribe el tema u objetivo de la reunión.';
  if (!m.archivos.length) return 'Adjunta el PDF o la foto de la minuta.';
  for (const f of m.archivos) {
    const e = errorArchivoAdjunto(f);
    if (e) return `${f.name}: ${e}`;
  }
  return null;
}

export async function cargarMinutaExistente(m: MinutaACargar, actor: string): Promise<Minuta> {
  const err = errorMinutaCargada(m);
  if (err) throw new Error(err);
  const b = {
    ...borradorDesdeMinuta(null),
    fecha: m.fecha, lugar: m.lugar, hora_inicio: m.hora_inicio, objetivo: m.objetivo,
    participantes: participantesDeTexto(m.participantes), observaciones: m.observaciones,
    estado: 'finalizada' as const, anexar_adjuntos_pdf: false,
  };
  let numero = m.numero.trim().toUpperCase();
  if (!numero) {
    const anio = Number(m.fecha.slice(0, 4));
    const { data, error } = await supabase.rpc('next_correlativo', { p_clave: `minuta-${anio}` });
    if (error) throw error;
    numero = numeroMinuta(anio, Number(data));
  }
  const { data, error } = await supabase.from('minutas')
    .insert({ ...filasAGuardar(b), numero, origen: 'cargada', creada_por: actor })
    .select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error(`Ya hay una minuta con el número ${numero}.`);
    throw error;
  }
  const minuta = data as Minuta;
  try {
    for (const f of m.archivos) await subirAdjunto(minuta.id, f, actor);
  } catch (e) {
    // Sin su archivo no sirve de nada: se deshace para no dejar una minuta vacía.
    await borrarArchivosDeMinuta(minuta.id).catch(() => {});
    await supabase.from('minutas').delete().eq('id', minuta.id);
    throw e;
  }
  return minuta;
}

/** Vista previa del archivo de una minuta cargada (el primer PDF; si no hay, la primera foto). */
export async function verArchivoMinuta(m: Pick<Minuta, 'id' | 'numero'>): Promise<void> {
  const adj = await listAdjuntos(m.id);
  const a = adj.find((x) => x.tipo === 'application/pdf') ?? adj[0];
  if (!a) throw new Error('Esta minuta no tiene archivo adjunto.');
  previewArchivo(await urlAdjunto(a.path), a.nombre || `${m.numero}.pdf`);
}
