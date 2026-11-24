/* ============================================================
   Golden Touch · Retenciones · Repositorio de Facturas Externas
   (Buzón Móvil de Compras y Soportes Fuera del Flujo)

   Facturas que cargan desde el teléfono las personas que están fuera
   de la oficina o del flujo de compras, clasificadas por la empresa
   que las recibe.

   Todo se lee y se guarda en la base (retencion_facturas_externas):
   una factura no queda «cargada» en un solo equipo. Si la base no
   guarda, se avisa con el motivo.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { completarRif, formatearRif } from '@/shared/lib/rif';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { errorRetencion } from '@/modules/libroFiscal/erroresRetencion';
import { borrarArchivosBuzon, subirArchivoBuzon, type AdjuntoFacturaItem } from './adjuntosBuzon';

export type EstatusFacturaBuzon = 'recibida' | 'en_revision' | 'retenida' | 'descartada';

export type TipoDocumentoBuzon = 'factura' | 'nota_debito' | 'nota_credito';

/** El tipo de documento, con la palabra que ve el usuario. Factura es lo habitual. */
export const TIPOS_DOCUMENTO_BUZON: { valor: TipoDocumentoBuzon; etiqueta: string }[] = [
  { valor: 'factura', etiqueta: 'Factura' },
  { valor: 'nota_debito', etiqueta: 'Nota de débito' },
  { valor: 'nota_credito', etiqueta: 'Nota de crédito' },
];

export const rotuloTipoDocumento = (t: TipoDocumentoBuzon | string): string =>
  TIPOS_DOCUMENTO_BUZON.find((x) => x.valor === t)?.etiqueta ?? 'Factura';

/**
 * El número de la factura para mostrar como «N° 123». Desde R12 el número es
 * opcional, así que una factura sin número muestra «(sin número)» en vez de un
 * «Factura N° » colgando (C-i).
 */
export function rotuloNumeroFactura(numero: string | null | undefined): string {
  return numero?.trim() ? `N° ${numero.trim()}` : '(sin número)';
}

/** Igual que rotuloNumeroFactura, con el estilo «#123» de la vista PC; vacío → «(sin número)». */
export function numeralFactura(numero: string | null | undefined): string {
  return numero?.trim() ? `#${numero.trim()}` : '(sin número)';
}

/**
 * El sello de creación más reciente de una lista de facturas del buzón, o '' si
 * está vacía. Sirve para avisar de una factura entrante por el sello más nuevo y
 * no por el conteo (C-i): si entra una y se borra otra en la misma recarga el
 * conteo no cambia, pero el sello sí, así el aviso no se pierde.
 */
export function ultimaCreacionBuzon(facs: readonly Pick<FacturaExternaBuzon, 'createdAt'>[]): string {
  return facs.reduce((max, f) => (f.createdAt > max ? f.createdAt : max), '');
}

export interface FacturaExternaBuzon {
  id: string;
  empresaId: string;
  empresaNombre: string;
  tipoDocumento: TipoDocumentoBuzon;
  proveedorNombre: string;
  proveedorRif: string;
  facturaNumero: string;
  facturaControl: string | null;
  facturaFecha: string; // YYYY-MM-DD
  montoTotal: number;
  moneda: 'Bs' | 'USD';
  tasa: number | null;
  montoBs: number;
  montoUsd?: number | null;
  descripcion: string;
  observaciones: string | null;
  estatus: EstatusFacturaBuzon;
  adjuntos: AdjuntoFacturaItem[];
  createdBy: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export type FacturaBuzon = FacturaExternaBuzon;

export interface NuevaFacturaBuzonInput {
  empresaId: string;
  empresaNombre: string;
  tipoDocumento: TipoDocumentoBuzon;
  proveedorNombre: string;
  /** Opcional en el buzón: la validación fiscal del RIF es después, al volverse retención. */
  proveedorRif?: string | null;
  facturaNumero?: string | null;
  facturaControl?: string | null;
  /** Opcional; si no viene, el teléfono manda la fecha de hoy (hora de Venezuela). */
  facturaFecha?: string | null;
  /** Opcional; vacío cuenta como 0. */
  montoTotal?: number | null;
  moneda: 'Bs' | 'USD';
  tasa?: number | null;
  descripcion?: string | null;
  observaciones?: string | null;
}

const TABLA = 'retencion_facturas_externas';

const redondear = (n: number) => Math.round(n * 100) / 100;

function mapearFilaFactura(r: Record<string, unknown>): FacturaExternaBuzon {
  const montoTotal = Number(r.monto_total ?? 0);
  const moneda = (r.moneda === 'USD' ? 'USD' : 'Bs') as 'Bs' | 'USD';
  const tasa = r.tasa != null ? Number(r.tasa) : null;
  const montoBs = r.monto_bs != null ? Number(r.monto_bs) : (moneda === 'Bs' ? montoTotal : (tasa ? redondear(montoTotal * tasa) : 0));
  const montoUsd = r.monto_usd != null
    ? Number(r.monto_usd)
    : moneda === 'USD' ? montoTotal : (tasa && tasa > 0 ? redondear(montoTotal / tasa) : null);

  return {
    id: String(r.id),
    empresaId: String(r.empresa_id ?? ''),
    empresaNombre: String(r.empresa_nombre ?? ''),
    tipoDocumento: (r.tipo_documento as TipoDocumentoBuzon) || 'factura',
    proveedorNombre: String(r.proveedor_nombre ?? ''),
    proveedorRif: String(r.proveedor_rif ?? ''),
    facturaNumero: String(r.factura_numero ?? ''),
    facturaControl: r.factura_control ? String(r.factura_control) : null,
    facturaFecha: String(r.factura_fecha ?? '').slice(0, 10),
    montoTotal,
    moneda,
    tasa,
    montoBs,
    montoUsd,
    descripcion: String(r.descripcion ?? ''),
    observaciones: r.observaciones ? String(r.observaciones) : null,
    estatus: (r.estatus as EstatusFacturaBuzon) || 'recibida',
    adjuntos: Array.isArray(r.adjuntos) ? (r.adjuntos as AdjuntoFacturaItem[]) : [],
    createdBy: r.created_by ? String(r.created_by) : null,
    createdByName: r.created_by_name ? String(r.created_by_name) : null,
    createdAt: String(r.created_at ?? ''),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

export async function listFacturasBuzon(filtro?: {
  empresaId?: string;
  estatus?: string;
  busqueda?: string;
}): Promise<FacturaExternaBuzon[]> {
  let q = supabase.from(TABLA).select('*').order('created_at', { ascending: false });
  if (filtro?.empresaId) q = q.eq('empresa_id', filtro.empresaId);
  if (filtro?.estatus) q = q.eq('estatus', filtro.estatus);

  const { data, error } = await q;
  if (error) throw errorRetencion(error, 'No se pudieron leer las facturas del buzón.');
  const items = (data ?? []).map((r) => mapearFilaFactura(r as Record<string, unknown>));
  return filtrarPorTexto(items, filtro?.busqueda);
}

export function filtrarPorTexto(xs: FacturaExternaBuzon[], q?: string): FacturaExternaBuzon[] {
  if (!q?.trim()) return xs;
  const s = q.trim().toLowerCase();
  return xs.filter(
    (f) =>
      f.proveedorNombre.toLowerCase().includes(s) ||
      f.proveedorRif.toLowerCase().includes(s) ||
      f.facturaNumero.toLowerCase().includes(s) ||
      (f.facturaControl && f.facturaControl.toLowerCase().includes(s)) ||
      f.empresaNombre.toLowerCase().includes(s) ||
      f.descripcion.toLowerCase().includes(s),
  );
}

/**
 * Qué falta o está mal en la factura; null si se puede guardar.
 *
 * En el buzón del teléfono solo son obligatorios la empresa, el proveedor y el
 * tipo de documento (el ≥1 soporte lo exige la carga, que ve los archivos).
 * El resto es opcional: el RIF no se valida aquí (la validación fiscal es
 * después, al volverse retención), la fecha trae hoy por defecto y el monto
 * vacío cuenta como 0. Solo se cuidan los topes de largo y que lo escrito tenga
 * forma (fecha no futura, tasa positiva).
 */
export function faltaEnFacturaBuzon(input: NuevaFacturaBuzonInput, hoy: string = hoyVenezuela()): string | null {
  if (!input.empresaId) return 'Elige la empresa que recibe la factura.';
  if (!input.proveedorNombre?.trim()) return 'Indica el nombre del proveedor.';
  if (input.proveedorNombre.trim().length > 200) return 'El nombre del proveedor va hasta 200 caracteres.';
  if (!TIPOS_DOCUMENTO_BUZON.some((t) => t.valor === input.tipoDocumento)) return 'Elige el tipo de documento.';
  if ((input.facturaNumero?.trim().length ?? 0) > 40 || (input.facturaControl?.trim().length ?? 0) > 40) return 'El número y el control de la factura van hasta 40 caracteres.';
  if (input.facturaFecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.facturaFecha)) return 'La fecha de la factura no es válida.';
    if (input.facturaFecha > hoy) return 'La fecha de la factura no puede ser posterior a hoy.';
  }
  if (input.montoTotal != null && (!Number.isFinite(input.montoTotal) || input.montoTotal < 0)) return 'El monto no puede ser negativo.';
  if (input.tasa != null && !(input.tasa > 0)) return 'La tasa tiene que ser mayor que 0.';
  if ((input.descripcion?.trim().length ?? 0) > 1000) return 'La descripción va hasta 1000 caracteres.';
  if ((input.observaciones?.trim().length ?? 0) > 2000) return 'Las observaciones van hasta 2000 caracteres.';
  return null;
}

/**
 * Registra la factura con sus soportes ya subidos (el id lo pone el cliente
 * para que los archivos vayan antes a «<id>/…»). Devuelve lo que quedó en la base.
 * El autor, las fechas y el nombre de la empresa los pone la base.
 */
export async function crearFacturaBuzon(
  input: NuevaFacturaBuzonInput,
  { id = crypto.randomUUID(), adjuntos = [] }: { id?: string; adjuntos?: AdjuntoFacturaItem[] } = {},
): Promise<FacturaExternaBuzon> {
  const falta = faltaEnFacturaBuzon(input);
  if (falta) throw new Error(falta);

  const montoTotal = redondear(input.montoTotal ?? 0);
  const tasa = input.tasa != null ? input.tasa : null;
  const montoBs = input.moneda === 'Bs' ? montoTotal : redondear(montoTotal * (tasa ?? 0));
  const montoUsd = input.moneda === 'USD' ? montoTotal : (tasa && tasa > 0 ? redondear(montoTotal / tasa) : null);

  // RIF opcional: si se escribió y tiene arreglo, se guarda completo; si no, va sin RIF (null).
  const rifCompleto = input.proveedorRif?.trim() ? completarRif(input.proveedorRif) : null;

  const { data, error } = await supabase.from(TABLA).insert({
    id,
    empresa_id: input.empresaId,
    empresa_nombre: input.empresaNombre,
    tipo_documento: input.tipoDocumento,
    proveedor_nombre: input.proveedorNombre.trim(),
    proveedor_rif: rifCompleto ? formatearRif(rifCompleto) : null,
    factura_numero: input.facturaNumero?.trim() || null,
    factura_control: input.facturaControl?.trim() || null,
    factura_fecha: input.facturaFecha || null,
    monto_total: montoTotal,
    moneda: input.moneda,
    tasa,
    monto_bs: montoBs,
    monto_usd: montoUsd,
    descripcion: input.descripcion?.trim() || null,
    observaciones: input.observaciones?.trim() || null,
    estatus: 'recibida',
    adjuntos,
    // El autor (correo y nombre) lo pone la base; el cliente no manda un nombre falsificable.
  }).select('*');
  if (error) throw errorRetencion(error, 'No se pudo guardar la factura.', { unico: 'Esa factura ya está cargada en el buzón.' });
  const fila = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!fila) throw new Error('No se guardó la factura: sin permiso para cargar facturas en el buzón.');
  return mapearFilaFactura(fila);
}

/**
 * Sube los soportes y después registra la factura con ellos. Si algo falla, la
 * factura no se guarda y se avisa el motivo; los archivos ya subidos se
 * intentan quitar (quien solo tiene lectura no puede borrarlos: quedan sueltos,
 * sin factura que los nombre).
 */
export async function cargarFacturaBuzon(
  input: NuevaFacturaBuzonInput,
  archivos: readonly File[],
  alAvanzar?: (mensaje: string) => void,
): Promise<FacturaExternaBuzon> {
  const falta = faltaEnFacturaBuzon(input);
  if (falta) throw new Error(falta);
  // El soporte es obligatorio: una factura del buzón entra con al menos una foto o un PDF.
  if (!archivos.length) throw new Error('Agrega al menos un soporte de la factura (una foto o un PDF).');

  const id = crypto.randomUUID();
  const subidos: AdjuntoFacturaItem[] = [];
  try {
    for (let i = 0; i < archivos.length; i += 1) {
      alAvanzar?.(`Subiendo el soporte ${i + 1} de ${archivos.length}…`);
      subidos.push(await subirArchivoBuzon(id, archivos[i]));
    }
    alAvanzar?.('Guardando los datos de la factura…');
    return await crearFacturaBuzon(input, { id, adjuntos: subidos });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    try { await borrarArchivosBuzon(subidos.map((a) => a.path)); } catch { /* sin permiso de borrar: quedan sueltos */ }
    throw new Error(`No se guardó la factura. ${motivo}`);
  }
}

export async function actualizarEstatusFacturaBuzon(id: string, nuevoEstatus: EstatusFacturaBuzon): Promise<void> {
  const { data, error } = await supabase.from(TABLA)
    .update({ estatus: nuevoEstatus })
    .eq('id', id)
    .select('id');
  if (error) throw errorRetencion(error, 'No se pudo cambiar el estado de la factura.');
  if (!data?.length) throw new Error('No se cambió el estado: sin permiso para modificar la factura, o ya no existe.');
}

/** Borra la factura y después sus soportes del almacenamiento. */
export async function eliminarFacturaBuzon(factura: Pick<FacturaExternaBuzon, 'id' | 'adjuntos'>): Promise<void> {
  const { data, error } = await supabase.from(TABLA).delete().eq('id', factura.id).select('id');
  if (error) throw errorRetencion(error, 'No se pudo borrar la factura.');
  if (!data?.length) throw new Error('No se borró la factura: sin permiso para borrarla, o ya no existe.');
  try {
    await borrarArchivosBuzon(factura.adjuntos.map((a) => a.path).filter(Boolean));
  } catch {
    throw new Error('La factura se borró, pero sus soportes no se pudieron quitar del almacenamiento.');
  }
}
