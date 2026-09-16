/* ============================================================
   MGG · Salidas · Catálogo de sedes destino
   La lista «Sede destino» de la salida de material se arma desde acá:
   se agregan, se renombran y se deshabilitan sedes. Deshabilitar no
   borra: la sede deja de ofrecerse, pero las salidas que ya la tienen
   la conservan y se puede volver a habilitar.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { textoDeError } from '@/shared/lib/errores';
import {
  actualizarCatalogoPedido, crearCatalogoPedido, listCatalogoPedido, setEstadoCatalogoPedido, type CatalogoPedido,
} from '@/modules/pedidos/pedidos.repository';

const mismoNombre = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function SedesDestinoModal({ actor, onClose }: { actor?: string | null; onClose: () => void }) {
  const [items, setItems] = useState<CatalogoPedido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nueva, setNueva] = useState('');
  const [edit, setEdit] = useState<{ id: string; nombre: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try { setItems(await listCatalogoPedido('sede_destino')); }
    catch (e) { toast(textoDeError(e, 'No se pudieron cargar las sedes.'), 'error'); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['catalogos_pedido'], () => { void cargar(); });

  // Las habilitadas primero; las deshabilitadas quedan abajo, a mano para reactivarlas.
  const ordenados = useMemo(
    () => [...items].sort((a, b) => (a.estado === b.estado ? a.nombre.localeCompare(b.nombre, 'es') : a.estado === 'activo' ? -1 : 1)),
    [items],
  );

  async function agregar() {
    const n = nueva.trim();
    if (!n) return;
    const existe = items.find((x) => mismoNombre(x.nombre, n));
    if (existe) {
      toast(existe.estado === 'activo' ? `«${existe.nombre}» ya está en la lista.` : `«${existe.nombre}» existe pero está deshabilitada: habilitala abajo.`, 'error');
      return;
    }
    setOcupado(true);
    try { await crearCatalogoPedido('sede_destino', n, actor); setNueva(''); await cargar(); toast(`Sede «${n}» agregada`, 'success'); }
    catch (e) { toast(textoDeError(e, 'No se pudo agregar la sede.'), 'error'); }
    finally { setOcupado(false); }
  }

  async function guardarNombre() {
    if (!edit) return;
    const n = edit.nombre.trim();
    if (!n) { toast('El nombre no puede quedar vacío.', 'error'); return; }
    if (items.some((x) => x.id !== edit.id && mismoNombre(x.nombre, n))) { toast(`Ya hay una sede llamada «${n}».`, 'error'); return; }
    setOcupado(true);
    try { await actualizarCatalogoPedido(edit.id, n); setEdit(null); await cargar(); }
    catch (e) { toast(textoDeError(e, 'No se pudo renombrar la sede.'), 'error'); }
    finally { setOcupado(false); }
  }

  async function alternar(it: CatalogoPedido) {
    setOcupado(true);
    try {
      await setEstadoCatalogoPedido(it.id, it.estado === 'activo' ? 'inactivo' : 'activo');
      await cargar();
      toast(it.estado === 'activo' ? `«${it.nombre}» deshabilitada` : `«${it.nombre}» habilitada`, 'success');
    } catch (e) { toast(textoDeError(e, 'No se pudo cambiar el estado.'), 'error'); }
    finally { setOcupado(false); }
  }

  return (
    <Modal title="📍 Sedes destino" size="md" onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Listo</button>}>
      <p className="hint muted" style={{ marginTop: 0 }}>
        Las sedes y centros de acopio que aparecen en <strong>Sede destino</strong> al hacer una salida de material.
        Deshabilitar no borra nada: la sede deja de ofrecerse y las salidas que ya la tienen la conservan.
      </p>
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.8rem' }}>
        <input className="input" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva sede (ej. Acopio El Callao)"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }} style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => void agregar()} disabled={ocupado || !nueva.trim()}>+ Agregar</button>
      </div>
      {cargando ? <p className="muted">Cargando…</p> : !ordenados.length ? (
        <p className="hint muted">Todavía no hay sedes cargadas.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead><tr><th>Sede</th><th>Estado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
            <tbody>
              {ordenados.map((it) => (
                <tr key={it.id} style={it.estado === 'inactivo' ? { opacity: 0.6 } : undefined}>
                  <td>
                    {edit?.id === it.id ? (
                      <input className="input" autoFocus value={edit.nombre} onChange={(e) => setEdit({ id: it.id, nombre: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void guardarNombre(); }
                          if (e.key === 'Escape') setEdit(null);
                        }} />
                    ) : it.nombre}
                  </td>
                  <td>{it.estado === 'activo' ? <span className="badge success">Habilitada</span> : <span className="badge">Deshabilitada</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {edit?.id === it.id ? (
                      <>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => void guardarNombre()} disabled={ocupado}>Guardar</button>{' '}
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit({ id: it.id, nombre: it.nombre })} disabled={ocupado}>✎ Editar</button>{' '}
                        <button type="button" className="btn btn-sm btn-ghost" style={it.estado === 'activo' ? { color: 'var(--danger)' } : undefined}
                          onClick={() => void alternar(it)} disabled={ocupado}>
                          {it.estado === 'activo' ? '⊘ Deshabilitar' : '↺ Habilitar'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
