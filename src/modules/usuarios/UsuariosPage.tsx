import { Quien } from '@/shared/ui/Quien';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Usuario } from '@/shared/lib/types';
import {
  crearUsuario,
  actualizarUsuario,
  cambiarEmailUsuario,
  labelRol,
  listUsuarios,
  loadRolesAndCache,
  resetearClave,
  desbloquearUsuario,
  setEstadoUsuario,
  archivarUsuario,
  restaurarUsuario,
  getDepartamentos,
  addDepartamento,
  renombrarDepartamento,
  eliminarDepartamento,
  contarUsuariosPorDepartamento,
} from './usuarios.repository';
import { contarUsuariosPorRol, type CustomRole } from './roles.repository';
import { RolesPermisosPanel } from './RolesPermisosPanel';
import { NuevoRolModal, GestionarRolesModal } from './RolesModales';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { GestionarCategoriasModal } from '@/shared/ui/GestionarCategoriasModal';
import { ResumenActividadModal } from './ResumenActividadModal';
import { norm } from '@/shared/lib/texto';
import { listHistorialNombres, type CambioNombreUsuario } from './usuarios.repository';
import { estadoVisible, estaArchivado, filtrarPorEstado, puedeArchivar, type FiltroEstadoUsuario } from './usuariosArchivo';
import { DirectorioUsuarios } from './DirectorioUsuarios';
import './usuarios.css';

type View = 'creacion' | 'roles';

/* Cómo se mira el padrón: el Directorio agrupa por departamento (capa de
   descubrimiento) y la Tabla es la tradicional para trabajar. Se recuerda
   la última usada en este navegador. */
type VistaLista = 'directorio' | 'tabla';
const CLAVE_VISTA = 'mgg.usuarios.v1.vista';

function leerVistaLista(): VistaLista {
  try {
    const v = localStorage.getItem(CLAVE_VISTA);
    if (v === 'tabla' || v === 'directorio') return v;
  } catch { /* sin almacenamiento */ }
  return 'directorio';
}

function guardarVistaLista(v: VistaLista) {
  try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* no crítico */ }
}

type ModalKind =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; usuario: Usuario }
  | { kind: 'detail'; usuario: Usuario }
  | { kind: 'actividad' }
  | { kind: 'reset-confirm'; usuario: Usuario }
  | { kind: 'desbloquear-confirm'; usuario: Usuario }
  | { kind: 'clave-temporal'; titulo: string; email: string; clave: string }
  | { kind: 'toggle-confirm'; usuario: Usuario; targetEstado: 'activo' | 'inactivo' }
  | { kind: 'archivar-confirm'; usuario: Usuario }
  | { kind: 'restaurar-confirm'; usuario: Usuario };

type RoleQuickModal = 'none' | 'crear' | 'gestionar';

export function UsuariosPage() {
  const { can, isAdmin } = usePermissions();
  const canWrite = can('usuarios', 'escritura');
  const canFull = can('usuarios', 'full');
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const rolesAsignables = useMemo(() => (isAdmin ? roles : roles.filter((r) => r.key !== 'admin')), [roles, isAdmin]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const b = searchParams.get('buscar');
    if (b) {
      setFilterText(b);
      const next = new URLSearchParams(searchParams);
      next.delete('buscar');
      setSearchParams(next, { replace: true });
    }
  }, []);

  const [filterRol, setFilterRol] = useState<string>('');
  const [filterEstado, setFilterEstado] = useState<FiltroEstadoUsuario>('');
  const [modal, setModal] = useState<ModalKind>({ kind: 'none' });
  const [view, setView] = useState<View>('creacion');
  const [vistaLista, setVistaLista] = useState<VistaLista>(leerVistaLista);
  const cambiarVistaLista = (v: VistaLista) => { setVistaLista(v); guardarVistaLista(v); };
  const [roleQuickModal, setRoleQuickModal] = useState<RoleQuickModal>('none');
  const [conteoRoles, setConteoRoles] = useState<Record<string, number>>({});
  const [lastCreatedRoleKey, setLastCreatedRoleKey] = useState<string | null>(null);
  const [departamentos, setDepartamentos] = useState<string[]>([]);
  const [conteoDeptos, setConteoDeptos] = useState<Record<string, number>>({});
  const [gestionDeptosOpen, setGestionDeptosOpen] = useState(false);
  const { user } = useSession();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [rows, rolesList, counts, conteoD] = await Promise.all([
        listUsuarios(),
        loadRolesAndCache(),
        contarUsuariosPorRol().catch(() => ({} as Record<string, number>)),
        contarUsuariosPorDepartamento().catch(() => ({} as Record<string, number>)),
      ]);
      setUsuarios(rows);
      setRoles(rolesList);
      setConteoRoles(counts);
      setConteoDeptos(conteoD);
      setDepartamentos(await getDepartamentos(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar usuarios');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useRealtime(['usuarios', 'custom_roles', 'taxonomias'], () => { void refresh(); });

  const activos = useMemo(() => usuarios.filter((u) => estadoVisible(u) === 'activo').length, [usuarios]);
  const inactivos = useMemo(() => usuarios.filter((u) => estadoVisible(u) === 'inactivo').length, [usuarios]);
  const archivados = useMemo(() => usuarios.filter(estaArchivado).length, [usuarios]);

  const listaRef = useRef<HTMLDivElement>(null);
  const verEstado = (estado: Exclude<FiltroEstadoUsuario, ''>) => {
    setFilterEstado((prev) => (prev === estado ? '' : estado));
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const filtered = useMemo(() => {
    const q = norm(filterText);
    const nombreCompleto = (u: Usuario) => `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || u.email || '';
    return filtrarPorEstado(usuarios, filterEstado)
      .filter((u) => {
        if (filterRol && u.role !== filterRol) return false;
        if (q) {
          const hay = [u.nombre, u.apellido, u.email, u.ci, u.role]
            .map((v) => norm(String(v ?? '')))
            .join(' | ');
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es', { sensitivity: 'base' }));
  }, [usuarios, filterText, filterRol, filterEstado]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            {view === 'creacion'
              ? 'Gestión de usuarios del sistema. Crea cuentas con clave por defecto, edita datos, resetea claves olvidadas y habilita/deshabilita accesos. Los deshabilitados se pueden archivar para que salgan de la lista.'
              : 'Define qué puede hacer cada rol sobre cada módulo, qué ve en el teléfono y a qué depósitos entra.'}
          </p>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Vista de usuarios">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'creacion'}
            className={view === 'creacion' ? 'active' : ''}
            onClick={() => setView('creacion')}
          >
            👤 Personas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'roles'}
            className={view === 'roles' ? 'active' : ''}
            onClick={() => setView('roles')}
          >
            🛡 Roles y permisos
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {view === 'roles' ? (
        <RolesPermisosPanel readOnly={!canFull} onRolesChanged={refresh} />
      ) : (
      <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {([
          { estado: 'activo', label: 'Usuarios activos', valor: activos, delta: 'Con acceso al sistema', down: false, icon: '✓' },
          { estado: 'inactivo', label: 'Usuarios deshabilitados', valor: inactivos, delta: 'No pueden ingresar', down: true, icon: '⛔' },
          { estado: 'archivado', label: 'Usuarios archivados', valor: archivados, delta: 'Fuera de la lista · se pueden restaurar', down: false, icon: '🗄' },
        ] as const).map((k) => {
          const activa = filterEstado === k.estado;
          return (
            <div
              key={k.estado}
              className="kpi usr-filtro-card"
              role="button"
              tabIndex={0}
              aria-pressed={activa}
              title={activa ? 'Clic para quitar el filtro' : `Clic para ver solo ${k.label.toLowerCase()}`}
              onClick={() => verEstado(k.estado)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); verEstado(k.estado); } }}
            >
              <div className="label">{k.label}</div>
              <div className="value">{k.valor}</div>
              <div className={`delta${k.down ? ' down' : ''}`}>{k.delta}</div>
              <div className="usr-filtro-pista">
                {activa ? '✓ Viendo solo estos · clic para quitar' : '⌕ Clic para filtrar'}
              </div>
              <div className="icon">{k.icon}</div>
            </div>
          );
        })}
      </div>

      <div className="filterbar" style={{ marginTop: '1rem' }} ref={listaRef}>
        <input
          className="search"
          placeholder="Buscar por nombre, apellido, email, CI…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <select
          className="select"
          style={{ maxWidth: 200 }}
          value={filterRol}
          onChange={(e) => setFilterRol(e.target.value)}
        >
          <option value="">Todos los roles</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value as FiltroEstadoUsuario)}
        >
          <option value="">Activos y deshabilitados</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Deshabilitados</option>
          <option value="archivado">Archivados</option>
        </select>
        <div className="view-toggle" role="tablist" aria-label="Cómo ver el listado">
          <button
            type="button" role="tab" aria-selected={vistaLista === 'directorio'}
            className={vistaLista === 'directorio' ? 'active' : ''}
            onClick={() => cambiarVistaLista('directorio')}
            title="Agrupados por departamento"
          >
            Directorio
          </button>
          <button
            type="button" role="tab" aria-selected={vistaLista === 'tabla'}
            className={vistaLista === 'tabla' ? 'active' : ''}
            onClick={() => cambiarVistaLista('tabla')}
            title="La lista completa con todas las columnas"
          >
            Tabla
          </button>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setModal({ kind: 'actividad' })}
          title="Supervisión: usuarios conectados y tiempo en el sistema"
        >
          📊 Resumen de Actividad
        </button>
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'create' })}
          >
            + Agregar usuario
          </button>
        )}
      </div>

      {loading ? (
        <EmptyState message="Cargando usuarios…" icon="◔" />
      ) : !filtered.length ? (
        <div className="card">
          <EmptyState message="No hay usuarios que coincidan." icon="◇" />
        </div>
      ) : vistaLista === 'directorio' ? (
        <DirectorioUsuarios
          usuarios={filtered}
          roles={roles}
          onAbrir={(u) => setModal({ kind: 'detail', usuario: u })}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre completo</th>
                <th>CI</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Registrado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.id}
                  className="usr-fila"
                  tabIndex={0}
                  onClick={() => setModal({ kind: 'detail', usuario: u })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal({ kind: 'detail', usuario: u }); }
                  }}
                  title="Ver la ficha de este usuario"
                >
                  <td>
                    <strong>{[u.nombre, u.apellido].filter(Boolean).join(' ') || u.nombre}</strong>
                    {(u.bloqueado || u.must_change_password) && (
                      <div className="usr-persona-avisos">
                        {u.bloqueado && <span className="usr-aviso bloqueado">🔒 Bloqueado · 3 intentos fallidos</span>}
                        {u.must_change_password && <span className="usr-aviso clave">⚠ Clave pendiente</span>}
                      </div>
                    )}
                  </td>
                  <td className="mono">{u.ci ?? '—'}</td>
                  <td>{u.email}</td>
                  <td>{labelRol(u.role)}</td>
                  <td><StatusBadge estado={estadoVisible(u)} /></td>
                  <td className="muted" style={{ fontSize: '.82rem' }}>{dateTime(u.created_at)}</td>
                  <td className="actions">
                    {canWrite && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={(e) => { e.stopPropagation(); setModal({ kind: 'edit', usuario: u }); }}
                      >
                        Editar
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={(e) => { e.stopPropagation(); setModal({ kind: 'detail', usuario: u }); }}
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </>
      )}

      {modal.kind === 'create' && (
        <UsuarioFormModal
          roles={rolesAsignables}
          departamentos={departamentos}
          actorEmail={user?.email ?? undefined}
          recientementeCreado={lastCreatedRoleKey}
          onRecienteConsumido={() => setLastCreatedRoleKey(null)}
          onSolicitarNuevoRol={() => setRoleQuickModal('crear')}
          onSolicitarGestionRoles={() => setRoleQuickModal('gestionar')}
          onSolicitarGestionDeptos={() => setGestionDeptosOpen(true)}
          onDeptoAgregado={async (nuevo) => {
            await addDepartamento(nuevo, user?.email);
            const cs = await getDepartamentos(usuarios);
            setDepartamentos(cs);
          }}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={async (email, clave) => {
            setModal({ kind: 'clave-temporal', titulo: 'Usuario creado', email, clave });
            await refresh();
          }}
        />
      )}

      {modal.kind === 'edit' && (
        <UsuarioEditModal
          usuario={modal.usuario}
          roles={rolesAsignables}
          departamentos={departamentos}
          actorEmail={user?.email ?? undefined}
          recientementeCreado={lastCreatedRoleKey}
          onRecienteConsumido={() => setLastCreatedRoleKey(null)}
          onSolicitarNuevoRol={() => setRoleQuickModal('crear')}
          onSolicitarGestionRoles={() => setRoleQuickModal('gestionar')}
          onSolicitarGestionDeptos={() => setGestionDeptosOpen(true)}
          onDeptoAgregado={async (nuevo) => {
            await addDepartamento(nuevo, user?.email);
            const cs = await getDepartamentos(usuarios);
            setDepartamentos(cs);
          }}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={async () => {
            setModal({ kind: 'none' });
            await refresh();
          }}
        />
      )}

      {gestionDeptosOpen && (
        <GestionarCategoriasModal
          titulo="Departamentos"
          categorias={departamentos}
          conteoUso={conteoDeptos}
          entidadLabel="usuario"
          terminoSingular="departamento"
          onRenombrar={(o, n) => renombrarDepartamento(o, n, user?.email)}
          onEliminar={(n) => eliminarDepartamento(n)}
          onAgregar={(n) => addDepartamento(n, user?.email)}
          onCambioAplicado={refresh}
          onClose={() => setGestionDeptosOpen(false)}
        />
      )}

      {roleQuickModal === 'crear' && (
        <NuevoRolModal
          actorEmail={user?.email ?? undefined}
          onClose={() => setRoleQuickModal('none')}
          onCreated={async (creado) => {
            setLastCreatedRoleKey(creado.key);
            setRoleQuickModal('none');
            await refresh();
          }}
        />
      )}

      {roleQuickModal === 'gestionar' && (
        <GestionarRolesModal
          roles={roles}
          conteoUso={conteoRoles}
          actorEmail={user?.email ?? undefined}
          onClose={() => setRoleQuickModal('none')}
          onCambioAplicado={refresh}
        />
      )}

      {modal.kind === 'detail' && (
        <UsuarioDetailModal
          usuario={modal.usuario}
          onClose={() => setModal({ kind: 'none' })}
          onResetClave={() => setModal({ kind: 'reset-confirm', usuario: modal.usuario })}
          onDesbloquear={() => setModal({ kind: 'desbloquear-confirm', usuario: modal.usuario })}
          onToggleEstado={() =>
            setModal({
              kind: 'toggle-confirm',
              usuario: modal.usuario,
              targetEstado: modal.usuario.estado === 'activo' ? 'inactivo' : 'activo',
            })
          }
          onEdit={() => setModal({ kind: 'edit', usuario: modal.usuario })}
          onArchivar={() => setModal({ kind: 'archivar-confirm', usuario: modal.usuario })}
          onRestaurar={() => setModal({ kind: 'restaurar-confirm', usuario: modal.usuario })}
        />
      )}

      {modal.kind === 'archivar-confirm' && (
        <ConfirmDialog
          title="Archivar usuario"
          message={`${modal.usuario.email} saldrá de la lista de usuarios. No se borra nada: sus órdenes, salidas e historial siguen mostrando su nombre, y se puede restaurar cuando haga falta. ¿Continuar?`}
          confirmText="Archivar"
          onCancel={() => setModal({ kind: 'detail', usuario: modal.usuario })}
          onConfirm={async () => {
            try {
              await archivarUsuario(modal.usuario.id);
              toast('Usuario archivado', 'success');
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'No se pudo archivar', 'error');
            }
          }}
        />
      )}

      {modal.kind === 'restaurar-confirm' && (
        <ConfirmDialog
          title="Restaurar usuario"
          message={`${modal.usuario.email} volverá a la lista como DESHABILITADO. Si debe volver a ingresar, habilitalo después desde su ficha. ¿Continuar?`}
          confirmText="Restaurar"
          onCancel={() => setModal({ kind: 'detail', usuario: modal.usuario })}
          onConfirm={async () => {
            try {
              await restaurarUsuario(modal.usuario.id);
              toast('Usuario restaurado (deshabilitado)', 'success');
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'No se pudo restaurar', 'error');
            }
          }}
        />
      )}

      {modal.kind === 'actividad' && (
        <ResumenActividadModal onClose={() => setModal({ kind: 'none' })} />
      )}

      {modal.kind === 'reset-confirm' && (
        <ConfirmDialog
          title="Resetear clave"
          message={`Se le asignará a ${modal.usuario.email} la clave inicial "mgg2026" y deberá cambiarla al ingresar. ¿Continuar?`}
          confirmText="Resetear"
          onCancel={() => setModal({ kind: 'detail', usuario: modal.usuario })}
          onConfirm={async () => {
            try {
              const clave = await resetearClave(modal.usuario.id);
              notify(`Clave reseteada · ${modal.usuario.email} debe cambiarla al ingresar`, 'success', { link: '#/app/usuarios' });
              setModal({ kind: 'clave-temporal', titulo: 'Clave reseteada', email: modal.usuario.email, clave: clave ?? 'mgg2026' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al resetear', 'error');
            }
          }}
        />
      )}

      {modal.kind === 'clave-temporal' && (
        <ClaveTemporalModal
          titulo={modal.titulo}
          email={modal.email}
          clave={modal.clave}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'desbloquear-confirm' && (
        <ConfirmDialog
          title="Desbloquear usuario"
          message={`Se desbloqueará a ${modal.usuario.email} y su clave volverá a la inicial "mgg2026". Al ingresar deberá cambiarla obligatoriamente. ¿Continuar?`}
          confirmText="Desbloquear"
          onCancel={() => setModal({ kind: 'detail', usuario: modal.usuario })}
          onConfirm={async () => {
            try {
              const clave = await desbloquearUsuario(modal.usuario.id);
              notify(`Usuario desbloqueado · ${modal.usuario.email} debe cambiar la clave al ingresar`, 'success', { link: '#/app/usuarios' });
              setModal({ kind: 'clave-temporal', titulo: 'Usuario desbloqueado', email: modal.usuario.email, clave });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'No se pudo desbloquear', 'error');
            }
          }}
        />
      )}

      {modal.kind === 'toggle-confirm' && (
        <ConfirmDialog
          title={modal.targetEstado === 'inactivo' ? 'Deshabilitar usuario' : 'Habilitar usuario'}
          message={
            modal.targetEstado === 'inactivo'
              ? `${modal.usuario.email} dejará de tener acceso al sistema. ¿Continuar?`
              : `${modal.usuario.email} podrá volver a ingresar al sistema. ¿Continuar?`
          }
          confirmText={modal.targetEstado === 'inactivo' ? 'Deshabilitar' : 'Habilitar'}
          onCancel={() => setModal({ kind: 'detail', usuario: modal.usuario })}
          onConfirm={async () => {
            try {
              await setEstadoUsuario(modal.usuario.id, modal.targetEstado);
              toast(
                modal.targetEstado === 'inactivo' ? 'Usuario deshabilitado' : 'Usuario habilitado',
                'success',
              );
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

const onlyLetters = (v: string) => v.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, '').toUpperCase();
const onlyDigits = (v: string, max = 8) => v.replace(/\D/g, '').slice(0, max);

interface UsuarioFormModalProps {
  roles: CustomRole[];
  departamentos: string[];
  actorEmail?: string;
  recientementeCreado?: string | null;
  onRecienteConsumido?: () => void;
  onSolicitarNuevoRol: () => void;
  onSolicitarGestionRoles: () => void;
  onSolicitarGestionDeptos: () => void;
  onDeptoAgregado: (nombre: string) => Promise<void>;
  onClose: () => void;
  onCreated: (email: string, claveTemporal: string) => void;
}
function UsuarioFormModal({
  roles,
  departamentos,
  recientementeCreado,
  onRecienteConsumido,
  onSolicitarNuevoRol,
  onSolicitarGestionRoles,
  onSolicitarGestionDeptos,
  onDeptoAgregado,
  onClose,
  onCreated,
}: UsuarioFormModalProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const [departamento, setDepartamento] = useState<string>('');
  const [nuevoDeptoOpen, setNuevoDeptoOpen] = useState(false);
  const [role, setRole] = useState<string>(roles.find((r) => r.key === 'analista')?.key ?? roles[0]?.key ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (recientementeCreado && roles.some((r) => r.key === recientementeCreado)) {
      setRole(recientementeCreado);
      onRecienteConsumido?.();
    }
  }, [recientementeCreado, roles, onRecienteConsumido]);

  async function handleSubmit() {
    const root = formRef.current;
    const val = (name: string) => (root?.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
    const nombre = onlyLetters(val('u-nombre')).trim();
    const apellido = onlyLetters(val('u-apellido')).trim();
    const ci = onlyDigits(val('u-ci'), 8).trim();
    const email = val('u-email').trim().toLowerCase();
    const telefono = onlyDigits(val('u-telefono'), 15).trim();
    if (!nombre || !apellido || !ci || !email) {
      toast('Nombre, apellido, CI y correo son obligatorios', 'error');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      toast('Email inválido', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { claveTemporal } = await crearUsuario({
        nombre,
        apellido,
        ci,
        email,
        telefono,
        departamento: departamento.trim(),
        role,
      });
      notify(`Usuario creado: ${email}`, 'success', { link: '#/app/usuarios' });
      onCreated(email, claveTemporal ?? 'mgg2026');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al crear usuario', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Nuevo usuario"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creando…' : 'Crear usuario'}
          </button>
        </>
      }
    >
      <div ref={formRef}>
      <div className="form-grid">
        <div className="form-row">
          <label>Nombre *</label>
          <input
            className="input"
            name="u-nombre"
            placeholder="JUAN"
            onChange={(e) => { e.target.value = onlyLetters(e.target.value); }}
            disabled={submitting}
            autoFocus
          />
        </div>
        <div className="form-row">
          <label>Apellido *</label>
          <input
            className="input"
            name="u-apellido"
            placeholder="PÉREZ"
            onChange={(e) => { e.target.value = onlyLetters(e.target.value); }}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>CI *</label>
          <input
            className="input mono"
            name="u-ci"
            placeholder="12345678"
            onChange={(e) => { e.target.value = onlyDigits(e.target.value, 8); }}
            maxLength={8}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Teléfono</label>
          <input
            className="input mono"
            name="u-telefono"
            placeholder="04241234567"
            onChange={(e) => { e.target.value = onlyDigits(e.target.value, 15); }}
            maxLength={15}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Departamento</label>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              disabled={submitting}
              style={{ flex: 1, minWidth: 160 }}
            >
              <option value="">(Sin departamento)</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setNuevoDeptoOpen(true)}
              disabled={submitting}
              title="Crear un departamento nuevo que quede en la lista"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSolicitarGestionDeptos}
              disabled={submitting}
              title="Gestionar departamentos existentes (renombrar o eliminar los que no se usen)"
            >
              ⚙
            </button>
          </div>
          <small className="muted">Opcional. Organiza las personas por área en el directorio.</small>
        </div>

        <div className="form-row">
          <label>Rol *</label>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
              style={{ flex: 1, minWidth: 160 }}
            >
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSolicitarNuevoRol}
              disabled={submitting}
              title="Crear un rol nuevo"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSolicitarGestionRoles}
              disabled={submitting}
              title="Gestionar roles existentes"
            >
              ⚙
            </button>
          </div>
        </div>
      </div>

      <div className="form-row">
        <label>Correo electrónico *</label>
        <input
          className="input"
          name="u-email"
          type="email"
          placeholder="correo@ejemplo.com"
          autoComplete="off"
          disabled={submitting}
        />
        <small className="muted">Se le asignará una contraseña temporal para su primer acceso.</small>
      </div>

      {nuevoDeptoOpen && (
        <NuevaTaxonomiaModal
          titulo="Nuevo departamento"
          placeholder="Ej.: Mantenimiento"
          onClose={() => setNuevoDeptoOpen(false)}
          onCrear={async (nombre) => {
            await onDeptoAgregado(nombre);
            setDepartamento(nombre);
            setNuevoDeptoOpen(false);
          }}
        />
      )}
      </div>
    </Modal>
  );
}

interface UsuarioEditModalProps {
  usuario: Usuario;
  roles: CustomRole[];
  departamentos: string[];
  actorEmail?: string;
  recientementeCreado?: string | null;
  onRecienteConsumido?: () => void;
  onSolicitarNuevoRol: () => void;
  onSolicitarGestionRoles: () => void;
  onSolicitarGestionDeptos: () => void;
  onDeptoAgregado: (nombre: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}
function UsuarioEditModal({
  usuario,
  roles,
  departamentos,
  recientementeCreado,
  onRecienteConsumido,
  onSolicitarNuevoRol,
  onSolicitarGestionRoles,
  onSolicitarGestionDeptos,
  onDeptoAgregado,
  onClose,
  onSaved,
}: UsuarioEditModalProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const [departamento, setDepartamento] = useState<string>(usuario.departamento ?? '');
  const [nuevoDeptoOpen, setNuevoDeptoOpen] = useState(false);
  const [role, setRole] = useState<string>(usuario.role);
  const [submitting, setSubmitting] = useState(false);
  const [cambiaNombre, setCambiaNombre] = useState(false);

  useEffect(() => {
    if (recientementeCreado && roles.some((r) => r.key === recientementeCreado)) {
      setRole(recientementeCreado);
      onRecienteConsumido?.();
    }
  }, [recientementeCreado, roles, onRecienteConsumido]);

  function revisarCambioNombre() {
    const root = formRef.current;
    if (!root) return;
    const n = onlyLetters((root.querySelector('[name="u-nombre"]') as HTMLInputElement | null)?.value ?? '').trim();
    const a = onlyLetters((root.querySelector('[name="u-apellido"]') as HTMLInputElement | null)?.value ?? '').trim();
    const cambio = n !== (usuario.nombre ?? '').trim() || a !== (usuario.apellido ?? '').trim();
    setCambiaNombre(cambio);
  }

  async function handleSubmit() {
    const root = formRef.current;
    const val = (name: string) => (root?.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
    const nombre = onlyLetters(val('u-nombre')).trim();
    const apellido = onlyLetters(val('u-apellido')).trim();
    const ci = onlyDigits(val('u-ci'), 8).trim();
    const telefono = onlyDigits(val('u-telefono'), 15).trim();
    const emailNuevo = val('u-email').trim().toLowerCase();
    const motivoNombre = val('u-motivo-nombre').trim();

    if (!nombre || !apellido || !ci) {
      toast('Nombre, apellido y CI son obligatorios', 'error');
      return;
    }
    const nombreCambio = nombre !== (usuario.nombre ?? '').trim() || apellido !== (usuario.apellido ?? '').trim();
    if (nombreCambio && !motivoNombre) {
      toast('Indica el motivo del cambio de nombre (es obligatorio)', 'error');
      return;
    }
    const cambiaEmail = emailNuevo && emailNuevo !== usuario.email.toLowerCase();
    if (cambiaEmail && !/\S+@\S+\.\S+/.test(emailNuevo)) {
      toast('El correo electrónico nuevo no es válido', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await actualizarUsuario(usuario.id, {
        nombre,
        apellido,
        ci,
        telefono,
        departamento: departamento.trim(),
        role,
        motivo_cambio_nombre: nombreCambio ? motivoNombre : undefined,
      });
      if (cambiaEmail) await cambiarEmailUsuario(usuario.id, emailNuevo);
      notify(`Datos actualizados de ${cambiaEmail ? emailNuevo : usuario.email}`, 'success', { link: '#/app/usuarios' });
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al actualizar', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Editar usuario · ${usuario.email}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <div ref={formRef}>
      <div className="form-grid">
        <div className="form-row">
          <label>Nombre</label>
          <input
            className="input"
            name="u-nombre"
            defaultValue={usuario.nombre ?? ''}
            onChange={(e) => { e.target.value = onlyLetters(e.target.value); revisarCambioNombre(); }}
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Apellido</label>
          <input
            className="input"
            name="u-apellido"
            defaultValue={usuario.apellido ?? ''}
            onChange={(e) => { e.target.value = onlyLetters(e.target.value); revisarCambioNombre(); }}
            disabled={submitting}
          />
        </div>
      </div>

      {cambiaNombre && (
        <div className="form-row">
          <label htmlFor="u-motivo-nombre">Motivo del cambio de nombre *</label>
          <textarea id="u-motivo-nombre" className="input" name="u-motivo-nombre" rows={2} disabled={submitting}
            placeholder="Ej.: corrección de la cédula, cambio de apellido por matrimonio, error al registrarlo…" />
          <small className="muted">
            Lo que hizo con su nombre anterior <strong>sigue mostrando ese nombre</strong>. El cambio, la fecha, quién lo hizo y
            el motivo quedan en el <strong>historial de nombres</strong> del usuario.
          </small>
        </div>
      )}

      <div className="form-grid">
        <div className="form-row">
          <label>CI</label>
          <input
            className="input mono"
            name="u-ci"
            defaultValue={usuario.ci ?? ''}
            onChange={(e) => { e.target.value = onlyDigits(e.target.value, 8); }}
            maxLength={8}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Teléfono</label>
          <input
            className="input mono"
            name="u-telefono"
            defaultValue={usuario.telefono ?? ''}
            onChange={(e) => { e.target.value = onlyDigits(e.target.value, 15); }}
            placeholder="04241234567"
            maxLength={15}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Departamento</label>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              disabled={submitting}
              style={{ flex: 1, minWidth: 160 }}
            >
              <option value="">(Sin departamento)</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setNuevoDeptoOpen(true)}
              disabled={submitting}
              title="Crear un departamento nuevo que quede en la lista"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSolicitarGestionDeptos}
              disabled={submitting}
              title="Gestionar departamentos existentes"
            >
              ⚙
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Rol</label>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
              style={{ flex: 1, minWidth: 160 }}
            >
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSolicitarNuevoRol}
              disabled={submitting}
              title="Crear un rol nuevo"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSolicitarGestionRoles}
              disabled={submitting}
              title="Gestionar roles existentes"
            >
              ⚙
            </button>
          </div>
        </div>
      </div>

      <div className="form-row">
        <label>Correo electrónico</label>
        <input
          className="input"
          name="u-email"
          type="email"
          defaultValue={usuario.email ?? ''}
          placeholder="correo@ejemplo.com"
          autoComplete="off"
        />
        <small className="muted">Es el correo con el que inicia sesión. Si lo cambias, el usuario deberá entrar con el nuevo correo (la contraseña no cambia).</small>
      </div>

      {nuevoDeptoOpen && (
        <NuevaTaxonomiaModal
          titulo="Nuevo departamento"
          placeholder="Ej.: Mantenimiento"
          onClose={() => setNuevoDeptoOpen(false)}
          onCrear={async (nombre) => {
            await onDeptoAgregado(nombre);
            setDepartamento(nombre);
            setNuevoDeptoOpen(false);
          }}
        />
      )}
      </div>
    </Modal>
  );
}

interface NuevaTaxonomiaModalProps {
  titulo: string;
  placeholder: string;
  onClose: () => void;
  onCrear: (nombre: string) => Promise<void>;
}
function NuevaTaxonomiaModal({ titulo, placeholder, onClose, onCrear }: NuevaTaxonomiaModalProps) {
  const nombreRef = useRef<HTMLInputElement>(null);
  const [nombreLive, setNombreLive] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCrear() {
    const v = (nombreRef.current?.value ?? '').trim();
    if (!v) {
      toast('El nombre no puede estar vacío', 'error');
      return;
    }
    setBusy(true);
    try {
      await onCrear(v);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={titulo}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleCrear} disabled={busy || !nombreLive.trim()}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label>Nombre</label>
        <input
          ref={nombreRef}
          className="input"
          defaultValue=""
          onChange={(e) => setNombreLive(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCrear();
            if (e.key === 'Escape') onClose();
          }}
        />
      </div>
      <p className="muted" style={{ fontSize: '.78rem', margin: '.5rem 0 0' }}>
        Queda persistido en Supabase y disponible para próximas sesiones. Podrás
        eliminarlo siempre que no esté en uso.
      </p>
    </Modal>
  );
}

interface UsuarioDetailModalProps {
  usuario: Usuario;
  onClose: () => void;
  onResetClave: () => void;
  onDesbloquear: () => void;
  onToggleEstado: () => void;
  onEdit: () => void;
  onArchivar: () => void;
  onRestaurar: () => void;
}
function UsuarioDetailModal({ usuario, onClose, onResetClave, onDesbloquear, onToggleEstado, onEdit, onArchivar, onRestaurar }: UsuarioDetailModalProps) {
  const isActive = usuario.estado === 'activo';
  const archivado = estaArchivado(usuario);
  return (
    <Modal
      title={`Usuario · ${[usuario.nombre, usuario.apellido].filter(Boolean).join(' ')}`}
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', width: '100%', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onResetClave} title="Le asigna la clave inicial; deberá cambiarla al ingresar.">
              🔑 Resetear clave
            </button>
            {!archivado && puedeArchivar(usuario) && (
              <button className="btn btn-ghost" onClick={onArchivar} title="Sale de la lista. No se borra nada.">
                🗄 Archivar
              </button>
            )}
            {!archivado && (
              <button
                className={isActive ? 'btn btn-danger' : 'btn btn-success'}
                onClick={onToggleEstado}
              >
                {isActive ? 'Deshabilitar usuario' : 'Habilitar usuario'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
            {usuario.bloqueado && (
              <button className="btn btn-success" onClick={onDesbloquear}>
                🔓 Desbloquear
              </button>
            )}
            {archivado && (
              <button className="btn btn-success" onClick={onRestaurar} title="Vuelve a la lista como deshabilitado">
                ↩ Restaurar
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
            <button className="btn btn-primary" onClick={onEdit}>✎ Editar datos</button>
          </div>
        </div>
      }
    >
      <div className="detail-row">
        <div className="k">Nombre completo</div>
        <div className="v">{[usuario.nombre, usuario.apellido].filter(Boolean).join(' ')}</div>
      </div>
      <div className="detail-row">
        <div className="k">CI</div>
        <div className="v mono">{usuario.ci ?? '—'}</div>
      </div>
      <div className="detail-row">
        <div className="k">Teléfono</div>
        <div className="v mono">{usuario.telefono ?? '—'}</div>
      </div>
      <div className="detail-row">
        <div className="k">Departamento</div>
        <div className="v">{usuario.departamento ?? '—'}</div>
      </div>
      <div className="detail-row">
        <div className="k">Correo</div>
        <div className="v">{usuario.email}</div>
      </div>
      <div className="detail-row">
        <div className="k">Rol</div>
        <div className="v">{labelRol(usuario.role)}</div>
      </div>
      <div className="detail-row">
        <div className="k">Estado</div>
        <div className="v">
          <StatusBadge estado={estadoVisible(usuario)} />
          {archivado && usuario.archivado_en && (
            <span className="muted" style={{ marginLeft: '.5rem', fontSize: '.8rem' }}>desde {dateTime(usuario.archivado_en)}</span>
          )}
        </div>
      </div>
      <div className="detail-row">
        <div className="k">Acceso</div>
        <div className="v">
          {usuario.bloqueado
            ? <span className="badge danger">🔒 Bloqueado (3 intentos fallidos)</span>
            : <span className="badge success">Normal</span>}
        </div>
      </div>
      <div className="detail-row">
        <div className="k">Cambio de clave pendiente</div>
        <div className="v">
          {usuario.must_change_password
            ? <span className="badge warning">Sí, en próximo login</span>
            : <span className="badge success">No</span>}
        </div>
      </div>
      <div className="detail-row">
        <div className="k">Registrado</div>
        <div className="v">{dateTime(usuario.created_at)}</div>
      </div>
      <HistorialNombres usuarioId={usuario.id} />
    </Modal>
  );
}

function ClaveTemporalModal({ titulo, email, clave, onClose }: {
  titulo: string; email: string; clave: string; onClose: () => void;
}) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(clave);
      toast('Clave copiada', 'success');
    } catch {
      toast('No se pudo copiar: anótala a mano', 'error');
    }
  }
  return (
    <Modal
      title={`🔑 ${titulo}`}
      compact
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={copiar}>📋 Copiar clave</button>
          <button className="btn btn-primary" onClick={onClose}>Listo, ya la anoté</button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>Clave temporal de <strong>{email}</strong>:</p>
      <div
        className="mono"
        style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '.08em', textAlign: 'center', padding: '.75rem', border: '1px dashed var(--border)', borderRadius: 8, userSelect: 'all' }}
      >
        {clave}
      </div>
      <p className="muted" style={{ fontSize: '.85rem', marginBottom: 0 }}>
        Indicásela a la persona. Al entrar por primera vez el sistema le pide cambiarla
        obligatoriamente por una propia.
      </p>
    </Modal>
  );
}

function HistorialNombres({ usuarioId }: { usuarioId: string }) {
  const [cambios, setCambios] = useState<CambioNombreUsuario[] | null>(null);
  const cargar = useCallback(() => {
    listHistorialNombres(usuarioId).then(setCambios).catch(() => setCambios([]));
  }, [usuarioId]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['usuarios_nombres_historial'], cargar);

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="card-title" style={{ marginBottom: '.4rem' }}>🕘 Historial de nombres</div>
      {cambios === null ? <p className="muted" style={{ margin: 0 }}>Cargando…</p>
        : !cambios.length ? <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Nunca se le ha cambiado el nombre.</p>
        : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead><tr><th>Fecha</th><th>Nombre anterior</th><th>Nombre nuevo</th><th>Motivo</th><th>Cambiado por</th></tr></thead>
              <tbody>
                {cambios.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(c.created_at)}</td>
                    <td className="muted">{c.nombre_anterior || '—'}</td>
                    <td><strong>{c.nombre_nuevo || '—'}</strong></td>
                    <td>{c.motivo}</td>
                    <td className="muted"><Quien nombre={c.cambiado_por_nombre} correo={c.cambiado_por} vacio="—" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <small className="muted">Lo que hizo antes de cada cambio sigue mostrando el nombre que tenía en ese momento.</small>
    </div>
  );
}
