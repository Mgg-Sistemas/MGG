/* ============================================================
   MGG · Ventas · Clientes (Supabase)
   Catálogo de clientes a quienes se les factura.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface Cliente {
  id: string;
  nombre: string;
  rif?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  activo: boolean;
  nota?: string | null;
  created_by?: string | null;
  actor_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClienteInput {
  nombre: string;
  rif?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  activo?: boolean;
  nota?: string | null;
}

export async function listClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from('clientes').select('*')
    .order('activo', { ascending: false })
    .order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Cliente[];
}

export async function crearCliente(input: ClienteInput, actor: string, actorName?: string | null): Promise<Cliente> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('Indicá el nombre del cliente.');
  const { data, error } = await supabase.from('clientes').insert({
    nombre, rif: input.rif?.trim() || null, telefono: input.telefono?.trim() || null,
    email: input.email?.trim() || null, direccion: input.direccion?.trim() || null,
    activo: input.activo ?? true, nota: input.nota?.trim() || null,
    created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as Cliente;
}

export async function actualizarCliente(id: string, input: ClienteInput): Promise<Cliente> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('Indicá el nombre del cliente.');
  const { data, error } = await supabase.from('clientes').update({
    nombre, rif: input.rif?.trim() || null, telefono: input.telefono?.trim() || null,
    email: input.email?.trim() || null, direccion: input.direccion?.trim() || null,
    activo: input.activo ?? true, nota: input.nota?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Cliente;
}

export async function eliminarCliente(id: string): Promise<void> {
  const { error } = await supabase.from('clientes').delete().eq('id', id);
  if (error) throw error;
}
