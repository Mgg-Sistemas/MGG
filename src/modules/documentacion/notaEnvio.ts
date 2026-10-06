/* ============================================================
   MGG · Documentación · Nota de envío de documentación (06-10-2026)

   El papel con el que se entrega documentación a otra empresa o a un
   departamento: «le llevo 296 facturas originales a Golden Touch, firmame
   que las recibiste». Lleva correlativo propio (NE-0001, NE-0002…), los
   datos del destinatario, los renglones (qué se entrega y cuántos) y dos
   firmas que se hacen A MANO sobre el papel impreso: quien entrega y quien
   recibe conforme (firma, sello, cédula y fecha). Nada de firma digital.

   Acá vive la lógica sin base ni pantalla: validar, totalizar, formatear.
   ============================================================ */

/** Un renglón de la nota: qué se entrega y cuántos. */
export interface ItemNotaEnvio {
  descripcion: string;
  cantidad: number;
}

export interface DatosNotaEnvio {
  fecha: string;
  razon_social: string;
  rif?: string | null;
  direccion?: string | null;
  atencion_a?: string | null;
  condicion?: string | null;
  items: ItemNotaEnvio[];
  entregado_por: string;
  nota?: string | null;
}

/** Datos de la empresa que emite la nota (encabezado del papel). */
export const EMISOR_NOTA = {
  razonSocial: 'MINERAL GROUP GUAYANA C.A.',
  rif: 'J-50221930-7',
  domicilio: 'Calle Manzana 03 Parcela 15, Urb. Villa Betania, Puerto Ordaz, Estado Bolívar',
} as const;

/** Condiciones de entrega frecuentes (se pueden escribir otras). */
export const CONDICIONES_NOTA = ['Facturas originales', 'Copias', 'Originales y copias', 'Documentos originales', 'Para firma y devolución'] as const;

/** «NE-0001». */
export function codigoNotaEnvio(numero: number): string {
  return `NE-${String(Math.max(0, Math.trunc(numero))).padStart(4, '0')}`;
}

/** Texto limpio: sin espacios de más. */
export function limpio(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim();
}

/** Renglones que cuentan: con descripción y cantidad > 0. */
export function itemsValidos(items: ItemNotaEnvio[]): ItemNotaEnvio[] {
  return items
    .map((it) => ({ descripcion: limpio(it.descripcion).toUpperCase(), cantidad: Number(it.cantidad) || 0 }))
    .filter((it) => it.descripcion && it.cantidad > 0);
}

/** Total de documentos de la nota (suma de cantidades). */
export function totalNotaEnvio(items: ItemNotaEnvio[]): number {
  return itemsValidos(items).reduce((a, it) => a + it.cantidad, 0);
}

/** Motivo por el que la nota no se puede emitir, o null si está bien. */
export function errorNotaEnvio(d: DatosNotaEnvio): string | null {
  if (!limpio(d.razon_social)) return 'Indicá a quién se le envía (razón social o departamento).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return 'La fecha no es válida.';
  const sinCantidad = d.items.find((it) => limpio(it.descripcion) && !(Number(it.cantidad) > 0));
  if (sinCantidad) return `«${limpio(sinCantidad.descripcion)}» no tiene cantidad.`;
  const items = itemsValidos(d.items);
  if (!items.length) return 'Agregá al menos un renglón con descripción y cantidad.';
  if (!limpio(d.entregado_por)) return 'Indicá quién entrega la documentación.';
  return null;
}

/** La nota lista para guardar: textos limpios, renglones válidos y total. */
export function normalizarNotaEnvio(d: DatosNotaEnvio) {
  const items = itemsValidos(d.items);
  return {
    fecha: d.fecha,
    razon_social: limpio(d.razon_social).toUpperCase(),
    rif: limpio(d.rif).toUpperCase() || null,
    direccion: limpio(d.direccion) || null,
    atencion_a: limpio(d.atencion_a) || null,
    condicion: limpio(d.condicion) || null,
    items,
    total_cantidad: items.reduce((a, it) => a + it.cantidad, 0),
    entregado_por: limpio(d.entregado_por).toUpperCase(),
    nota: limpio(d.nota) || null,
  };
}

export interface DestinatarioLike {
  razon_social: string;
  rif?: string | null;
  atencion_a?: string | null;
  direccion?: string | null;
}

/** Busca destinatarios por texto (razón social, RIF o persona de atención). */
export function filtrarDestinatarios<T extends DestinatarioLike>(lista: T[], q: string): T[] {
  const t = limpio(q).toLowerCase();
  if (!t) return lista;
  const palabras = t.split(' ');
  return lista.filter((d) => {
    const txt = `${d.razon_social} ${d.rif ?? ''} ${d.atencion_a ?? ''} ${d.direccion ?? ''}`.toLowerCase();
    return palabras.every((p) => txt.includes(p));
  });
}
