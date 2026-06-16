import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getAppUser, useSession, type AppUser } from './authStore';
import {
  loadRolePermisos,
  defaultsFor,
  normalizeRolePermisos,
  MODULES,
  modulePath,
  type ModuleKey,
  type ModulePermission,
  type RolePermisos,
} from '@/modules/usuarios/permisos.repository';

export type PermLevel = keyof ModulePermission; // 'lectura' | 'escritura' | 'full'

interface PermissionsValue {
  loading: boolean;
  role: string | null;
  /** Usuario actual (de la tabla `usuarios`). Compartido para evitar re-consultarlo por página. */
  appUser: AppUser | null;
  permisos: RolePermisos | null;
  isAdmin: boolean;
  /** ¿El rol actual tiene `level` (por defecto lectura) sobre `module`? */
  can: (module: ModuleKey, level?: PermLevel) => boolean;
  /** Módulos con al menos lectura, en el orden canónico de MODULES. */
  allowedModules: ModuleKey[];
}

const PermissionsContext = createContext<PermissionsValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, loading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [permisos, setPermisos] = useState<RolePermisos | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      setRole(null);
      setAppUser(null);
      setPermisos(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const u = await getAppUser(user);
      if (cancelled) return;
      setAppUser(u);
      const r = u?.role ?? null;
      setRole(r);
      if (!r) {
        setPermisos(null);
        setLoading(false);
        return;
      }
      let stored: RolePermisos | null = null;
      try {
        stored = await loadRolePermisos(r);
      } catch {
        stored = null; // RLS/offline: caemos a los defaults del rol
      }
      if (cancelled) return;
      // Si la matriz aún no tiene fila para el rol, usamos los defaults (mismos que el panel).
      setPermisos(stored ? normalizeRolePermisos(stored) : defaultsFor(r));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, sessionLoading]);

  const value = useMemo<PermissionsValue>(() => {
    const isAdmin = role === 'admin';
    const can = (module: ModuleKey, level: PermLevel = 'lectura') => {
      // El admin es superusuario: nunca queda bloqueado de su propio panel de permisos.
      if (isAdmin) return true;
      const p = permisos?.[module];
      if (!p) return false;
      return p.full || p[level];
    };
    const allowedModules = MODULES.map((m) => m.key).filter((k) => can(k, 'lectura'));
    return { loading, role, appUser, permisos, isAdmin, can, allowedModules };
  }, [loading, role, appUser, permisos]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions debe usarse dentro de <PermissionsProvider>');
  return ctx;
}

/** Envuelve una página: si el rol no tiene lectura sobre `module`, redirige al primer módulo permitido. */
export function RequireModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { loading, can, allowedModules } = usePermissions();
  if (loading) return <div className="p-8 muted">Cargando…</div>;
  if (can(module, 'lectura')) return <>{children}</>;
  const fallback = allowedModules[0];
  return <Navigate to={fallback ? `/app/${modulePath(fallback)}` : '/app/sin-acceso'} replace />;
}

/** Redirige al primer módulo al que el usuario tiene acceso (usado como índice de /app). */
export function HomeRedirect() {
  const { loading, allowedModules } = usePermissions();
  if (loading) return <div className="p-8 muted">Cargando…</div>;
  const first = allowedModules[0];
  return <Navigate to={first ? `/app/${modulePath(first)}` : '/app/sin-acceso'} replace />;
}
