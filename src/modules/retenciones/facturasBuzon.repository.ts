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
import { urlPublicaAdjunto, type AdjuntoFacturaItem } from './adjuntosBuzon';

export { urlPublicaAdjunto };

export type EstatusFacturaBuzon = 'recibida' | 'en_revision' | 'retenida' | 'descartada';

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
}

const TABLE_BUZON = 'retencion_facturas_externas';
const LOCAL_STORAGE_KEY = 'mgg.retenciones.facturas_buzon_cache';
let _memoriaFacturas: FacturaExternaBuzon[] = [];

function leerCacheLocal(): FacturaExternaBuzon[] {
  if (typeof window === 'undefined') return _memoriaFacturas;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FacturaExternaBuzon[]) : [];
  } catch {
    return [];
  }
}

function guardarCacheLocal(facturas: FacturaExternaBuzon[]): void {
  _memoriaFacturas = facturas;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(facturas));
  } catch {
    /* ignore */
  }
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
  try {
    let q = supabase.from(TABLE_BUZON).select('*').order('created_at', { ascending: false });

    if (filtro?.empresaId) q = q.eq('empresa_id', filtro.empresaId);
    if (filtro?.estatus) q = q.eq('estatus', filtro.estatus);

    const { data, error } = await q;
    if (!error && data) {
      const items: FacturaExternaBuzon[] = data.map((r) => mapearFilaFactura(r as Record<string, unknown>));
      guardarCacheLocal(items);
      return filtrarMemoria(items, filtro?.busqueda);
    }
  } catch {
    /* fallback cache local */
  }

  let items = leerCacheLocal();
  if (filtro?.empresaId) items = items.filter((f) => f.empresaId === filtro.empresaId || f.empresa_receptora_id === filtro.empresaId);
  if (filtro?.estatus) items = items.filter((f) => f.estatus === filtro.estatus);
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

export async function crearFacturaBuzon(input: NuevaFacturaBuzonInput): Promise<FacturaExternaBuzon> {
  const id = `fac-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

  const montoBs = input.moneda === 'Bs'
    ? montoTotal
    : tasa && tasa > 0
      ? Math.round(montoTotal * tasa * 100) / 100
      : 0;

  const montoUsd = input.moneda === 'USD'
    ? montoTotal
    : tasa && tasa > 0
      ? Math.round((montoTotal / tasa) * 100) / 100
      : null;

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

  try {
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
      adjuntos: item.adjuntos,
      created_by: item.createdBy,
      created_by_name: item.createdByName,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    });
    if (error) {
      console.warn('Inserción en Supabase falló, usando cache local:', error.message);
    }
  } catch {
    /* Fallback en caso de que la tabla aún no exista */
  }

  const actuales = leerCacheLocal();
  actuales.unshift(item);
  guardarCacheLocal(actuales);

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
  const now = new Date().toISOString();
  try {
    await supabase.from(TABLE_BUZON).update({
      estatus: nuevoEstatus,
      updated_at: now,
    }).eq('id', id);
  } catch {
    /* ignore */
  }

  const actuales = leerCacheLocal();
  const idx = actuales.findIndex((f) => f.id === id);
  if (idx >= 0) {
    actuales[idx].estatus = nuevoEstatus;
    actuales[idx].updatedAt = now;
    guardarCacheLocal(actuales);
  }
}

export async function eliminarFacturaBuzon(id: string): Promise<void> {
  try {
    await supabase.from(TABLE_BUZON).delete().eq('id', id);
  } catch {
    /* ignore */
  }

  const actuales = leerCacheLocal().filter((f) => f.id !== id);
  guardarCacheLocal(actuales);
}

