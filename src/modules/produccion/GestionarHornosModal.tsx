import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import type { Horno } from '@/shared/lib/types';
import {
  listHornos,
  crearHorno,
  renombrarHorno,
  deshabilitarHorno,
  habilitarHorno,
} from './hornos.repository';

/**
 * Administra el catálogo de hornos como las categorías: permite agregar,
 * renombrar (modificar) e inhabilitar (con motivo obligatorio) o reactivar.
 */
export function GestionarHornosModal({
  actor,
  onClose,
  onCambioAplicado,
}: {
  actor: string;
  onClose: () => void;
  onCambioAplicado?: () => void;
}) {
  const [hornos, setHornos] = useState<Horno[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [nuevo, setNuevo] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [motivoId, setMotivoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  async function recargar() {
    setLoading(true);
    try {
      setHornos(await listHornos());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron cargar los hornos', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void recargar(); }, []);

  function notificarCambio() { onCambioAplicado?.(); }

  async function agregar() {
    if (!nuevo.trim()) { toast('Escribí el nombre del horno', 'error'); return; }
    setBusy(true);
    try {
      await crearHorno(nuevo, actor);
      notify(`Horno "${nuevo.trim()}" agregado`, 'success');
      setNuevo('');
      await recargar();
      notificarCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function guardarRename() {
    if (!editId) return;
    setBusy(true);
    try {
      await renombrarHorno(editId, editVal);
      notify('Horno renombrado', 'success');
      setEditId(null);
      await recargar();
      notificarCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo renombrar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmarDeshabilitar() {
    if (!motivoId) return;
    if (!motivo.trim()) { toast('Indicá el motivo', 'error'); return; }
    setBusy(true);
    try {
      await deshabilitarHorno(motivoId, motivo);
      notify('Horno deshabilitado', 'success');
      setMotivoId(null);
      setMotivo('');
      await recargar();
      notificarCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo deshabilitar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reactivar(h: Horno) {
    setBusy(true);
    try {
      await habilitarHorno(h.id);
      notify(`Horno "${h.nombre}" reactivado`, 'success');
      await recargar();
      notificarCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo reactivar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Hornos"
      size="lg"
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Administrá los hornos disponibles para fundición. Podés agregar, renombrar y
        deshabilitar (indicando el motivo). Los hornos deshabilitados no aparecen en el
        formulario de fundición.
      </p>

      {/* Alta */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.85rem' }}>
        <input
          className="input"
          placeholder="Nombre del nuevo horno (ej. Horno 3)"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={agregar} disabled={busy}>+ Agregar</button>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando hornos…</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.88rem' }}>
            <thead>
              <tr>
                <th>Horno</th>
                <th style={{ width: 110 }}>Estado</th>
                <th style={{ width: 240 }}></th>
              </tr>
            </thead>
            <tbody>
              {hornos.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin hornos. Agregá el primero arriba.</td></tr>
              )}
              {hornos.map((h) => {
                const enEdicion = editId === h.id;
                const activo = h.estado === 'activo';
                return (
                  <tr key={h.id}>
                    <td>
                      {enEdicion ? (
                        <input
                          className="input"
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void guardarRename();
                            if (e.key === 'Escape') setEditId(null);
                          }}
                        />
                      ) : (
                        <>
                          <strong>{h.nombre}</strong>
                          {!activo && h.motivo_inhabilitacion && (
                            <div className="muted" style={{ fontSize: '.72rem' }}>Motivo: {h.motivo_inhabilitacion}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${activo ? 'success' : 'warning'}`}>{activo ? 'Activo' : 'Inhabilitado'}</span>
                    </td>
                    <td className="actions">
                      {enEdicion ? (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void guardarRename()}>Guardar</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditId(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm btn-ghost" onClick={() => { setEditId(h.id); setEditVal(h.nombre); }}>✎ Editar</button>
                          {activo ? (
                            <button className="btn btn-sm btn-danger" onClick={() => { setMotivoId(h.id); setMotivo(''); }}>⃠ Deshabilitar</button>
                          ) : (
                            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => reactivar(h)}>↺ Reactivar</button>
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
      )}

      {/* Captura del motivo de inhabilitación */}
      {motivoId && (
        <Modal
          title="Deshabilitar horno"
          size="md"
          onClose={() => setMotivoId(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setMotivoId(null)} disabled={busy}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmarDeshabilitar} disabled={busy}>Deshabilitar</button>
            </>
          }
        >
          <div className="form-row">
            <label>Motivo de la inhabilitación</label>
            <textarea
              className="input"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. En mantenimiento / fuera de servicio…"
              autoFocus
            />
            <small className="muted">Quedará registrado junto al horno.</small>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
