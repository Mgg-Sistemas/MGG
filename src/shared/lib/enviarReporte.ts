import { supabase } from '@/shared/lib/supabase';

/**
 * Envía un PDF (base64) a uno o varios correos vía la Edge Function genérica
 * `enviar-reporte` (Brevo). Reutilizable por cualquier reporte del sistema.
 */
export async function enviarReportePdf(
  base64: string,
  nombreArchivo: string,
  asunto: string,
  emails: string[],
  mensaje?: string,
): Promise<{ enviados: string[]; fallidos: Array<{ email: string; motivo: string }> }> {
  const unicos = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))),
  );
  if (!unicos.length) throw new Error('Indicá al menos un correo válido');

  const enviados: string[] = [];
  const fallidos: Array<{ email: string; motivo: string }> = [];
  for (const email of unicos) {
    try {
      const { data, error } = await supabase.functions.invoke<
        { ok: true; destinatarios?: string[] } | { error: string }
      >('enviar-reporte', {
        body: { pdf_base64: base64, nombre_archivo: nombreArchivo, asunto, mensaje, to_email: email },
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
      enviados.push(email);
    } catch (e) {
      fallidos.push({ email, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!enviados.length) {
    throw new Error(`No se pudo enviar ningún correo · ${fallidos.map((f) => `${f.email}: ${f.motivo}`).join(' · ')}`);
  }
  return { enviados, fallidos };
}
