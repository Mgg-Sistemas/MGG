import { useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import {
  actualizarRol,
  crearRol,
  eliminarRol,
  type CustomRole,
} from './roles.repository';

/* ════════════════════════════════════════════════════════════
   Nuevo rol — modal de creación reutilizable
   ════════════════════════════════════════════════════════════ */

interface NuevoRolModalProps {
  actorEmail?: string;
  onClose: () => void;
  /** Devuelve el rol creado para que el caller lo seleccione automáticamente. */
  onCreated: (rol: CustomRole) => void | Promise<void>;
}

export function NuevoRolModal({ actorEmail, onClose, onCreated }: NuevoRolModalProps) {
  const [label, setLabel] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [color, setColor] = useState('#7c3aed');
  const [busy, setBusy] = useState(false);

  const suggestedKey = label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  async function handleSubmit() {
    if (!label.trim()) {
      toast('El nombre del rol es obligatorio', 'error');
      return;
    }
    if (!suggestedKey) {
      toast('No se pudo derivar la clave del rol; usá letras y números', 'error');
      return;
    }
    setBusy(true);
    try {
      const creado = await crearRol({
        key: suggestedKey,
        label: label.trim(),
        descripcion: descripcion.trim(),
        color,
        actor: actorEmail,
      });
      notify(`Rol creado: ${creado.label}`, 'success', { link: '#/app/usuarios' });
      await onCreated(creado);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear el rol', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nuevo rol"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={busy || !label.trim()}>
            {busy ? 'Creando…' : 'Crear rol'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label>Nombre del rol</label>
        <input
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ej.: Supervisor de planta"
          disabled={busy}
          autoFocus
        />
        {suggestedKey && (
          <small className="muted mono" style={{ fontSize: '.7rem' }}>clave: {suggestedKey}</small>
        )}
      </div>
      <div className="form-row">
        <label>Descripción</label>
        <textarea
          className="input"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          placeholder="Para qué sirve este rol"
          disabled={busy}
        />
      </div>
      <div className="form-row">
        <label>Color</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          disabled={busy}
          style={{ width: 60, height: 36, padding: 0, border: '1px solid var(--border)', borderRadius: 8 }}
        />
      </div>
      <p className="hint muted" style={{ fontSize: '.78rem', margin: '.5rem 0 0' }}>
        El rol queda persistido en Supabase y disponible en próximas sesiones. Podrás
        eliminarlo siempre que no tenga usuarios asignados.
      </p>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════
   Gestionar roles — modal de edición/eliminación
   ════════════════════════════════════════════════════════════ */

interface GestionarRolesModalProps {
  roles: CustomRole[];
  conteoUso: Record<string, number>;
  actorEmail?: string;
  onClose: () => void;
  /** Refresca el listado y el conteo en el caller. */
  onCambioAplicado: () => Promise<void> | void;
}

export function GestionarRolesModal({
  roles,
  conteoUso,
  actorEmail,
  onClose,
  onCambioAplicado,
}: GestionarRolesModalProps) {
  const [editando, setEditando] = useState<string | null>(null);
  const [labelEdit, setLabelEdit] = useState('');
  const [descEdit, setDescEdit] = useState('');
  const [colorEdit, setColorEdit] = useState('#7c3aed');
  const [guardando, setGuardando] = useState(false);
  const [aEliminar, setAEliminar] = useState<CustomRole | null>(null);
  const [filtro, setFiltro] = useState('');

  const ordenados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return roles
      .filter((r) => !q || r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (a.sistema !== b.sistema) return a.sistema ? -1 : 1;
        return a.label.localeCompare(b.label, 'es');
      });
  }, [roles, filtro]);

  useEffect(() => {
    if (!editando) return;
    const r = roles.find((x) => x.key === editando);
    if (r) {
      setLabelEdit(r.label);
      setDescEdit(r.descripcion ?? '');
      setColorEdit(r.color);
    }
  }, [editando, roles]);

  async function aplicarRename(rol: CustomRole) {
    const lbl = labelEdit.trim();
    if (!lbl) {
      toast('El nombre no puede estar vacío', 'error');
      return;
    }
    setGuardando(true);
    try {
      await actualizarRol(rol.key, {
        label: lbl,
        descripcion: descEdit,
        color: colorEdit,
      });
      notify(`Rol actualizado: ${lbl}`, 'success', { link: '#/app/usuarios' });
      setEditando(null);
      await onCambioAplicado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarEliminar() {
    if (!aEliminar) return;
    setGuardando(true);
    try {
      await eliminarRol(aEliminar.key);
      notify(`Rol eliminado: ${aEliminar.label}`, 'success', { link: '#/app/usuarios' });
      setAEliminar(null);
      await onCambioAplicado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Gestión de roles"
      size="lg"
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Corregí el nombre, descripción o color de los roles. Los roles del sistema
        (admin / analista / obrero) no pueden eliminarse, pero sí re-etiquetarse.
      </p>

      <input
        className="search"
        placeholder="Filtrar roles…"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: '.75rem' }}
      />

      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.88rem' }}>
          <thead>
            <tr>
              <th style={{ width: 12 }}></th>
              <th>Rol</th>
              <th style={{ width: 150, textAlign: 'right' }}>Usuarios</th>
              <th style={{ width: 240 }}></th>
            </tr>
          </thead>
          <tbody>
            {ordenados.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin roles.</td></tr>
            )}
            {ordenados.map((r) => {
              const usos = conteoUso[r.key] ?? 0;
              const enEdicion = editando === r.key;

              return (
                <tr key={r.key}>
                  <td>
                    <span
                      title={r.color}
                      style={{
                        display: 'inline-block',
                        width: 10, height: 10, borderRadius: '50%',
                        background: enEdicion ? colorEdit : r.color,
                        verticalAlign: 'middle',
                      }}
                    />
                  </td>
                  <td>
                    {enEdicion ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                        <input
                          className="input"
                          value={labelEdit}
                          onChange={(e) => setLabelEdit(e.target.value)}
                          placeholder="Nombre visible"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void aplicarRename(r);
                            if (e.key === 'Escape') setEditando(null);
                          }}
                        />
                        <input
                          className="input"
                          value={descEdit}
                          onChange={(e) => setDescEdit(e.target.value)}
                          placeholder="Descripción"
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                          <small className="muted">Color:</small>
                          <input
                            type="color"
                            value={colorEdit}
                            onChange={(e) => setColorEdit(e.target.value)}
                            style={{ width: 42, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 6 }}
                          />
                          <small className="muted mono" style={{ fontSize: '.7rem' }}>clave: {r.key}</small>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong>{r.label}</strong>
                        {r.sistema && <span className="badge" style={{ marginLeft: '.4rem', fontSize: '.62rem' }}>SISTEMA</span>}
                        {r.descripcion && (
                          <div className="muted" style={{ fontSize: '.74rem' }}>{r.descripcion}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {usos > 0 ? `${usos} usuario${usos === 1 ? '' : 's'}` : <span className="muted">—</span>}
                  </td>
                  <td className="actions">
                    {enEdicion ? (
                      <>
                        <button className="btn btn-sm btn-primary" disabled={guardando} onClick={() => void aplicarRename(r)}>
                          {guardando ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button className="btn btn-sm btn-ghost" disabled={guardando} onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditando(r.key)}>
                          ✎ Editar
                        </button>
                        {!r.sistema && usos === 0 && (
                          <button className="btn btn-sm btn-danger" onClick={() => setAEliminar(r)}>
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint muted" style={{ fontSize: '.74rem', marginTop: '.75rem' }}>
        {actorEmail ? `Acciones registradas como ${actorEmail}.` : 'Las acciones se registran en Supabase.'}
      </p>

      {aEliminar && (
        <ConfirmDialog
          title="Eliminar rol"
          message={`Se eliminará el rol "${aEliminar.label}". Esto borra también su matriz de permisos. ¿Continuar?`}
          confirmText="Eliminar"
          danger
          onCancel={() => setAEliminar(null)}
          onConfirm={aplicarEliminar}
        />
      )}
    </Modal>
  );
}
