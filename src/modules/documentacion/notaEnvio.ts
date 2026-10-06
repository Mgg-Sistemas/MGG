/* ============================================================
   MGG · Documentación · Reglas de la nota de envío (06-10-2026)

   El papel con el que se entrega documentación a otra empresa o a un
   departamento: «le llevo 296 facturas originales, firmame que las
   recibiste». Lleva correlativo propio (lo asigna la BASE: secuencia +
   trigger; acá solo se le da formato), los datos del destinatario, los
   renglones (qué se entrega y cuántos) y dos firmas que se hacen A MANO
   sobre el papel impreso: quien entrega y quien recibe conforme (firma,
   sello, cédula y fecha). Nada de firma digital.

   Mismo formato y reglas que el módulo de Golden Touch.
   Acá vive la lógica sin base ni pantalla: validar, totalizar, formatear.
   ============================================================ */

/** Un renglón de la nota: qué se entrega y cuántos (la cantidad puede ir vacía). */
export interface ItemNotaEnvio {
  descripcion: string;
  cantidad: number | null;
}

/** Estado que se muestra: anulada manda; si se marcó recibida, recibida; si no, enviada. */
export type EstadoEnvio = 'emitido' | 'recibido' | 'anulado';

export const ESTADO_ENVIO_LABEL: Record<EstadoEnvio, string> = {
  emitido: 'Enviada',
  recibido: 'Recibida conforme',
  anulado: 'Anulada',
};

export function estadoEnvio(n: { estado: string; recibido_en?: string | null }): EstadoEnvio {
  if (n.estado === 'anulada') return 'anulado';
  if (n.recibido_en) return 'recibido';
  return 'emitido';
}

/** Datos de la empresa que emite la nota (encabezado del papel), tal cual el SENIAT. */
export const EMISOR_NOTA = {
  razonSocial: 'MINERAL GROUP GUAYANA, C.A.',
  rif: 'J-50221930-7',
  domicilio: 'Calle Manzana 03 Local Parcela N° 15 Urb. Villa Betania, Puerto Ordaz, Ciudad Guayana, Bolívar, Zona Postal 8050',
} as const;

/** N° de la nota con 4 dígitos, como en el formato impreso: 1 → «0001». */
export function numeroEnvio(n: number | null | undefined): string {
  const v = Math.max(0, Math.trunc(Number(n) || 0));
  return String(v).padStart(4, '0');
}

/** «NE-0001» (el código que guarda la base). */
export function codigoNotaEnvio(numero: number): string {
  return `NE-${numeroEnvio(numero)}`;
}

/** Texto limpio: sin espacios de más. */
export function limpio(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim();
}

/** Renglones que van a la nota: con descripción. La cantidad vacía se guarda como null. */
export function renglonesValidos(items: ItemNotaEnvio[]): ItemNotaEnvio[] {
  return items
    .map((r) => ({
      descripcion: limpio(r.descripcion),
      cantidad: r.cantidad == null || Number.isNaN(Number(r.cantidad)) ? null : Number(r.cantidad),
    }))
    .filter((r) => r.descripcion.length > 0);
}

/** Suma de cantidades (los renglones sin cantidad no suman). */
export function totalRenglones(items: ItemNotaEnvio[]): number {
  return renglonesValidos(items).reduce((a, r) => a + (r.cantidad ?? 0), 0);
}

/** Texto de cantidad para tabla/PDF: enteros sin decimales, el resto con coma. */
export function cantidadTexto(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

export interface DatosNotaEnvio {
  fecha: string;
  razon_social: string;
  rif?: string | null;
  direccion?: string | null;
  atencion_a?: string | null;
  condicion?: string | null;
  items: ItemNotaEnvio[];
  total_etiqueta?: string | null;
  /** Total escrito a mano; si falta, se usa la suma de cantidades. */
  total?: number | null;
  entregado_por?: string | null;
  nota?: string | null;
}

/** Motivo por el que la nota no se puede emitir, o null si está bien. */
export function errorNotaEnvio(d: DatosNotaEnvio): string | null {
  if (!limpio(d.razon_social)) return 'Indicá a quién se le envía (razón social o departamento).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return 'La fecha no es válida.';
  if (!renglonesValidos(d.items).length) return 'Agregá al menos un renglón con su descripción.';
  return null;
}

/** La nota lista para guardar: textos limpios, renglones válidos y total. */
export function normalizarNotaEnvio(d: DatosNotaEnvio) {
  const items = renglonesValidos(d.items);
  const suma = items.reduce((a, r) => a + (r.cantidad ?? 0), 0);
  const total = d.total == null || Number.isNaN(Number(d.total)) ? suma : Number(d.total);
  return {
    fecha: d.fecha,
    razon_social: limpio(d.razon_social),
    rif: limpio(d.rif).toUpperCase() || null,
    direccion: limpio(d.direccion) || null,
    atencion_a: limpio(d.atencion_a) || null,
    condicion: limpio(d.condicion) || null,
    items,
    total_etiqueta: limpio(d.total_etiqueta) || 'Documentos',
    total_cantidad: total,
    entregado_por: limpio(d.entregado_por) || '—',
    nota: limpio(d.nota) || null,
  };
}

/** Sin acentos y en minúsculas, para buscar. */
export function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface DestinatarioLike {
  razon_social: string;
  rif?: string | null;
  atencion_a?: string | null;
  direccion?: string | null;
}

/** Busca destinatarios por texto (razón social, RIF o persona de atención). */
export function filtrarDestinatarios<T extends DestinatarioLike>(lista: T[], q: string): T[] {
  const t = norm(q);
  if (!t) return lista;
  const palabras = t.split(/\s+/);
  return lista.filter((d) => {
    const txt = norm(`${d.razon_social} ${d.rif ?? ''} ${d.atencion_a ?? ''} ${d.direccion ?? ''}`);
    return palabras.every((p) => txt.includes(p));
  });
}
