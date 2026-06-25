import { supabase } from '@/shared/lib/supabase';
import type { SolicitudCombustible } from '@/shared/lib/types';
// obtenerSolicitudCombustiblePdfBase64 se importa dinámicamente (al generar) para no cargar jsPDF al abrir.

const FUNCTION_SLUG = 'enviar-combustible';

/**
 * Genera el PDF de la solicitud y lo envía a uno o varios correos vía la Edge
 * Function `enviar-combustible` (Brevo). Mismo patrón que las otras del sistema.
 */
export async function enviarCombustibleAMultiples(
  s: SolicitudCombustible,
  emails: string[],
): Promise<{ enviados: string[]; fallidos: Array<{ email: string; motivo: string }> }> {
  const unicos = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))),
  );
  if (!unicos.length) throw new Error('Indicá al menos un correo válido');

  const { obtenerSolicitudCombustiblePdfBase64 } = await import('./combustiblePdf');
  const { base64 } = await obtenerSolicitudCombustiblePdfBase64(s);
  const enviados: string[] = [];
  const fallidos: Array<{ email: string; motivo: string }> = [];

  for (const email of unicos) {
    try {
      const { data, error } = await supabase.functions.invoke<
        { ok: true; destinatarios: string[]; id?: string | null } | { error: string }
      >(FUNCTION_SLUG, {
        body: { solicitud_id: s.id, pdf_base64: base64, to_email: email },
      });
      if (error) {
        let motivo = error.message ?? 'Edge function falló';
        try {
          const ctx = (error as { context?: { json: () => Promise<unknown> } }).context;
          if (ctx?.json) {
            const body = (await ctx.json()) as { error?: string };
            if (body?.error) motivo = body.error;
          }
        } catch { /* sin body legible */ }
        throw new Error(motivo);
      }
      if (!data) throw new Error('Respuesta vacía del servidor');
      if ('error' in data) throw new Error(data.error || 'Edge function devolvió error');
      enviados.push(...(data.destinatarios?.length ? data.destinatarios : [email]));
    } catch (e) {
      fallidos.push({ email, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!enviados.length) {
    const motivos = fallidos.map((f) => `${f.email}: ${f.motivo}`).join(' · ');
    throw new Error(`No se pudo enviar ningún correo · ${motivos}`);
  }
  return { enviados, fallidos };
}
