import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { useSession } from '@/modules/auth/authStore';
import {
  loadPermisos,
  loadTelefonoRoles,
  saveTelefonoRol,
  savePermisosRole,
  eliminarPermisosRol,
  normalizeRolePermisos,
  MODULES,
  emptyPermission as empty,
  defaultsFor,
  type AllPermisos,
  type ModuleKey,
  type ModulePermission,
  type RoleKey,
  type RolePermisos,
} from './permisos.repository';
import { VISTAS_TELEFONO } from '@/modules/auth/vistasTelefono';
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

function normalize(stored: Partial<AllPermisos>, roles: CustomRole[]): AllPermisos {
  return roles.reduce<AllPermisos>((acc, r) => {
    const role = (stored[r.key] ?? {}) as Partial<RolePermisos>;
    acc[r.key] = MODULES.reduce<RolePermisos>((m, mod) => {
      m[mod.key] = { ...empty, ...role[mod.key] };
      return m;
    }, {} as RolePermisos);
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
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [permisos, setPermisos] = useState<AllPermisos>({} as AllPermisos);
  // Pantallas de teléfono dadas a cada rol (13-10): se otorgan aparte del módulo.
  const [telefono, setTelefono] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [autoEstado, setAutoEstado] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  // Buscador de roles (06-10-2026): con muchos roles, la grilla se hace larga.
  const [busca, setBusca] = useState('');
  const rolesVisibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return roles;
    return roles.filter((r) => `${r.label} ${r.key} ${r.descripcion ?? ''}`.toLowerCase().includes(t));
  }, [roles, busca]);

  async function refresh() {
    setLoading(true);
    try {
      const [rolesList, remote, c, tel] = await Promise.all([
        listRoles(),
        loadPermisos(),
        contarUsuariosPorRol(),
        loadTelefonoRoles().catch(() => ({} as Record<string, string[]>)),
      ]);
      setRolesCache(rolesList);
      setRoles(rolesList);
      setCounts(c);
      setTelefono(tel);
      if (remote) {
        setPermisos(normalize(remote, rolesList));
      } else {
        const defaults = rolesList.reduce<AllPermisos>((acc, r) => {
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

  // Recarga la matriz y avisa al padre (para que el dropdown de "crear usuario"
  // y otros listados de roles se actualicen automáticamente tras un cambio).
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
      }
      const nextRole = normalizeRolePermisos({ ...prev[role], [mod]: next });
      // Autoguardado: persiste de inmediato los permisos de ESE rol (no depende
      // del botón "Guardar", para que no se pierdan al cambiar de vista).
      void persistirRol(role, nextRole);
      return { ...prev, [role]: nextRole };
    });
  }

  async function persistirRol(role: RoleKey, rolePermisos: RolePermisos) {
    setAutoEstado('guardando');
    try {
      await savePermisosRole(role, rolePermisos, user?.email ?? 'sistema');
      setAutoEstado('guardado');
    } catch (e) {
      setAutoEstado('error');
      toast(e instanceof Error ? e.message : 'No se pudo guardar el permiso', 'error');
    }
  }

  /** Marca o desmarca una pantalla de teléfono del rol (autoguardado en roles_permisos). */
  function cambiarVista(role: RoleKey, vista: string) {
    const actuales = telefono[role] ?? [];
    const next = actuales.includes(vista) ? actuales.filter((x) => x !== vista) : [...actuales, vista];
    setTelefono((prev) => ({ ...prev, [role]: next }));
    setAutoEstado('guardando');
    saveTelefonoRol(role, next, user?.email ?? 'sistema', permisos[role] ?? defaultsFor(role))
      .then(() => setAutoEstado('guardado'))
      .catch((e) => { setAutoEstado('error'); toast(e instanceof Error ? e.message : 'No se pudo guardar la pantalla', 'error'); });
  }

  /** La marca «solo teléfono» vive en el rol (custom_roles): se cambia ahí y se recarga la lista. */
  async function cambiarSoloTelefono(role: RoleKey, valor: boolean) {
    setAutoEstado('guardando');
    try {
      await actualizarRol(role, { soloTelefono: valor });
      setRoles((prev) => prev.map((r) => (r.key === role ? { ...r, solo_telefono: valor } : r)));
      setAutoEstado('guardado');
      onRolesChanged?.();
    } catch (e) { setAutoEstado('error'); toast(e instanceof Error ? e.message : 'No se pudo cambiar la marca', 'error'); }
  }

  function resetRol(role: RoleKey) {
    const def = defaultsFor(role);
    setPermisos((prev) => ({ ...prev, [role]: def }));
    void persistirRol(role, def); // autoguardado
    toast(`Permisos del rol "${role}" reseteados al valor por defecto`, 'info');
  }

  async function handleEliminarRol(role: CustomRole) {
    try {
      await eliminarRol(role.key);
      try { await eliminarPermisosRol(role.key); } catch { /* opcional */ }
      notify(`Rol eliminado: ${role.label}`, 'success', { link: '#/app/usuarios' });
      setModal({ kind: 'none' });
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Roles y Permiso</h2>
          <p className="hint muted" style={{ margin: '.25rem 0 0', fontSize: '.88rem' }}>
            Definí qué acciones puede realizar cada rol sobre cada módulo. Podés crear roles
            nuevos y eliminar los que no tengan usuarios asignados.
          </p>
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span
              className="muted"
              style={{ fontSize: '.8rem', color: autoEstado === 'error' ? 'var(--danger)' : autoEstado === 'guardado' ? 'var(--success)' : undefined }}
              aria-live="polite"
            >
              {autoEstado === 'guardando' ? '⏳ Guardando…'
                : autoEstado === 'guardado' ? '✓ Guardado automáticamente'
                : autoEstado === 'error' ? '⚠ Error al guardar'
                : '💾 Los cambios se guardan automáticamente'}
            </span>
            <button className="btn btn-ghost" onClick={() => setModal({ kind: 'gestionar' })} title="Editar nombre, descripción o color de roles">
              ⚙ Gestionar
            </button>
            <button className="btn btn-ghost" onClick={() => setModal({ kind: 'crear' })}>+ Nuevo rol</button>
          </div>
        )}
      </div>

      {/* Quién aprueba OC y salidas (28-10-2026): lista propia, con su firma. */}
      <UsuariosAutorizadosPanel readOnly={readOnly} actorEmail={user?.email ?? 'sistema'} />

      {!loading && (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="🔍 Buscar rol por nombre o descripción…" style={{ width: 'min(100%, 340px)' }} />
          <span className="muted" style={{ fontSize: '.8rem' }}>{rolesVisibles.length} de {roles.length} rol(es)</span>
          {busca && <button className="btn btn-sm btn-ghost" onClick={() => setBusca('')}>✕ Limpiar</button>}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: '1.25rem' }}>
          <p className="hint muted" style={{ margin: 0 }}>Cargando matriz de permisos…</p>
        </div>
      ) : !rolesVisibles.length ? (
        <div className="card" style={{ padding: '1.25rem' }}>
          <p className="hint muted" style={{ margin: 0 }}>Ningún rol coincide con «{busca.trim()}».</p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
            gap: '1rem',
          }}
        >
          {rolesVisibles.map((rc) => {
            const enUso = counts[rc.key] ?? 0;
            return (
              <div
                key={rc.key}
                className="card"
                style={{ padding: '1.25rem', borderTop: `3px solid ${rc.color}` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
                  <div>
                    <div className="card-title" style={{ marginBottom: '.25rem' }}>
                      <span>{rc.label}</span>
                      {rc.sistema && <span className="badge" style={{ marginLeft: '.4rem', fontSize: '.65rem' }}>SISTEMA</span>}
                    </div>
                    <p className="hint muted" style={{ margin: 0, fontSize: '.78rem' }}>{rc.descripcion ?? '—'}</p>
                    <p className="hint muted" style={{ margin: '.25rem 0 0', fontSize: '.72rem' }}>
                      {enUso === 0 ? 'Sin usuarios asignados' : `${enUso} usuario(s) asignado(s)`}
                    </p>
                  </div>
                  {!readOnly && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => resetRol(rc.key)}
                        title="Resetear este rol a los valores por defecto"
                      >
                        ↺ Default
                      </button>
                      {!rc.sistema && enUso === 0 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => setModal({ kind: 'eliminar', role: rc })}
                          title="Eliminar este rol"
                        >
                          🗑 Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="table-wrap">
                <table className="table" style={{ fontSize: '.82rem' }}>
                  <thead>
                    <tr>
                      <th>Módulo</th>
                      <th style={{ textAlign: 'center' }}>Lectura</th>
                      <th style={{ textAlign: 'center' }}>Escritura</th>
                      <th style={{ textAlign: 'center' }} title="Implica lectura y escritura">Full control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((m) => {
                      const p = permisos[rc.key]?.[m.key] ?? { ...empty };
                      return (
                        <tr key={m.key}>
                          <td><strong>{m.label}</strong></td>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" disabled={readOnly} checked={p.lectura} onChange={() => togglePerm(rc.key, m.key, 'lectura')} aria-label={`Lectura ${m.label} para ${rc.label}`} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" disabled={readOnly} checked={p.escritura} onChange={() => togglePerm(rc.key, m.key, 'escritura')} aria-label={`Escritura ${m.label} para ${rc.label}`} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" disabled={readOnly} checked={p.full} onChange={() => togglePerm(rc.key, m.key, 'full')} aria-label={`Full control ${m.label} para ${rc.label}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>

                {/* Pantallas de teléfono (13-10, como en Golden Touch): se dan aparte del módulo.
                    El administrador ve todas las pantallas: no hay nada que elegir. */}
                {rc.key !== 'admin' && (() => {
                  const vistas = telefono[rc.key] ?? [];
                  const solo = rc.solo_telefono === true;
                  return (
                    <div style={{ marginTop: '.9rem', paddingTop: '.75rem', borderTop: '1px solid var(--border)', display: 'grid', gap: '.4rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '.85rem' }}>📱 Pantallas de teléfono</div>
                      {VISTAS_TELEFONO.map((v) => {
                        const marcada = vistas.includes(v.key);
                        const mod = permisos[rc.key]?.[v.modulo];
                        const sinModulo = !(mod?.lectura || mod?.full);
                        const modLabel = MODULES.find((m) => m.key === v.modulo)?.label ?? v.modulo;
                        return (
                          <label key={v.key} htmlFor={`tel-${rc.key}-${v.key}`} style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.82rem', cursor: readOnly ? 'default' : 'pointer' }}>
                            <input id={`tel-${rc.key}-${v.key}`} type="checkbox" disabled={readOnly} checked={marcada} onChange={() => cambiarVista(rc.key, v.key)} />
                            <span>
                              {v.icono} {v.label}
                              {marcada && sinModulo && (
                                <small style={{ display: 'block', color: 'var(--warning)' }}>No se abre: falta lectura en {modLabel}.</small>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      <label htmlFor={`tel-${rc.key}-solo`} style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.82rem', marginTop: '.2rem', cursor: readOnly ? 'default' : 'pointer' }}>
                        <input id={`tel-${rc.key}-solo`} type="checkbox" disabled={readOnly} checked={solo} onChange={() => void cambiarSoloTelefono(rc.key, !solo)} />
                        <span>
                          <strong>Solo teléfono</strong>
                          <small className="muted" style={{ display: 'block' }}>Entra directo a sus pantallas de teléfono y no ve las de PC, salvo Ajustes.</small>
                          {solo && !vistas.length && (
                            <small style={{ display: 'block', color: 'var(--danger)' }}>Sin pantallas marcadas, este rol no tiene nada que abrir.</small>
                          )}
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>
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
            // Persiste la fila del nuevo rol de inmediato (autoguardado) para que
            // no se pierda al refrescar la matriz.
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
