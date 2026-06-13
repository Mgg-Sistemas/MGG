import { supabase } from '@/shared/lib/supabase';
import { obtenerReporteBase64, type ReporteMeta } from './reportePdf';
import { obtenerMovimientoDetalleBase64 } from './movimientoDetallePdf';
import { obtenerCuentaPorPagarBase64 } from './cuentaPorPagarPdf';
import type { CuentaPorPagar, AbonoCxP, IngresoCxP } from './cuentasPorPagar.repository';
import type { MovimientoCaja, Orden } from '@/shared/lib/types';

const FUNCTION_SLUG = 'enviar-reporte';

/**
 * Genera el reporte PDF en el navegador (una sola vez) y lo envía por correo vía
 * la Edge Function `enviar-reporte` (Brevo). `destinos` puede ser una lista de
 * correos (como en el envío de las OC) o un único string; si no se pasa, va a
 * admin/jefe.
 */
export async function enviarReportePorCorreo(
  movs: MovimientoCaja[],
  meta: ReporteMeta,
  destinos?: string[] | string,
): Promise<{ destinatarios: string[] }> {
  const { base64, nombre } = await obtenerReporteBase64(movs, meta);
  const lista = Array.isArray(destinos) ? destinos : destinos ? [destinos] : [];
  const { data, error } = await supabase.functions.invoke<
    { ok: true; destinatarios: string[] } | { error: string }
  >(FUNCTION_SLUG, {
    body: {
      pdf_base64: base64,
      nombre_archivo: nombre,
      asunto: meta.titulo + (meta.subtitulo ? ` · ${meta.subtitulo}` : ''),
      mensaje: meta.subtitulo ?? '',
      to_emails: lista,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}

/**
 * Envía por correo el PDF de una cuenta por pagar (crédito) con su historial de
 * abonos, vía la misma Edge Function `enviar-reporte` (mismo formato/remitente).
 */
export async function enviarCuentaPorPagarPorCorreo(
  cuenta: CuentaPorPagar,
  abonos: AbonoCxP[],
  destinos?: string[] | string,
  ingresos: IngresoCxP[] = [],
): Promise<{ destinatarios: string[] }> {
  const { base64, nombre } = await obtenerCuentaPorPagarBase64(cuenta, abonos, ingresos);
  const lista = Array.isArray(destinos) ? destinos : destinos ? [destinos] : [];
  const tipoLabel = cuenta.tipo === 'proveedor' ? 'Proveedor' : 'Cliente';
  const { data, error } = await supabase.functions.invoke<
    { ok: true; destinatarios: string[] } | { error: string }
  >(FUNCTION_SLUG, {
    body: {
      pdf_base64: base64,
      nombre_archivo: nombre,
      asunto: `Cuenta por pagar · ${tipoLabel}: ${cuenta.contraparte}`,
      mensaje: `Reporte de la cuenta por pagar de ${cuenta.contraparte} con su historial de abonos.`,
      to_emails: lista,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}

/**
 * Envía por correo el PDF del detalle de UN movimiento (con orden pagada,
 * seriales y comprobante si aplica) vía la misma Edge Function `enviar-reporte`.
 */
export async function enviarMovimientoDetallePorCorreo(
  mov: MovimientoCaja,
  orden: Orden | null,
  destinos?: string[] | string,
): Promise<{ destinatarios: string[] }> {
  const { base64, nombre } = await obtenerMovimientoDetalleBase64(mov, orden);
  const lista = Array.isArray(destinos) ? destinos : destinos ? [destinos] : [];
  const ref = orden?.oc_codigo || orden?.codigo || mov.id.slice(0, 8);
  const { data, error } = await supabase.functions.invoke<
    { ok: true; destinatarios: string[] } | { error: string }
  >(FUNCTION_SLUG, {
    body: {
      pdf_base64: base64,
      nombre_archivo: nombre,
      asunto: `Detalle de movimiento · ${ref}`,
      mensaje: `Detalle del movimiento de ${mov.caja?.nombre ?? 'caja'}.`,
      to_emails: lista,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}
