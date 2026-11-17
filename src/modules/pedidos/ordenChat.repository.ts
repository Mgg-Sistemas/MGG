/* ============================================================
   MGG · Pedidos · Chat interno por orden (OC)
   Conversación de seguimiento entre la directiva, compras y tesorería.
   Un hilo por orden.
   Soporte de menciones (@) con despacho de alertas personalizadas.
   Soporte de referencias (#) y compatibilidad resiliente de esquema.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { push as pushNotificacion } from '@/modules/notificaciones/notif.repository';
import { extraerMenciones, resolverDestinatariosMenciones, notificarMenciones } from './chatMenciones';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import type { Usuario } from '@/shared/lib/types';

export interface MensajeOrden {
  id: string;
  orden_id: string;
  autor_email: string;
  autor_nombre: string | null;
  mensaje: string;
  created_at: string;
}

function esErrorTablaNoExiste(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '42P01' || e.code === 'PGRST204' || (e.message ? /relation.*does not exist|could not find the table/i.test(e.message) : false);
}

/** Mensajes de una orden, del más viejo al más nuevo. */
export async function listMensajes(ordenId: string): Promise<MensajeOrden[]> {
  const { data, error } = await supabase
    .from('orden_mensajes')
    .select('*')
    .eq('orden_id', ordenId)
    .order('created_at', { ascending: true });
  if (!error) return (data ?? []) as MensajeOrden[];

  if (esErrorTablaNoExiste(error)) {
    const { data: ocData, error: ocError } = await supabase
      .from('oc_mensajes')
      .select('id, orden_id, texto, autor_email, autor_nombre, created_at')
      .eq('orden_id', ordenId)
      .order('created_at', { ascending: true });
    if (ocError) throw ocError;
    return (ocData ?? []).map((r) => ({
      id: r.id as string,
      orden_id: r.orden_id as string,
      autor_email: (r.autor_email as string) || '',
      autor_nombre: (r.autor_nombre as string) || null,
      mensaje: (r.texto as string) || '',
      created_at: r.created_at as string,
    }));
  }
  throw error;
}

/** Envía un mensaje y avisa al equipo (notificación con dedup por orden) + menciones puntuales. */
export async function enviarMensaje(input: {
  ordenId: string;
  ordenLabel?: string;
  mensaje: string;
  autorEmail?: string | null;
  autorNombre?: string | null;
}): Promise<MensajeOrden> {
  const texto = input.mensaje.trim();
  if (!texto) throw new Error('Escribe un mensaje.');
  const autorEmail = input.autorEmail || 'sistema';
  const ordenLabel = input.ordenLabel || 'Orden';
  let resData: MensajeOrden | null = null;

  const { data, error } = await supabase
    .from('orden_mensajes')
    .insert({
      orden_id: input.ordenId,
      autor_email: autorEmail,
      autor_nombre: input.autorNombre ?? null,
      mensaje: texto,
    })
    .select('*')
    .single();

  if (!error) {
    resData = data as MensajeOrden;
  } else if (esErrorTablaNoExiste(error)) {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    const { data: ocData, error: ocErr } = await supabase
      .from('oc_mensajes')
      .insert({
        orden_id: input.ordenId,
        texto,
        autor: uid,
        autor_email: autorEmail,
        autor_nombre: input.autorNombre ?? null,
        leido_por: uid ? [uid] : [],
      })
      .select('*')
      .single();
    if (ocErr) throw ocErr;
    resData = {
      id: ocData.id as string,
      orden_id: ocData.orden_id as string,
      autor_email: (ocData.autor_email as string) || autorEmail,
      autor_nombre: (ocData.autor_nombre as string) || input.autorNombre || null,
      mensaje: (ocData.texto as string) || texto,
      created_at: ocData.created_at as string,
    };
  } else {
    throw error;
  }

  // Nudge general: una notificación no leída por orden (dedup) para que la otra parte la vea.
  try {
    await pushNotificacion({
      kind: 'info',
      title: `💬 Mensaje en ${ordenLabel}`,
      message: `${input.autorNombre || autorEmail}: ${texto.slice(0, 80)}`,
      link: '#/app/pedidos',
      dedup_key: `chat:${input.ordenId}`,
    });
  } catch { /* la notificación general no debe bloquear el envío */ }

  // Menciones (@): notificar a cada destinatario mencionado en el texto
  try {
    const menciones = extraerMenciones(texto);
    if (menciones.length > 0) {
      let usuariosDb: Usuario[] = [];
      try {
        usuariosDb = await listUsuarios();
      } catch {
        // En caso de restricción RLS de usuarios, el resolvedor usará PERSONAS_CONOCIDAS_COMPRAS
      }
      const destinatarios = resolverDestinatariosMenciones(menciones, usuariosDb);
      if (destinatarios.length > 0) {
        await notificarMenciones({
          ordenId: input.ordenId,
          ordenLabel,
          mensaje: texto,
          autorEmail,
          autorNombre: input.autorNombre,
          destinatarios,
        });
      }
    }
  } catch {
    // La notificación de mención no debe bloquear el envío
  }

  return resData;
}

/** Marca el hilo de una orden como leído por el usuario (now()). */
export async function marcarLeido(ordenId: string, usuarioId: string): Promise<void> {
  if (!usuarioId) return;
  const { error } = await supabase
    .from('orden_chat_lecturas')
    .upsert(
      { orden_id: ordenId, usuario_id: usuarioId, last_read_at: new Date().toISOString() },
      { onConflict: 'orden_id,usuario_id' },
    );
  if (error && esErrorTablaNoExiste(error)) {
    try {
      const { data } = await supabase.from('oc_mensajes').select('id, leido_por').eq('orden_id', ordenId);
      const pendientes = (data ?? []).filter((m) => !(Array.isArray(m.leido_por) ? (m.leido_por as string[]) : []).includes(usuarioId));
      if (pendientes.length) {
        await Promise.all(pendientes.map((m) => {
          const lista = Array.isArray(m.leido_por) ? (m.leido_por as string[]) : [];
          return supabase.from('oc_mensajes').update({ leido_por: [...lista, usuarioId] }).eq('id', m.id);
        }));
      }
    } catch { /* no crítico */ }
  }
}

/**
 * Cuenta de mensajes NO leídos por orden para un usuario.
 * Admite tanto `(ordenIds, usuarioId, email)` como firma de legado `(usuarioId)`.
 */
export async function noLeidosPorOrden(
  ordenIdsOrUserId: string[] | string,
  usuarioIdArg?: string,
  emailArg?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  let ordenIds: string[] | null = null;
  let usuarioId = '';
  let email = '';

  if (Array.isArray(ordenIdsOrUserId)) {
    ordenIds = ordenIdsOrUserId;
    usuarioId = usuarioIdArg || '';
    email = emailArg || '';
    if (!ordenIds.length || !usuarioId) return out;
  } else {
    usuarioId = ordenIdsOrUserId || '';
    if (!usuarioId) return out;
  }

  try {
    let qMsgs = supabase.from('orden_mensajes').select('orden_id, autor_email, created_at');
    let qLect = supabase.from('orden_chat_lecturas').select('orden_id, last_read_at').eq('usuario_id', usuarioId);
    if (ordenIds && ordenIds.length > 0) {
      qMsgs = qMsgs.in('orden_id', ordenIds);
      qLect = qLect.in('orden_id', ordenIds);
    }
    const [{ data: msgs, error: errMsgs }, { data: lect }] = await Promise.all([qMsgs, qLect]);
    if (!errMsgs) {
      const lastRead = new Map((lect ?? []).map((l) => [l.orden_id as string, l.last_read_at as string]));
      for (const m of (msgs ?? []) as Array<{ orden_id: string; autor_email: string; created_at: string }>) {
        if (email && m.autor_email === email) continue;
        const lr = lastRead.get(m.orden_id);
        if (lr && m.created_at <= lr) continue;
        out.set(m.orden_id, (out.get(m.orden_id) ?? 0) + 1);
      }
      return out;
    }
  } catch { /* tabla no existe aún */ }

  try {
    let qOc = supabase.from('oc_mensajes').select('orden_id, autor, autor_email, leido_por');
    if (ordenIds && ordenIds.length > 0) {
      qOc = qOc.in('orden_id', ordenIds);
    }
    const { data: ocMsgs } = await qOc;
    for (const m of (ocMsgs ?? []) as Array<{ orden_id: string; autor?: string | null; autor_email?: string | null; leido_por?: unknown }>) {
      if (m.autor === usuarioId) continue;
      if (email && m.autor_email && m.autor_email.toLowerCase() === email.toLowerCase()) continue;
      const leidos = Array.isArray(m.leido_por) ? (m.leido_por as string[]) : [];
      if (!leidos.includes(usuarioId)) {
        out.set(m.orden_id, (out.get(m.orden_id) ?? 0) + 1);
      }
    }
  } catch { /* no crítico */ }

  return out;
}

/** Aliases para compatibilidad con código existente */
export async function enviarMensajeOc(input: {
  ordenId: string;
  texto: string;
  autorEmail?: string | null;
  autorNombre?: string | null;
  ordenLabel?: string;
}): Promise<MensajeOrden> {
  return enviarMensaje({
    ordenId: input.ordenId,
    ordenLabel: input.ordenLabel ?? 'Orden',
    mensaje: input.texto,
    autorEmail: input.autorEmail,
    autorNombre: input.autorNombre,
  });
}

export const listMensajesOc = listMensajes;
export const marcarLeidosOc = marcarLeido;
