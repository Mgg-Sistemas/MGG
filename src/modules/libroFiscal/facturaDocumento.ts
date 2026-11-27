/* ============================================================
   Golden Touch · Retenciones · Datos fiscales de una factura (P03)

   Lo que la pantalla revisa antes de registrar una factura (la base revisa
   lo mismo con retencion_documentos_forma): número y control de 1 a 30
   caracteres, sin saltos de línea; fecha válida, desde el 2000 y no futura.
   Y si vale la pena ofrecer «Borrar»: solo una factura sin retenciones
   (ni anuladas); decisiones y notas las revisa la base (RET_DOCUMENTO_NO_LIBRE).
   ============================================================ */
import { limiteEntregaComprobante } from './retencionesCalculo';

/** Lo que falta en los datos fiscales de una factura; null si están bien. `hoy` en AAAA-MM-DD. */
export function faltaEnDatosFactura(d: { nro?: string | null; control?: string | null; fecha?: string | null }, hoy: string): string | null {
  const nro = (d.nro ?? '').trim();
  const control = (d.control ?? '').trim();
  if (!nro) return 'Indica el número de la factura.';
  if (nro.length > 30) return 'El número de la factura tiene más de 30 caracteres.';
  if (/[\r\n]/.test(d.nro ?? '')) return 'El número de la factura no lleva saltos de línea.';
  if (!control) return 'Indica el número de control de la factura.';
  if (control.length > 30) return 'El número de control tiene más de 30 caracteres.';
  if (/[\r\n]/.test(d.control ?? '')) return 'El número de control no lleva saltos de línea.';
  const fecha = (d.fecha ?? '').slice(0, 10);
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) === fecha;
  if (!valida) return 'Indica la fecha de la factura.';
  if (fecha < '2000-01-01') return 'La fecha de la factura es anterior al 2000.';
  if (fecha > hoy) return 'La fecha de la factura no puede ser futura.';
  return null;
}

/** ¿Se ofrece «Borrar» en una factura? Solo si no tiene ninguna línea de retención, ni anulada. */
export const puedeOfrecerBorrar = (f: { lineas: unknown[] }) => f.lineas.length === 0;

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (f: string) => FECHA_ISO.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;

/**
 * La fecha de la retención (emisión del comprobante): válida, no anterior a la de
 * la factura y no futura. Compartida por los dos caminos de registro. `hoy` en AAAA-MM-DD.
 */
export function faltaEnFechaRetencion(fechaRetencion: string | null | undefined, fechaFactura: string | null | undefined, hoy: string): string | null {
  const fr = (fechaRetencion ?? '').slice(0, 10);
  if (!fechaValida(fr)) return 'Indica la fecha de la retención (emisión del comprobante).';
  const ff = (fechaFactura ?? '').slice(0, 10);
  if (ff && fr < ff) return 'La fecha de la retención no puede ser anterior a la de la factura.';
  if (fr > hoy) return 'La fecha de la retención no puede ser futura.';
  return null;
}

/**
 * La fecha de entrega (SNAT/2025/000054 Art. 16 y G.O. 43.484 Art. 18.3) es
 * OPCIONAL: puede quedar vacía. Si se informa, debe ser válida, no anterior a
 * la emisión ni futura. Compartida por los dos caminos de registro.
 */
export function faltaEnFechaEntrega(fechaEntrega: string | null | undefined, fechaEmision: string | null | undefined, hoy: string): string | null {
  const fe = (fechaEntrega ?? '').slice(0, 10);
  // Fecha Recibido / Entrega es opcional: vacía queda sin informar en el comprobante.
  if (!fe) return null;
  if (!fechaValida(fe)) return 'La fecha de entrega no es válida.';
  const fem = (fechaEmision ?? '').slice(0, 10);
  if (fem && fe < fem) return 'La fecha de entrega no puede ser anterior a la de emisión.';
  if (fe > hoy) return 'La fecha de entrega no puede ser futura.';
  return null;
}

/**
 * IVA · SNAT/2025/000054 Art. 16: avisa, sin impedir el registro, si la emisión
 * o la entrega queda después de los primeros 2 días hábiles del período siguiente.
 */
export function avisoEntregaIvaTardia(fechaFactura: string | null | undefined, fechaEmision: string | null | undefined, fechaEntrega: string | null | undefined): string | null {
  const limite = limiteEntregaComprobante((fechaFactura ?? '').slice(0, 10));
  if (!limite) return null;
  const emision = (fechaEmision ?? '').slice(0, 10);
  const entrega = (fechaEntrega ?? '').slice(0, 10);
  if ((!emision || emision <= limite) && (!entrega || entrega <= limite)) return null;
  return `Fuera de plazo del Art. 16: emitir y entregar dentro de los primeros 2 días hábiles del período siguiente (hasta ${limite}, sin contar feriados).`;
}

/** La base imponible no puede ser negativa (ni NaN). null si está bien. */
export function faltaEnBaseImponible(base: number | null | undefined): string | null {
  if (base == null) return null;
  if (!Number.isFinite(base) || base < 0) return 'La base imponible no puede ser negativa.';
  return null;
}

/**
 * Valida el campo que el usuario ve como «Base imponible» (C-d). Internamente sigue
 * siendo el total de la factura (`facturaTotal`): solo cambió el rótulo, no la semántica.
 * No puede ser negativo (ni NaN). null si está bien.
 */
export function faltaEnTotalFactura(total: number | null | undefined): string | null {
  if (total == null) return null;
  if (!Number.isFinite(total) || total < 0) return 'La base imponible no puede ser negativa.';
  return null;
}

/**
 * Aviso NO bloqueante (cordura) para una retención RECIBIDA que se copia del
 * comprobante del cliente: el retenido no debería superar la base ni el IVA.
 * Devuelve el texto del aviso, o null si todo luce bien. No frena el registro.
 */
export function avisoRetenidoSuperaBase(retenido: number, base: number, iva: number): string | null {
  if (!(Number(retenido) > 0)) return null;
  const superaBase = base > 0 && retenido > base + 0.005;
  const superaIva = iva > 0 && retenido > iva + 0.005;
  if (superaBase || superaIva) return 'El retenido supera la base o el IVA: verifica el comprobante.';
  return null;
}

/** Los únicos documentos sobre los que se retiene (norma): factura, nota de crédito o nota de débito. */
export const TIPOS_DOCUMENTO_RETENCION = ['factura', 'nota_debito', 'nota_credito'] as const;
export type TipoDocumentoRetencion = typeof TIPOS_DOCUMENTO_RETENCION[number];

/**
 * ¿El tipo de documento permite retener? Solo factura, nota de crédito o nota de
 * débito; nunca comprobantes de pago, notas de entrega u otros. Vacío cuenta como
 * «factura» (el valor por defecto). Devuelve el motivo si NO se puede, o null.
 */
export function faltaEnTipoDocumentoRetencion(tipo: string | null | undefined): string | null {
  const t = (tipo ?? 'factura').trim() || 'factura';
  if (!(TIPOS_DOCUMENTO_RETENCION as readonly string[]).includes(t)) {
    return 'Solo se puede retener sobre una factura, nota de crédito o nota de débito; no sobre comprobantes de pago, notas de entrega u otros documentos.';
  }
  return null;
}
