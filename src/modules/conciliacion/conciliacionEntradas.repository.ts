/* ============================================================
   MGG · Conciliación · Repositorio de ENTRADAS DE RETENCIÓN (13-11-2026)

   Guarda los reintegros confirmados de retenciones de órdenes de compra
   y servicio en el historial (`reintegro_retencion`), con subida de
   comprobante al bucket `compras-oc`.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Orden } from '@/shared/lib/types';
import { comprimirImagen } from '@/shared/lib/comprimirImagen';
import { errorComprobantePago, type ResultadoCargaDrive } from './conciliacion.repository';
import { EVENTO_REINTEGRO_RETENCION, EVENTO_DRIVE_ENTRADA, reintegroDeOrden } from './conciliacionEntradas';
import type { DatosDrive } from './conciliacionDrive';

const BUCKET_OC = 'compras-oc';

export interface GuardarReintegroInput {
  fechaReintegro: string; // 'YYYY-MM-DD'
  referencia: string;
  banco?: string | null;
  montoBs: number;
  montoUsd?: number | null;
  archivo?: File | null;
  nota?: string | null;
}

/**
 * Guarda o actualiza el reintegro de una retención en el historial de la OC.
 * Sube el comprobante bancario (PDF o imagen) si se suministra uno nuevo.
 */
export async function guardarReintegroConciliacion(
  ordenId: string,
  input: GuardarReintegroInput,
  actorEmail: string,
): Promise<Orden> {
  const referencia = input.referencia.trim().slice(0, 80);
  const fecha = input.fechaReintegro.trim().slice(0, 10);
  const banco = input.banco?.trim().slice(0, 80) || null;
  const nota = input.nota?.trim().slice(0, 200) || null;
  const montoBs = Math.round((Number(input.montoBs) || 0) * 100) / 100;
  const montoUsd = input.montoUsd != null ? Math.round((Number(input.montoUsd) || 0) * 100) / 100 : null;

  if (!fecha) throw new Error('Ingresa la fecha en que se recibió el reintegro.');
  if (!referencia) throw new Error('Ingresa la referencia bancaria del reintegro.');
  if (montoBs <= 0) throw new Error('El monto del reintegro debe ser mayor a cero.');

  let subido: { path: string; nombre: string } | null = null;
  if (input.archivo) {
    const err = errorComprobantePago(input.archivo);
    if (err) throw new Error(err);
    const f = input.archivo.type.startsWith('image/')
      ? await comprimirImagen(input.archivo).catch(() => input.archivo as File)
      : input.archivo;
    const seguro = input.archivo.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
    const path = `${ordenId}/reintegro-${Date.now()}-${seguro}`;
    const { error: errSubida } = await supabase.storage.from(BUCKET_OC).upload(path, f, {
      upsert: false,
      contentType: f.type || 'application/pdf',
    });
    if (errSubida) throw new Error(`No se pudo subir el comprobante: ${errSubida.message}`);
    subido = { path, nombre: f.name };
  }

  // Actualización optimista del historial (con reintentos)
  for (let intento = 0; intento < 3; intento++) {
    const { data: actual, error: e0 } = await supabase
      .from('ordenes')
      .select('id, historial, updated_at')
      .eq('id', ordenId)
      .maybeSingle();

    if (e0) throw e0;
    if (!actual) throw new Error('La orden ya no existe.');

    const historial = Array.isArray(actual.historial) ? actual.historial : [];
    const previo = reintegroDeOrden(historial);
    const comprobantePath = subido ? subido.path : previo?.comprobantePath || null;
    const comprobanteNombre = subido ? subido.nombre : previo?.comprobanteNombre || null;

    const evento = {
      at: new Date().toISOString(),
      evento: EVENTO_REINTEGRO_RETENCION,
      actor: actorEmail,
      fecha_reintegro: fecha,
      referencia,
      banco,
      monto_bs: montoBs,
      monto_usd: montoUsd,
      comprobante_path: comprobantePath,
      comprobante_nombre: comprobanteNombre,
      nota,
    };

    let q = supabase.from('ordenes').update({ historial: [...historial, evento] }).eq('id', ordenId);
    q = actual.updated_at ? q.eq('updated_at', actual.updated_at) : q;
    const { data, error } = await q.select('*').maybeSingle();

    if (error) throw error;
    if (data) return data as Orden;
  }

  throw new Error('La orden se estaba modificando concurrentemente. Por favor intenta de nuevo.');
}

/**
 * Anota en el historial de la OC el cruce de Drive para la ENTRADA de retención.
 */
async function anotarDriveEntrada(ordenId: string, d: DatosDrive, actorEmail: string): Promise<Orden> {
  for (let intento = 0; intento < 3; intento++) {
    const { data: actual, error: e0 } = await supabase
      .from('ordenes')
      .select('id, historial, updated_at')
      .eq('id', ordenId)
      .maybeSingle();

    if (e0) throw e0;
    if (!actual) throw new Error('La orden ya no existe.');

    const historial = Array.isArray(actual.historial) ? actual.historial : [];
    const evento = {
      at: new Date().toISOString(),
      evento: EVENTO_DRIVE_ENTRADA,
      actor: actorEmail,
      referencias: d.referencias,
      monto_bs: d.montoBs,
      archivo: d.archivo.slice(0, 120),
      filas: d.filas,
    };

    let q = supabase.from('ordenes').update({ historial: [...historial, evento] }).eq('id', ordenId);
    q = actual.updated_at ? q.eq('updated_at', actual.updated_at) : q;
    const { data, error } = await q.select('*').maybeSingle();

    if (error) throw error;
    if (data) return data as Orden;
  }
  throw new Error('La orden se estaba modificando en este momento.');
}

/** Guarda los datos de entradas de Drive/Caja en cada OC (hasta 4 a la vez). */
export async function guardarDriveEntradas(
  porOrdenEntradas: Map<string, DatosDrive>,
  actorEmail: string,
): Promise<ResultadoCargaDrive> {
  const tareas = [...porOrdenEntradas.entries()];
  const out: ResultadoCargaDrive = { guardadas: [], fallidas: [] };
  let i = 0;
  const trabajador = async () => {
    while (i < tareas.length) {
      const [id, d] = tareas[i++];
      try {
        out.guardadas.push(await anotarDriveEntrada(id, d, actorEmail));
      } catch (e) {
        out.fallidas.push({ ordenId: id, motivo: e instanceof Error ? e.message : 'No se pudo guardar la entrada' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tareas.length) }, trabajador));
  return out;
}
