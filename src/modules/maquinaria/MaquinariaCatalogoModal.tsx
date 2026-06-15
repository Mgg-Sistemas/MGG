import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  listCatalogosMaquinaria, addCatalogoMaquinaria, updateCatalogoMaquinaria,
  setCatalogoMaquinariaActivo, eliminarCatalogoMaquinaria,
  type CatalogoMaquinaria, type TipoCatalogoMaquinaria,
} from './maquinaria.repository';

const TABS: { key: TipoCatalogoMaquinaria; label: string; singular: string }[] = [
  { key: 'tipo_maquinaria', label: 'Tipo de maquinaria', singular: 'tipo de maquinaria' },
  { key: 'propietario', label: 'Propietario', singular: 'propietario' },
  { key: 'status', label: 'Status', singular: 'status' },
];

/**
 * Catálogo de Control de Maquinaria (2 partes: tipo de maquinaria + propietario).
 * Mismo patrón que el catálogo de la OP: pestañas, agregar, filtrar, editar y
 * activar/desactivar (los inactivos dejan de aparecer en los selectores). En vivo.
 */
export function MaquinariaCatalogoModal({ canWrite, onClose }: { canWrite: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TipoCatalogoMaquinaria>('tipo_maquinaria');
  const [items, setItems] = useState<CatalogoMaquinaria[]>([]);
  const [valor, setValor] = useState('');
  const [valorKey, setValorKey] = useState(0);
  const [filtro, setFiltro] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValor, setEditValor] = useState('');
  const [borrarId, setBorrarId] = useState<string | null>(null);

  const tabActual = TABS.find((t) => t.key === tab)!;
  const recargar = useCallback(async () => { setItems(await listCatalogosMaquinaria()); }, []);
  useEffect(() => { recargar().catch(() => {}); }, [recargar]);
  useRealtime(['maquinaria_catalogos'], () => { void recargar(); });

  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return items.filter((i) => i.tipo === tab && (!q || i.valor.toLowerCase().includes(q)));
  }, [items, tab, filtro]);

  async function agregar() {
    if (!valor.trim()) { toast(`Indicá el ${tabActual.singular}`, 'error'); return; }
    setBusy(true);
    try {
      await addCatalogoMaquinaria(tab, valor.trim().toUpperCase());
      setValor(''); setValorKey((k) => k + 1); await recargar(); toast('Agregado', 'success');
    }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
    finally { setBusy(false); }
  }
  async function guardarEdicion(id: string) {
    try {
      await updateCatalogoMaquinaria(id, editValor.trim().toUpperCase());
      setEditId(null); await recargar(); toast('Actualizado', 'success');
    }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo editar', 'error'); }
  }
  async function toggle(id: string, activo: boolean) {
    try { await setCatalogoMaquinariaActivo(id, !activo); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  async function borrar(id: string) {
    try { await eliminarCatalogoMaquinaria(id); await recargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const colSpan = (canWrite ? 1 : 0) + 2;

  return (
    <Modal title="🚜 Catálogo de maquinaria" size="md" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="view-toggle" role="tablist" style={{ marginBottom: '.75rem' }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => { setTab(t.key); setEditId(null); setValor(''); setValorKey((k) => k + 1); setFiltro(''); }}>{t.label}</button>
        ))}
      </div>

      {canWrite && (
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', flexWrap: 'wrap' }}>
          <input key={valorKey} name="maq-cat-nuevo" className="input" style={{ flex: '1 1 160px' }} defaultValue={valor} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setValor(e.target.value); }} placeholder={`Nuevo ${tabActual.singular}…`}
            onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }} />
          <button className="btn btn-primary" onClick={() => void agregar()} disabled={busy}>+ Agregar</button>
        </div>
      )}
      <input className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="🔍 Filtrar…" style={{ marginBottom: '.5rem' }} />

      <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead><tr><th>{tabActual.label}</th><th>Estado</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {!lista.length && <tr><td colSpan={colSpan} className="muted" style={{ textAlign: 'center' }}>Sin elementos.</td></tr>}
            {lista.map((l) => (
              <tr key={l.id} style={{ opacity: l.activo ? 1 : 0.5 }}>
                <td>
                  {editId === l.id ? (
                    <input name="maq-cat-editar" className="input" defaultValue={editValor} autoFocus onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setEditValor(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void guardarEdicion(l.id); if (e.key === 'Escape') setEditId(null); }} />
                  ) : l.valor}
                </td>
                <td>{l.activo ? '🟢 Activo' : '⚪ Inactivo'}</td>
                {canWrite && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {editId === l.id ? (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => void guardarEdicion(l.id)}>Guardar</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditId(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => { setEditId(l.id); setEditValor(l.valor); }}>✎</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => void toggle(l.id, l.activo)}>{l.activo ? 'Desactivar' : 'Activar'}</button>
                        <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrarId(l.id)}>🗑</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {borrarId && (
        <ConfirmDialog
          title="Eliminar del catálogo"
          message={`¿Eliminar este ${tabActual.singular} del catálogo?`}
          confirmText="Eliminar"
          danger
          onCancel={() => setBorrarId(null)}
          onConfirm={() => { const id = borrarId; setBorrarId(null); void borrar(id); }}
        />
      )}
    </Modal>
  );
}
