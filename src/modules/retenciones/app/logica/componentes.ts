/* ============================================================
   MGG · Retenciones · Los montos del documento para el motor

   Lo que la puerta de datos lee del sistema anfitrión (la vista R0b,
   retenciones_anfitrion_documentos) y cómo lo convierte en los componentes
   del paso 1. Los nombres de las columnas son los de R0b v4 y se
   confirman al conectar la capa de datos.

   · subtotal (sin IVA ni IGTF, antes del descuento) = total − IVA − IGTF
     + descuento, de modo que subtotal − descuento = total − IVA − IGTF,
     como la semilla de la pantalla de hoy (con el ajuste de la OC dentro).
   · El IVA en blanco se PIDE (decisión del usuario, 16/10 12:19): en la OC
     el blanco no distingue «sin IVA» de «nadie lo cargó». Solo vale 0
     cuando la orden dice precios sin IVA y trae el 0 escrito. Unos precios
     con el IVA incluido y un IVA en 0 no cuadran: también se pide.
   · El IGTF en blanco es 0 (la OC no lo usa nunca; el servicio directo no
     lo tiene). El descuento en blanco es 0 (no hubo descuento).
   ============================================================ */

import type { Componente } from './regla';

export type TipoDocumentoAnfitrion = 'oc' | 'compra_directa' | 'servicio_directo';

/** Una fila de R0b, con lo que el motor necesita. */
export interface DocumentoAnfitrion {
  tipo: TipoDocumentoAnfitrion;
  moneda: string | null;
  total: number | null;
  iva: number | null;
  igtf: number | null;
  /** Solo la OC: true = los precios ya traen el IVA (el IVA se guarda, pero no suma al total). */
  iva_incluido: boolean | null;
  descuento: number | null;
}

export interface ComponentesDocumento {
  montos: Partial<Record<Componente, number | null>>;
  /** Lo que hay que pedir al registrar, en palabras del usuario. */
  pendientes: string[];
}

export function componentesDelDocumento(d: DocumentoAnfitrion): ComponentesDocumento {
  const pendientes: string[] = [];
  const igtf = d.igtf ?? 0;
  const descuento = d.descuento ?? 0;

  let iva: number | null = d.iva;
  if (iva == null) {
    pendientes.push('Falta el IVA de la factura: cargarlo.');
  } else if (iva === 0 && d.iva_incluido) {
    iva = null;
    pendientes.push('La orden dice que los precios traen el IVA, pero el IVA está en 0: cargar el IVA de la factura.');
  }

  const total = d.total;
  if (total == null) pendientes.push('Falta el total del documento.');

  const subtotal = iva != null && total != null ? total - iva - igtf + descuento : null;
  return { montos: { total, iva, igtf, descuento, subtotal }, pendientes };
}
