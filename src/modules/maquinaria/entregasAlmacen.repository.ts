/* ============================================================
   Entregas del almacén para mantenimiento · acceso a datos (12-11-2026).
   Traído de Golden Touch y adaptado a MGG. Todo cambio pasa por RPC (la
   base valida quién puede qué y pone quién lo hizo):
     entrega_mantenimiento_crear        → almacenista (teléfono) / quien ejecuta la salida (PC)
     entrega_mantenimiento_registrar    → Maquinaria: queda en la bitácora
     entrega_mantenimiento_rechazar     → Maquinaria: vuelve al almacén como devolución
     entrega_mantenimiento_dar_entrada  → almacenista: entra al inventario
     entrega_mantenimiento_fotos_salida → las fotos de la salida, al día
   Mientras supabase/sql/maquinaria-entregas-almacen-2026-11-12.sql no esté
   aplicada, las lecturas devuelven vacío y `entregasDisponibles()` dice false:
   las pantallas muestran un aviso en vez de romperse.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import type { EntregaAlmacen, FotoArchivo } from './entregasAlmacen';

const TABLA = 'maquinaria_entregas_almacen';
/** Las fotos del mantenimiento van al bucket de fotos de Maquinaria, carpeta bitacora/. */
export const BUCKET_FOTOS_BITACORA = 'maquinaria-os-fotos';
export const MAX_FOTOS_MANTENIMIENTO = 8;

type ErrorPg = { code?: string; message?: string; details?: string } | null;

export function faltaMigracion(e: ErrorPg): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883' || e.code === 'PGRST204'
    || e.code === '42703'
    || /does not exist|could not find|schema cache/i.test(`${e.message ?? ''} ${e.details ?? ''}`);
}

export const MSG_FALTA_MIGRACION =
  'Falta aplicar en Supabase supabase/sql/maquinaria-entregas-almacen-2026-11-12.sql (entregas del almacén a Maquinaria).';

function aEntrega(r: Record<string, unknown>): EntregaAlmacen {
  return {
    ...(r as unknown as EntregaAlmacen),
    items: Array.isArray(r.items) ? (r.items as EntregaAlmacen['items']).map((i) => ({ ...i, cantidad: Number(i.cantidad) || 0 })) : [],
    fotos: Array.isArray(r.fotos) ? (r.fotos as FotoArchivo[]) : [],
    salida_ids: Array.isArray(r.salida_ids) ? (r.salida_ids as string[]) : [],
  };
}

function errorLegible(e: ErrorPg, porDefecto: string): Error {
  if (faltaMigracion(e)) return new Error(MSG_FALTA_MIGRACION);
  const m = String(e?.message ?? '').trim();
  if (/permission denied|row-level security/i.test(m)) return new Error('No tienes permiso para esta acción.');
  return new Error(m || porDefecto);
}

async function rpc<T>(nombre: string, args: Record<string, unknown>, porDefecto: string): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) {
    if (faltaMigracion(error)) marcarDisponible(false);
    throw errorLegible(error, porDefecto);
  }
  return data as T;
}

/* ─────────── ¿Está aplicada la migración? ─────────── */

let disponible: { valor: boolean; en: number } | null = null;
let consultando: Promise<boolean> | null = null;
const VIGENCIA_MS = 5 * 60 * 1000;

function marcarDisponible(v: boolean) { disponible = { valor: v, en: Date.now() }; }

/**
 * true si la tabla de entregas existe. Se pregunta una vez cada 5 minutos: si la
 * migración se aplica con la app abierta, al rato aparece sola.
 */
export function entregasDisponibles(): Promise<boolean> {
  if (disponible && Date.now() - disponible.en < VIGENCIA_MS) return Promise.resolve(disponible.valor);
  if (consultando) return consultando;
  consultando = (async () => {
    const { error } = await supabase.from(TABLA).select('id').limit(1);
    // Otro error (red, permiso) no dice que falte la tabla: se da por disponible y la RPC dirá lo suyo.
    const v = !faltaMigracion(error);
    marcarDisponible(v);
    return v;
  })().finally(() => { consultando = null; });
  return consultando;
}

/* ─────────── Crear (almacén) ─────────── */

export async function crearEntregaTelefono(input: {
  salidaIds: string[]; equipoId: string; nota?: string | null; tipoSugerido?: string | null;
}): Promise<EntregaAlmacen> {
  const r = await rpc<Record<string, unknown>>('entrega_mantenimiento_crear', {
    p: {
      origen: 'telefono', salida_ids: input.salidaIds, equipo_id: input.equipoId,
      nota: input.nota ?? null, tipo_sugerido: input.tipoSugerido ?? null,
    },
  }, 'No se pudo avisar a Maquinaria.');
  return aEntrega(r);
}

export async function crearEntregaPc(input: { solicitudSalidaId: string }): Promise<EntregaAlmacen> {
  const r = await rpc<Record<string, unknown>>('entrega_mantenimiento_crear', {
    p: { origen: 'pc', solicitud_salida_id: input.solicitudSalidaId },
  }, 'No se pudo avisar a Maquinaria.');
  return aEntrega(r);
}

/* ─────────── Listas ─────────── */

async function filas(consulta: PromiseLike<{ data: unknown; error: ErrorPg }>): Promise<EntregaAlmacen[]> {
  const { data, error } = await consulta;
  if (error) {
    if (faltaMigracion(error)) { marcarDisponible(false); return []; }
    throw errorLegible(error, 'No se pudieron leer las entregas del almacén.');
  }
  return ((data ?? []) as Record<string, unknown>[]).map(aEntrega);
}

/** Pendientes de registrar en Maquinaria (más viejas primero: se atienden en orden). */
export function listEntregasPendientes(): Promise<EntregaAlmacen[]> {
  return filas(supabase.from(TABLA).select('*').eq('estado', 'pendiente').order('created_at', { ascending: true }));
}

/** Una entrega por id (para el detalle de un registro de la bitácora). */
export async function getEntrega(id: string): Promise<EntregaAlmacen | null> {
  const xs = await filas(supabase.from(TABLA).select('*').eq('id', id).limit(1));
  return xs[0] ?? null;
}

/** La entrega de una solicitud de salida de la PC (para no ofrecer reenviarla). */
export async function entregaDeSolicitud(solicitudId: string): Promise<EntregaAlmacen | null> {
  const xs = await filas(supabase.from(TABLA).select('*').eq('solicitud_salida_id', solicitudId).limit(1));
  return xs[0] ?? null;
}

/** Devoluciones (rechazadas por Maquinaria) que el almacén todavía no recibió. */
export function listDevolucionesPendientes(origen?: 'telefono' | 'pc'): Promise<EntregaAlmacen[]> {
  let q = supabase.from(TABLA).select('*').eq('estado', 'rechazada').eq('devolucion_estado', 'pendiente')
    .order('atendida_en', { ascending: true });
  if (origen) q = q.eq('origen', origen);
  return filas(q);
}

/* ─────────── Maquinaria: registrar / rechazar ─────────── */

export interface DatosRegistroEntrega {
  equipoId?: string | null;
  fecha: string;
  tipos: string[];
  horometro: number | null;
  kilometraje: number | null;
  aceiteLts: number | null;
  refrigeranteLts: number | null;
  trabajo: string | null;
  mecanico: string | null;
  ubicacion: string | null;
  observacion: string | null;
  fotos: FotoArchivo[];
}

export async function registrarEntrega(id: string, d: DatosRegistroEntrega): Promise<EntregaAlmacen> {
  const r = await rpc<Record<string, unknown>>('entrega_mantenimiento_registrar', {
    p_id: id,
    p: {
      equipo_id: d.equipoId ?? null, fecha: d.fecha, tipos: d.tipos,
      horometro: d.horometro, kilometraje: d.kilometraje, aceite_lts: d.aceiteLts, refrigerante_lts: d.refrigeranteLts,
      trabajo: d.trabajo, mecanico: d.mecanico, ubicacion: d.ubicacion, observacion: d.observacion,
      fotos: d.fotos.map((f) => ({ path: f.path, filename: f.filename })),
    },
  }, 'No se pudo registrar el mantenimiento.');
  return aEntrega(r);
}

export async function rechazarEntrega(id: string, motivo: string): Promise<EntregaAlmacen> {
  const r = await rpc<Record<string, unknown>>('entrega_mantenimiento_rechazar', { p_id: id, p_motivo: motivo }, 'No se pudo rechazar la entrega.');
  return aEntrega(r);
}

/* ─────────── Almacén: recibir la devolución ─────────── */

export async function darEntradaDevolucion(id: string, nota: string | null): Promise<EntregaAlmacen> {
  const r = await rpc<Record<string, unknown>>('entrega_mantenimiento_dar_entrada', { p_id: id, p_nota: nota }, 'No se pudo dar entrada.');
  return aEntrega(r);
}

/* ─────────── Fotos ─────────── */

const seguro = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

/** Sube las fotos del mantenimiento (achicadas). Devuelve [{path, filename}] para guardar en la bitácora. */
export async function subirFotosMantenimiento(equipoId: string, archivos: File[]): Promise<FotoArchivo[]> {
  const carpeta = `bitacora/${equipoId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const out: FotoArchivo[] = [];
  for (const [i, original] of archivos.slice(0, MAX_FOTOS_MANTENIMIENTO).entries()) {
    const f = await comprimirImagen(original).catch(() => original);
    const path = `${carpeta}/${i + 1}-${seguro(f.name || 'foto.jpg')}`;
    const { error } = await supabase.storage.from(BUCKET_FOTOS_BITACORA).upload(path, f, { upsert: false, contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir la foto «${original.name}»: ${error.message}`);
    out.push({ path, filename: original.name || `foto-${i + 1}.jpg` });
  }
  return out;
}

/** Las fotos de la salida de una entrega, al día (el teléfono deja sumar fotos después). */
export async function fotosSalidaDeEntrega(e: Pick<EntregaAlmacen, 'id' | 'fotos'>): Promise<FotoArchivo[]> {
  const { data, error } = await supabase.rpc('entrega_mantenimiento_fotos_salida', { p_id: e.id });
  if (error || !Array.isArray(data)) return e.fotos;
  return data as FotoArchivo[];
}

/** URL firmadas (30 min) de un grupo de fotos. Cada foto dice su bucket; sin bucket, el de la bitácora. */
export async function urlsFotos(fotos: FotoArchivo[]): Promise<Record<string, string>> {
  const porBucket = new Map<string, string[]>();
  for (const f of fotos) {
    const b = f.bucket || BUCKET_FOTOS_BITACORA;
    porBucket.set(b, [...(porBucket.get(b) ?? []), f.path]);
  }
  const out: Record<string, string> = {};
  await Promise.all([...porBucket.entries()].map(async ([bucket, paths]) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 30);
    if (error) return;
    (data ?? []).forEach((d, i) => { if (d.signedUrl) out[paths[i]] = d.signedUrl; });
  }));
  return out;
}
