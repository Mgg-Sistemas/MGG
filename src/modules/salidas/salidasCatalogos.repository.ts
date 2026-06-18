/* ============================================================
   MGG · Salidas/Traslados · Catálogos de Chofer y Vehículo
   Chofer (nombre + cédula) y Vehículo (nombre + placa) reutilizables
   en las solicitudes. Modificables y deshabilitables (activo), igual
   que los demás catálogos del sistema.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Chofer, Vehiculo } from '@/shared/lib/types';

const CHOFERES = 'salidas_choferes';
const VEHICULOS = 'salidas_vehiculos';

/* ───────────── Choferes ───────────── */

export async function listChoferes(soloActivos = true): Promise<Chofer[]> {
  let q = supabase.from(CHOFERES).select('*').order('nombre', { ascending: true });
  if (soloActivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Chofer[];
}

export async function crearChofer(input: { nombre: string; cedula?: string | null; actor?: string | null }): Promise<Chofer> {
  const nombre = input.nombre.trim().toUpperCase();
  if (!nombre) throw new Error('Indicá el nombre del chofer.');
  const { data, error } = await supabase.from(CHOFERES)
    .insert({ nombre, cedula: input.cedula?.trim() || null, actor: input.actor ?? null })
    .select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error(`Ya existe un chofer "${nombre}".`);
    throw error;
  }
  return data as Chofer;
}

export async function actualizarChofer(id: string, input: { nombre: string; cedula?: string | null }): Promise<void> {
  const nombre = input.nombre.trim().toUpperCase();
  if (!nombre) throw new Error('Indicá el nombre del chofer.');
  const { error } = await supabase.from(CHOFERES).update({ nombre, cedula: input.cedula?.trim() || null }).eq('id', id);
  if (error) throw error;
}

export async function setActivoChofer(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(CHOFERES).update({ activo }).eq('id', id);
  if (error) throw error;
}

export async function eliminarChofer(id: string): Promise<void> {
  const { error } = await supabase.from(CHOFERES).delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Vehículos ───────────── */

export async function listVehiculos(soloActivos = true): Promise<Vehiculo[]> {
  let q = supabase.from(VEHICULOS).select('*').order('nombre', { ascending: true });
  if (soloActivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Vehiculo[];
}

export async function crearVehiculo(input: { nombre: string; placa?: string | null; actor?: string | null }): Promise<Vehiculo> {
  const nombre = input.nombre.trim().toUpperCase();
  if (!nombre) throw new Error('Indicá el nombre del vehículo.');
  const { data, error } = await supabase.from(VEHICULOS)
    .insert({ nombre, placa: input.placa?.trim().toUpperCase() || null, actor: input.actor ?? null })
    .select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error(`Ya existe un vehículo "${nombre}".`);
    throw error;
  }
  return data as Vehiculo;
}

export async function actualizarVehiculo(id: string, input: { nombre: string; placa?: string | null }): Promise<void> {
  const nombre = input.nombre.trim().toUpperCase();
  if (!nombre) throw new Error('Indicá el nombre del vehículo.');
  const { error } = await supabase.from(VEHICULOS).update({ nombre, placa: input.placa?.trim().toUpperCase() || null }).eq('id', id);
  if (error) throw error;
}

export async function setActivoVehiculo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(VEHICULOS).update({ activo }).eq('id', id);
  if (error) throw error;
}

export async function eliminarVehiculo(id: string): Promise<void> {
  const { error } = await supabase.from(VEHICULOS).delete().eq('id', id);
  if (error) throw error;
}
