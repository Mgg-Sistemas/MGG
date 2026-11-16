/* ============================================================
   MGG · Documentación · Catálogo de categorías de documentos
   Lista buscable: agregar, renombrar (arrastra a sus documentos) y borrar
   (sus documentos pasan a «General»), con confirmación del sistema.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { BotonPapeleraRegistros, EnviarRegistroPapelera } from '@/shared/ui/PapeleraRegistros';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import {
  crearCategoriaDocumento, eliminarCategoriaDocumento, papeleraCatalogosDocumentacion, renombrarCategoriaDocumento, type CategoriaDocumento, type DocumentoEmpresa,
} from './documentacion.repository';
import { norm } from './notaEnvio';

export function CategoriasDocumentoModal({ categorias, docs, canWrite, actor, onClose, onChanged }: {
  categorias: CategoriaDocumento[]; docs: DocumentoEmpresa[]; canWrite: boolean; actor: string;
  onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [nueva, setNueva] = useState('');
  const [editando, setEditando] = useState<CategoriaDocumento | null>(null);
  const [nombreEdit, setNombreEdit] = useState('');
  const [borrar, setBorrar] = useState<CategoriaDocumento | null>(null);
  const [saving, setSaving] = useState(false);

  const usos = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) m.set(d.categoria, (m.get(d.categoria) ?? 0) + 1);
    return m;
  }, [docs]);
  const visibles = useMemo(() => {
    const t = norm(q);
    return categorias.filter((c) => !t || norm(c.nombre).includes(t));
  }, [categorias, q]);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    if (!nueva.trim()) return;
    setSaving(true);
    try { await crearCategoriaDocumento(nueva, actor); toast(`Categoría «${nueva.trim()}» creada`, 'success'); setNueva(''); await onChanged(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo crear', 'error'); }
    finally { setSaving(false); }
  }
  async function guardarNombre() {
    if (!editando) return;
    setSaving(true);
    try { await renombrarCategoriaDocumento(editando, nombreEdit); toast('Categoría renombrada', 'success'); setEditando(null); await onChanged(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo renombrar', 'error'); }
    finally { setSaving(false); }
  }
  return (
    <Modal title="🏷 Categorías de documentos" size="md" onClose={onClose} footer={<>
      <BotonPapeleraRegistros acciones={papeleraCatalogosDocumentacion} onChanged={() => void onChanged()} />
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    </>}>
      {canWrite && (
        <form onSubmit={agregar} style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
          <input className="input" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva categoría…" style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary" disabled={saving || !nueva.trim()}>＋ Agregar</button>
        </form>
      )}
      <div className="form-row" style={{ marginBottom: '.5rem' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar categoría…" />
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <thead><tr><th>Categoría</th><th style={{ textAlign: 'right' }}>Documentos</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={3}><EmptyState icon="🏷" message={categorias.length ? 'Ninguna categoría coincide' : 'Aún no hay categorías'} /></td></tr>}
            {visibles.map((c) => (
              <tr key={c.id}>
                <td>
                  {editando?.id === c.id ? (
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      <input className="input" value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void guardarNombre(); } if (e.key === 'Escape') setEditando(null); }} />
                      <button className="btn btn-sm btn-primary" onClick={() => void guardarNombre()} disabled={saving}>Guardar</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditando(null)}>Cancelar</button>
                    </div>
                  ) : <span className="badge">{c.nombre}</span>}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{usos.get(c.nombre) ?? 0}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canWrite && editando?.id !== c.id && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEditando(c); setNombreEdit(c.nombre); }}>✎</button>
                      <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrar(c)}>🗑️</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="muted">Al renombrar, sus documentos cambian con ella. Al vaciar la papelera, los documentos de la categoría eliminada pasan a «General».</small>

      {borrar && (
        <EnviarRegistroPapelera nombre={`la categoría «${borrar.nombre}»`} conAdjuntos={false} onClose={() => setBorrar(null)}
          onConfirm={async (motivo) => {
            await eliminarCategoriaDocumento(borrar, motivo);
            toast('Categoría enviada a la papelera', 'success');
            setBorrar(null);
            await onChanged();
          }} />
      )}
    </Modal>
  );
}
