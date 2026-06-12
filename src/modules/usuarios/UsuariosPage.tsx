import { useCallback, useEffect, useMemo, useState } from 'react';
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
  labelRol,
  listUsuarios,
  loadRolesAndCache,
  resetearClave,
  setEstadoUsuario,
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

type View = 'creacion' | 'roles';

type ModalKind =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; usuario: Usuario }
  | { kind: 'detail'; usuario: Usuario }
  | { kind: 'reset-confirm'; usuario: Usuario }
  | { kind: 'toggle-confirm'; usuario: Usuario; targetEstado: 'activo' | 'inactivo' };

type RoleQuickModal = 'none' | 'crear' | 'gestionar';

export function UsuariosPage() {
  const canWrite = usePermissions().can('usuarios', 'escritura');
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  // Pre-carga el filtro si se llega desde la búsqueda global (?buscar=…).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const b = searchParams.get('buscar');
    if (b) {
      setFilterText(b);
      const next = new URLSearchParams(searchParams);
      next.delete('buscar');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filterRol, setFilterRol] = useState<string>('');
  const [filterEstado, setFilterEstado] = useState<'activo' | 'inactivo' | ''>('');
  const [modal, setModal] = useState<ModalKind>({ kind: 'none' });
  const [view, setView] = useState<View>('creacion');
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
      // Todo lo que no depende de `rows` va en un solo lote paralelo.
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
      // Único paso dependiente: la taxonomía de departamentos necesita `rows`.
      setDepartamentos(await getDepartamentos(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar usuarios');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);
  // Realtime: usuarios + roles/permisos (altas, cambios de rol o departamento en vivo).
  useRealtime(['usuarios', 'roles_permisos', 'custom_roles', 'taxonomias'], () => { void refresh(); });

  const activos = useMemo(() => usuarios.filter((u) => u.estado === 'activo').length, [usuarios]);
  const inactivos = useMemo(() => usuarios.filter((u) => u.estado === 'inactivo').length, [usuarios]);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const nombreCompleto = (u: Usuario) => `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || u.email || '';
    return usuarios
      .filter((u) => {
        if (filterRol && u.role !== filterRol) return false;
        if (filterEstado && u.estado !== filterEstado) return false;
        if (q) {
          const hay = [u.nombre, u.apellido, u.email, u.ci, u.role]
            .map((v) => (v ?? '').toString().toLowerCase())
            .join(' | ');
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      // Orden alfabético por nombre completo (es-VE).
      .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es', { sensitivity: 'base' }));
  }, [usuarios, filterText, filterRol, filterEstado]);

  return (
    <div>
      <div className="page-head" style={{ display: 'block' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '.5rem' }}>
          {view === 'creacion' ? 'Creación de Usuario' : 'Roles y Permiso'}
        </h1>
        <p className="muted" style={{ textAlign: 'center' }}>
          {view === 'creacion'
            ? 'Gestión de usuarios del sistema. Crea cuentas con clave por defecto, edita datos, resetea claves olvidadas y habilita/deshabilita accesos.'
            : 'Configurá la matriz de permisos por rol y por módulo del sistema.'}
        </p>

        <div className="view-switch" role="tablist" aria-label="Vista de usuarios">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'creacion'}
            className={`view-switch-tab${view === 'creacion' ? ' active' : ''}`}
            onClick={() => setView('creacion')}
          >
            👤 Creación de Usuario
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'roles'}
            className={`view-switch-tab${view === 'roles' ? ' active' : ''}`}
            onClick={() => setView('roles')}
          >
            🛡 Roles y Permiso
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {view === 'roles' ? (
        <RolesPermisosPanel readOnly={!canWrite} onRolesChanged={refresh} />
      ) : (
      <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="kpi">
          <div className="label">Usuarios activos</div>
          <div className="value">{activos}</div>
          <div className="delta">Con acceso al sistema</div>
          <div className="icon">✓</div>
        </div>
        <div className="kpi">
          <div className="label">Usuarios deshabilitados</div>
          <div className="value">{inactivos}</div>
          <div className="delta down">No pueden ingresar</div>
          <div className="icon">⛔</div>
        </div>
      </div>

      <div className="filterbar" style={{ marginTop: '1rem' }}>
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
          onChange={(e) => setFilterEstado(e.target.value as 'activo' | 'inactivo' | '')}
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Deshabilitados</option>
        </select>
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'create' })}
            style={{ marginLeft: 'auto' }}
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
                <tr key={u.id}>
                  <td>
                    <strong>{[u.nombre, u.apellido].filter(Boolean).join(' ') || u.nombre}</strong>
                    {u.must_change_password && (
                      <div className="muted" style={{ fontSize: '.7rem' }}>
                        ⚠ Debe cambiar clave al ingresar
                      </div>
                    )}
                  </td>
                  <td className="mono">{u.ci ?? '—'}</td>
                  <td>{u.email}</td>
                  <td>{labelRol(u.role)}</td>
                  <td><StatusBadge estado={u.estado} /></td>
                  <td className="muted" style={{ fontSize: '.82rem' }}>{dateTime(u.created_at)}</td>
                  <td className="actions">
                    {canWrite && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setModal({ kind: 'edit', usuario: u })}
                      >
                        Editar
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setModal({ kind: 'detail', usuario: u })}
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
          roles={roles}
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
          onCreated={async () => {
            setModal({ kind: 'none' });
            await refresh();
          }}
        />
      )}

      {modal.kind === 'edit' && (
        <UsuarioEditModal
          usuario={modal.usuario}
          roles={roles}
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
          onToggleEstado={() =>
            setModal({
              kind: 'toggle-confirm',
              usuario: modal.usuario,
              targetEstado: modal.usuario.estado === 'activo' ? 'inactivo' : 'activo',
            })
          }
          onEdit={() => setModal({ kind: 'edit', usuario: modal.usuario })}
        />
      )}

      {modal.kind === 'reset-confirm' && (
        <ConfirmDialog
          title="Resetear clave"
          message={`La clave de ${modal.usuario.email} se cambiará a "123456" y el usuario deberá cambiarla al ingresar. ¿Continuar?`}
          confirmText="Resetear"
          onCancel={() => setModal({ kind: 'detail', usuario: modal.usuario })}
          onConfirm={async () => {
            try {
              await resetearClave(modal.usuario.id);
              notify(`Clave reseteada · ${modal.usuario.email} usará 123456 al ingresar`, 'success', { link: '#/app/usuarios' });
              setModal({ kind: 'none' });
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error al resetear', 'error');
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
  /** Persistir un departamento nuevo y refrescar el listado. */
  onDeptoAgregado: (nombre: string) => Promise<void>;
  onClose: () => void;
  onCreated: () => void;
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
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [ci, setCi] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
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
    if (!nombre.trim() || !apellido.trim() || !ci.trim() || !email.trim()) {
      toast('Nombre, apellido, CI y correo son obligatorios', 'error');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      toast('Email inválido', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await crearUsuario({
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        ci: ci.trim(),
        email: email.trim().toLowerCase(),
        role,
        telefono: telefono.trim() || undefined,
        departamento: departamento.trim() || undefined,
      });
      notify(`Usuario creado: ${email} · clave inicial 123456`, 'success', { link: '#/app/usuarios' });
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al crear', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Agregar nuevo usuario"
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
      <div className="form-grid">
        <div className="form-row">
          <label>Nombre</label>
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(onlyLetters(e.target.value))}
            disabled={submitting}
            placeholder="Solo letras"
          />
        </div>
        <div className="form-row">
          <label>Apellido</label>
          <input
            className="input"
            value={apellido}
            onChange={(e) => setApellido(onlyLetters(e.target.value))}
            disabled={submitting}
            placeholder="Solo letras"
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>CI</label>
          <input
            className="input mono"
            value={ci}
            onChange={(e) => setCi(onlyDigits(e.target.value, 8))}
            placeholder="12345678"
            maxLength={8}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Correo</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario@empresa.com"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Teléfono</label>
          <input
            className="input mono"
            value={telefono}
            onChange={(e) => setTelefono(onlyDigits(e.target.value, 15))}
            placeholder="04241234567"
            maxLength={15}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Departamento</label>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              disabled={submitting}
              style={{ flex: 1, minWidth: 180 }}
            >
              <option value="">— sin asignar —</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setNuevoDeptoOpen(true)}
              disabled={submitting}
              title="Crear un departamento nuevo (queda disponible para próximas sesiones)"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onSolicitarGestionDeptos}
              disabled={submitting}
              title="Renombrar o eliminar departamentos"
            >
              ⚙
            </button>
          </div>
        </div>
      </div>

      <div className="form-row">
        <label>Tipo de rol</label>
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={submitting}
            style={{ flex: 1, minWidth: 200 }}
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onSolicitarNuevoRol}
            disabled={submitting}
            title="Crear un rol nuevo (queda disponible para próximas sesiones)"
          >
            + Nuevo
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onSolicitarGestionRoles}
            disabled={submitting}
            title="Editar nombre/descripción/color de roles"
          >
            ⚙
          </button>
        </div>
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

      <div className="card" style={{ marginTop: '1rem', background: 'var(--bg-2)' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
          🔑 El usuario se creará con la clave inicial <strong className="mono">123456</strong>.
          En su primer inicio de sesión deberá cambiarla obligatoriamente.
        </p>
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
  const [nuevoDeptoOpen, setNuevoDeptoOpen] = useState(false);
  const [nombre, setNombre] = useState(usuario.nombre ?? '');
  const [apellido, setApellido] = useState(usuario.apellido ?? '');
  const [ci, setCi] = useState(usuario.ci ?? '');
  const [telefono, setTelefono] = useState(usuario.telefono ?? '');
  const [departamento, setDepartamento] = useState(usuario.departamento ?? '');
  const [role, setRole] = useState<string>(usuario.role);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (recientementeCreado && roles.some((r) => r.key === recientementeCreado)) {
      setRole(recientementeCreado);
      onRecienteConsumido?.();
    }
  }, [recientementeCreado, roles, onRecienteConsumido]);

  async function handleSubmit() {
    if (!nombre.trim() || !apellido.trim() || !ci.trim()) {
      toast('Nombre, apellido y CI son obligatorios', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await actualizarUsuario(usuario.id, {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        ci: ci.trim(),
        telefono: telefono.trim(),
        departamento: departamento.trim(),
        role,
      });
      notify(`Datos actualizados de ${usuario.email}`, 'success', { link: '#/app/usuarios' });
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
      <div className="form-grid">
        <div className="form-row">
          <label>Nombre</label>
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(onlyLetters(e.target.value))}
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Apellido</label>
          <input
            className="input"
            value={apellido}
            onChange={(e) => setApellido(onlyLetters(e.target.value))}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>CI</label>
          <input
            className="input mono"
            value={ci}
            onChange={(e) => setCi(onlyDigits(e.target.value, 8))}
            maxLength={8}
            inputMode="numeric"
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Teléfono</label>
          <input
            className="input mono"
            value={telefono}
            onChange={(e) => setTelefono(onlyDigits(e.target.value, 15))}
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
              style={{ flex: 1, minWidth: 180 }}
            >
              <option value="">— sin asignar —</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setNuevoDeptoOpen(true)}
              disabled={submitting}
              title="Crear un departamento nuevo"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onSolicitarGestionDeptos}
              disabled={submitting}
              title="Renombrar o eliminar departamentos"
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
              style={{ flex: 1, minWidth: 200 }}
            >
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onSolicitarNuevoRol}
              disabled={submitting}
              title="Crear un rol nuevo"
            >
              + Nuevo
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onSolicitarGestionRoles}
              disabled={submitting}
              title="Editar nombre/descripción/color de roles"
            >
              ⚙
            </button>
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: '.78rem', margin: '.5rem 0 0' }}>
        El correo no es editable. Si necesitás cambiarlo, deshabilitá este usuario y creá uno nuevo.
      </p>

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
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCrear() {
    const v = nombre.trim();
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
          <button className="btn btn-primary" onClick={handleCrear} disabled={busy || !nombre.trim()}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label>Nombre</label>
        <input
          className="input"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
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
  onToggleEstado: () => void;
  onEdit: () => void;
}
function UsuarioDetailModal({ usuario, onClose, onResetClave, onToggleEstado, onEdit }: UsuarioDetailModalProps) {
  const isActive = usuario.estado === 'activo';
  return (
    <Modal
      title={`Usuario · ${[usuario.nombre, usuario.apellido].filter(Boolean).join(' ')}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-ghost" onClick={onEdit}>✎ Editar datos</button>
          <button className="btn btn-ghost" onClick={onResetClave}>
            🔑 Resetear clave
          </button>
          <button
            className={isActive ? 'btn btn-danger' : 'btn btn-success'}
            onClick={onToggleEstado}
          >
            {isActive ? 'Deshabilitar usuario' : 'Habilitar usuario'}
          </button>
        </>
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
        <div className="v"><StatusBadge estado={usuario.estado} /></div>
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
    </Modal>
  );
}
