/* ============================================================
   Golden Touch · Retenciones · Datos fiscales de una factura (P03)

   Lo que la pantalla revisa antes de registrar una factura (la base revisa
   lo mismo con retencion_documentos_forma): número y control de 1 a 30
   caracteres, sin saltos de línea; fecha válida, desde el 2000 y no futura.
   Y si vale la pena ofrecer «Borrar»: solo una factura sin retenciones
   (ni anuladas); decisiones y notas las revisa la base (RET_DOCUMENTO_NO_LIBRE).
   ============================================================ */

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
