/* ============================================================
   MGG · RRHH · Minutas (Supabase)

   La minuta se guarda en UNA sola escritura: sus secciones repetitivas
   viven en columnas jsonb de la misma fila. No hay cadena de escrituras
   que pueda cortarse a la mitad y dejar la minuta incompleta.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Minuta, MinutaAcuerdo, MinutaAvance, MinutaParticipante } from '@/shared/lib/types';
import { borrarArchivosDeMinuta } from './minutaAdjuntos.repository';
import { componerBusq, hoyVE, numeroMinuta, type BorradorMinuta } from './minutaModelo';

const TABLE = 'minutas';

const textoONull = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

const recortar = (s: string | null | undefined) => (s ?? '').trim();

/** Un campo está vacío si es null, undefined o texto en blanco. El número 0 NO es vacío. */
const campoVacio = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** ¿Todos los campos editables de la fila están vacíos? Solo entonces se descarta. */
const filaVacia = (campos: unknown[]) => campos.every(campoVacio);

/**
 * Convierte lo que hay en pantalla en la fila que va a la base. Las filas que
 * el usuario dejó en blanco se descartan: nadie quiere ver renglones vacíos
 * guardados. Exportada para poder probarla sin tocar la red.
 */
export function filasAGuardar(b: BorradorMinuta): Record<string, unknown> {
  return {
    estado: b.estado,
    fecha: b.fecha,
    lugar: textoONull(b.lugar),
    hora_inicio: textoONull(b.hora_inicio),
    objetivo: textoONull(b.objetivo),
    orden_dia: b.orden_dia.map((s) => s.trim()).filter(Boolean),
    participantes: b.participantes
      .filter((p) => !filaVacia([p.nombre, p.cargo]))
      .map((p): MinutaParticipante => ({ ...p, nombre: recortar(p.nombre), cargo: recortar(p.cargo) })),
    acuerdos: b.acuerdos
      .filter((a) => !filaVacia([a.responsable, a.actividad, a.fecha_compromiso]))
      .map((a): MinutaAcuerdo => ({ ...a, responsable: recortar(a.responsable), actividad: recortar(a.actividad) })),
    otros_asuntos: textoONull(b.otros_asuntos),
    proxima_fecha: b.proxima_fecha || null,
    proximos_puntos: b.proximos_puntos.map((s) => s.trim()).filter(Boolean),
    avances: b.avances
      .filter((a) => !filaVacia([
        a.actividad, a.responsable, a.fecha_programada, a.revision_fecha,
        a.pct_inicial, a.revision_final, a.pct_avance,
      ]))
      .map((a): MinutaAvance => ({
        ...a,
        actividad: recortar(a.actividad),
        responsable: recortar(a.responsable),
        revision_final: recortar(a.revision_final),
      })),
    observaciones: textoONull(b.observaciones),
    anexar_adjuntos_pdf: b.anexar_adjuntos_pdf,
    busq: componerBusq(b),
  };
}

/** Una minuta del histórico, con la marca de si tiene archivos adjuntos. */
export interface MinutaConAdjuntos extends Minuta { tiene_adjuntos: boolean }

export async function listMinutas(): Promise<MinutaConAdjuntos[]> {
  // `minuta_adjuntos(count)` trae el conteo embebido en la misma consulta: sin N consultas
  // y sin el corte de 1000 filas que tendría pedir los adjuntos por separado.
  const { data, error } = await supabase
    .from(TABLE).select('*, minuta_adjuntos(count)')
    .order('fecha', { ascending: false }).order('numero', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<Minuta & { minuta_adjuntos?: { count: number }[] }>).map((fila) => {
    const { minuta_adjuntos, ...minuta } = fila;
    return { ...minuta, tiene_adjuntos: (minuta_adjuntos?.[0]?.count ?? 0) > 0 };
  });
}

export async function getMinuta(id: string): Promise<Minuta | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Minuta | null;
}

/** Número correlativo atómico por año. Dos personas a la vez nunca reciben el mismo. */
async function proximoNumero(anio: number): Promise<string> {
  const { data, error } = await supabase.rpc('next_correlativo', { p_clave: `minuta-${anio}` });
  if (error) throw error;
  const n = Number(data);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('El correlativo de minutas devolvió un valor inválido.');
  }
  return numeroMinuta(anio, n);
}

export async function crearMinuta(b: BorradorMinuta, actor: string): Promise<Minuta> {
  const anio = Number((b.fecha || '').slice(0, 4)) || Number(hoyVE().slice(0, 4));
  const numero = await proximoNumero(anio);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...filasAGuardar(b), numero, creada_por: actor })
    .select('*').single();
  if (error) throw error;
  return data as Minuta;
}

export async function actualizarMinuta(id: string, b: BorradorMinuta, actor: string): Promise<Minuta> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...filasAGuardar(b), modificada_por: actor, modificada_en: new Date().toISOString() })
    .eq('id', id)
    .select('*').single();
  if (error) throw error;
  return data as Minuta;
}

export async function borrarMinuta(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
  // Después de la fila, nunca antes: si el borrado fallara, no quedaría una
  // minuta viva con los adjuntos rotos. Peor un huérfano que eso.
  await borrarArchivosDeMinuta(id);
}
