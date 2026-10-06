import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  ACEPTA_DOCUMENTACION, CATEGORIAS_DOCUMENTO, eliminarDocumentoEmpresa, guardarDocumentoEmpresa, listDocumentosEmpresa,
  urlDescargaDocumentoEmpresa, urlVerDocumentoEmpresa, type DocumentoEmpresa,
} from './documentacion.repository';

function tamano(b: number | null): string {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function esVisible(d: DocumentoEmpresa): boolean {
  return d.mime === 'application/pdf' || (d.mime ?? '').startsWith('image/') || /\.(pdf|jpe?g|png|webp|gif)$/i.test(d.filename);
}

function vencimiento(d: DocumentoEmpresa): { txt: string; color: string } | null {
  if (!d.vence) return null;
  const dias = Math.round((new Date(`${d.vence}T00:00:00`).getTime() - Date.now()) / 86400000);
  if (dias < 0) return { txt: `Vencido el ${date(d.vence)}`, color: 'var(--danger)' };
  if (dias <= 30) return { txt: `Vence el ${date(d.vence)} (${dias} días)`, color: 'var(--warning, #f5a524)' };
  return { txt: `Vence el ${date(d.vence)}`, color: 'var(--muted)' };
}

/** Los papeles de la empresa: se suben, se ven, se descargan, se reemplazan. */
export function DocumentosEmpresaTab({ canWrite, actor, actorName }: { canWrite: boolean; actor: string; actorName: string | null }) {
  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [modal, setModal] = useState<{ kind: 'nuevo' } | { kind: 'editar'; doc: DocumentoEmpresa } | { kind: 'eliminar'; doc: DocumentoEmpresa } | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try { setDocs(await listDocumentosEmpresa()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron leer los documentos', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['documentos_empresa'], () => { void cargar(true); });

  const categorias = useMemo(() => Array.from(new Set([...CATEGORIAS_DOCUMENTO, ...docs.map((d) => d.categoria)])).sort(), [docs]);
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return docs.filter((d) => (!cat || d.categoria === cat) && (!t || `${d.nombre} ${d.categoria} ${d.descripcion ?? ''} ${d.filename}`.toLowerCase().includes(t)));
  }, [docs, q, cat]);
  const porCategoria = useMemo(() => {
    const m = new Map<string, DocumentoEmpresa[]>();
    for (const d of visibles) m.set(d.categoria, [...(m.get(d.categoria) ?? []), d]);
    return [...m.entries()];
  }, [visibles]);

  async function ver(d: DocumentoEmpresa) {
    setAbriendo(d.id);
    try {
      if (esVisible(d)) await previewFileUrl(await urlVerDocumentoEmpresa(d.path), d.filename, d.nombre);
      else window.open(await urlDescargaDocumentoEmpresa(d), '_blank', 'noopener');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el documento', 'error'); }
    finally { setAbriendo(null); }
  }
  async function descargar(d: DocumentoEmpresa) {
    try { window.open(await urlDescargaDocumentoEmpresa(d), '_blank', 'noopener'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo descargar', 'error'); }
  }

  return (
    <div className="card">
      <div className="card-title" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
        <span>📁 Documentos de la empresa <span className="muted mono" style={{ fontWeight: 400 }}>{docs.length}</span></span>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar documento…" style={{ width: 200 }} />
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {canWrite && <button className="btn btn-primary" onClick={() => setModal({ kind: 'nuevo' })}>＋ Subir documento</button>}
        </div>
      </div>

      {loading ? <p className="muted">Cargando…</p> : !visibles.length ? (
        <EmptyState icon="📁" message={docs.length ? 'Ningún documento coincide con la búsqueda.' : 'Todavía no hay documentos. Subí el RIF, las actas, los permisos y los contratos de la empresa para tenerlos a mano.'} />
      ) : porCategoria.map(([c, lista]) => (
        <div key={c} style={{ marginBottom: '1rem' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', margin: '.4rem 0' }}>{c} · {lista.length}</div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.86rem' }}>
              <thead><tr><th>Documento</th><th>Archivo</th><th>Vence</th><th>Subido</th><th></th></tr></thead>
              <tbody>
                {lista.map((d) => {
                  const v = vencimiento(d);
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.nombre}</strong>{d.descripcion && <div className="muted" style={{ fontSize: '.78rem' }}>{d.descripcion}</div>}</td>
                      <td className="muted" style={{ fontSize: '.8rem' }}>{d.filename}{d.size_bytes ? ` · ${tamano(d.size_bytes)}` : ''}</td>
                      <td style={{ fontSize: '.8rem', color: v?.color }}>{v?.txt ?? <span className="muted">—</span>}</td>
                      <td className="muted" style={{ fontSize: '.78rem' }}>{date(d.created_at)}{d.subido_por_nombre ? ` · ${d.subido_por_nombre}` : ''}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className="btn btn-sm btn-ghost" disabled={abriendo === d.id} onClick={() => void ver(d)}>👁 Ver</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => void descargar(d)}>⬇</button>
                        {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'editar', doc: d })} title="Editar o reemplazar">✎</button>}
                        {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'eliminar', doc: d })} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {modal && modal.kind !== 'eliminar' && (
        <DocumentoForm
          anterior={modal.kind === 'editar' ? modal.doc : null}
          categorias={categorias}
          actor={actor} actorName={actorName}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); void cargar(true); }}
        />
      )}
      {modal && modal.kind === 'eliminar' && (
        <Modal title="Eliminar documento" size="sm" onClose={() => setModal(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              try { await eliminarDocumentoEmpresa(modal.doc); toast('Documento eliminado', 'success'); setModal(null); void cargar(true); }
              catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
            }}>🗑 Eliminar</button>
          </>
        }>
          <p>Se elimina <strong>{modal.doc.nombre}</strong> y su archivo. Esto no se puede deshacer.</p>
        </Modal>
      )}
    </div>
  );
}

function DocumentoForm({ anterior, categorias, actor, actorName, onClose, onSaved }: {
  anterior: DocumentoEmpresa | null; categorias: string[]; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(anterior?.nombre ?? '');
  const [categoria, setCategoria] = useState(anterior?.categoria ?? 'GENERAL');
  const [descripcion, setDescripcion] = useState(anterior?.descripcion ?? '');
  const [vence, setVence] = useState(anterior?.vence ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      await guardarDocumentoEmpresa({ nombre, categoria, descripcion, vence: vence || null, file, actor, actorName, anterior });
      toast(anterior ? 'Documento actualizado' : 'Documento subido', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={anterior ? `Editar · ${anterior.nombre}` : 'Subir documento de la empresa'} size="md" onClose={onClose} footer={
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="doc-empresa-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : anterior ? 'Guardar' : '⬆ Subir'}</button>
      </>
    }>
      <form id="doc-empresa-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Nombre del documento *</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="RIF, Acta constitutiva, Permiso de explotación…" required autoFocus /></div>
        <div className="form-grid">
          <div className="form-row"><label>Categoría</label>
            <input className="input" list="doc-cats" value={categoria} onChange={(e) => setCategoria(e.target.value.toUpperCase())} />
            <datalist id="doc-cats">{categorias.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="form-row"><label>Vence (opcional)</label>
            <input className="input" type="date" value={vence} onChange={(e) => setVence(e.target.value)} /></div>
        </div>
        <div className="form-row"><label>Descripción (opcional)</label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="N° de registro, vigencia, observación…" /></div>
        <div className="form-row"><label>{anterior ? 'Reemplazar archivo (opcional)' : 'Archivo *'}</label>
          <input className="input" type="file" accept={ACEPTA_DOCUMENTACION} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <small className="hint muted">PDF, imagen o documento de Word, Excel o PowerPoint, hasta 20 MB. {anterior ? `Actual: ${anterior.filename}` : ''}</small></div>
      </form>
    </Modal>
  );
}
