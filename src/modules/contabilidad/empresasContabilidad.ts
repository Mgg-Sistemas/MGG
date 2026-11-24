/* ============================================================
   Golden Touch · Contabilidad · Empresas Contables (Multi-empresa)

   Contabilidad opera de forma estrictamente multiempresa, compartiendo
   el catálogo de empresas con Administración (tabla `admin_empresas`).
   A diferencia de Administración (que permite ver "Todas las empresas"),
   en Contabilidad cada ejercicio, comprobante, libro diario y balance
   corresponde a una entidad legal única ('GT', 'MTO'...).
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';

export interface EmpresaContable {
  id?: string;
  clave: string;
  nombre: string;
  rif: string | null;
  activa: boolean;
  orden?: number;
}

export const EMPRESA_MGG_DEFECTO: EmpresaContable = {
  clave: 'MGG',
  nombre: 'MINERAL GROUP GUAYANA C.A.',
  rif: 'J-50221930-7',
  activa: true,
};

export const EMPRESAS_CONTABLES_DEFECTO: EmpresaContable[] = [
  EMPRESA_MGG_DEFECTO,
  { clave: 'GT', nombre: 'GOLDEN TOUCH 1127, C.A.', rif: 'J-50129993-5', activa: true },
  { clave: 'MTO', nombre: 'MINERÍA TIN OXIDE, C.A.', rif: 'J-50478722-1', activa: true },
];

export const CLAVE_EMPRESA_ACTIVA = 'mgg.contabilidad.empresa_activa';

export function leerEmpresaContableActiva(): string {
  try {
    return localStorage.getItem(CLAVE_EMPRESA_ACTIVA) || localStorage.getItem('gt.contabilidad.empresa_activa') || 'MGG';
  } catch {
    return 'MGG';
  }
}

export function guardarEmpresaContableActiva(clave: string): void {
  try {
    localStorage.setItem(CLAVE_EMPRESA_ACTIVA, clave);
  } catch {
    /* sin almacenamiento en modo incógnito/privado */
  }
}

/**
 * Consulta la lista de empresas activas registradas en `admin_empresas`.
 * Si Supabase no está conectado o falla, devuelve la lista base (GT y MTO).
 */
export async function listEmpresasContables(): Promise<EmpresaContable[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admin_empresas')
        .select('id, clave, nombre, rif, activa, orden')
        .order('orden', { ascending: true })
        .order('clave', { ascending: true });
      if (!error && data && data.length > 0) {
        return (data as EmpresaContable[]).filter((e) => e.activa !== false);
      }
    } catch {
      // Usar fallback
    }
  }
  return EMPRESAS_CONTABLES_DEFECTO;
}

/**
 * Consulta todas las empresas (activas e inactivas) para administración.
 */
export async function listTodasEmpresasContables(): Promise<EmpresaContable[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admin_empresas')
        .select('id, clave, nombre, rif, activa, orden')
        .order('orden', { ascending: true })
        .order('clave', { ascending: true });
      if (!error && data && data.length > 0) {
        return data as EmpresaContable[];
      }
    } catch {
      // Usar fallback
    }
  }
  return EMPRESAS_CONTABLES_DEFECTO;
}

export async function guardarNuevaEmpresaContable(input: {
  clave: string;
  nombre: string;
  rif: string | null;
  activa: boolean;
  orden?: number;
}): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('admin_empresas')
    .insert({
      clave: input.clave,
      nombre: input.nombre,
      rif: input.rif,
      activa: input.activa,
      orden: input.orden ?? 99,
    });
  if (error) throw error;
}

export async function actualizarEmpresaContable(
  claveOriginal: string,
  input: {
    nombre: string;
    rif: string | null;
    activa: boolean;
  },
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('admin_empresas')
    .update({
      nombre: input.nombre,
      rif: input.rif,
      activa: input.activa,
      updated_at: new Date().toISOString(),
    })
    .eq('clave', claveOriginal);
  if (error) throw error;
}

export async function cambiarActivaEmpresaContable(clave: string, activa: boolean): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('admin_empresas')
    .update({ activa, updated_at: new Date().toISOString() })
    .eq('clave', clave);
  if (error) throw error;
}
