/* ============================================================
   MGG · Cocina · Envío por correo del Cierre de Mercado
   Genera el PDF del cierre en el navegador y lo manda por la Edge Function
   genérica `enviar-reporte` (Brevo). Reusa el snapshot ya calculado.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CierreSnapshot, MercadoCocina } from './mercados.repository';
import { cierrePdfBase64, nombreArchivoCierre } from './mercadoCierrePdf';

const FUNCTION_SLUG = 'enviar-reporte';

/** Envía el PDF del cierre a uno o varios correos. Devuelve los destinatarios. */
export async function enviarCierrePorCorreo(
  cocinaNombre: string, mercado: MercadoCocina, snap: CierreSnapshot, emails: string[],
): Promise<{ destinatarios: string[] }> {
  const unicos = Array.from(new Set(
    emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
  ));
  if (!unicos.length) throw new Error('Indicá al menos un correo válido.');

  const base64 = await cierrePdfBase64(cocinaNombre, mercado, snap);
  const asunto = `Cierre de Mercado · ${cocinaNombre} · Mercado #${mercado.numero}`;
  const mensaje = `Adjuntamos el cierre del mercado #${mercado.numero} de la cocina ${cocinaNombre} (${mercado.fecha_inicio} → ${mercado.fecha_fin}): consumos por ítem y lo que queda para el próximo mercado.`;

  const { data, error } = await supabase.functions.invoke<{
    ok: true; destinatarios: string[]; id?: string | null;
  } | { error: string }>(FUNCTION_SLUG, {
    body: { pdf_base64: base64, nombre_archivo: nombreArchivoCierre(cocinaNombre, mercado), asunto, mensaje, to_emails: unicos },
  });

  if (error) {
    let motivo = error.message ?? 'No se pudo enviar el correo';
    try {
      const ctx = (error as { context?: { json: () => Promise<unknown> } }).context;
      if (ctx?.json) { const body = (await ctx.json()) as { error?: string }; if (body?.error) motivo = body.error; }
    } catch { /* sin body legible */ }
    throw new Error(motivo);
  }
  if (!data || 'error' in data) throw new Error((data && 'error' in data && data.error) || 'Respuesta inválida del servidor');
  return { destinatarios: data.destinatarios?.length ? data.destinatarios : unicos };
}
