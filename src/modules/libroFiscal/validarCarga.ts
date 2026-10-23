import type { TipoImpuesto } from './retencionesCalculo';

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Un monto escrito a mano, en formato venezolano: el punto separa miles y la
 * coma es el decimal. Vacío es 0.
 * · «1.234» = 1234 y «36.500» = 36500 (un punto seguido de 3 dígitos, sin coma, son miles);
 * · «1.234,56», «1234,56» = 1234,56;
 * · «1234.56», «879.1» = decimal (punto con 1, 2, 4 o más dígitos);
 * · «0.125» y «.125» = 0,125 (con parte entera 0 o vacía no hay miles).
 * Lo que no se entiende devuelve null: nunca se convierte en 0 sin avisar.
 */
export function leerMonto(v: string): number | null {
  const s = String(v ?? '').replace(/\s/g, '');
  if (s === '') return 0;
  let normal: string | null = null;
  if (s.includes(',')) {
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+(,\d+)?$/.test(s)) normal = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    normal = s.replace(/\./g, '');
  } else if (/^-?\d+(\.\d+)?$/.test(s)) {
    normal = s;
  } else if (/^-?\.\d+$/.test(s)) {
    normal = s.replace('.', '0.');
  }
  if (normal == null) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Un número que el sistema pone en un campo de texto, para que leerMonto lo lea igual: coma decimal, sin miles. */
export function numeroATexto(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return String(Number(n)).replace('.', ',');
}

/** Cómo se leyó un monto, para mostrarlo junto al campo: «36.500,00». null si no se entiende o está vacío. */
export function textoLeido(v: string, decimales = 2): string | null {
  if (!String(v ?? '').trim()) return null;
  const n = leerMonto(v);
  if (n == null) return null;
  const max = Math.max(decimales, (String(n).split('.')[1] ?? '').length);
  return n.toLocaleString('es-VE', { minimumFractionDigits: decimales, maximumFractionDigits: Math.min(max, 8) });
}

/**
 * Lo que falta para registrar una retención, o null si está todo. El N° de
 * factura es el fiscal (va al comprobante, al libro y a la relación), nunca el
 * código interno de la OC o la compra. El IGTF es una percepción por pago: no
 * lo pide. La fecha la piden todos: de ella salen el período y la quincena.
 */
export function faltaEnLaCarga(c: { tipo: TipoImpuesto; facturaNumero: string; facturaFecha: string }): string | null {
  if (c.tipo !== 'igtf' && !c.facturaNumero.trim()) {
    return 'N° de factura requerido (el número fiscal, no el código de la OC): figura en el comprobante y en el libro.';
  }
  if (!FECHA.test(c.facturaFecha.trim())) return 'Fecha de la factura requerida: determina el período y la quincena.';
  return null;
}

/**
 * Valida el tipo y descripción del documento de respaldo.
 * Si se indica «Otro documento», es obligatorio describirlo para auditoría.
 */
export function validarDocumentoRespaldo(tipoArchivo: string, detalle: string, tieneArchivo: boolean): string | null {
  if (tieneArchivo && !tipoArchivo.trim()) {
    return 'Indica qué documento adjuntas (factura, comprobante firmado, nota de entrega u otro).';
  }
  if (tipoArchivo === 'Otro documento' && !detalle.trim()) {
    return 'Describe qué documento de respaldo es (en una auditoría «Otro documento» no especifica el respaldo).';
  }
  return null;
}

/**
 * Etiqueta del documento para guardarlo en la retención o en el nombre del comprobante.
 */
export function etiquetaDocumentoRespaldo(tipoArchivo: string, detalle: string): string {
  if (tipoArchivo === 'Otro documento') {
    const d = detalle.trim();
    return d ? `Otro: ${d}` : 'Otro documento';
  }
  return tipoArchivo.trim();
}

