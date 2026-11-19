/* ============================================================
   MGG · Roles y permisos (Nivelado visual exacto a GT)
   Se separa la pared de tablas en dos capas:
   1. Galería de roles (vista general con barra de alcance por rol).
   2. Ficha técnica del rol seleccionado (RolFicha).
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './usuarios.css';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { norm } from '@/shared/lib/texto';
import {
  loadPermisos,
  loadTelefonoRoles,
  saveTelefonoRol,
  savePermisosRole,
  eliminarPermisosRol,
  normalizeRolePermisos,
  emptyPermission as empty,
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
  const { isAdmin } = usePermissions();
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [permisos, setPermisos] = useState<AllPermisos>({} as AllPermisos);
  const [telefono, setTelefono] = useState<Record<RoleKey, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [autoEstado, setAutoEstado] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [buscarRol, setBuscarRol] = useState('');
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
      const current = prev[role]?.[mod] ?? { ...empty };
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

  function resetRol(role: RoleKey) {
    const def = defaultsFor(role);
    setPermisos((prev) => ({ ...prev, [role]: def }));
    void persistirRol(role, def);
    toast(`Permisos del rol "${role}" reseteados al valor por defecto`, 'info');
  }

  async function handleEliminarRol(role: CustomRole) {
    try {
      await eliminarRol(role.key);
      try { await eliminarPermisosRol(role.key); } catch { /* opcional */ }
      setModal({ kind: 'none' });
      setRolAbierto(null);
      await reload();
      toast(`Rol "${role.label}" eliminado`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar el rol', 'error');
    }
  }

  const rolesVisibles = (() => {
    const t = norm(buscarRol);
    if (!t) return roles;
    return roles.filter((r) =>
      t.split(/\s+/).every((p) => norm(`${r.label} ${r.key} ${r.descripcion ?? ''}`).includes(p)),
    );
  })();

  const rolSel = rolAbierto ? roles.find((r) => r.key === rolAbierto) ?? null : null;

  /* La ficha del rol reemplaza la galería: la matriz se monta solo para
     el rol que se está editando, no para todos a la vez. */
  if (rolSel) {
    const enUso = counts[rolSel.key] ?? 0;
    return (
      <div>
        <RolFicha
          rol={rolSel}
          usuariosEnUso={enUso}
          permisos={permisos[rolSel.key]}
          vistasTelefono={telefono[rolSel.key] ?? []}
          soloTelefono={!!rolSel.solo_telefono}
          readOnly={readOnly}
          bloqueado={rolSel.key === 'admin' && !isAdmin}
          autoEstado={autoEstado}
          onVolver={() => setRolAbierto(null)}
          onToggle={(mod, field) => togglePerm(rolSel.key, mod, field)}
          onToggleTelefono={(v) => cambiarVistaTelefono(rolSel.key, v)}
          onSoloTelefono={(val) => void cambiarSoloTelefono(rolSel.key, val)}
          onReset={() => resetRol(rolSel.key)}
          onEliminar={
            !readOnly && !rolSel.sistema && enUso === 0
              ? () => setModal({ kind: 'eliminar', role: rolSel })
              : null
          }
        />

        {modal.kind === 'eliminar' && (
          <ConfirmDialog
            title="Eliminar rol"
            message={`Se eliminará el rol "${modal.role.label}". Esto borra también su matriz de permisos. ¿Continuar?`}
            confirmText="Eliminar"
            danger
            onCancel={() => setModal({ kind: 'none' })}
            onConfirm={async () => {
              await handleEliminarRol(modal.role);
              setRolAbierto(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Quién FIRMA no es lo mismo que qué puede ver cada rol: va antes
          y con encabezado propio, en vez de empotrado entre los roles. */}
      <div className="rol-seccion-aparte">
        <UsuariosAutorizadosPanel readOnly={readOnly} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.88rem', maxWidth: '58ch' }}>
          Elige un rol para ver y ajustar qué puede hacer. Puedes crear roles nuevos y
          eliminar los que no tengan usuarios asignados.
        </p>
        {!readOnly && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setModal({ kind: 'gestionar' })} title="Editar nombre, descripción o color de roles">
              ⚙ Gestionar
            </button>
            <button className="btn btn-ghost" onClick={() => setModal({ kind: 'crear' })}>+ Nuevo rol</button>
          </div>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <input
            id="roles-buscar" className="input" style={{ maxWidth: 360 }}
            value={buscarRol} onChange={(e) => setBuscarRol(e.target.value)}
            placeholder="🔍 Buscar rol por nombre o descripción…" aria-label="Buscar rol"
          />
          {buscarRol && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBuscarRol('')}>✕ Limpiar</button>}
          <span className="muted" style={{ fontSize: '.8rem' }}>{rolesVisibles.length} de {roles.length} roles</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: '1.25rem' }}>
          <p className="muted" style={{ margin: 0 }}>Cargando roles…</p>
        </div>
      ) : !rolesVisibles.length ? (
        <div className="card muted" style={{ padding: '1.25rem' }}>Ningún rol coincide con «{buscarRol}».</div>
      ) : (
        /* Galería: cada rol resumido en una barra de alcance. */
        <div className="rol-galeria">
          {rolesVisibles.map((rc) => {
            const enUso = counts[rc.key] ?? 0;
            const alcance = alcanceDeRol(permisos[rc.key]);
            const pct = Math.round((alcance.conAcceso / alcance.total) * 100);
            const vistasTel = telefono[rc.key]?.length ?? 0;
            return (
              <button
                key={rc.key}
                type="button"
                className="rol-card"
                style={{ '--rol-color': rc.color } as CSSProperties}
                onClick={() => setRolAbierto(rc.key)}
                title={`Ver y ajustar los permisos de ${rc.label}`}
              >
                <span className="rol-card-nombre">
                  {rc.label}
                  {rc.sistema && <span className="badge" style={{ fontSize: '.65rem' }}>SISTEMA</span>}
                </span>
                <span className="rol-card-usuarios">
                  {enUso === 0 ? 'Sin usuarios asignados' : `${enUso} usuario(s) asignado(s)`}
                </span>
                {rc.descripcion && <p className="rol-card-desc">{rc.descripcion}</p>}

                <span className="rol-alcance-fila">
                  <span
                    className="rol-alcance"
                    role="img"
                    aria-label={`Ve ${alcance.conAcceso} de ${alcance.total} módulos`}
                  >
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span className="rol-alcance-cifra">{alcance.conAcceso}/{alcance.total}</span>
                </span>

                <span className="rol-card-extras">
                  <span>✎ {alcance.escritura} con escritura</span>
                  {alcance.full > 0 && <span>★ {alcance.full} full</span>}
                  {rc.key === 'admin'
                    ? <span>📱 todas</span>
                    : (
                      <span>{vistasTel === 0 ? '📱 sin pantallas' : `📱 ${vistasTel} pantalla(s)`}</span>
                    )}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
            setRolAbierto(creado.key);
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
    </div>
  );
}
