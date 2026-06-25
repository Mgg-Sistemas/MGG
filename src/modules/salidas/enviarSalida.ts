import { supabase } from '@/shared/lib/supabase';
import type { Movimiento } from '@/shared/lib/types';
// obtenerSalidaMaterialPdfBase64 se importa dinámicamente (al generar) para no cargar jsPDF al abrir.

const FUNCTION_SLUG = 'enviar-salida';

/**
 * Genera el comprobante de salida/traslado en el navegador y lo envía a uno o
 * varios correos vía la Edge Function `enviar-salida` (Brevo). Mismo patrón que
 * la trazabilidad de compras y el reporte de fundición. Genera el PDF una sola
 * vez y reusa el base64 para cada destinatario.
 */
export async function enviarSalidaAMultiples(
  mov: Movimiento,
  esTraslado: boolean,
  emails: string[],
): Promise<{ enviados: string[]; fallidos: Array<{ email: string; motivo: string }> }> {
  const unicos = Array.from(
    new Set(
      emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    ),
  );
  if (!unicos.length) throw new Error('Indicá al menos un correo válido');

  const { obtenerSalidaMaterialPdfBase64 } = await import('./salidaPdf');
  const { base64 } = await obtenerSalidaMaterialPdfBase64(mov, esTraslado);
  const enviados: string[] = [];
  const fallidos: Array<{ email: string; motivo: string }> = [];

  for (const email of unicos) {
    try {
      const { data, error } = await supabase.functions.invoke<
        { ok: true; destinatarios: string[]; id?: string | null } | { error: string }
      >(FUNCTION_SLUG, {
        body: { movimiento_id: mov.id, es_traslado: esTraslado, pdf_base64: base64, to_email: email },
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
