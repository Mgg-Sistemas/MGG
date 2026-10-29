/* ============================================================
   MGG · Retenciones · Repositorio de Facturas Externas
   (Buzón Móvil de Compras y Soportes Fuera del Flujo)
   Alineado 1:1 con Golden Touch facturasBuzon.repository.ts

   Almacena facturas que personas fuera del edificio o del flujo
   cargan desde el teléfono, clasificadas por empresa (MGG,
   Golden Touch, Minería TS / MTO, etc.).
   Incluye registro automático de Notificación Interna en el sistema.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { type AdjuntoFacturaItem } from './adjuntosBuzon';

export type EstatusFacturaBuzon = 'recibida' | 'en_revision' | 'retenida' | 'descartada';

export type TipoDocumentoFactura = 'factura' | 'nota_debito' | 'nota_credito';

export interface FacturaExternaBuzon {
  id: string;
  empresaId: string;
  empresaNombre: string;
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
  tipoDocumento: TipoDocumentoFactura;
  adjuntos: AdjuntoFacturaItem[];
  createdBy: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string | null;

  // Propiedades espejo para compatibilidad con vistas existentes
  empresa_receptora_id?: string;
  empresa_nombre?: string;
  proveedor_nombre?: string;
  proveedor_rif?: string;
  numero_factura?: string;
  numero_control?: string | null;
  fecha_factura?: string;
  monto_total?: number;
  monto_bs?: number;
  monto_usd?: number | null;
}

export type FacturaBuzon = FacturaExternaBuzon;

export interface NuevaFacturaBuzonInput {
  empresaId?: string;
  empresa_receptora_id?: string;
  empresaNombre?: string;
  empresa_nombre?: string;
  proveedorNombre?: string;
  proveedor_nombre?: string;
  proveedorRif?: string;
  proveedor_rif?: string;
  facturaNumero?: string;
  numero_factura?: string;
  facturaControl?: string | null;
  numero_control?: string | null;
  facturaFecha?: string;
  fecha_factura?: string;
  montoTotal?: number;
  monto_total?: number;
  moneda: 'Bs' | 'USD';
  tasa?: number | null;
  descripcion?: string;
  observaciones?: string | null;
  adjuntos?: AdjuntoFacturaItem[];
  createdBy?: string | null;
  creado_por?: string | null;
  createdByName?: string | null;
  tipoDocumento?: TipoDocumentoFactura;
}

const TABLE_BUZON = 'retencion_facturas_externas';

/**
 * Nada se guarda «en local» haciéndose pasar por guardado: si la base no
 * responde, se dice. Antes, un fallo dejaba la factura solo en el navegador
 * del teléfono y nadie en la oficina la veía.
 */
export function errorBuzon(e: { code?: string; message?: string } | null | undefined): Error {
  const msg = e?.message ?? '';
  const faltaTabla = e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|Could not find the table/i.test(msg);
  if (faltaTabla) {
    return new Error('El buzón de facturas todavía no está activo en la base (falta aplicar su SQL). No se guardó nada.');
  }
  return new Error(`No se pudo guardar en el buzón: ${msg || 'error desconocido'}`);
}

function mapearFilaFactura(r: Record<string, unknown>): FacturaExternaBuzon {
  const empresaId = String(r.empresa_id || r.empresaId || r.empresa_receptora_id || '');
  const empresaNombre = String(r.empresa_nombre || r.empresaNombre || 'Empresa Receptora');
  const proveedorNombre = String(r.proveedor_nombre || r.proveedorNombre || 'Proveedor');
  const proveedorRif = String(r.proveedor_rif || r.proveedorRif || 'S/RIF');
  const facturaNumero = String(r.factura_numero || r.facturaNumero || r.numero_factura || '000000');
  const facturaControl = r.factura_control ? String(r.factura_control) : (r.numero_control ? String(r.numero_control) : null);
  const facturaFecha = String(r.factura_fecha || r.facturaFecha || r.fecha_factura || '').slice(0, 10);
  const montoTotal = Number(r.monto_total ?? r.montoTotal ?? 0);
  const moneda = (String(r.moneda || 'USD').toUpperCase() === 'BS' ? 'Bs' : 'USD') as 'Bs' | 'USD';
  const tasa = r.tasa != null ? Number(r.tasa) : null;
  const montoBs = Number(r.monto_bs ?? r.montoBs ?? (moneda === 'Bs' ? montoTotal : (tasa ? montoTotal * tasa : 0)));
  const montoUsd = r.monto_usd != null ? Number(r.monto_usd) : (r.montoUsd != null ? Number(r.montoUsd) : (moneda === 'USD' ? montoTotal : (tasa && tasa > 0 ? montoTotal / tasa : null)));
  const descripcion = String(r.descripcion || '');
  const observaciones = r.observaciones ? String(r.observaciones) : null;
  const estatus = (r.estatus as EstatusFacturaBuzon) || 'recibida';
  const tipoDocumento = (r.tipo_documento as TipoDocumentoFactura) || 'factura';
  const adjuntos = Array.isArray(r.adjuntos) ? (r.adjuntos as AdjuntoFacturaItem[]) : [];
  const createdBy = r.created_by ? String(r.created_by) : (r.createdBy ? String(r.createdBy) : null);
  const createdByName = r.created_by_name ? String(r.created_by_name) : (r.createdByName ? String(r.createdByName) : null);
  const createdAt = String(r.created_at || r.createdAt || new Date().toISOString());
  const updatedAt = r.updated_at ? String(r.updated_at) : (r.updatedAt ? String(r.updatedAt) : null);

  return {
    id: String(r.id),
    empresaId,
    empresaNombre,
    proveedorNombre,
    proveedorRif,
    facturaNumero,
    facturaControl,
    facturaFecha,
    montoTotal,
    moneda,
    tasa,
    montoBs,
    montoUsd,
    descripcion,
    observaciones,
    estatus,
    tipoDocumento,
    adjuntos,
    createdBy,
    createdByName,
    createdAt,
    updatedAt,

    // Espejos
    empresa_receptora_id: empresaId,
    empresa_nombre: empresaNombre,
    proveedor_nombre: proveedorNombre,
    proveedor_rif: proveedorRif,
    numero_factura: facturaNumero,
    numero_control: facturaControl,
    fecha_factura: facturaFecha,
    monto_total: montoTotal,
    monto_bs: montoBs,
    monto_usd: montoUsd,
  };
}

export async function listFacturasBuzon(filtro?: {
  empresaId?: string;
  estatus?: string;
  busqueda?: string;
}): Promise<FacturaExternaBuzon[]> {
  let q = supabase.from(TABLE_BUZON).select('*').order('created_at', { ascending: false });
  if (filtro?.empresaId) q = q.eq('empresa_id', filtro.empresaId);
  if (filtro?.estatus) q = q.eq('estatus', filtro.estatus);

  const { data, error } = await q;
  if (error) throw errorBuzon(error);
  const items: FacturaExternaBuzon[] = (data ?? []).map((r) => mapearFilaFactura(r as Record<string, unknown>));
  return filtrarMemoria(items, filtro?.busqueda);
}

function filtrarMemoria(xs: FacturaExternaBuzon[], q?: string): FacturaExternaBuzon[] {
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
 * Calcula el equivalente en Bs y en USD de forma consistente, según la moneda
 * y la tasa. Sin tasa válida no se inventan equivalencias.
 */
export function calcularMontosBuzon(
  moneda: 'Bs' | 'USD',
  montoTotal: number,
  tasa: number | null,
): { montoBs: number; montoUsd: number | null } {
  const montoBs = moneda === 'Bs'
    ? montoTotal
    : tasa && tasa > 0
      ? Math.round(montoTotal * tasa * 100) / 100
      : 0;
  const montoUsd = moneda === 'USD'
    ? montoTotal
    : tasa && tasa > 0
      ? Math.round((montoTotal / tasa) * 100) / 100
      : null;
  return { montoBs, montoUsd };
}

export async function crearFacturaBuzon(input: NuevaFacturaBuzonInput): Promise<FacturaExternaBuzon> {
  // La columna id es uuid.
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const empresaId = input.empresaId || input.empresa_receptora_id || '';
  const empresaNombre = input.empresaNombre || input.empresa_nombre || 'Empresa Receptora';
  const proveedorNombre = (input.proveedorNombre || input.proveedor_nombre || '').trim();
  const proveedorRif = (input.proveedorRif || input.proveedor_rif || 'S/RIF').trim().toUpperCase();
  const facturaNumero = (input.facturaNumero || input.numero_factura || '').trim();
  const facturaControl = (input.facturaControl || input.numero_control || '').trim() || null;
  const facturaFecha = (input.facturaFecha || input.fecha_factura || now).slice(0, 10);
  const montoTotal = Number(input.montoTotal ?? input.monto_total ?? 0);
  const tasa = input.tasa != null ? Number(input.tasa) : null;

  const { montoBs, montoUsd } = calcularMontosBuzon(input.moneda, montoTotal, tasa);

  const item: FacturaExternaBuzon = {
    id,
    empresaId,
    empresaNombre,
    proveedorNombre,
    proveedorRif,
    facturaNumero,
    facturaControl,
    facturaFecha,
    montoTotal,
    moneda: input.moneda,
    tasa,
    montoBs,
    montoUsd,
    descripcion: (input.descripcion || '').trim(),
    observaciones: (input.observaciones || '').trim() || null,
    estatus: 'recibida',
    tipoDocumento: input.tipoDocumento || 'factura',
    adjuntos: input.adjuntos || [],
    createdBy: input.createdBy || input.creado_por || null,
    createdByName: input.createdByName || null,
    createdAt: now,
    updatedAt: now,

    // Espejos
    empresa_receptora_id: empresaId,
    empresa_nombre: empresaNombre,
    proveedor_nombre: proveedorNombre,
    proveedor_rif: proveedorRif,
    numero_factura: facturaNumero,
    numero_control: facturaControl,
    fecha_factura: facturaFecha,
    monto_total: montoTotal,
    monto_bs: montoBs,
    monto_usd: montoUsd,
  };

  {
    const { error } = await supabase.from(TABLE_BUZON).insert({
      id: item.id,
      empresa_id: item.empresaId,
      empresa_nombre: item.empresaNombre,
      proveedor_nombre: item.proveedorNombre,
      proveedor_rif: item.proveedorRif,
      factura_numero: item.facturaNumero,
      factura_control: item.facturaControl,
      factura_fecha: item.facturaFecha,
      monto_total: item.montoTotal,
      moneda: item.moneda,
      tasa: item.tasa,
      monto_bs: item.montoBs,
      monto_usd: item.montoUsd,
      descripcion: item.descripcion,
      observaciones: item.observaciones,
      estatus: item.estatus,
      tipo_documento: item.tipoDocumento,
      adjuntos: item.adjuntos,
      created_by: item.createdBy,
      created_by_name: item.createdByName,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    });
    if (error) throw errorBuzon(error);
  }

  // Notificación Interna del Sistema (Campana y Panel de Notificaciones)
  try {
    const { push: pushNotif } = await import('@/modules/notificaciones/notif.repository');
    const montoFmt = `${item.moneda} ${Number(item.montoTotal).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await pushNotif({
      destino: 'all',
      kind: 'info',
      title: `🧾 Factura externa: ${item.empresaNombre}`,
      message: `Factura ${item.facturaNumero} de ${item.proveedorNombre} (${montoFmt}) recibida en el buzón`,
      link: '/app/retenciones',
      dedup_key: `factura-buzon-${item.id}`,
    });
  } catch (e) {
    console.warn('Error al registrar notificación interna de factura:', e);
  }

  return item;
}

export async function actualizarEstatusFacturaBuzon(
  id: string,
  nuevoEstatus: EstatusFacturaBuzon,
): Promise<void> {
  const { error } = await supabase.from(TABLE_BUZON).update({
    estatus: nuevoEstatus,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw errorBuzon(error);
}

/** Guarda en la factura los soportes ya subidos (la factura se crea primero y los archivos van en su carpeta). */
export async function guardarAdjuntosFacturaBuzon(id: string, adjuntos: AdjuntoFacturaItem[]): Promise<void> {
  const { error } = await supabase.from(TABLE_BUZON).update({
    adjuntos,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw errorBuzon(error);
}

export async function eliminarFacturaBuzon(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE_BUZON).delete().eq('id', id);
  if (error) throw errorBuzon(error);
}

