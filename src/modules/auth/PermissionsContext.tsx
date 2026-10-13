import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getAppUser, useSession, type AppUser } from './authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  loadAccesoRol,
  defaultsFor,
  normalizeRolePermisos,
  MODULES,
  modulePath,
  type ModuleKey,
  type ModulePermission,
  type RolePermisos,
} from '@/modules/usuarios/permisos.repository';
import { soloTelefonoDeRol } from '@/modules/usuarios/roles.repository';
import { VISTAS_TELEFONO, entraPorTelefono, inicioTelefono, vistasPermitidas, type VistaTelefono, type VistaTelefonoKey } from './vistasTelefono';

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
  /** Pantallas de teléfono que puede abrir: las dadas a su rol que además tengan lectura en su módulo (13-10). */
  vistasTelefono: VistaTelefono[];
  /** ¿Puede abrir esta pantalla de teléfono? */
  puedeVista: (vista: VistaTelefonoKey) => boolean;
  /**
   * El rol está marcado «solo teléfono» (02-10): trabaja desde sus pantallas de
   * celular y no ve los módulos de escritorio, salvo Ajustes.
   */
  soloTelefono: boolean;
}

const PermissionsContext = createContext<PermissionsValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, loading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [permisos, setPermisos] = useState<RolePermisos | null>(null);
  const [vistasRol, setVistasRol] = useState<string[]>([]);
  const [soloTelefono, setSoloTelefono] = useState(false);

  // Carga el rol del usuario y sus permisos. `mostrarCarga` evita el flash de
  // "Cargando…" en los refrescos en vivo (realtime), que sí ocurre al iniciar sesión.
  const cargar = useCallback(async (mostrarCarga: boolean) => {
    if (sessionLoading) return;
    if (!user) {
      setRole(null);
      setAppUser(null);
      setPermisos(null);
      setVistasRol([]);
      setSoloTelefono(false);
      setLoading(false);
      return;
    }
    if (mostrarCarga) setLoading(true);
    const u = await getAppUser(user);
    setAppUser(u);
    const r = u?.role ?? null;
    setRole(r);
    if (!r) {
      setPermisos(null);
      setVistasRol([]);
      setSoloTelefono(false);
      setLoading(false);
      return;
    }
    let stored: RolePermisos | null = null;
    let vistas: string[] = [];
    let marcaTelefono: boolean | null = null;
    try {
      const [acceso, marca] = await Promise.all([loadAccesoRol(r), soloTelefonoDeRol(r).catch(() => null)]);
      stored = acceso?.permisos ?? null;
      vistas = acceso?.vistas ?? [];
      marcaTelefono = marca;
    } catch {
      stored = null; // RLS/offline: caemos a los defaults del rol
    }
    // La marca «solo teléfono» vive en el rol (custom_roles); las pantallas, en roles_permisos.
    setSoloTelefono(marcaTelefono === true);
    setVistasRol(vistas);
    // Si la matriz aún no tiene fila para el rol, usamos los defaults (mismos que el panel).
    setPermisos(stored ? normalizeRolePermisos(stored) : defaultsFor(r));
    setLoading(false);
  }, [user, sessionLoading]);

  useEffect(() => { void cargar(true); }, [cargar]);

  // Realtime: si el admin cambia los permisos o las pantallas del rol (roles_permisos),
  // la marca del rol (custom_roles) o reasigna el rol del usuario (usuarios),
  // recargamos en vivo —sin volver a entrar—.
  useRealtime(['roles_permisos', 'usuarios', 'custom_roles'], () => { void cargar(false); }, { enabled: !!user });

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
    const vistasTelefono = vistasPermitidas(vistasRol, (m) => can(m, 'lectura'), isAdmin);
    const puedeVista = (vista: VistaTelefonoKey) => vistasTelefono.some((v) => v.key === vista);
    // El administrador nunca queda encerrado en el teléfono.
    return { loading, role, appUser, permisos, isAdmin, can, allowedModules, vistasTelefono, puedeVista, soloTelefono: !isAdmin && soloTelefono };
  }, [loading, role, appUser, permisos, vistasRol, soloTelefono]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions debe usarse dentro de <PermissionsProvider>');
  return ctx;
}

/** Adónde va el usuario cuando entra o cuando cae en algo que no puede ver.
 *  Quien tiene una pantalla de teléfono dada (el Surtidor, por ejemplo) entra por ella (13-10). */
function destinoInicial(p: Pick<PermissionsValue, 'allowedModules' | 'soloTelefono' | 'vistasTelefono' | 'isAdmin'>): string {
  if (entraPorTelefono({ isAdmin: p.isAdmin, soloTelefono: p.soloTelefono, vistas: p.vistasTelefono })) return inicioTelefono(p.vistasTelefono);
  const first = p.allowedModules[0];
  return first ? `/app/${modulePath(first)}` : '/app/sin-acceso';
}

/** Envuelve una página: si el rol no tiene lectura sobre `module`, redirige al primer módulo permitido. */
export function RequireModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const p = usePermissions();
  if (p.loading) return <div className="p-8 muted">Cargando…</div>;
  // Solo teléfono: de las pantallas de PC solo queda Ajustes (para cambiar la clave).
  if (p.soloTelefono && module !== 'ajustes') return <Navigate to={inicioTelefono(p.vistasTelefono)} replace />;
  if (p.can(module, 'lectura')) return <>{children}</>;
  return <Navigate to={destinoInicial(p)} replace />;
}

/**
 * Envuelve una pantalla de teléfono: hace falta la pantalla en el rol y lectura en su módulo.
 * Quien tiene el módulo pero no la pantalla va a la versión de PC del módulo.
 */
export function RequireVistaTelefono({ vista, children }: { vista: VistaTelefonoKey; children: ReactNode }) {
  const p = usePermissions();
  if (p.loading) return <div className="p-8 muted">Cargando…</div>;
  if (p.puedeVista(vista)) return <>{children}</>;
  const v = VISTAS_TELEFONO.find((x) => x.key === vista);
  if (!p.soloTelefono && v && p.can(v.modulo, 'lectura')) return <Navigate to={`/app/${modulePath(v.modulo)}`} replace />;
  return <Navigate to={destinoInicial(p)} replace />;
}

/** Redirige al primer módulo al que el usuario tiene acceso (usado como índice de /app).
 *  Un rol solo teléfono va a su pantalla, o a «Mis pantallas» si tiene varias. */
export function HomeRedirect() {
  const p = usePermissions();
  if (p.loading) return <div className="p-8 muted">Cargando…</div>;
  return <Navigate to={destinoInicial(p)} replace />;
}
