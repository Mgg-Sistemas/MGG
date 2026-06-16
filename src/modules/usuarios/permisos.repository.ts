import { supabase } from '@/shared/lib/supabase';

export type RoleKey = string;
export type ModuleKey =
  | 'dashboard'
  | 'pedidos'
  | 'proveedores'
  | 'inventario'
  | 'produccion'
  | 'salidas'
  | 'combustible'
  | 'acopio'
  | 'acopio_reporte'
  | 'acopio_gmt'
  | 'acopio_peramanal'
  | 'acopio_esmeralda'
  | 'acopio_pijiguaos'
  | 'maquinaria'
  | 'ventas'
  | 'tesoreria'
  | 'retenciones'
  | 'rrhh'
  | 'usuarios'
  | 'ajustes';

export interface ModulePermission {
  lectura: boolean;
  escritura: boolean;
  full: boolean;
}

export type RolePermisos = Record<ModuleKey, ModulePermission>;
export type AllPermisos = Record<RoleKey, RolePermisos>;

/** Lista canónica de módulos del sistema. Fuente única para la matriz, el menú y los guards.
 *  `path` (opcional) = ruta bajo `/app/` cuando NO coincide con la key (submódulos anidados). */
export const MODULES: { key: ModuleKey; label: string; path?: string }[] = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'pedidos',     label: 'Pedidos / Compras' },
  { key: 'proveedores', label: 'Proveedores' },
  { key: 'inventario',  label: 'Inventario' },
  { key: 'produccion',  label: 'Fundición' },
  { key: 'salidas',     label: 'Salidas / Traslados' },
  { key: 'combustible', label: 'Combustible' },
  { key: 'acopio',          label: 'C. Acopio · La Esperanza' },
  { key: 'acopio_reporte',  label: 'C. Acopio · Reporte Preliminar', path: 'acopio/reporte-preliminar' },
  { key: 'acopio_gmt',      label: 'C. Acopio · Global Mineral TIN', path: 'acopio/global-mineral-tin' },
  { key: 'acopio_peramanal',label: 'C. Acopio · Peramanal (Ender Mejías)', path: 'acopio/peramanal-ender' },
  { key: 'acopio_esmeralda',label: 'C. Acopio · La Esmeralda (Alí)', path: 'acopio/esmeralda-ali' },
  { key: 'acopio_pijiguaos',label: 'C. Acopio · Los Pijiguaos', path: 'acopio/los-pijiguaos' },
  { key: 'maquinaria',  label: 'Control de Maquinaria' },
  { key: 'ventas',      label: 'Ventas' },
  { key: 'tesoreria',   label: 'Tesorería' },
  { key: 'retenciones', label: 'Retenciones' },
  { key: 'rrhh',        label: 'RRHH / Nómina' },
  { key: 'usuarios',    label: 'Usuarios' },
  { key: 'ajustes',     label: 'Ajustes' },
];

/** Ruta bajo `/app/` de un módulo (usa `path` si está; si no, la propia key). */
export function modulePath(key: ModuleKey): string {
  return MODULES.find((m) => m.key === key)?.path ?? key;
}

export const emptyPermission: ModulePermission = { lectura: false, escritura: false, full: false };

/** Permisos por defecto de un rol cuando la matriz aún no tiene fila guardada en BD. */
export function defaultsFor(role: RoleKey): RolePermisos {
  const all: RolePermisos = MODULES.reduce<RolePermisos>((acc, m) => {
    acc[m.key] = { ...emptyPermission };
    return acc;
  }, {} as RolePermisos);

  if (role === 'admin') {
    MODULES.forEach((m) => (all[m.key] = { lectura: true, escritura: true, full: true }));
  } else if (role === 'analista') {
    (['dashboard', 'pedidos', 'proveedores', 'inventario', 'produccion', 'salidas', 'combustible', 'ajustes'] as ModuleKey[]).forEach((k) => {
      all[k] = { lectura: true, escritura: true, full: false };
    });
    all.usuarios = { lectura: true, escritura: false, full: false };
    all.tesoreria = { lectura: true, escritura: false, full: false };
    all.retenciones = { lectura: true, escritura: true, full: false };
    all.rrhh = { lectura: true, escritura: true, full: false };
  } else if (role === 'obrero') {
    all.dashboard  = { lectura: true, escritura: false, full: false };
    all.pedidos    = { lectura: true, escritura: true, full: false };
    all.inventario = { lectura: true, escritura: true, full: false };
    all.produccion = { lectura: true, escritura: true, full: false };
    all.ajustes    = { lectura: true, escritura: false, full: false };
  } else {
    all.dashboard = { lectura: true, escritura: false, full: false };
  }
  return all;
}

/** Rellena los módulos faltantes de una fila parcial con `emptyPermission`. */
export function normalizeRolePermisos(stored: Partial<RolePermisos>): RolePermisos {
  return MODULES.reduce<RolePermisos>((acc, m) => {
    acc[m.key] = { ...emptyPermission, ...stored[m.key] };
    return acc;
  }, {} as RolePermisos);
}

const TABLE = 'roles_permisos';

interface Row {
  role: RoleKey;
  permisos: RolePermisos;
  updated_at?: string;
  updated_by?: string | null;
}

export async function loadPermisos(): Promise<AllPermisos | null> {
  const { data, error } = await supabase.from(TABLE).select('role, permisos');
  if (error) throw error;
  if (!data || !data.length) return null;
  return (data as Row[]).reduce<AllPermisos>((acc, row) => {
    acc[row.role] = row.permisos;
    return acc;
  }, {} as AllPermisos);
}

/** Carga la matriz de permisos de un rol concreto. `null` si la fila aún no existe. */
export async function loadRolePermisos(role: RoleKey): Promise<RolePermisos | null> {
  const { data, error } = await supabase.from(TABLE).select('permisos').eq('role', role).maybeSingle();
  if (error) throw error;
  return (data?.permisos as RolePermisos | undefined) ?? null;
}

/** Persiste los permisos de UN solo rol (autoguardado por celda en la matriz). */
export async function savePermisosRole(
  role: RoleKey,
  permisos: RolePermisos,
  actorEmail: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).upsert(
    { role, permisos, updated_at: new Date().toISOString(), updated_by: actorEmail },
    { onConflict: 'role' },
  );
  if (error) throw error;
}

export async function savePermisos(all: AllPermisos, actorEmail: string): Promise<void> {
  const rows = Object.keys(all).map((role) => ({
    role,
    permisos: all[role],
    updated_at: new Date().toISOString(),
    updated_by: actorEmail,
  }));
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'role' });
  if (error) throw error;
}

export async function eliminarPermisosRol(role: RoleKey): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('role', role);
  if (error) throw error;
}
