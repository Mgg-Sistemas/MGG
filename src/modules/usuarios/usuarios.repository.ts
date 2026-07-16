import { supabase } from '@/shared/lib/supabase';
import type { Role, Usuario } from '@/shared/lib/types';
import { listRoles, type CustomRole } from './roles.repository';
import { addTaxonomia, deleteTaxonomia, listTaxonomia, renameTaxonomia } from '@/shared/lib/taxonomias';

const TABLE = 'usuarios';

/** Opciones por defecto del dropdown (sistema). Se complementan con los roles dinámicos. */
export const ROLES_FORM: Array<{ value: Role; label: string }> = [
  { value: 'analista', label: 'Analista' },
  { value: 'admin', label: 'Administrador' },
  { value: 'obrero', label: 'Personal de Planta' },
];

let labelCache: Record<string, string> = {
  admin: 'Administrador',
  analista: 'Analista',
  obrero: 'Personal de Planta / Obrero',
};

export function labelRol(role: Role | string | null | undefined): string {
  if (!role) return '—';
  return labelCache[String(role)] ?? String(role);
}

/** Refresca el caché de etiquetas (llamar tras cargar roles dinámicos). */
export function setRolesCache(roles: CustomRole[]): void {
  labelCache = roles.reduce<Record<string, string>>((acc, r) => {
    acc[r.key] = r.label;
    return acc;
  }, {});
}

export async function loadRolesAndCache(): Promise<CustomRole[]> {
  const roles = await listRoles();
  setRolesCache(roles);
  return roles;
}

export async function listUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Usuario[];
}

export async function getUsuario(id: string): Promise<Usuario | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Usuario | null;
}

export interface CrearUsuarioInput {
  nombre: string;
  apellido: string;
  ci: string;
  email: string;
  role: Role | string;
  telefono?: string;
  departamento?: string;
}

/* ──────────── Departamentos (taxonomía) ──────────── */

const DEPTOS_DEFAULT = [
  'Administración', 'Operaciones', 'Compras', 'Laboratorio', 'Logística', 'Sistemas',
];

export async function getDepartamentos(fromUsuarios: Usuario[] = []): Promise<string[]> {
  const set = new Set<string>();
  try {
    const extras = await listTaxonomia('usuario.departamento');
    extras.forEach((d) => set.add(d));
  } catch { /* falla silenciosa */ }
  fromUsuarios.forEach((u) => { if (u.departamento) set.add(u.departamento); });
  if (set.size === 0) DEPTOS_DEFAULT.forEach((d) => set.add(d));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

export async function addDepartamento(nombre: string, actorEmail?: string): Promise<string | null> {
  return addTaxonomia('usuario.departamento', nombre, actorEmail);
}

/** Renombra un departamento en cascada: actualiza taxonomías + re-etiqueta `usuarios.departamento`. */
export async function renombrarDepartamento(oldNombre: string, newNombre: string, actorEmail?: string): Promise<number> {
  const oldClean = oldNombre.trim();
  const newClean = newNombre.trim();
  if (!oldClean || !newClean) throw new Error('Nombres vacíos');
  if (oldClean === newClean) return 0;
  await renameTaxonomia('usuario.departamento', oldClean, newClean, actorEmail);
  const { data, error } = await supabase
    .from(TABLE)
    .update({ departamento: newClean })
    .eq('departamento', oldClean)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

export async function contarUsuariosPorDepartamento(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from(TABLE).select('departamento');
  if (error) throw error;
  return (data ?? []).reduce<Record<string, number>>((acc, row) => {
    const d = (row as { departamento: string | null }).departamento;
    if (d) acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});
}

export async function eliminarDepartamento(nombre: string): Promise<void> {
  const counts = await contarUsuariosPorDepartamento();
  if ((counts[nombre] ?? 0) > 0) {
    throw new Error(`No se puede eliminar: ${counts[nombre]} usuario(s) usan este departamento`);
  }
  await deleteTaxonomia('usuario.departamento', nombre);
}

/** Llama a la Edge Function crear-usuario (clave por defecto: 123456). */
export async function crearUsuario(input: CrearUsuarioInput): Promise<{ id: string }> {
  const { data, error } = await supabase.functions.invoke<
    { ok: true; id: string; email: string } | { error: string }
  >('crear-usuario', { body: input });
  if (error) throw new Error(error.message ?? 'Error al crear usuario');
  if (!data || 'error' in data) throw new Error((data && 'error' in data && data.error) || 'Respuesta inválida');
  return { id: data.id };
}

export interface ActualizarUsuarioInput {
  nombre?: string;
  apellido?: string;
  ci?: string;
  telefono?: string;
  departamento?: string;
  role?: Role | string;
}

/** Actualiza datos editables del usuario (no toca email ni password). */
export async function actualizarUsuario(id: string, input: ActualizarUsuarioInput): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.nombre != null) payload.nombre = input.nombre.trim();
  if (input.apellido != null) payload.apellido = input.apellido.trim();
  if (input.ci != null) payload.ci = input.ci.trim();
  if (input.telefono != null) payload.telefono = input.telefono.trim() || null;
  if (input.departamento != null) payload.departamento = input.departamento.trim() || null;
  if (input.role != null) payload.role = String(input.role);
  const { error } = await supabase.from(TABLE).update(payload).eq('id', id);
  if (error) throw error;
}

/** Llama a la Edge Function cambiar-correo (solo admin): cambia el correo en Auth
 *  (identidad de login) y en la tabla `usuarios` en una sola operación. */
export async function cambiarCorreoUsuario(userId: string, email: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<
    { ok: true; email: string } | { error: string }
  >('cambiar-correo', { body: { user_id: userId, email } });
  if (error) throw new Error(error.message ?? 'Error al cambiar el correo');
  if (!data || 'error' in data) throw new Error((data && 'error' in data && data.error) || 'Respuesta inválida');
}

/** Llama a la Edge Function resetear-clave. */
export async function resetearClave(userId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<
    { ok: true } | { error: string }
  >('resetear-clave', { body: { user_id: userId } });
  if (error) throw new Error(error.message ?? 'Error al resetear');
  if (!data || 'error' in data) throw new Error((data && 'error' in data && data.error) || 'Respuesta inválida');
}

export async function setEstadoUsuario(id: string, estado: 'activo' | 'inactivo'): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ estado }).eq('id', id);
  if (error) throw error;
}

/** Cambia la clave del usuario logueado y desactiva el flag must_change_password.
 *  El flag se limpia vía RPC `clear_must_change_password` (SECURITY DEFINER) porque
 *  las políticas RLS de `usuarios` no permiten que un usuario actualice su propia
 *  fila directamente — un UPDATE plano se rechazaba en silencio. */
export async function cambiarMiClave(nuevaClave: string): Promise<void> {
  const { error: pwErr } = await supabase.auth.updateUser({ password: nuevaClave });
  if (pwErr) throw pwErr;
  const { data, error: rpcErr } = await supabase.rpc('clear_must_change_password');
  if (rpcErr) {
    throw new Error(`Clave actualizada pero no se pudo limpiar la bandera de cambio obligatorio: ${rpcErr.message}`);
  }
  if (data === false) {
    throw new Error('No se encontró la ficha del usuario en el sistema para limpiar la bandera.');
  }
}
