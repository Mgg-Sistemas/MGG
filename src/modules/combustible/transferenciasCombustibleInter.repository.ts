/* ============================================================
   MGG · Combustible · Puente inter-sistema (litros)
   Igual que el puente de dinero de Tesorería, pero el recurso son LITROS de
   combustible: el otro sistema traslada litros y MGG los recibe. Al confirmar
   la entrante, los litros entran a un TANQUE de MGG (que se refleja en el
   inventario) y se devuelve el ACK que pasa la saliente del origen a 'recibida'.

   `transf_id` es el id GLOBAL compartido por ambos lados → idempotencia.
   Reusa las mismas Edge Functions (transfer-enviar/transfer-recibir) con un
   discriminador recurso='combustible'. El código de empresa propio sale de
   VITE_EMPRESA_CODIGO (igual que el puente de dinero).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { TransferenciaCombustibleInter } from '@/shared/lib/types';
import { empresaPropia } from '@/modules/tesoreria/transferenciasInter.repository';
import { listCombustibles, listTanques, registrarIngreso, salidaCombustibleDirecta } from './combustible.repository';

const TABLE = 'transferencias_combustible_inter';

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}

function resumenLitros(litros: number, combustible: string): string {
  return `${Number(litros).toLocaleString('es-VE', { maximumFractionDigits: 2 })} L de ${combustible}`;
}

/* ───────── Consultas ───────── */

export async function listTransferenciasCombustible(): Promise<TransferenciaCombustibleInter[]> {
  const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransferenciaCombustibleInter[];
}

/* ───────── Saliente (este sistema envía litros a otro) ───────── */

export interface CrearSalienteCombustibleInput {
  empresaDestino: string;
  combustibleId: string;
  combustibleNombre: string;
  /** Tanque local del que salen los litros (se descuenta del tanque y del inventario). */
  tanqueId: string;
  tanqueNombre?: string | null;
  almacen?: string | null;
  litros: number;
  costoLitro?: number | null;
  motivo: string;
  actor: string;
  actorName?: string | null;
}

/**
 * Descuenta los litros del tanque/inventario local y registra la transferencia
 * saliente, empujándola al otro sistema. Si el destino aún no está configurado,
 * la saliente queda en 'error' (reintentable) — el descuento local ya ocurrió.
 */
export async function crearTransferenciaCombustibleSaliente(input: CrearSalienteCombustibleInput): Promise<TransferenciaCombustibleInter> {
  const litros = Number(input.litros) || 0;
  if (litros <= 0) throw new Error('Indicá los litros a trasladar.');
  if (!input.empresaDestino.trim()) throw new Error('Indicá el sistema destino.');

  const transfId = genId();
  const resumen = resumenLitros(litros, input.combustibleNombre);

  // 1) Descuento local (tanque + inventario). Valida stock/litros antes de tocar nada.
  await salidaCombustibleDirecta({
    combustibleId: input.combustibleId,
    almacen: input.almacen ?? null,
    tanqueId: input.tanqueId,
    litros,
    destino: `Sistema ${input.empresaDestino}`,
    motivo: input.motivo,
    refTipo: 'combustible_traslado_inter',
    refCodigo: transfId,
    actor: input.actor,
    actorName: input.actorName ?? null,
  });

  // 2) Registro de la saliente.
  const { data, error } = await supabase.from(TABLE).insert({
    transf_id: transfId, direccion: 'saliente', estado: 'enviada',
    empresa_origen: empresaPropia(), empresa_destino: input.empresaDestino,
    combustible_nombre: input.combustibleNombre, litros, costo_litro: input.costoLitro ?? null,
    tanque_id: input.tanqueId, tanque_nombre: input.tanqueNombre ?? null,
    resumen, motivo: input.motivo,
    actor: input.actor, actor_name: input.actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  const row = data as TransferenciaCombustibleInter;

  // 3) Empuje al otro sistema.
  await empujarTransferencia(row).catch(async (e) => {
    await supabase.from(TABLE).update({ estado: 'error', mensaje_error: e instanceof Error ? e.message : 'No se pudo entregar' }).eq('id', row.id);
  });
  return row;
}

/** Empuja (o reintenta) la entrega de una saliente al otro sistema. */
async function empujarTransferencia(row: TransferenciaCombustibleInter): Promise<void> {
  const { data: res, error } = await supabase.functions.invoke('transfer-enviar', {
    body: {
      tipo: 'transferencia', recurso: 'combustible', transf_id: row.transf_id,
      empresa_origen: row.empresa_origen, empresa_destino: row.empresa_destino,
      combustible_nombre: row.combustible_nombre, litros: row.litros, costo_litro: row.costo_litro,
      resumen: row.resumen, motivo: row.motivo,
      actor: row.actor, actor_name: row.actor_name,
    },
  });
  if (error) throw new Error(error.message ?? 'Edge function falló');
  const r = res as { entregada?: boolean; error?: string } | null;
  if (!r?.entregada) throw new Error(r?.error || 'El otro sistema no confirmó la recepción.');
  await supabase.from(TABLE).update({ estado: 'enviada', mensaje_error: null }).eq('id', row.id);
}

/** Reintenta entregar una saliente que quedó en 'error' (destino no configurado, etc.). */
export async function reintentarTransferenciaCombustible(row: TransferenciaCombustibleInter): Promise<void> {
  await empujarTransferencia(row);
}

/* ───────── Entrante (este sistema recibe litros de otro) ───────── */

/**
 * Confirma una transferencia entrante: ingresa los litros al TANQUE de MGG
 * elegido (que se refleja en el inventario) y avisa al origen (ACK) para que su
 * saliente pase a 'recibida'. Idempotente por el id global.
 */
export async function confirmarTransferenciaCombustibleEntrante(input: {
  row: TransferenciaCombustibleInter;
  tanqueId: string;            // tanque MGG que recibe los litros
  actor: string;
  actorName?: string | null;
}): Promise<void> {
  const { row } = input;
  if (row.estado !== 'por_confirmar') throw new Error('Esta transferencia ya fue procesada.');
  if (!input.tanqueId) throw new Error('Elegí el tanque MGG que recibe los litros.');
  const litros = Number(row.litros) || 0;
  if (litros <= 0) throw new Error('La transferencia no tiene litros.');

  // Resolver el combustible local: el del tanque, o por nombre como respaldo.
  const tanques = await listTanques();
  const tanque = tanques.find((t) => t.id === input.tanqueId);
  if (!tanque) throw new Error('El tanque elegido no existe.');

  const combustibles = await listCombustibles();
  let comb = tanque.combustible_id ? combustibles.find((c) => c.id === tanque.combustible_id) : undefined;
  if (!comb) comb = combustibles.find((c) => c.nombre.trim().toLowerCase() === row.combustible_nombre.trim().toLowerCase());
  if (!comb) throw new Error(`Asigná un combustible al tanque "${tanque.nombre}" o creá el combustible "${row.combustible_nombre}" antes de recibir.`);

  const almacen = comb.home_almacen?.trim() || 'General';

  // Ingreso al tanque + inventario (valida capacidad del tanque, recalcula PMP).
  await registrarIngreso({
    combustibleId: comb.id,
    almacen,
    tanqueId: input.tanqueId,
    litros,
    costoLitro: Number(row.costo_litro) || comb.costo_litro || 0,
    actor: input.actor,
    actorName: input.actorName ?? null,
    detalle: `Recepción inter-sistema de ${row.empresa_origen}`,
  });

  await supabase.from(TABLE).update({
    estado: 'recibida', tanque_id: input.tanqueId, tanque_nombre: tanque.nombre,
    confirmada_at: new Date().toISOString(),
  }).eq('id', row.id);

  // ACK al origen (best-effort).
  if (row.callback_base) {
    await supabase.functions.invoke('transfer-enviar', {
      body: { tipo: 'ack', recurso: 'combustible', transf_id: row.transf_id, callback_base: row.callback_base },
    }).catch(() => { /* el ACK no bloquea */ });
  }
}
