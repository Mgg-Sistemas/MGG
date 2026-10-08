/* ============================================================
   MGG · Documentación · Catálogos de texto de la nota de envío
   Condiciones, conceptos de renglón y personas de atención: lista
   buscable, agregar, renombrar y borrar con los estilos del sistema.
   Si viene `onElegir`, cada fila tiene «Usar» (desde el formulario).
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { crearItemCatalogoDoc, eliminarItemCatalogoDoc, renombrarItemCatalogoDoc, type ItemCatalogoDoc } from './documentacion.repository';
import { SCOPES_CATALOGO_DOC, filtrarCatalogo, type ScopeCatalogoDoc } from './catalogoDocumentacion';

export function CatalogoTextoModal({ items, scope: scopeInicial, fijo = false, canWrite, actor, onClose, onChanged, onElegir }: {
  items: ItemCatalogoDoc[];
  /** Catálogo que se abre. */
  scope: ScopeCatalogoDoc;
  /** true: solo ese catálogo (desde un campo del formulario); false: se puede cambiar entre los tres. */
  fijo?: boolean;
  canWrite: boolean; actor: string;
  onClose: () => void; onChanged: () => void | Promise<void>;
  onElegir?: (nombre: string) => void;
}) {
  const [scope, setScope] = useState<ScopeCatalogoDoc>(scopeInicial);
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [editando, setEditando] = useState<ItemCatalogoDoc | null>(null);
  const [nombreEdit, setNombreEdit] = useState('');
  const [borrar, setBorrar] = useState<ItemCatalogoDoc | null>(null);
  const [saving, setSaving] = useState(false);

  const def = SCOPES_CATALOGO_DOC.find((s) => s.key === scope) ?? SCOPES_CATALOGO_DOC[0];
  const visibles = useMemo(() => filtrarCatalogo(items, scope, q), [items, scope, q]);
  const total = useMemo(() => items.filter((i) => i.scope === scope).length, [items, scope]);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    if (!nuevo.trim()) return;
    setSaving(true);
    try { await crearItemCatalogoDoc(scope, nuevo, actor); toast(`«${nuevo.trim()}» agregado`, 'success'); setNuevo(''); await onChanged(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo agregar', 'error'); }
    finally { setSaving(false); }
  }
  async function guardarNombre() {
    if (!editando) return;
    setSaving(true);
    try { await renombrarItemCatalogoDoc(editando.id, nombreEdit); toast('Actualizado', 'success'); setEditando(null); await onChanged(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo guardar', 'error'); }
    finally { setSaving(false); }
  }
  async function confirmarBorrar() {
    if (!borrar) return;
    setSaving(true);
    try { await eliminarItemCatalogoDoc(borrar.id); toast('Eliminado del catálogo', 'success'); setBorrar(null); await onChanged(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo eliminar', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`${def.icon} ${def.label}`} size="md" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {!fijo && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
          {SCOPES_CATALOGO_DOC.map((s) => (
            <button key={s.key} type="button" className={`btn btn-sm ${s.key === scope ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setScope(s.key); setQ(''); setEditando(null); }}>
              {s.icon} {s.label} ({items.filter((i) => i.scope === s.key).length})
            </button>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 .5rem' }}>{def.ayuda} Lo que se escribe en una nota se agrega solo acá.</p>
      {canWrite && (
        <form onSubmit={agregar} style={{ display: 'flex', gap: '.5rem', marginBottom: '.6rem' }}>
          <input className="input" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder={`Nuevo en ${def.label.toLowerCase()}…`} style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary" disabled={saving || !nuevo.trim()}>＋ Agregar</button>
        </form>
      )}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.5rem' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar…" style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{visibles.length} de {total}</span>
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <thead><tr><th>Texto</th><th style={{ textAlign: 'right' }}>Usos</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={3}><EmptyState icon={def.icon} message={total ? 'Nada coincide' : 'Todavía no hay nada en este catálogo'} /></td></tr>}
            {visibles.map((it) => (
              <tr key={it.id}>
                <td>
                  {editando?.id === it.id ? (
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      <input className="input" value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void guardarNombre(); } if (e.key === 'Escape') setEditando(null); }} />
                      <button className="btn btn-sm btn-primary" onClick={() => void guardarNombre()} disabled={saving}>Guardar</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditando(null)}>Cancelar</button>
                    </div>
                  ) : it.nombre}
                </td>
                <td className="mono muted" style={{ textAlign: 'right' }}>{it.usos}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {onElegir && editando?.id !== it.id && <button className="btn btn-sm btn-primary" onClick={() => onElegir(it.nombre)}>Usar</button>}
                  {canWrite && editando?.id !== it.id && (
                    <>
                      <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => { setEditando(it); setNombreEdit(it.nombre); }}>✎</button>
                      <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrar(it)}>🗑️</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {borrar && (
        <ConfirmDialog title={`Eliminar de ${def.label.toLowerCase()}`}
          message={`¿Eliminar «${borrar.nombre}» del catálogo? Las notas ya emitidas no cambian: el texto quedó escrito en cada una.`}
          confirmText="Eliminar" danger onConfirm={() => void confirmarBorrar()} onCancel={() => setBorrar(null)} />
      )}
    </Modal>
  );
}
