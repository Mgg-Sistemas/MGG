/* ============================================================
   MGG · Asignaciones · Catálogo de vehículos (Supabase)
   Tabla `vehiculos_catalogo`. Un vehículo con una asignación VIVA no se
   borra (la autorización apunta a él): primero se devuelve.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { textoDeError } from '@/shared/lib/errores';
import { errorVehiculo, normalizarPlaca, type VehiculoBase } from './vehiculos';

const TABLE = 'vehiculos_catalogo';

export interface Vehiculo extends VehiculoBase {
  id: string;
  placa: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  color: string | null;
  serial_carroceria: string | null;
  serial_motor: string | null;
  notas: string | null;
  activo: boolean;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehiculoInput extends VehiculoBase {
  notas?: string | null;
  activo?: boolean;
}

export async function listVehiculos(): Promise<Vehiculo[]> {
  const { data, error } = await supabase.from(TABLE).select('*').order('marca').order('modelo').order('placa');
  if (error) throw new Error(textoDeError(error, 'No se pudo leer el catálogo de vehículos.'));
  return (data ?? []) as Vehiculo[];
}

function fila(v: VehiculoInput) {
  const err = errorVehiculo(v);
  if (err) throw new Error(err);
  const t = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim() || null;
  return {
    placa: normalizarPlaca(v.placa),
    tipo: t(v.tipo) ?? 'carro',
    marca: t(v.marca)?.toUpperCase() ?? null,
    modelo: t(v.modelo)?.toUpperCase() ?? null,
    anio: v.anio ?? null,
    color: t(v.color)?.toUpperCase() ?? null,
    serial_carroceria: t(v.serial_carroceria)?.toUpperCase() ?? null,
    serial_motor: t(v.serial_motor)?.toUpperCase() ?? null,
    notas: t(v.notas),
    activo: v.activo ?? true,
    updated_at: new Date().toISOString(),
  };
}

function placaRepetida(e: { code?: string }): boolean { return e.code === '23505'; }

export async function crearVehiculo(v: VehiculoInput, actor: string): Promise<Vehiculo> {
  const { data, error } = await supabase.from(TABLE).insert({ ...fila(v), creado_por: actor }).select('*').single();
  if (error) throw new Error(placaRepetida(error) ? `Ya hay un vehículo con la placa ${normalizarPlaca(v.placa)}.` : textoDeError(error, 'No se pudo guardar el vehículo.'));
  return data as Vehiculo;
}

export async function editarVehiculo(id: string, v: VehiculoInput): Promise<Vehiculo> {
  const { data, error } = await supabase.from(TABLE).update(fila(v)).eq('id', id).select('*').single();
  if (error) throw new Error(placaRepetida(error) ? `Ya hay un vehículo con la placa ${normalizarPlaca(v.placa)}.` : textoDeError(error, 'No se pudo guardar el vehículo.'));
  return data as Vehiculo;
}

/** Borra el vehículo. Si tiene una asignación viva (alguien autorizado), no deja. */
export async function eliminarVehiculo(id: string): Promise<void> {
  const { data: vivas } = await supabase.from('asignaciones').select('id').eq('vehiculo_id', id).eq('estado', 'asignado').limit(1);
  if ((vivas ?? []).length) throw new Error('Este vehículo está asignado a alguien: primero registrá la devolución.');
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(textoDeError(error, 'No se pudo eliminar el vehículo.'));
}
