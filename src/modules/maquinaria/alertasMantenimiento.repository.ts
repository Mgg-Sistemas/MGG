/* ============================================================
   Golden Touch · Control de Maquinaria · Respuestas a las alertas de mantenimiento
   (26/10/2026)

   Cuando un equipo tiene el servicio próximo o vencido (horas o km), el encargado
   responde si HARÁ o NO HARÁ el mantenimiento con un mensaje. Cada respuesta queda
   en `maquinaria_alertas_respuestas` como historial (nunca se edita desde la app):
   se ve en la bitácora del equipo y guarda el texto exacto que se armó para
   WhatsApp, para reenviarlo tal cual.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface RespuestaAlerta {
  id: string;
  equipo_id: string;
  nivel: 'proximo' | 'vencido';
  unidad: 'h' | 'km';
  /** Lectura vigente (horómetro o km) al momento de responder. */
  lectura: number | null;
  /** Frecuencia del servicio (cada N h / km) al momento de responder. */
  frecuencia: number | null;
  /** Lo que restaba para el servicio (negativo = ya pasado). */
  restante: number | null;
  decision: 'hara' | 'no_hara';
  mensaje: string;
  texto_whatsapp: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface RespuestaAlertaInput {
  equipoId: string;
  nivel: 'proximo' | 'vencido';
  unidad: 'h' | 'km';
  lectura: number | null;
  frecuencia: number | null;
  restante: number | null;
  decision: 'hara' | 'no_hara';
  mensaje: string;
  textoWhatsapp: string;
}

/** Tablas que mueven estas respuestas (para `useRealtime`). */
export const TABLAS_ALERTAS_MANT = ['maquinaria_alertas_respuestas'] as const;

const TABLE = 'maquinaria_alertas_respuestas';

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normaliza la fila de la base (los numeric pueden llegar como texto). */
function fila(r: Record<string, unknown>): RespuestaAlerta {
  return {
    ...(r as unknown as RespuestaAlerta),
    lectura: num(r.lectura),
    frecuencia: num(r.frecuencia),
    restante: num(r.restante),
  };
}

/** Guarda la respuesta del encargado a la alerta (quién, cuándo y el texto WhatsApp que se armó). */
export async function registrarRespuestaAlerta(input: RespuestaAlertaInput, actor: string, actorName: string | null): Promise<RespuestaAlerta> {
  const { data, error } = await supabase.from(TABLE)
    .insert({
      equipo_id: input.equipoId,
      nivel: input.nivel,
      unidad: input.unidad,
      lectura: input.lectura,
      frecuencia: input.frecuencia,
      restante: input.restante,
      decision: input.decision,
      mensaje: input.mensaje.trim(),
      texto_whatsapp: input.textoWhatsapp || null,
      actor,
      actor_name: actorName ?? null,
    })
    .select('*').single();
  if (error) throw error;
  return fila(data as Record<string, unknown>);
}

/** Historial de respuestas de un equipo, la más reciente primero (bitácora). */
export async function listRespuestasAlerta(equipoId: string): Promise<RespuestaAlerta[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('equipo_id', equipoId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(fila);
}

/** La última respuesta registrada de cada equipo (para el banner de alertas). Una sola consulta. */
export async function ultimasRespuestasPorEquipo(): Promise<Map<string, RespuestaAlerta>> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out = new Map<string, RespuestaAlerta>();
  // Viene de más nueva a más vieja: la primera de cada equipo es la vigente.
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const f = fila(r);
    if (!out.has(f.equipo_id)) out.set(f.equipo_id, f);
  }
  return out;
}
