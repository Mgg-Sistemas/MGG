/* ============================================================
   MGG · Roles y permisos (Rediseño visual tipo GT)
   Se separa la pared de tablas en dos capas:
   1. Galería de roles (vista general con barra de alcance por rol).
   2. Ficha técnica del rol seleccionado (RolFicha).
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  loadPermisos,
  loadTelefonoRoles,
  saveTelefonoRol,
  savePermisosRole,
  eliminarPermisosRol,
  normalizeRolePermisos,
  defaultsFor,
  type AllPermisos,
  type ModuleKey,
  type ModulePermission,
  type RoleKey,
  type RolePermisos,
} from './permisos.repository';
import {
  listRoles,
  actualizarRol,
  eliminarRol,
  contarUsuariosPorRol,
  type CustomRole,
} from './roles.repository';
import { setRolesCache } from './usuarios.repository';
import { NuevoRolModal, GestionarRolesModal } from './RolesModales';
import { UsuariosAutorizadosPanel } from './UsuariosAutorizadosPanel';
import { RolFicha } from './RolFicha';
import { alcanceDeRol } from './gruposModulos';

// Un módulo que la fila guardada aún no trae se muestra con el default del rol
function normalize(stored: Partial<AllPermisos>, roles: CustomRole[]): AllPermisos {
  return roles.reduce<AllPermisos>((acc: AllPermisos, r: CustomRole) => {
    const role = stored[r.key] as Partial<RolePermisos> | undefined;
    acc[r.key] = role ? normalizeRolePermisos(role) : defaultsFor(r.key);
    return acc;
  }, {} as AllPermisos);
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'crear' }
  | { kind: 'gestionar' }
  | { kind: 'eliminar'; role: CustomRole };

export function RolesPermisosPanel({ readOnly = false, onRolesChanged }: { readOnly?: boolean; onRolesChanged?: () => void } = {}) {
  const { user } = useSession();
  const { isAdmin } = usePermissions(); // el rol admin solo lo edita el admin
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [permisos, setPermisos] = useState<AllPermisos>({} as AllPermisos);
  const [telefono, setTelefono] = useState<Record<RoleKey, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [autoEstado, setAutoEstado] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [buscarRol, setBuscarRol] = useState('');
  /* Galería → ficha. Se abre en la galería y la matriz solo se monta para el rol que se va a editar. */
  const [rolAbierto, setRolAbierto] = useState<RoleKey | null>(null);

  const guardandoRef = useRef(0);
  const refrescarAlTerminar = useRef(false);

  async function refresh(silencioso = false) {
    if (!silencioso) setLoading(true);
    try {
      const [rolesList, remote, c, tel] = await Promise.all([
        listRoles(),
        loadPermisos(),
        contarUsuariosPorRol(),
        loadTelefonoRoles().catch(() => ({} as Record<RoleKey, string[]>)),
      ]);
      setRolesCache(rolesList);
      setRoles(rolesList);
      setCounts(c);
      setTelefono(tel);
      if (remote) {
        setPermisos(normalize(remote, rolesList));
      } else {
        const defaults = rolesList.reduce<AllPermisos>((acc: AllPermisos, r: CustomRole) => {
          acc[r.key] = defaultsFor(r.key);
          return acc;
        }, {} as AllPermisos);
        setPermisos(defaults);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar la matriz', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refresh().finally(() => { if (cancelled) void 0; });
    return () => { cancelled = true; };
  }, []);

  async function reload() {
    await refresh();
    onRolesChanged?.();
  }

  function togglePerm(role: RoleKey, mod: ModuleKey, field: keyof ModulePermission) {
    setPermisos((prev) => {
      const current = prev[role]?.[mod] ?? { lectura: false, escritura: false, full: false };
      const next: ModulePermission = { ...current, [field]: !current[field] };
      if (field === 'full' && next.full) {
        next.lectura = true;
        next.escritura = true;
      }
      if ((field === 'lectura' || field === 'escritura') && !next[field]) {
        next.full = false;
        next.vaciar_papelera = false;
      }
      const nextRole = normalizeRolePermisos({ ...prev[role], [mod]: next });
      void persistirRol(role, nextRole);
      return { ...prev, [role]: nextRole };
    });
  }

  async function persistirRol(role: RoleKey, rolePermisos: RolePermisos) {
    guardandoRef.current += 1;
    setAutoEstado('guardando');
    try {
      await savePermisosRole(role, rolePermisos, user?.email ?? 'sistema');
      setAutoEstado('guardado');
    } catch (e) {
      setAutoEstado('error');
      toast(e instanceof Error ? e.message : 'No se pudo guardar el permiso', 'error');
    } finally {
      guardandoRef.current -= 1;
      if (guardandoRef.current === 0 && refrescarAlTerminar.current) {
        refrescarAlTerminar.current = false;
        void refresh(true);
      }
    }
  }

  function cambiarVistaTelefono(role: RoleKey, vista: string) {
    const actuales = telefono[role] ?? [];
    const next = actuales.includes(vista) ? actuales.filter((x) => x !== vista) : [...actuales, vista];
    setTelefono((prev) => ({ ...prev, [role]: next }));
    setAutoEstado('guardando');
    saveTelefonoRol(role, next, user?.email ?? 'sistema', permisos[role] ?? defaultsFor(role))
      .then(() => setAutoEstado('guardado'))
      .catch((e) => {
        setAutoEstado('error');
        toast(e instanceof Error ? e.message : 'No se pudo guardar la pantalla', 'error');
      });
  }

  async function cambiarSoloTelefono(role: RoleKey, valor: boolean) {
    setAutoEstado('guardando');
    try {
      await actualizarRol(role, { soloTelefono: valor });
      setRoles((prev) => prev.map((r) => (r.key === role ? { ...r, solo_telefono: valor } : r)));
      setAutoEstado('guardado');
    } catch (e) {
      setAutoEstado('error');
      toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error');
    }
  }

  function handleReset(role: RoleKey) {
    const def = defaultsFor(role);
    setPermisos((prev) => ({ ...prev, [role]: def }));
    void persistirRol(role, def);
  }

  async function handleEliminarRol(role: CustomRole) {
    try {
      await eliminarRol(role.key);
      await eliminarPermisosRol(role.key);
      setModal({ kind: 'none' });
      setRolAbierto(null);
      await reload();
      toast(`Rol "${role.label}" eliminado`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar el rol', 'error');
    }
  }

  const rolesFiltrados = useMemo(() => {
    const q = buscarRol.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) =>
      r.label.toLowerCase().includes(q)
      || r.key.toLowerCase().includes(q)
      || (r.descripcion && r.descripcion.toLowerCase().includes(q)),
    );
  }, [roles, buscarRol]);

  const rolActual = roles.find((r) => r.key === rolAbierto);

  if (loading) {
    return <div className="muted" style={{ padding: '2rem 0' }}>Cargando roles y permisos…</div>;
  }

  /* ── 2. Si hay un rol abierto: FICHA TÉCNICA ── */
  if (rolActual) {
    return (
      <RolFicha
        rol={rolActual}
        usuariosEnUso={counts[rolActual.key] ?? 0}
        permisos={permisos[rolActual.key]}
        vistasTelefono={telefono[rolActual.key] ?? []}
        soloTelefono={!!rolActual.solo_telefono}
        readOnly={readOnly}
        bloqueado={rolActual.key === 'admin' && !isAdmin}
        autoEstado={autoEstado}
        onVolver={() => setRolAbierto(null)}
        onToggle={(mod, field) => togglePerm(rolActual.key, mod, field)}
        onToggleTelefono={(v) => cambiarVistaTelefono(rolActual.key, v)}
        onSoloTelefono={(val) => void cambiarSoloTelefono(rolActual.key, val)}
        onReset={() => handleReset(rolActual.key)}
        onEliminar={
          rolActual.key !== 'admin' && (counts[rolActual.key] ?? 0) === 0
            ? () => setModal({ kind: 'eliminar', role: rolActual })
            : null
        }
      />
    );
  }

  /* ── 1. Vista principal: AUTORIZADOS + GALERÍA DE ROLES ── */
  return (
    <div>
      {/* Apartado propio para autorizados: ya no queda en medio de las tablas */}
      <UsuariosAutorizadosPanel readOnly={readOnly} />

      {/* Cabecera de la galería con buscador y botones de gestión */}
      <div className="rol-galeria-top">
        <div className="rol-galeria-meta">
          <strong>Galería de roles</strong>
          <span className="muted">
            · {roles.length} {roles.length === 1 ? 'rol definido' : 'roles definidos'}
          </span>
        </div>
        <div className="rol-galeria-acciones">
          <input
            type="search"
            className="input input-sm rol-buscador"
            placeholder="🔍 Filtrar rol…"
            value={buscarRol}
            onChange={(e) => setBuscarRol(e.target.value)}
            aria-label="Filtrar roles"
          />
          {!readOnly && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setModal({ kind: 'crear' })}
              >
                + Nuevo rol
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModal({ kind: 'gestionar' })}
              >
                ⚙ Gestionar roles
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grilla de tarjetas de rol */}
      <div className="rol-galeria">
        {rolesFiltrados.map((rc) => {
          const scope = alcanceDeRol(permisos[rc.key]);
          const porcentaje = scope.total > 0 ? Math.round((scope.conAcceso / scope.total) * 100) : 0;
          const bloqueado = rc.key === 'admin' && !isAdmin;
          return (
            <article
              key={rc.key}
              className={`rol-card ${rolAbierto === rc.key ? 'activo' : ''}`}
              style={{ '--rol-color': rc.color || 'var(--primary)' } as React.CSSProperties}
              onClick={() => setRolAbierto(rc.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setRolAbierto(rc.key);
                }
              }}
            >
              <div className="rol-card-head">
                <span className="rol-card-tag" style={{ background: rc.color || 'var(--primary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 className="rol-card-title">{rc.label}</h3>
                  <p className="rol-card-desc">{rc.descripcion || 'Sin descripción'}</p>
                </div>
                <span className="rol-card-uso" title="Usuarios con este rol">
                  👤 {counts[rc.key] ?? 0}
                </span>
              </div>

              <div className="rol-card-alcance">
                <div className="rol-card-barra-wrap">
                  <div
                    className="rol-card-barra"
                    style={{ width: `${porcentaje}%`, background: rc.color || 'var(--primary)' }}
                  />
                </div>
                <div className="rol-card-stats">
                  <span>{scope.conAcceso} de {scope.total} módulos ({porcentaje}%)</span>
                  {scope.full > 0 && <span>· {scope.full} total</span>}
                  {scope.escritura > 0 && <span>· {scope.escritura} edición</span>}
                </div>
              </div>

              {rc.solo_telefono && (
                <div className="rol-card-extra">
                  <span className="tag tag-sm" style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--warning)' }}>
                    📱 Solo teléfono
                  </span>
                </div>
              )}

              <div className="rol-card-foot">
                <span className="rol-card-accion">
                  {bloqueado ? '🔒 Solo lectura' : '⚙ Ver ficha y permisos →'}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {modal.kind === 'crear' && (
        <NuevoRolModal
          actorEmail={user?.email ?? undefined}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async (creado) => {
            const def = defaultsFor(creado.key);
            setPermisos((prev) => ({ ...prev, [creado.key]: def }));
            await persistirRol(creado.key, def);
            setModal({ kind: 'none' });
            await reload();
          }}
        />
      )}

      {modal.kind === 'gestionar' && (
        <GestionarRolesModal
          roles={roles}
          conteoUso={counts}
          actorEmail={user?.email ?? undefined}
          onClose={() => setModal({ kind: 'none' })}
          onCambioAplicado={reload}
        />
      )}

      {modal.kind === 'eliminar' && (
        <ConfirmDialog
          title="Eliminar rol"
          message={`Se eliminará el rol "${modal.role.label}". Esto borra también su matriz de permisos. ¿Continuar?`}
          confirmText="Eliminar"
          danger
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={() => handleEliminarRol(modal.role)}
        />
      )}
    </div>
  );
}
