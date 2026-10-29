/* ============================================================
   MGG · Retenciones · Facturas externas y compras fuera de oficina (29-10-2026)

   Permite recibir facturas de compras registradas fuera de oficina
   (desde el celular), asociadas a cualquier empresa del grupo (MGG, Golden,
   MineriaTs / MTO, etc.), con validación estricta de adjuntos:
   - Máximo 4 imágenes
   - 1 o 2 archivos PDF
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { normalizarRif, rifValido } from '@/shared/lib/rif';

export const TABLE_FACTURAS_EXTERNAS = 'retencion_facturas_externas';
const BUCKET = 'compras-oc';

export const MAX_IMAGENES_FACTURA = 4;
export const MAX_PDFS_FACTURA = 2;

export type TipoDocumentoFactura = 'factura' | 'nota_debito' | 'nota_credito';
export type MonedaFactura = 'USD' | 'Bs';
export type EstadoFacturaExterna = 'recibida' | 'en_revision' | 'procesada' | 'retenida' | 'rechazada' | 'anulada';

export interface ArchivoFactura {
  id: string;
  nombre: string;
  path: string;
  tipo: 'imagen' | 'pdf';
  size: number;
  mimeType?: string;
}

export interface FacturaExterna {
  id: string;
  empresa: string;
  proveedorNombre: string;
  proveedorRif: string;
  numeroFactura: string;
  numeroControl: string | null;
  fechaFactura: string;
  tipoDocumento: TipoDocumentoFactura;
  moneda: MonedaFactura;
  tasaCambio: number | null;
  montoTotal: number;
  baseImponible: number;
  ivaMonto: number | null;
  observacion: string | null;
  estado: EstadoFacturaExterna;
  archivos: ArchivoFactura[];
  actor: string | null;
  actorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NuevaFacturaExternaInput {
  empresa: string;
  proveedorNombre: string;
  proveedorRif: string;
  numeroFactura: string;
  numeroControl?: string | null;
  fechaFactura: string;
  tipoDocumento?: TipoDocumentoFactura;
  moneda?: MonedaFactura;
  tasaCambio?: number | null;
  montoTotal: number;
  baseImponible?: number;
  ivaMonto?: number | null;
  observacion?: string | null;
  actor?: string | null;
  actorName?: string | null;
}

export interface FiltrosFacturasExternas {
  empresa?: string;
  estado?: EstadoFacturaExterna | 'todas';
  desde?: string;
  hasta?: string;
  texto?: string;
}

export function validarArchivosFactura(archivos: File[]): { imagenes: File[]; pdfs: File[] } {
  const imagenes: File[] = [];
  const pdfs: File[] = [];

  for (const f of archivos) {
    const esPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    const esImg = f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|bmp)$/i.test(f.name);

    if (esPdf) {
      pdfs.push(f);
    } else if (esImg) {
      imagenes.push(f);
    } else {
      throw new Error(`El archivo «${f.name}» no es compatible. Solo se permiten imágenes (JPG, PNG, WebP) o PDF.`);
    }
  }

  if (imagenes.length > MAX_IMAGENES_FACTURA) {
    throw new Error(`Se permiten como máximo ${MAX_IMAGENES_FACTURA} fotos por factura (cargaste ${imagenes.length}).`);
  }

  if (pdfs.length > MAX_PDFS_FACTURA) {
    throw new Error(`Se permiten como máximo ${MAX_PDFS_FACTURA} archivos PDF por factura (cargaste ${pdfs.length}).`);
  }

  return { imagenes, pdfs };
}

function aFacturaExterna(r: Record<string, unknown>): FacturaExterna {
  const rawArchivos = Array.isArray(r.archivos) ? r.archivos : [];
  const archivos: ArchivoFactura[] = rawArchivos.map((a: unknown) => {
    const item = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    return {
      id: String(item.id || ''),
      nombre: String(item.nombre || 'archivo'),
      path: String(item.path || ''),
      tipo: item.tipo === 'pdf' ? 'pdf' : 'imagen',
      size: Number(item.size) || 0,
      mimeType: item.mimeType ? String(item.mimeType) : undefined,
    };
  });

  return {
    id: String(r.id),
    empresa: String(r.empresa || 'MGG').toUpperCase(),
    proveedorNombre: String(r.proveedor_nombre || ''),
    proveedorRif: String(r.proveedor_rif || ''),
    numeroFactura: String(r.numero_factura || ''),
    numeroControl: r.numero_control ? String(r.numero_control) : null,
    fechaFactura: String(r.fecha_factura || ''),
    tipoDocumento: (r.tipo_documento as TipoDocumentoFactura) || 'factura',
    moneda: (r.moneda as MonedaFactura) || 'USD',
    tasaCambio: r.tasa_cambio != null ? Number(r.tasa_cambio) : null,
    montoTotal: Number(r.monto_total) || 0,
    baseImponible: Number(r.base_imponible) || 0,
    ivaMonto: r.iva_monto != null ? Number(r.iva_monto) : null,
    observacion: r.observacion ? String(r.observacion) : null,
    estado: (r.estado as EstadoFacturaExterna) || 'recibida',
    archivos,
    actor: r.actor ? String(r.actor) : null,
    actorName: r.actor_name ? String(r.actor_name) : null,
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
  };
}

export async function listFacturasExternas(filtros?: FiltrosFacturasExternas): Promise<FacturaExterna[]> {
  let query = supabase.from(TABLE_FACTURAS_EXTERNAS).select('*').order('created_at', { ascending: false });

  if (filtros?.empresa && filtros.empresa !== 'todas') {
    query = query.eq('empresa', filtros.empresa.toUpperCase());
  }
  if (filtros?.estado && filtros.estado !== 'todas') {
    query = query.eq('estado', filtros.estado);
  }
  if (filtros?.desde) {
    query = query.gte('fecha_factura', filtros.desde);
  }
  if (filtros?.hasta) {
    query = query.lte('fecha_factura', filtros.hasta);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01' || /does not exist|schema cache/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message || 'Error al consultar facturas externas.');
  }

  let list = ((data ?? []) as Record<string, unknown>[]).map(aFacturaExterna);

  if (filtros?.texto?.trim()) {
    const q = filtros.texto.trim().toLowerCase();
    list = list.filter((f) =>
      f.numeroFactura.toLowerCase().includes(q) ||
      (f.numeroControl && f.numeroControl.toLowerCase().includes(q)) ||
      f.proveedorNombre.toLowerCase().includes(q) ||
      f.proveedorRif.toLowerCase().includes(q) ||
      f.empresa.toLowerCase().includes(q)
    );
  }

  return list;
}

export async function crearFacturaExterna(
  input: NuevaFacturaExternaInput,
  archivos: File[]
): Promise<FacturaExterna> {
  const proveedorNombre = input.proveedorNombre.trim();
  if (proveedorNombre.length < 2) throw new Error('Escribe la razón social o nombre del proveedor.');

  const rifNorm = normalizarRif(input.proveedorRif);
  if (!rifNorm || !rifValido(rifNorm)) throw new Error('El RIF del proveedor no es válido (ej. J-12345678-0).');

  const numeroFactura = input.numeroFactura.trim();
  if (!numeroFactura) throw new Error('Indica el número de la factura.');

  if (!input.fechaFactura) throw new Error('Indica la fecha de la factura.');

  const montoTotal = Number(input.montoTotal);
  if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
    throw new Error('El monto de la factura debe ser mayor a 0.');
  }

  const { imagenes, pdfs } = validarArchivosFactura(archivos);
  const todosArchivos = [...imagenes, ...pdfs];

  const idTemp = crypto.randomUUID();
  const subidos: ArchivoFactura[] = [];

  try {
    for (let i = 0; i < todosArchivos.length; i++) {
      const file = todosArchivos[i];
      const safeName = file.name.replace(/[^\w.-]+/g, '_');
      const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const tipo = esPdf ? 'pdf' : 'imagen';
      const path = `facturas_externas/${idTemp}/${Date.now()}_${i}_${safeName}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type || (esPdf ? 'application/pdf' : 'image/jpeg'),
      });

      if (upErr) {
        throw new Error(`Error al subir ${file.name}: ${upErr.message}`);
      }

      subidos.push({
        id: crypto.randomUUID(),
        nombre: file.name,
        path,
        tipo,
        size: file.size,
        mimeType: file.type || undefined,
      });
    }

    const payload = {
      id: idTemp,
      empresa: (input.empresa || 'MGG').toUpperCase().trim(),
      proveedor_nombre: proveedorNombre,
      proveedor_rif: rifNorm,
      numero_factura: numeroFactura,
      numero_control: input.numeroControl?.trim() || null,
      fecha_factura: input.fechaFactura,
      tipo_documento: input.tipoDocumento || 'factura',
      moneda: input.moneda || 'USD',
      tasa_cambio: input.tasaCambio != null ? Number(input.tasaCambio) : null,
      monto_total: montoTotal,
      base_imponible: Number(input.baseImponible) || montoTotal,
      iva_monto: input.ivaMonto != null ? Number(input.ivaMonto) : null,
      observacion: input.observacion?.trim() || null,
      estado: 'recibida' as EstadoFacturaExterna,
      archivos: subidos,
      actor: input.actor || null,
      actor_name: input.actorName || null,
    };

    const { data, error } = await supabase.from(TABLE_FACTURAS_EXTERNAS).insert(payload).select('*').single();
    if (error) {
      // Limpiar adjuntos si falla inserción
      if (subidos.length) {
        await supabase.storage.from(BUCKET).remove(subidos.map((s) => s.path)).catch(() => {});
      }
      throw new Error(error.message || 'No se pudo guardar la factura.');
    }

    return aFacturaExterna(data as Record<string, unknown>);
  } catch (err) {
    if (subidos.length) {
      await supabase.storage.from(BUCKET).remove(subidos.map((s) => s.path)).catch(() => {});
    }
    throw err;
  }
}

export async function eliminarFacturaExterna(id: string): Promise<void> {
  const { data: existente } = await supabase
    .from(TABLE_FACTURAS_EXTERNAS)
    .select('archivos')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from(TABLE_FACTURAS_EXTERNAS).delete().eq('id', id);
  if (error) throw new Error(error.message || 'No se pudo eliminar la factura.');

  const rawArchivos = Array.isArray(existente?.archivos) ? existente.archivos : [];
  const paths = rawArchivos.map((a: { path?: string }) => a?.path).filter(Boolean) as string[];
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
  }
}

export async function actualizarEstadoFacturaExterna(
  id: string,
  nuevoEstado: EstadoFacturaExterna,
  observacion?: string
): Promise<void> {
  const patch: Record<string, unknown> = { estado: nuevoEstado };
  if (observacion !== undefined) patch.observacion = observacion.trim() || null;

  const { error } = await supabase.from(TABLE_FACTURAS_EXTERNAS).update(patch).eq('id', id);
  if (error) throw new Error(error.message || 'No se pudo actualizar el estado de la factura.');
}

export async function actualizarEmpresaFacturaExterna(id: string, nuevaEmpresa: string): Promise<void> {
  const emp = nuevaEmpresa.trim().toUpperCase();
  if (!emp) throw new Error('Indica la empresa a asignar.');

  const { error } = await supabase.from(TABLE_FACTURAS_EXTERNAS).update({ empresa: emp }).eq('id', id);
  if (error) throw new Error(error.message || 'No se pudo reasignar la empresa de la factura.');
}

export async function urlArchivoFactura(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 15);
  if (error) throw new Error(error.message || 'No se pudo generar el enlace de descarga.');
  return data.signedUrl;
}
