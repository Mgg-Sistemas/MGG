/* ============================================================
   MGG · Facturas de una compra: DELIVERY y ALMACÉN (11-11-2026)

   Pedido de la administradora:
     · El delivery tiene el botón «🧾 CARGAR FACTURA» (opcional): son las
       `fotos_recibo` de su pedido (bucket delivery-fotos).
     · El almacenista, al recepcionar la orden (PC y teléfono), DEBE cargar la
       factura: van al bucket compras-oc y se anotan en `ordenes.facturas_almacen`.
     · En Compras, el botón «🧾 Factura» de la OC recibida muestra las dos:
       FACTURAS DELIVERY y FACTURAS ALMACÉN, con vista previa, descarga e impresión.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import type { Orden } from '@/shared/lib/types';

const BUCKET_OC = 'compras-oc';
const BUCKET_DELIVERY = 'delivery-fotos';
export const MAX_FACTURAS_ALMACEN = 6;

export interface FacturaAlmacen { path: string; filename: string; at?: string | null; por?: string | null }

export interface ArchivoFactura {
  path: string;
  filename: string;
  url: string;
  esPdf: boolean;
  /** Quién la subió y cuándo (si se sabe). */
  detalle?: string | null;
}

export interface FacturasDeOrden {
  delivery: ArchivoFactura[];
  almacen: ArchivoFactura[];
  /** La factura que se adjuntó al finalizar la OC (si hay). */
  alFinalizar: ArchivoFactura | null;
}

const seguro = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
const esPdf = (nombre: string, tipo?: string) => tipo === 'application/pdf' || /\.pdf$/i.test(nombre);

/** ¿El archivo sirve como factura? (imagen o PDF, hasta 10 MB). Devuelve el error o null. */
export function errorArchivoFactura(f: File): string | null {
  const tipoOk = /^image\//.test(f.type) || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name);
  if (!tipoOk) return `«${f.name}» no es una foto ni un PDF.`;
  if (f.size > 10 * 1024 * 1024) return `«${f.name}» pesa más de 10 MB.`;
  return null;
}

/**
 * Sube las facturas del almacén (fotos comprimidas o PDF) y las anota en la orden.
 * Se llama ANTES de recibir: si la subida falla, no se recibe.
 */
export async function subirFacturasAlmacen(ordenId: string, archivos: File[], actor: string): Promise<FacturaAlmacen[]> {
  if (!archivos.length) throw new Error('Carga la factura de la compra.');
  for (const f of archivos) { const e = errorArchivoFactura(f); if (e) throw new Error(e); }
  const { data: actual, error: e0 } = await supabase.from('ordenes').select('facturas_almacen').eq('id', ordenId).maybeSingle();
  if (e0) throw e0;
  const previas = Array.isArray(actual?.facturas_almacen) ? (actual.facturas_almacen as FacturaAlmacen[]) : [];
  if (previas.length + archivos.length > MAX_FACTURAS_ALMACEN) throw new Error(`Se pueden cargar hasta ${MAX_FACTURAS_ALMACEN} archivos de factura.`);
  const ahora = new Date().toISOString();
  const nuevas = await Promise.all(archivos.map(async (original) => {
    const f = esPdf(original.name, original.type) ? original : await comprimirImagen(original).catch(() => original);
    const path = `${ordenId}/factura-almacen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro(f.name)}`;
    const { error } = await supabase.storage.from(BUCKET_OC).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir «${original.name}»: ${error.message}`);
    return { path, filename: original.name, at: ahora, por: actor };
  }));
  const todas = [...previas, ...nuevas];
  const { error } = await supabase.from('ordenes').update({ facturas_almacen: todas }).eq('id', ordenId);
  if (error) throw new Error(`La factura subió, pero no se anotó en la orden: ${error.message}`);
  return todas;
}

async function firmar(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 30);
  if (error) return '';
  return data.signedUrl;
}

/** Las facturas de una orden: las que subió el delivery y las del almacén. */
/** Cuántos archivos de factura tiene la orden (delivery + almacén), para el botón. */
export function cantidadFacturas(o: Pick<Orden, 'facturas_almacen' | 'facturas_delivery'>): number {
  const alm = Array.isArray(o.facturas_almacen) ? o.facturas_almacen.length : 0;
  const dlv = Array.isArray(o.facturas_delivery) ? o.facturas_delivery.filter((f) => f.tipo === 'factura').length : 0;
  return alm + dlv;
}

export async function facturasDeOrden(o: Pick<Orden, 'id' | 'facturas_almacen' | 'facturas_delivery' | 'factura_path' | 'factura_nombre'>): Promise<FacturasDeOrden> {
  // Las fotos del delivery vienen copiadas en la orden (trigger, 12-11-2026). Si la
  // orden en pantalla es de antes de la copia, se leen de la base.
  let copia = Array.isArray(o.facturas_delivery) ? o.facturas_delivery : null;
  if (!copia) {
    const { data } = await supabase.from('ordenes').select('facturas_delivery').eq('id', o.id).maybeSingle();
    copia = Array.isArray(data?.facturas_delivery) ? (data.facturas_delivery as NonNullable<Orden['facturas_delivery']>) : [];
  }
  // A Compras solo le llega la FACTURA del delivery (12-11-2026); la foto del producto se queda en Delivery.
  const firmarDelivery = (tipo: 'factura') => Promise.all(copia!.filter((f) => f.tipo === tipo).map(async (f) => ({
    path: f.path, filename: f.filename || 'foto.jpg', url: await firmar(BUCKET_DELIVERY, f.path),
    esPdf: esPdf(f.filename || ''), detalle: f.quien ? `Delivery: ${f.quien}` : null,
  })));
  const almacen = Array.isArray(o.facturas_almacen) ? o.facturas_almacen : [];
  const [delivery, alm, fin] = await Promise.all([
    firmarDelivery('factura'),
    Promise.all(almacen.map(async (f) => ({
      path: f.path, filename: f.filename || 'factura', url: await firmar(BUCKET_OC, f.path),
      esPdf: esPdf(f.filename || f.path), detalle: f.por ? `Almacén: ${f.por}` : null,
    }))),
    o.factura_path
      ? firmar(BUCKET_OC, o.factura_path).then((url) => ({
        path: o.factura_path as string, filename: o.factura_nombre || 'factura', url,
        esPdf: esPdf(o.factura_nombre || o.factura_path || ''), detalle: 'Cargada al finalizar la OC',
      }))
      : Promise.resolve(null),
  ]);
  return {
    delivery: delivery.filter((f) => f.url),
    almacen: alm.filter((f) => f.url), alFinalizar: fin && fin.url ? fin : null,
  };
}
