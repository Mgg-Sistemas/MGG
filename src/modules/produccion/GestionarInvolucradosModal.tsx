import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { textoDeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Involucrado } from '@/shared/lib/types';
import {
  listInvolucrados, crearInvolucrado, editarInvolucrado,
  desactivarInvolucrado, reactivarInvolucrado,
} from './involucrados.repository';
import { buscar, opcionesInvolucrados } from './involucrados';

/**
 * Administra el catálogo de personas de planta: agregar, modificar el nombre
 * o el cargo, y desactivar con motivo o volver a activar.
 *
 * Desactivar NO borra a nadie de las coladas ya cargadas: los reportes guardan
 * el nombre, así que lo firmado sigue diciendo lo mismo. Solo deja de ofrecerse
 * para coladas nuevas.
 */
export function GestionarInvolucradosModal({ actor, onClose, onCambio }: {
  actor: string;
  onClose: () => void;
  onCambio?: () => void;
}) {
  const [gente, setGente] = useState<Involucrado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [texto, setTexto] = useState('');

  const [nuevo, setNuevo] = useState('');
  const [nuevoCargo, setNuevoCargo] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editCargo, setEditCargo] = useState('');
  const [motivoId, setMotivoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  async function recargar(): Promise<void> {
    try { setGente(await listInvolucrados()); }
    catch (e) { toast(textoDeError(e, 'No se pudo cargar el catálogo'), 'error'); }
    finally { setCargando(false); }
  }
  useEffect(() => { void recargar(); }, []);
  useRealtime(['involucrados'], () => { void recargar(); });

  function hecho(msg: string): void { notify(msg, 'success'); void recargar(); onCambio?.(); }

  async function correr(fn: () => Promise<void>, fallo: string): Promise<void> {
    setBusy(true);
    try { await fn(); }
    catch (e) { toast(textoDeError(e, fallo), 'error'); }
    finally { setBusy(false); }
  }

  const agregar = () => correr(async () => {
    if (!nuevo.trim()) { toast('Escribí el nombre de la persona', 'error'); return; }
    await crearInvolucrado(nuevo, nuevoCargo, actor);
    setNuevo(''); setNuevoCargo('');
    hecho(`«${nuevo.trim().toUpperCase()}» agregado al catálogo`);
  }, 'No se pudo agregar');

  const guardar = () => correr(async () => {
    if (!editId) return;
    await editarInvolucrado(editId, editNombre, editCargo);
    setEditId(null);
    hecho('Persona actualizada');
  }, 'No se pudo guardar');

  const confirmarBaja = () => correr(async () => {
    if (!motivoId) return;
    if (!motivo.trim()) { toast('Indicá el motivo', 'error'); return; }
    await desactivarInvolucrado(motivoId, motivo);
    setMotivoId(null); setMotivo('');
    hecho('Persona desactivada');
  }, 'No se pudo desactivar');

  const reactivar = (p: Involucrado) => correr(async () => {
    await reactivarInvolucrado(p.id);
    hecho(`«${p.nombre}» reactivado`);
  }, 'No se pudo reactivar');

  // Se busca sobre todas (activas e inactivas), que es lo que se administra acá.
  const q = texto.trim();
  const visibles = q
    ? gente.filter((p) => buscar(
        opcionesInvolucrados([{ id: p.id, nombre: p.nombre, cargo: p.cargo, estado: 'activo' }], []),
        q,
      ).length > 0)
    : gente;

  return (
    <Modal
      title="Involucrados de planta"
      size="lg"
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Las personas que se pueden elegir al cerrar una colada o una refinación.
        Podés agregar, modificar el nombre y el cargo, y desactivar indicando el motivo.
        <strong> Desactivar no borra a nadie de las coladas ya cargadas</strong>: lo firmado
        sigue diciendo lo mismo, solo deja de ofrecerse para las nuevas.
      </p>

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.85rem', flexWrap: 'wrap' }}>
        <input className="input" placeholder="Nombre y apellido" value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }}
          style={{ flex: '2 1 200px' }} />
        <input className="input" placeholder="Cargo (opcional): fundidor, ayudante…" value={nuevoCargo}
          onChange={(e) => setNuevoCargo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }}
          style={{ flex: '1 1 160px' }} />
        <button className="btn btn-primary" onClick={agregar} disabled={busy}>+ Agregar</button>
      </div>

      <input className="input" placeholder="Buscar por nombre o cargo…" value={texto}
        onChange={(e) => setTexto(e.target.value)} style={{ marginBottom: '.6rem' }} />

      {cargando ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando…</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.88rem' }}>
            <thead>
              <tr>
                <th>Persona</th>
                <th style={{ width: 180 }}>Cargo</th>
                <th style={{ width: 110 }}>Estado</th>
                <th style={{ width: 230 }}></th>
              </tr>
            </thead>
            <tbody>
              {!visibles.length && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>
                  {q ? 'Nadie con ese nombre.' : 'Sin personas cargadas. Agregá la primera arriba.'}
                </td></tr>
              )}
              {visibles.map((p) => {
                const enEdicion = editId === p.id;
                const activo = p.estado === 'activo';
                return (
                  <tr key={p.id}>
                    <td>
                      {enEdicion ? (
                        <input className="input" value={editNombre} autoFocus
                          onChange={(e) => setEditNombre(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void guardar(); if (e.key === 'Escape') setEditId(null); }} />
                      ) : (
                        <>
                          <strong>{p.nombre}</strong>
                          {!activo && p.motivo_inhabilitacion && (
                            <div className="muted" style={{ fontSize: '.72rem' }}>Motivo: {p.motivo_inhabilitacion}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {enEdicion ? (
                        <input className="input" value={editCargo} placeholder="Cargo"
                          onChange={(e) => setEditCargo(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void guardar(); if (e.key === 'Escape') setEditId(null); }} />
                      ) : (
                        <span className="muted">{p.cargo || '—'}</span>
                      )}
                    </td>
                    <td><span className={`badge ${activo ? 'success' : 'warning'}`}>{activo ? 'Activo' : 'Desactivado'}</span></td>
                    <td className="actions">
                      {enEdicion ? (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={guardar}>Guardar</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditId(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm btn-ghost"
                            onClick={() => { setEditId(p.id); setEditNombre(p.nombre); setEditCargo(p.cargo ?? ''); }}>✎ Editar</button>
                          {activo ? (
                            <button className="btn btn-sm btn-danger" onClick={() => { setMotivoId(p.id); setMotivo(''); }}>⃠ Desactivar</button>
                          ) : (
                            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => reactivar(p)}>↺ Reactivar</button>
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

      {motivoId && (
        <Modal
          title="Desactivar persona"
          size="md"
          onClose={() => setMotivoId(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setMotivoId(null)} disabled={busy}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmarBaja} disabled={busy}>Desactivar</button>
            </>
          }
        >
          <div className="form-row">
            <label>Motivo de la desactivación</label>
            <textarea className="input" rows={3} value={motivo} autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. ya no trabaja en planta / cambió de área…" />
            <small className="muted">Queda registrado junto a la persona. Las coladas ya cargadas no cambian.</small>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
