/* ============================================================
   Golden Touch · Adjuntos (facturas) de Compra/Servicio Directo y de OC
   Permite VARIAS facturas (PDF o imagen) por compra/servicio.
   Tabla `adjuntos_directos` (modulo + ref_id) + Storage en el
   bucket de cada módulo. Acepta PDF e imágenes; se previsualizan.

   Con P03 (p03Disponible):
   · 'orden_factura' = las facturas del proveedor de una OC (bucket
     compras-oc, ruta <orden>/facturas/…); 'orden' sigue siendo los
     adjuntos generales de la OC (nunca son factura).
   · es_factura: true = factura del proveedor; false = otro papel (pago,
     solicitud…); null = cargado antes de P03 (en compra y servicio cuenta
     como factura).
   · Un archivo registrado como factura en Retenciones no se cambia ni se
     borra (RET_ADJUNTO_REGISTRADO); de los demás cambian el nombre, el tipo
     y si es factura.
   Sin P03, todo queda como hoy (no se manda es_factura).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { p03Disponible } from '@/modules/libroFiscal/disponibilidad';

export type ModuloDirecto = 'compra' | 'servicio' | 'orden' | 'orden_factura';

const BUCKET: Record<ModuloDirecto, string> = {
  compra: 'compras-directas',
  servicio: 'servicios-directos',
  // Solicitudes/órdenes (SP de servicio y compra normal): reusa el bucket de imágenes de OP.
  orden: 'op-imagenes',
  // P03: facturas del proveedor de una OC, junto a los demás papeles de la OC.
  orden_factura: 'compras-oc',
};

export interface AdjuntoDirecto {
  id: string;
  modulo: ModuloDirecto;
  ref_id: string;
  path: string;
  nombre: string | null;
  content_type: string | null;
  created_at: string;
  created_by: string | null;
  /** P03: true = factura del proveedor; false = otro papel; null = cargado antes de P03. */
  es_factura?: boolean | null;
}

/** ¿Cuenta como factura del proveedor? (true, o null en compra y servicio: lo cargado antes de P03). */
export function cuentaComoFactura(a: Pick<AdjuntoDirecto, 'modulo' | 'es_factura'>): boolean {
  if (a.modulo === 'orden') return false;
  if (a.modulo === 'orden_factura') return true;
  return a.es_factura !== false;
}

/** La ruta del archivo: las facturas de OC van bajo /facturas/ (la base lo exige). */
export function rutaAdjunto(modulo: ModuloDirecto, refId: string, nombre: string, stamp: string): string {
  const safe = nombre.replace(/[^\w.-]+/g, '_');
  return modulo === 'orden_factura' ? `${refId}/facturas/${stamp}-${safe}` : `${refId}/${stamp}-${safe}`;
}

/** Texto de pantalla para los rechazos de P03 sobre un adjunto; null si no es uno de ellos. */
export function textoErrorAdjunto(e: { message?: string } | null | undefined): string | null {
  const m = String(e?.message ?? '');
  if (/RET_ADJUNTO_REGISTRADO/.test(m)) return 'Esta factura ya está registrada en Retenciones: no se cambia ni se elimina.';
  if (/RET_ADJUNTO_CAMPO/.test(m)) return 'De un archivo solo se cambian el nombre, el tipo y si es factura.';
  if (/adjuntos_directos_es_factura/.test(m)) return 'Ese archivo no puede marcarse así: los adjuntos generales de la OC no son facturas.';
  return null;
}

/** Facturas de una compra/servicio (más recientes primero). */
export async function listAdjuntosDirectos(modulo: ModuloDirecto, refId: string): Promise<AdjuntoDirecto[]> {
  if (!refId) return [];
  const { data, error } = await supabase
    .from('adjuntos_directos')
    .select('*')
    .eq('modulo', modulo)
    .eq('ref_id', refId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdjuntoDirecto[];
}

/** P03: de estos adjuntos, cuáles ya están registrados como factura en Retenciones. */
export async function adjuntosRegistrados(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from('origen_facturas_adjuntos_estado').select('adjunto_id').in('adjunto_id', ids).eq('registrado', true);
  if (error) throw error;
  return new Set((data ?? []).map((r) => String((r as { adjunto_id: string }).adjunto_id)));
}

/**
 * Sube un archivo (PDF/imagen) y lo registra. Con P03, `esFactura` dice si es
 * factura del proveedor (orden_factura siempre lo es). Si el registro no
 * queda, se borra el archivo subido.
 */
export async function agregarAdjuntoDirecto(
  modulo: ModuloDirecto, refId: string, file: File, actor?: string | null, esFactura?: boolean,
): Promise<AdjuntoDirecto> {
  if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/'))
    throw new Error('El adjunto debe ser un PDF o una imagen.');
  const conP03 = modulo === 'orden_factura' || (esFactura !== undefined && modulo !== 'orden' && await p03Disponible());
  // Prefijo único por archivo para no pisar otras facturas de la misma compra.
  const stamp = `${Math.floor(performance.now()).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const path = rutaAdjunto(modulo, refId, file.name, stamp);
  const bucket = BUCKET[modulo];
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false, contentType: file.type || 'application/pdf',
  });
  if (upErr) throw upErr;
  const fila: Record<string, unknown> = { modulo, ref_id: refId, path, nombre: file.name, content_type: file.type || null, created_by: actor ?? null };
  if (conP03) fila.es_factura = modulo === 'orden_factura' ? true : !!esFactura;
  const { data, error } = await supabase.from('adjuntos_directos').insert(fila).select('*').single();
  if (error || !data) {
    await supabase.storage.from(bucket).remove([path]).catch(() => { /* queda suelto; se limpia después */ });
    if (error) throw new Error(textoErrorAdjunto(error) ?? error.message);
    throw new Error(`No se guardó «${file.name}»: sin permiso.`);
  }
  return data as AdjuntoDirecto;
}

/** P03: cambia el nombre o si es factura (solo si no está registrado en Retenciones). */
export async function editarAdjuntoDirecto(id: string, cambios: { nombre?: string; esFactura?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) {
    if (!cambios.nombre.trim()) throw new Error('El nombre no puede quedar vacío.');
    patch.nombre = cambios.nombre.trim();
  }
  if (cambios.esFactura !== undefined) patch.es_factura = cambios.esFactura;
  const { data, error } = await supabase.from('adjuntos_directos').update(patch).eq('id', id).select('id');
  if (error) throw new Error(textoErrorAdjunto(error) ?? error.message);
  if (!data?.length) throw new Error('No se guardó el cambio: sin permiso, o el archivo ya no existe.');
}

/**
 * Elimina una factura: primero su registro y después el archivo. Si la base no
 * deja borrar el registro (p. ej., la factura ya está registrada en
 * Retenciones), el archivo queda intacto. Si falla borrar el archivo, queda un
 * archivo sin registro: es preferible a perder el de una factura registrada.
 */
export async function eliminarAdjuntoDirecto(adjunto: AdjuntoDirecto): Promise<void> {
  const { data, error } = await supabase.from('adjuntos_directos').delete().eq('id', adjunto.id).select('id');
  if (error) {
    if (/RET_ADJUNTO_REGISTRADO/.test(error.message ?? '')) throw new Error('No se puede eliminar: esta factura ya está registrada en Retenciones.');
    throw error;
  }
  if (!data?.length) throw new Error('No se eliminó la factura: sin permiso, o ya no existe.');
  await supabase.storage.from(BUCKET[adjunto.modulo]).remove([adjunto.path]).catch(() => { /* el registro ya no está; el archivo suelto se limpia después */ });
}

/** URL firmada (10 min) para previsualizar/descargar la factura. */
export async function urlAdjuntoDirecto(modulo: ModuloDirecto, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET[modulo]).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
