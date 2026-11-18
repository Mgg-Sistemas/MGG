/* ============================================================
   MGG · Contabilidad · Empresas Contables (Multi-empresa)

   Contabilidad opera de forma estrictamente multiempresa, compartiendo
   el catálogo de empresas con Administración (tabla `admin_empresas`).
   A diferencia de Administración (que permite ver "Todas las empresas"),
   en Contabilidad cada ejercicio, comprobante, libro diario y balance
   corresponde a una entidad legal única ('MGG', etc.).
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';

export interface EmpresaContable {
  clave: string;
  nombre: string;
  rif: string | null;
  activa: boolean;
}

export const EMPRESAS_CONTABLES_DEFECTO: EmpresaContable[] = [
  { clave: 'MGG', nombre: EMPRESA_NOMBRE, rif: EMPRESA_RIF, activa: true },
];

export const EMPRESA_MGG_DEFECTO = EMPRESAS_CONTABLES_DEFECTO[0];

export const CLAVE_EMPRESA_ACTIVA = 'mgg.contabilidad.empresa_activa';

export function leerEmpresaContableActiva(): string {
  try {
    return localStorage.getItem(CLAVE_EMPRESA_ACTIVA) || 'MGG';
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
 * Consulta la lista de empresas registradas en `admin_empresas`.
 * Si Supabase no está conectado o falla, devuelve la lista base (MGG).
 */
export async function listEmpresasContables(): Promise<EmpresaContable[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admin_empresas')
        .select('clave, nombre, rif, activa')
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
