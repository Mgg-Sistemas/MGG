/* ============================================================
   MGG · Inventario · Recepciones desde el teléfono de almacén (04-11-2026)

   Pedido de la administradora: «cuando los deliverys entreguen al almacenista,
   el almacenista desde su pantalla de tlf debe RECEPCIONAR ese pedido» y «este
   botón (Recepciones) lo necesito en almacén Los Pinos… si estoy en Matanza y
   recepciono entra automáticamente a Matanza». Lecturas para la lista (las OC
   por recibir, su proveedor y qué delivery la trae) y las fotos de la recepción.
   La recepción misma es la de Compras/PC (`recibirOrdenParcial`): suma al
   inventario, recalcula el PMP y deja la orden RECIBIDA en Compras.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import type { Orden } from '@/shared/lib/types';
import { listRecepcionesPendientes } from './inventario.repository';
import { listMovimientosRecepcion } from './movimientos.repository';
import { recepcionesDesdeMovimientos, type Recepcion } from './recepcionesHistorico';

const BUCKET_OC = 'compras-oc';

export interface DeliveryDeOrden {
  orden_id: string;
  estado: 'aceptado' | 'en_ruta' | 'entregado';
  repartidor_nombre: string | null;
  almacen_entrega: string | null;
  entregado_en: string | null;
  aceptado_en: string | null;
}

export interface OrdenPorRecibir { orden: Orden; proveedor: string | null; delivery: DeliveryDeOrden | null }

export interface FotoRecepcion { path: string; filename: string }

/** Nombres de proveedores por id (lectura abierta). */
export async function nombresProveedores(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const { data } = await supabase.from('proveedores').select('id, razon_social').in('id', unicos);
  return new Map((data ?? []).map((p: { id: string; razon_social: string | null }) => [p.id, p.razon_social ?? '']));
}

/** Las OC por recibir con su proveedor y el delivery que la trae o la trajo. */
export async function listOrdenesPorRecibir(): Promise<OrdenPorRecibir[]> {
  const ordenes = await listRecepcionesPendientes();
  const [provs, dlv] = await Promise.all([
    nombresProveedores(ordenes.map((o) => o.proveedor_id ?? '')),
    ordenes.length
      ? supabase.rpc('inv_tel_delivery_de_ordenes', { p_ids: ordenes.map((o) => o.id) }).then(({ data }) => (data ?? []) as DeliveryDeOrden[])
      : Promise.resolve([] as DeliveryDeOrden[]),
  ]);
  const porOrden = new Map(dlv.map((d) => [d.orden_id, d]));
  return ordenes.map((o) => ({ orden: o, proveedor: (o.proveedor_id && provs.get(o.proveedor_id)) || null, delivery: porOrden.get(o.id) ?? null }));
}

const seguro = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

/** Sube las fotos de la recepción al bucket de la OC y las anota en la orden. */
export async function subirFotosRecepcion(orden: Pick<Orden, 'id'> & { recepcion_fotos?: unknown }, archivos: File[]): Promise<FotoRecepcion[]> {
  const previas = Array.isArray(orden.recepcion_fotos) ? (orden.recepcion_fotos as FotoRecepcion[]) : [];
  const nuevas = await Promise.all(archivos.slice(0, 4).map(async (original) => {
    const f = await comprimirImagen(original).catch(() => original);
    const path = `${orden.id}/recepcion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET_OC).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir «${original.name}»: ${error.message}`);
    return { path, filename: original.name };
  }));
  const fotos = [...previas, ...nuevas];
  const { error } = await supabase.from('ordenes').update({ recepcion_fotos: fotos }).eq('id', orden.id);
  if (error) throw new Error(`Las fotos subieron, pero no se anotaron en la orden: ${error.message}`);
  return fotos;
}

/** Las fotos de la recepción de una orden (para el WhatsApp del histórico). */
export async function fotosRecepcionDe(ordenId: string): Promise<{ fotos: FotoRecepcion[]; archivos: File[] }> {
  const { data } = await supabase.from('ordenes').select('recepcion_fotos').eq('id', ordenId).maybeSingle();
  const fotos = Array.isArray((data as { recepcion_fotos?: unknown } | null)?.recepcion_fotos)
    ? ((data as { recepcion_fotos: FotoRecepcion[] }).recepcion_fotos) : [];
  const archivos = await Promise.all(fotos.map(async (f) => {
    const { data: blob } = await supabase.storage.from(BUCKET_OC).download(f.path);
    return blob ? new File([blob], f.filename || 'foto.jpg', { type: blob.type || 'image/jpeg' }) : null;
  }));
  return { fotos, archivos: archivos.filter((x): x is File => !!x) };
}

/** Las recepciones (de compras) que entraron a un almacén entre dos días. */
export async function listRecepcionesDeAlmacen(almacen: string | null, desde: string, hasta: string): Promise<Recepcion[]> {
  const movs = await listMovimientosRecepcion(desde, hasta);
  const recs = recepcionesDesdeMovimientos(movs as never);
  return almacen ? recs.filter((r) => r.almacen === almacen) : recs;
}

/** Nombre y unidad de los productos por id (para armar el comprobante). */
export async function fichasDeProductos(ids: string[]): Promise<Map<string, { nombre: string; unidad: string | null }>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const { data } = await supabase.from('productos').select('id, nombre, unidad').in('id', unicos);
  return new Map((data ?? []).map((p: { id: string; nombre: string; unidad: string | null }) => [p.id, { nombre: p.nombre, unidad: p.unidad }]));
}

/**
 * Avisa al almacenista del almacén donde el delivery dejó la orden: «tienes una
 * recepción pendiente». Va a cada usuario cuyo correo recibe en ese almacén.
 */
export async function avisarRecepcionPendiente(correos: string[], d: { codigo: string; repartidor: string; almacen: string }): Promise<void> {
  if (!correos.length) return;
  const { data } = await supabase.from('usuarios').select('id, email').in('email', correos);
  await Promise.all((data ?? []).map((u: { id: string }) => supabase.from('notificaciones').insert({
    destino: u.id, kind: 'info',
    title: `📥 Recepción pendiente · ${d.codigo}`,
    message: `${d.repartidor} la entregó en ${d.almacen}. Recepciónala en el teléfono de Inventario (📥 Recepciones).`,
    link: '#/app/inventario/telefono',
  })));
}
