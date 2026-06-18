import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import type { Chofer, Vehiculo } from '@/shared/lib/types';
import {
  listChoferes, crearChofer, actualizarChofer, setActivoChofer, eliminarChofer,
  listVehiculos, crearVehiculo, actualizarVehiculo, setActivoVehiculo, eliminarVehiculo,
} from './salidasCatalogos.repository';

type Tab = 'choferes' | 'vehiculos';

/**
 * Administra los catálogos de Salidas/Traslados: choferes (responsable + cédula)
 * y vehículos (nombre + placa). Permite crear, editar, deshabilitar/reactivar y
 * eliminar. Lo que se deshabilita deja de aparecer en el selector del formulario.
 */
export function GestionarChoferesVehiculosModal({
  actor, onClose, onCambioAplicado,
}: {
  actor: string;
  onClose: () => void;
  onCambioAplicado?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('choferes');
  const [choferes, setChoferes] = useState<Chofer[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Alta
  const [nNombre, setNNombre] = useState('');
  const [nExtra, setNExtra] = useState(''); // cédula (chofer) o placa (vehículo)

  // Edición inline
  const [editId, setEditId] = useState<string | null>(null);
  const [edNombre, setEdNombre] = useState('');
  const [edExtra, setEdExtra] = useState('');

  async function recargar() {
    setLoading(true);
    try {
      const [cs, vs] = await Promise.all([
        listChoferes(false).catch(() => [] as Chofer[]),
        listVehiculos(false).catch(() => [] as Vehiculo[]),
      ]);
      setChoferes(cs); setVehiculos(vs);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar los catálogos', 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void recargar(); }, []);
  function cambio() { onCambioAplicado?.(); }

  const esChofer = tab === 'choferes';
  const extraLabel = esChofer ? 'Cédula' : 'Placa';

  function limpiarAlta() { setNNombre(''); setNExtra(''); }
  function cancelarEdicion() { setEditId(null); setEdNombre(''); setEdExtra(''); }

  async function agregar() {
    if (!nNombre.trim()) { toast(`Escribí el nombre del ${esChofer ? 'chofer' : 'vehículo'}`, 'error'); return; }
    if (!esChofer && !nExtra.trim()) { toast('Indicá la placa del vehículo', 'error'); return; }
    setBusy(true);
    try {
      if (esChofer) await crearChofer({ nombre: nNombre, cedula: nExtra, actor });
      else await crearVehiculo({ nombre: nNombre, placa: nExtra, actor });
      notify(`${esChofer ? 'Chofer' : 'Vehículo'} "${nNombre.trim().toUpperCase()}" agregado`, 'success');
      limpiarAlta(); await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
    finally { setBusy(false); }
  }

  async function guardarEdicion() {
    if (!editId) return;
    if (!edNombre.trim()) { toast('El nombre no puede quedar vacío', 'error'); return; }
    setBusy(true);
    try {
      if (esChofer) await actualizarChofer(editId, { nombre: edNombre, cedula: edExtra });
      else await actualizarVehiculo(editId, { nombre: edNombre, placa: edExtra });
      notify('Cambios guardados', 'success');
      cancelarEdicion(); await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }

  async function toggleActivo(id: string, activo: boolean) {
    setBusy(true);
    try {
      if (esChofer) await setActivoChofer(id, !activo);
      else await setActivoVehiculo(id, !activo);
      await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error'); }
    finally { setBusy(false); }
  }

  async function borrar(id: string, nombre: string) {
    if (!confirm(`¿Eliminar "${nombre}" del catálogo? Las solicitudes ya creadas conservan sus datos.`)) return;
    setBusy(true);
    try {
      if (esChofer) await eliminarChofer(id);
      else await eliminarVehiculo(id);
      notify(`"${nombre}" eliminado`, 'success');
      await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
    finally { setBusy(false); }
  }

  const filas: Array<{ id: string; nombre: string; extra: string | null; activo: boolean }> = esChofer
    ? choferes.map((c) => ({ id: c.id, nombre: c.nombre, extra: c.cedula ?? null, activo: c.activo }))
    : vehiculos.map((v) => ({ id: v.id, nombre: v.nombre, extra: v.placa ?? null, activo: v.activo }));

  return (
    <Modal title="Choferes / Vehículos" size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Catálogos del despacho. Lo que <strong>deshabilités</strong> deja de aparecer en el selector al crear
        una salida o traslado, pero las solicitudes ya creadas conservan sus datos.
      </p>

      {/* Pestañas */}
      <div className="view-toggle" role="tablist" style={{ marginBottom: '.9rem' }}>
        <button className={esChofer ? 'active' : ''} onClick={() => { setTab('choferes'); cancelarEdicion(); limpiarAlta(); }}>👤 Choferes</button>
        <button className={!esChofer ? 'active' : ''} onClick={() => { setTab('vehiculos'); cancelarEdicion(); limpiarAlta(); }}>🚚 Vehículos</button>
      </div>

      {/* Alta */}
      <div className="form-grid" style={{ marginBottom: '.85rem' }}>
        <div className="form-row">
          <label>{esChofer ? 'Nombre del chofer' : 'Vehículo (marca/modelo)'}</label>
          <input className="input" value={nNombre} onChange={(e) => setNNombre(e.target.value)}
            placeholder={esChofer ? 'Ej. Juan Pérez' : 'Ej. Ford 350'}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }} />
        </div>
        <div className="form-row">
          <label>{extraLabel}{esChofer ? ' (opcional)' : ''}</label>
          <input className={`input ${esChofer ? 'mono' : 'mono'}`} value={nExtra} onChange={(e) => setNExtra(e.target.value)}
            placeholder={esChofer ? 'V-12.345.678' : 'AB123CD'}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }} />
        </div>
        <div className="form-row" style={{ alignSelf: 'end' }}>
          <button className="btn btn-primary" onClick={agregar} disabled={busy || !nNombre.trim()}>+ Agregar</button>
        </div>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando…</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.88rem' }}>
            <thead>
              <tr><th>{esChofer ? 'Chofer' : 'Vehículo'}</th><th>{extraLabel}</th><th>Estado</th><th style={{ width: 240 }}></th></tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin {esChofer ? 'choferes' : 'vehículos'} cargados.</td></tr>}
              {filas.map((f) => {
                const enEd = editId === f.id;
                return (
                  <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.55 }}>
                    <td>{enEd ? (
                      <input className="input" value={edNombre} onChange={(e) => setEdNombre(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') void guardarEdicion(); if (e.key === 'Escape') cancelarEdicion(); }} />
                    ) : <strong>{f.nombre}</strong>}</td>
                    <td className="mono">{enEd ? (
                      <input className="input mono" value={edExtra} onChange={(e) => setEdExtra(e.target.value)}
                        placeholder={esChofer ? 'Cédula' : 'Placa'}
                        onKeyDown={(e) => { if (e.key === 'Enter') void guardarEdicion(); if (e.key === 'Escape') cancelarEdicion(); }} />
                    ) : (f.extra || '—')}</td>
                    <td><span className={`badge ${f.activo ? 'success' : 'warning'}`}>{f.activo ? 'Activo' : 'Deshabilitado'}</span></td>
                    <td className="actions">
                      {enEd ? (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void guardarEdicion()}>Guardar</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={cancelarEdicion}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => { setEditId(f.id); setEdNombre(f.nombre); setEdExtra(f.extra ?? ''); }}>✎</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => toggleActivo(f.id, f.activo)}>{f.activo ? '⃠ Deshabilitar' : '↺ Reactivar'}</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} title="Eliminar" onClick={() => borrar(f.id, f.nombre)}>🗑</button>
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
    </Modal>
  );
}
