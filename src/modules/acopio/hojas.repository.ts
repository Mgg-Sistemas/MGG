/* ============================================================
   Golden Touch · Centro de Acopio · Hojas del Excel
   Snapshot fiel de cada hoja del libro original (referencia).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { HojaExcel } from '@/shared/lib/types';

/** Lista las hojas (sin los datos pesados) para el selector. */
export async function listHojasExcel(): Promise<Pick<HojaExcel, 'id' | 'nombre' | 'orden' | 'cols'>[]> {
  const { data, error } = await supabase
    .from('acopio_hojas_excel')
    .select('id, nombre, orden, cols')
    .order('orden', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Pick<HojaExcel, 'id' | 'nombre' | 'orden' | 'cols'>[];
}

/** Obtiene una hoja completa (con la grilla) por nombre. */
export async function getHojaExcel(nombre: string): Promise<HojaExcel | null> {
  const { data, error } = await supabase
    .from('acopio_hojas_excel')
    .select('*')
    .eq('nombre', nombre)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as HojaExcel | null;
}
