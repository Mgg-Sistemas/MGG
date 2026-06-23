/* ============================================================
   MGG · Cocina ↔ Compras · Alerta "a restablecer el mercado"
   La cocina avisa que hay que reponer víveres; la alerta aparece
   como tarjeta en Pedidos/Compras para que el analista monte el
   pedido MERCADO. Se marca "atendida" al montarlo o al descartar.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface AlertaMercado {
  id: string;
  estado: 'pendiente' | 'atendida';
  nota: string | null;
  creada_por: string | null;
  creada_en: string;
  atendida_por: string | null;
  atendida_en: string | null;
  created_at: string;
}

const TABLE = 'alertas_mercado';

/** Crea una alerta de reposición de mercado (estado pendiente). */
export async function crearAlertaMercado(input: { nota?: string | null; actor?: string | null }): Promise<AlertaMercado> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ nota: input.nota?.trim() || null, creada_por: input.actor ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as AlertaMercado;
}

/** Alertas pendientes (las que ve el analista en Pedidos). */
export async function listAlertasMercadoPendientes(): Promise<AlertaMercado[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('estado', 'pendiente')
    .order('creada_en', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AlertaMercado[];
}

/** Marca una alerta como atendida. */
export async function marcarAlertaAtendida(id: string, actor?: string | null): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ estado: 'atendida', atendida_por: actor ?? null, atendida_en: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Marca TODAS las pendientes como atendidas (al montar el MERCADO). */
export async function marcarTodasAtendidas(actor?: string | null): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ estado: 'atendida', atendida_por: actor ?? null, atendida_en: new Date().toISOString() })
    .eq('estado', 'pendiente');
  if (error) throw error;
}
