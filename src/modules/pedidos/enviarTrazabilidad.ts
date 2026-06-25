import { supabase } from '@/shared/lib/supabase';
// obtenerTrazabilidadPdfBase64 se importa dinámicamente (al enviar) para no cargar jsPDF al abrir Pedidos.

const FUNCTION_SLUG = 'enviar-trazabilidad';

interface EnviarOptions {
  /** Si se omite, la Edge Function envía a todos los usuarios admin/jefe. */
  toEmail?: string;
}

interface EnviarResult {
  destinatarios: string[];
  resendId?: string | null;
}

/**
 * Genera el PDF de trazabilidad en el navegador y lo envía a la Edge Function
 * `enviar-trazabilidad` que a su vez lo reenvía por Resend.
 */
export async function enviarTrazabilidadPorCorreo(
  ordenId: string,
  options: EnviarOptions = {},
): Promise<EnviarResult> {
  const { obtenerTrazabilidadPdfBase64 } = await import('./trazabilidadPdf');
  const { base64 } = await obtenerTrazabilidadPdfBase64(ordenId);

  const { data, error } = await supabase.functions.invoke<{
    ok: true;
    destinatarios: string[];
    id?: string | null;
  } | { error: string; detail?: unknown }>(FUNCTION_SLUG, {
    body: {
      orden_id: ordenId,
      pdf_base64: base64,
      to_email: options.toEmail,
    },
  });

  if (error) {
    throw new Error(error.message ?? 'Error al invocar la edge function');
  }
  if (!data || 'error' in data) {
    throw new Error((data && 'error' in data && data.error) || 'Respuesta inválida');
  }
  return { destinatarios: data.destinatarios, resendId: data.id ?? null };
}

/**
 * Envía la trazabilidad a varios correos. Genera el PDF una sola vez y reusa
 * el base64 para cada destinatario. Devuelve listas de enviados y fallidos.
 */
export async function enviarTrazabilidadAMultiples(
  ordenId: string,
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

  const { obtenerTrazabilidadPdfBase64 } = await import('./trazabilidadPdf');
  const { base64 } = await obtenerTrazabilidadPdfBase64(ordenId);
  const enviados: string[] = [];
  const fallidos: Array<{ email: string; motivo: string }> = [];

  for (const email of unicos) {
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: true;
        destinatarios: string[];
        id?: string | null;
      } | { error: string; detail?: unknown }>(FUNCTION_SLUG, {
        body: { orden_id: ordenId, pdf_base64: base64, to_email: email },
      });
      // `error` puede traer el cuerpo serializado de la function — intentamos
      // extraer el mensaje específico del body antes de quedarnos con el genérico.
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
