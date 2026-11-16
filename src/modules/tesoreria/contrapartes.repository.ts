/* ============================================================
   MGG · Tesorería · Contrapartes (clientes / proveedores)
   Directorio para reusar en los ingresos manuales a caja y en
   las cuentas por pagar. Cada contraparte es un cliente o un
   proveedor (esa es su categoría).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export type TipoContraparte = 'cliente' | 'proveedor';

export interface Contraparte {
  id: string;
  tipo: TipoContraparte;
  nombre: string;        // nombre (cliente) o razón social (proveedor)
  rif?: string | null;
  telefono?: string | null;
  email?: string | null;
  nota?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ContraparteInput {
  tipo: TipoContraparte;
  nombre: string;
  rif?: string | null;
  telefono?: string | null;
  email?: string | null;
  nota?: string | null;
}

const TABLE = 'tesoreria_contrapartes';

export async function listContrapartes(tipo?: TipoContraparte): Promise<Contraparte[]> {
  let q = supabase.from(TABLE).select('*').order('nombre', { ascending: true });
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Contraparte[];
}

function normalizar(input: ContraparteInput): ContraparteInput {
  return {
    tipo: input.tipo,
    nombre: input.nombre.trim().toUpperCase(),
    rif: input.rif?.trim() || null,
    telefono: input.telefono?.trim() || null,
    email: input.email?.trim() || null,
    nota: input.nota?.trim() || null,
  };
}

export async function crearContraparte(input: ContraparteInput): Promise<Contraparte> {
  const row = normalizar(input);
  if (!row.nombre) throw new Error('El nombre es obligatorio.');
  const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
  if (error) throw error;
  return data as Contraparte;
}

export async function actualizarContraparte(id: string, input: ContraparteInput): Promise<Contraparte> {
  const row = { ...normalizar(input), updated_at: new Date().toISOString() };
  if (!row.nombre) throw new Error('El nombre es obligatorio.');
  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Contraparte;
}
