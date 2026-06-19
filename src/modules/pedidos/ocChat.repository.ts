/* ============================================================
   MGG · Compras · Chat interno por Orden de Compra
   Hilo de seguimiento (gerente ↔ analista, etc.) atado a cada OC.
   Realtime + contador de no leídos por usuario (leido_por jsonb).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { OcMensaje } from '@/shared/lib/types';

function mapMensaje(r: Record<string, unknown>): OcMensaje {
  return {
    id: r.id as string,
    orden_id: r.orden_id as string,
    texto: (r.texto as string) ?? '',
    autor: (r.autor as string) ?? null,
    autor_email: (r.autor_email as string) ?? null,
    autor_nombre: (r.autor_nombre as string) ?? null,
    leido_por: Array.isArray(r.leido_por) ? (r.leido_por as string[]) : [],
    created_at: r.created_at as string,
  };
}

/** Hilo completo de una OC, en orden cronológico. */
export async function listMensajesOc(ordenId: string): Promise<OcMensaje[]> {
  const { data, error } = await supabase
    .from('oc_mensajes')
    .select('*')
    .eq('orden_id', ordenId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapMensaje);
}

interface EnviarMensajeInput {
  ordenId: string;
  texto: string;
  autorEmail?: string | null;
  autorNombre?: string | null;
}

/** Inserta un mensaje. El autor lo marca como leído por sí mismo. */
export async function enviarMensajeOc(input: EnviarMensajeInput): Promise<OcMensaje> {
  const texto = input.texto.trim();
  if (!texto) throw new Error('El mensaje no puede estar vacío.');
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;
  const { data, error } = await supabase
    .from('oc_mensajes')
    .insert({
      orden_id: input.ordenId,
      texto,
      autor: uid,
      autor_email: input.autorEmail ?? auth.user?.email ?? null,
      autor_nombre: input.autorNombre ?? null,
      leido_por: uid ? [uid] : [],
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapMensaje(data);
}

/**
 * Marca como leídos por `userId` todos los mensajes de la OC que aún no lo
 * tengan en `leido_por` (y que no haya escrito el propio usuario). Devuelve
 * cuántos se marcaron, para que la UI sepa si refrescar el badge.
 */
export async function marcarLeidosOc(ordenId: string, userId: string): Promise<number> {
  if (!userId) return 0;
  const { data, error } = await supabase
    .from('oc_mensajes')
    .select('id, leido_por')
    .eq('orden_id', ordenId);
  if (error) throw error;
  const pendientes = (data ?? []).filter(
    (m) => !(Array.isArray(m.leido_por) ? (m.leido_por as string[]) : []).includes(userId),
  );
  if (!pendientes.length) return 0;
  await Promise.all(
    pendientes.map((m) => {
      const lista = Array.isArray(m.leido_por) ? (m.leido_por as string[]) : [];
      return supabase
        .from('oc_mensajes')
        .update({ leido_por: [...lista, userId] })
        .eq('id', m.id);
    }),
  );
  return pendientes.length;
}

/**
 * Mapa orden_id → cantidad de mensajes NO leídos por `userId` (excluye los
 * que el propio usuario escribió). Alimenta el badge 💬 de cada tarjeta.
 */
export async function noLeidosPorOrden(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userId) return out;
  const { data, error } = await supabase
    .from('oc_mensajes')
    .select('orden_id, autor, leido_por');
  if (error) throw error;
  for (const m of data ?? []) {
    const leido = Array.isArray(m.leido_por) ? (m.leido_por as string[]) : [];
    if (m.autor === userId || leido.includes(userId)) continue;
    out.set(m.orden_id as string, (out.get(m.orden_id as string) ?? 0) + 1);
  }
  return out;
}
