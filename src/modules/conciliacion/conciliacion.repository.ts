/* ============================================================
   MGG · Conciliación · lectura de datos (12-11-2026)
   LEE: OC (Compras), proveedores, tasas BCV del día de pago
   (Tesorería) y comprobantes de retención (libro fiscal).
   ESCRIBE solo la referencia / comprobante de pago que se coloca en
   Conciliación (evento del historial de la OC; 12-11-2026).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import type { Orden } from '@/shared/lib/types';
import { diaVE, getTasaHoy, getTasasUsdDeFechas } from '@/modules/tesoreria/tasas.repository';
import { listRetenciones } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { cantidadFacturas, resolverOrigenFacturas } from '@/modules/pedidos/facturasOrden.repository';
import { origenFactura } from '@/modules/pedidos/facturaCompras';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import {
  EVENTO_REF_CONCILIACION, armarFila, comprobanteDePago, datosConciliacion, ordenesConciliables, referenciaDePago,
  type FilaConciliacion, type RetencionFiscalOc,
} from './conciliacion';

export interface DatosConciliacion {
  filas: FilaConciliacion[];
  ordenes: Map<string, Orden>;
  tasaHoy: number | null;
  /** false si el libro fiscal no se pudo leer (permisos): los N° de retención no salen. */
  conLibroFiscal: boolean;
  /** OC viejas cuya factura de Compras solo se sabe mirando el storage (se resuelven después). */
  porResolver: string[];
}

async function nombresProveedores(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  for (let i = 0; i < unicos.length; i += 300) {
    const { data, error } = await supabase.from('proveedores').select('id, razon_social').in('id', unicos.slice(i, i + 300));
    if (error) throw error;
    for (const p of (data ?? []) as Array<{ id: string; razon_social: string | null }>) out.set(p.id, p.razon_social ?? '');
  }
  return out;
}

async function retencionesFiscalesPorOrden(): Promise<Map<string, RetencionFiscalOc[]> | null> {
  try {
    const rs = await listRetenciones({ direccion: 'practicada' });
    const out = new Map<string, RetencionFiscalOc[]>();
    for (const r of rs) {
      if (!r.docId || r.anulada) continue;
      const l = out.get(r.docId) ?? [];
      l.push({ tipo: r.tipo, numero: r.numeroComprobante ?? null });
      out.set(r.docId, l);
    }
    return out;
  } catch {
    return null; // sin permiso al libro fiscal: la retención sale igual, sin el N°
  }
}

export async function cargarConciliacion(): Promise<DatosConciliacion> {
  const [ordenesRaw, hoy, fiscales] = await Promise.all([
    // OC (con código) y órdenes de servicio ya en Control de Servicio (sin código de OC).
    todasLasFilas<Orden>((d, h) => supabase.from('ordenes').select('*')
      .or('oc_codigo.not.is.null,and(clase.eq.servicio,oc_creada_en.not.is.null)')
      .order('oc_creada_en', { ascending: false, nullsFirst: false }).order('id').range(d, h)),
    getTasaHoy().catch(() => null),
    retencionesFiscalesPorOrden(),
  ]);
  const ordenes = ordenesConciliables(ordenesRaw);
  const [proveedores, tasas] = await Promise.all([
    nombresProveedores(ordenes.map((o) => o.proveedor_id ?? '')),
    getTasasUsdDeFechas(ordenes.filter((o) => o.pagada_en).map((o) => diaVE(o.pagada_en as string))).catch(() => new Map<string, number>()),
  ]);
  const tasaHoy = hoy?.usd ?? null;
  const filas = ordenes.map((o, i) => armarFila({
    orden: o,
    proveedor: proveedores.get(o.proveedor_id ?? '') ?? '',
    tasaPago: o.pagada_en ? (tasas.get(diaVE(o.pagada_en)) ?? null) : null,
    tasaHoy,
    fiscales: fiscales?.get(o.id) ?? [],
    // Delivery + almacén + la factura que cargó Compras al finalizar (si factura_path es la
    // de Compras y no el comprobante de pago de Tesorería; las dudosas se resuelven después).
    facturas: cantidadFacturas(o),
  }, i + 1));
  const porResolver = ordenes.filter((o) => origenFactura(o) === 'desconocido').map((o) => o.id);
  return { filas, ordenes: new Map(ordenes.map((o) => [o.id, o])), tasaHoy, conLibroFiscal: fiscales != null, porResolver };
}

/** Las OC viejas en las que la factura de Compras SÍ está (mirando la hora de subida en el storage). */
export async function facturasComprasPorResolver(datos: DatosConciliacion): Promise<Set<string>> {
  const ordenes = datos.porResolver.map((id) => datos.ordenes.get(id)).filter((o): o is Orden => !!o);
  const origen = await resolverOrigenFacturas(ordenes);
  return new Set([...origen].filter(([, v]) => v === 'compras').map(([k]) => k));
}

const BUCKET_OC = 'compras-oc';
const MAX_BYTES = 10 * 1024 * 1024;

/** ¿Sirve como comprobante de pago? (PDF o imagen, hasta 10 MB). Devuelve el error o null. */
export function errorComprobantePago(f: { name: string; type?: string; size: number }): string | null {
  const ok = f.type === 'application/pdf' || (f.type ?? '').startsWith('image/') || /\.(pdf|jpe?g|png|webp)$/i.test(f.name);
  if (!ok) return 'El comprobante debe ser PDF o imagen.';
  if (f.size > MAX_BYTES) return 'El comprobante no puede superar 10 MB.';
  return null;
}

/**
 * Guarda la referencia (y, si se carga, el comprobante de pago) de una OC desde Conciliación.
 * Va al historial de la OC como evento «referencia_conciliacion»: lo que cargó Tesorería no se toca.
 * Sin archivo nuevo se conserva el comprobante que ya se había cargado aquí.
 */
export async function guardarReferenciaConciliacion(
  ordenId: string, input: { referencia: string; archivo?: File | null }, actorEmail: string,
): Promise<Orden> {
  const referencia = input.referencia.trim().slice(0, 80);
  let subido: { path: string; nombre: string } | null = null;
  if (input.archivo) {
    const err = errorComprobantePago(input.archivo);
    if (err) throw new Error(err);
    const f = input.archivo.type.startsWith('image/') ? await comprimirImagen(input.archivo).catch(() => input.archivo as File) : input.archivo;
    const seguro = input.archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
    const path = `${ordenId}/conciliacion-pago-${Date.now()}-${seguro}`;
    const { error } = await supabase.storage.from(BUCKET_OC).upload(path, f, { upsert: false, contentType: f.type || 'application/pdf' });
    if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);
    subido = { path, nombre: f.name };
  }
  // Se relee la OC justo antes de anotar (y se escribe solo si nadie la cambió entretanto).
  for (let intento = 0; intento < 3; intento++) {
    const { data: actual, error: e0 } = await supabase.from('ordenes').select('id, historial, updated_at').eq('id', ordenId).maybeSingle();
    if (e0) throw e0;
    if (!actual) throw new Error('La OC ya no existe.');
    const historial = Array.isArray(actual.historial) ? actual.historial : [];
    const previo = datosConciliacion(historial)?.comprobante ?? null;
    const comprobante = subido ?? previo;
    if (!referencia && !comprobante && !datosConciliacion(historial)) throw new Error('Coloca la referencia o carga el comprobante de pago.');
    const evento = {
      at: new Date().toISOString(), evento: EVENTO_REF_CONCILIACION, actor: actorEmail,
      referencia: referencia || null,
      ...(comprobante ? { comprobante_path: comprobante.path, comprobante_nombre: comprobante.nombre } : {}),
    };
    let q = supabase.from('ordenes').update({ historial: [...historial, evento] }).eq('id', ordenId);
    q = actual.updated_at ? q.eq('updated_at', actual.updated_at) : q;
    const { data, error } = await q.select('*').maybeSingle();
    if (error) throw error;
    if (data) return data as Orden;
  }
  throw new Error('La OC se estaba modificando en este momento. Intenta de nuevo.');
}

/** Lo que muestra la fila tras guardar (sin recargar toda la conciliación). */
export function filaConReferencia(fila: FilaConciliacion, o: Orden): FilaConciliacion {
  return { ...fila, referencia: referenciaDePago(o.historial), comprobantePago: comprobanteDePago(o.historial) };
}
