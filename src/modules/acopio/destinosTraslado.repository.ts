/* ============================================================
   Centro de Acopio · Destinos de «Traslado de caja»
   Catálogo editable de a-dónde va el dinero de un traslado de la caja
   general (La Esperanza), y el orquestador que ejecuta el traslado:
     · El traslado SIEMPRE baja el saldo de la caja general
       (acopio_caja_movimientos, grupo 'traslado').
     · 'aliado_interno' → además entra como $Usd ENTREGADO en el ledger del
       aliado de ESTE sistema (acopio_aliado_movimientos). Directo, sin confirmar.
     · 'externo' → además empuja una transferencia SALIENTE por el puente
       inter-sistema (transferencias_inter) a `empresa_codigo`; el otro sistema
       la recibe «por confirmar» y, al aceptar, acredita su caja (misma
       metodología que Tesorería).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { DestinoTraslado, TipoDestinoTraslado, TransferLeg } from '@/shared/lib/types';
import { crearMovimientoCaja, eliminarMovimientoCaja, CENTRO_ACOPIO_DEFECTO } from './caja.repository';
import { crearTransferenciaSaliente } from '@/modules/tesoreria/transferenciasInter.repository';

const TABLE = 'acopio_destinos_traslado';
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/* ───────────── Catálogo ───────────── */

export async function listDestinosTraslado(centroNombre = CENTRO_ACOPIO_DEFECTO): Promise<DestinoTraslado[]> {
  const { data, error } = await supabase
    .from(TABLE).select('*')
    .eq('centro_nombre', centroNombre)
    .order('activo', { ascending: false })
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DestinoTraslado[];
}

export interface DestinoTrasladoInput {
  nombre: string;
  tipo: TipoDestinoTraslado;
  aliadoId?: string | null;
  cajaExternaId?: string | null;
  empresaCodigo?: string | null;
  centroNombre?: string;
}

/** Valida la coherencia del destino según su tipo. */
function validar(input: DestinoTrasladoInput): void {
  if (!input.nombre.trim()) throw new Error('Indicá el nombre del destino.');
  if (input.tipo === 'aliado_interno' && !input.aliadoId) throw new Error('Elegí el aliado interno destino.');
  if (input.tipo === 'externo' && (!input.cajaExternaId || !input.empresaCodigo?.trim())) {
    throw new Error('Para un destino externo elegí la caja espejo del otro sistema.');
  }
}

export async function crearDestinoTraslado(input: DestinoTrasladoInput, actor: string): Promise<DestinoTraslado> {
  validar(input);
  const { data, error } = await supabase.from(TABLE).insert({
    centro_nombre: input.centroNombre || CENTRO_ACOPIO_DEFECTO,
    nombre: input.nombre.trim(), tipo: input.tipo,
    aliado_id: input.tipo === 'aliado_interno' ? input.aliadoId : null,
    caja_externa_id: input.tipo === 'externo' ? input.cajaExternaId : null,
    empresa_codigo: input.tipo === 'externo' ? (input.empresaCodigo?.trim() || null) : null,
    created_by: actor,
  }).select('*').single();
  if (error) throw error;
  return data as DestinoTraslado;
}

export async function actualizarDestinoTraslado(id: string, input: DestinoTrasladoInput): Promise<void> {
  validar(input);
  const { error } = await supabase.from(TABLE).update({
    nombre: input.nombre.trim(), tipo: input.tipo,
    aliado_id: input.tipo === 'aliado_interno' ? input.aliadoId : null,
    caja_externa_id: input.tipo === 'externo' ? input.cajaExternaId : null,
    empresa_codigo: input.tipo === 'externo' ? (input.empresaCodigo?.trim() || null) : null,
  }).eq('id', id);
  if (error) throw error;
}

export async function setDestinoTrasladoActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ activo }).eq('id', id);
  if (error) throw error;
}

export async function eliminarDestinoTraslado(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/** Caja espejo de un centro EXTERNO (vive en otra Supabase) para destinos 'externo'. */
export interface CajaEspejo { id: string; nombre: string; empresa_codigo: string | null; }

export async function listCajasExternas(): Promise<CajaEspejo[]> {
  const { data, error } = await supabase
    .from('cajas').select('id, nombre, empresa_codigo')
    .eq('externo', true).order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CajaEspejo[];
}

/* ───────────── Orquestador del traslado ───────────── */

/** Próximo `orden` dentro del ledger del aliado. */
async function nextOrdenAliado(aliadoId: string): Promise<number> {
  const { data } = await supabase
    .from('acopio_aliado_movimientos').select('orden').eq('aliado_id', aliadoId)
    .order('orden', { ascending: false }).limit(1).maybeSingle();
  return ((data as { orden?: number } | null)?.orden ?? 0) + 1;
}

export interface TrasladoAcopioInput {
  destino: DestinoTraslado;
  fecha: string;
  monto: number;                 // USD
  descripcion?: string | null;
  cajaId?: string | null;        // caja general abierta (origen)
}

/**
 * Ejecuta un traslado de la caja general hacia un destino del catálogo. Baja el
 * saldo de la caja general y refleja el monto en el destino (aliado interno como
 * $Usd entregado, o externo por el puente inter-sistema). Si la reflexión falla,
 * revierte el traslado local para no dejarlo huérfano.
 */
export async function ejecutarTrasladoAcopio(
  input: TrasladoAcopioInput, actor: string, actorName?: string | null,
): Promise<void> {
  const monto = r2(input.monto);
  if (monto <= 0) throw new Error('El monto del traslado debe ser mayor que 0.');
  if (!input.fecha) throw new Error('Indicá la fecha del traslado.');
  const d = input.destino;
  const desc = input.descripcion?.trim() || `Traslado de caja · ${d.nombre}`;

  // 1) Traslado en la caja general (baja saldo de La Esperanza).
  const mov = await crearMovimientoCaja(
    { fecha: input.fecha, descripcion: desc, traslado: monto, clasif_grupo: 'traslado', clasif_valor: d.nombre, caja_id: input.cajaId ?? null },
    actor, actorName,
  );

  // 2) Reflejo en el destino.
  try {
    if (d.tipo === 'aliado_interno') {
      if (!d.aliado_id) throw new Error('El destino no tiene un aliado interno asociado.');
      const orden = await nextOrdenAliado(d.aliado_id);
      const { error } = await supabase.from('acopio_aliado_movimientos').insert({
        aliado_id: d.aliado_id, fecha: input.fecha, tipo: 'cierre',
        descripcion: desc, usd_entregado: monto, kg_cerrados: 0, precio_usd_kg: 0, kg_recibidos: 0, gastos: 0,
        caja_mov_id: mov.id, orden, created_by: actor, actor_name: actorName ?? null,
      });
      if (error) throw error;
    } else {
      if (!d.caja_externa_id || !d.empresa_codigo) throw new Error('El destino externo no está configurado (caja espejo / empresa).');
      const legs: TransferLeg[] = [{ cuenta: 'general', moneda: 'USD', monto, tasa_bs: null }];
      // No lanza por fallo de entrega: deja la saliente en 'error' para reintentar
      // (el traslado local ya quedó hecho), igual que en Tesorería.
      await crearTransferenciaSaliente({
        empresaDestino: d.empresa_codigo, cajaId: d.caja_externa_id, cajaNombre: d.nombre,
        legs, motivo: desc, actor, actorName,
      });
    }
  } catch (e) {
    // La reflexión falló de verdad (no fue mera entrega) → revierto el traslado local.
    await eliminarMovimientoCaja(mov.id).catch(() => {});
    throw e;
  }
}
