/* ============================================================
   MGG · Retenciones · Resumen para WhatsApp de Facturas (29-10-2026)

   Arma un texto claro y estructurado con los datos esenciales de la factura
   (empresa asignada, proveedor, RIF, número, fecha, monto, adjuntos y estatus),
   listo para compartir por WhatsApp sin recortar emojis ni caracteres especiales.
   ============================================================ */

import { DefinicionEmpresa, definicionEmpresa } from '@/modules/rrhh/empresa';
import type { FacturaExterna, EstadoFacturaExterna } from './facturasExternas.repository';

export const EMOJI_ESTADO_FACTURA: Record<EstadoFacturaExterna, string> = {
  recibida: '🟡',
  en_revision: '🔵',
  procesada: '🟢',
  retenida: '🟣',
  rechazada: '🔴',
  anulada: '⚪',
};

export const ETIQUETA_ESTADO_FACTURA: Record<EstadoFacturaExterna, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  procesada: 'Procesada',
  retenida: 'Retenida / Aplicada',
  rechazada: 'Rechazada',
  anulada: 'Anulada',
};

function formatearMonto(monto: number, moneda: string): string {
  const formateado = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto);
  return moneda === 'USD' ? `$ ${formateado}` : `Bs. ${formateado}`;
}

export function mensajeFacturaWhatsapp(
  factura: FacturaExterna,
  empresaDef?: DefinicionEmpresa | null
): string {
  const emp = empresaDef || definicionEmpresa(factura.empresa);
  const nombreEmpresa = emp.razonSocial || emp.label || factura.empresa;
  const emojiEstado = EMOJI_ESTADO_FACTURA[factura.estado] || '📄';
  const etiquetaEstado = ETIQUETA_ESTADO_FACTURA[factura.estado] || factura.estado;

  const lineas: string[] = [
    `🧾 *FACTURA · ${nombreEmpresa.toUpperCase()}*`,
    '',
    `🏢 Empresa: *${nombreEmpresa}*`,
    `🏪 Proveedor: *${factura.proveedorNombre}*`,
    `🆔 RIF: ${factura.proveedorRif}`,
    `📄 N° Factura: *${factura.numeroFactura}*`,
  ];

  if (factura.numeroControl) {
    lineas.push(`🔢 N° Control: ${factura.numeroControl}`);
  }

  lineas.push(`📅 Fecha: ${factura.fechaFactura}`);
  lineas.push(`💰 Monto Total: *${formatearMonto(factura.montoTotal, factura.moneda)}*`);

  if (factura.baseImponible && factura.baseImponible !== factura.montoTotal) {
    lineas.push(`📊 Base Imponible: ${formatearMonto(factura.baseImponible, factura.moneda)}`);
  }

  if (factura.moneda === 'Bs' && factura.tasaCambio) {
    lineas.push(`💱 Tasa Ref: Bs. ${factura.tasaCambio}`);
  }

  lineas.push(`📌 Estatus: ${emojiEstado} *${etiquetaEstado}*`);

  // Conteo de adjuntos
  const fotos = factura.archivos.filter((a) => a.tipo === 'imagen').length;
  const pdfs = factura.archivos.filter((a) => a.tipo === 'pdf').length;
  if (fotos > 0 || pdfs > 0) {
    const partes: string[] = [];
    if (fotos > 0) partes.push(`${fotos} foto(s)`);
    if (pdfs > 0) partes.push(`${pdfs} PDF(s)`);
    lineas.push(`📎 Adjuntos: ${partes.join(', ')}`);
  }

  if (factura.observacion?.trim()) {
    lineas.push(`📝 Observación: ${factura.observacion.trim()}`);
  }

  if (factura.actorName || factura.actor) {
    lineas.push(`👤 Enviado por: ${factura.actorName || factura.actor}`);
  }

  lineas.push('');
  lineas.push('_Control de Facturas y Retenciones_');

  return lineas.join('\n');
}

/**
 * Enlace directo que abre WhatsApp con el mensaje cargado listo para enviar.
 * Se usa `api.whatsapp.com/send` para evitar que `wa.me` trunque caracteres UTF-8 o emojis.
 */
export function enlaceWhatsappFactura(texto: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}

/**
 * Comparte el texto por la hoja nativa de compartir del teléfono si está disponible,
 * o abre WhatsApp Web/app si se ejecuta en PC o navegador sin soporte de Share API.
 */
export async function compartirFacturaWhatsapp(texto: string, titulo = 'Factura'): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: titulo, text: texto });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return true;
    }
  }

  if (typeof window !== 'undefined') {
    window.open(enlaceWhatsappFactura(texto), '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

