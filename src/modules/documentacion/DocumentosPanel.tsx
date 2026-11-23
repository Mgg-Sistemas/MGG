/* ============================================================
   MGG · Documentación · Documentos de la empresa
   Archivo buscable (nombre, categoría, descripción) con el PDF o
   imagen de cada documento y su vencimiento opcional (avisa ≤ 30 días).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { BotonPapeleraRegistros, EnviarRegistroPapelera } from '@/shared/ui/PapeleraRegistros';
import { toast } from '@/shared/ui/Toast';
import { date } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  accionesPapeleraDocumentos, listDocumentosEmpresa, guardarDocumentoEmpresa, enviarDocumentoAPapelera, urlArchivoDocumentacion, urlDescargaDocumentoEmpresa,
  listCategoriasDocumento, ACEPTA_DOCUMENTACION, type Actor, type CategoriaDocumento, type DocumentoEmpresa,
} from './documentacion.repository';
import { norm } from './notaEnvio';
import { CategoriasDocumentoModal } from './CategoriasDocumentoModal';

type EstadoVence = 'vigente' | 'por_vencer' | 'vencido' | null;

/** Vencido, por vencer (≤ 30 días) o vigente. */
function estadoVence(vence: string | null): EstadoVence {
  if (!vence) return null;
  const dias = Math.round((new Date(`${vence}T00:00:00`).getTime() - Date.now()) / 86400000);
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'por_vencer';
  return 'vigente';
}

function esVisible(d: DocumentoEmpresa): boolean {
  return d.mime === 'application/pdf' || (d.mime ?? '').startsWith('image/') || /\.(pdf|jpe?g|png|webp|gif)$/i.test(d.filename);
}

/* Cómo se mira el archivo: agrupado por lo que apura (vigencia) o la tabla
   de siempre. Se recuerda, como el resto del sistema. */
type VistaDocs = 'archivo' | 'tabla';
const CLAVE_VISTA_DOCS = 'mgg.documentacion.v1.docs';

function leerVistaDocs(): VistaDocs {
  try {
    const v = localStorage.getItem(CLAVE_VISTA_DOCS);
    if (v === 'tabla' || v === 'archivo') return v;
  } catch { /* sin almacenamiento: valor por defecto */ }
  return 'archivo';
}

/** Cuánto le queda al papel, en palabras. */
function plazoTexto(vence: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(vence);
  if (!m) return '';
  const v = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const h = new Date();
  const hoy = new Date(h.getFullYear(), h.getMonth(), h.getDate());
  const dias = Math.round((v.getTime() - hoy.getTime()) / 86_400_000);
  if (dias < -1) return `venció hace ${Math.abs(dias)} días`;
  if (dias === -1) return 'venció ayer';
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  if (dias <= 60) return `vence en ${dias} días`;
  const meses = Math.round(dias / 30);
  return meses < 24 ? `vence en ${meses} meses` : `vence en ${Math.round(dias / 365)} años`;
}

const BLOQUES = [
  { key: 'vencido', titulo: 'Vencidos', nota: 'Hay que renovarlos ya.' },
  { key: 'por_vencer', titulo: 'Por vencer', nota: 'Menos de 30 días.' },
  { key: 'vigente', titulo: 'Vigentes', nota: 'Al día.' },
  { key: 'sin', titulo: 'Sin vencimiento', nota: 'No caducan.' },
] as const;

export function DocumentosPanel({ canWrite, actor }: { canWrite: boolean; actor: Actor }) {
  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editar, setEditar] = useState<DocumentoEmpresa | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<DocumentoEmpresa | null>(null);
  const [catalogo, setCatalogo] = useState<CategoriaDocumento[]>([]);
  const [verCategorias, setVerCategorias] = useState(false);
  const [vista, setVista] = useState<VistaDocs>(leerVistaDocs);
  const cambiarVista = (v: VistaDocs) => {
    setVista(v);
    try { localStorage.setItem(CLAVE_VISTA_DOCS, v); } catch { /* no es crítico */ }
  };

  const cargar = useCallback(async () => {
    try {
      const [ds, cs] = await Promise.all([listDocumentosEmpresa(), listCategoriasDocumento().catch(() => [] as CategoriaDocumento[])]);
      setDocs(ds); setCatalogo(cs);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar los documentos', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['documentos_empresa', 'categorias_documentacion'], () => { void cargar(); });

  // El catálogo manda; se suman las categorías que algún documento viejo traiga escrita.
  const categorias = useMemo(
    () => Array.from(new Set([...catalogo.map((c) => c.nombre), ...docs.map((d) => d.categoria)])).sort((a, b) => a.localeCompare(b, 'es')),
    [catalogo, docs],
  );
  const filtrados = useMemo(() => {
    const t = norm(q);
    return docs.filter((d) => (!cat || d.categoria === cat)
      && (!t || norm(`${d.nombre} ${d.categoria} ${d.descripcion ?? ''} ${d.filename}`).includes(t)));
  }, [docs, q, cat]);
  const porVencer = docs.filter((d) => estadoVence(d.vence) === 'por_vencer').length;
  const vencidos = docs.filter((d) => estadoVence(d.vence) === 'vencido').length;

  async function ver(d: DocumentoEmpresa) {
    try {
      if (esVisible(d)) await previewFileUrl(await urlArchivoDocumentacion(d.path), d.filename, d.nombre);
      else window.open(await urlDescargaDocumentoEmpresa(d), '_blank', 'noopener');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el archivo', 'error'); }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
            <label htmlFor="doc-buscar">Buscar</label>
            <input id="doc-buscar" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, categoría o descripción…" />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label htmlFor="doc-cat">Categoría</label>
            <select id="doc-cat" className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="view-toggle" role="tablist" aria-label="Cómo ver el archivo">
            <button type="button" role="tab" aria-selected={vista === 'archivo'}
              className={vista === 'archivo' ? 'active' : ''} onClick={() => cambiarVista('archivo')}
              title="Agrupados por lo que falta para vencer">Archivo</button>
            <button type="button" role="tab" aria-selected={vista === 'tabla'}
              className={vista === 'tabla' ? 'active' : ''} onClick={() => cambiarVista('tabla')}
              title="La lista completa con todas las columnas">Tabla</button>
          </div>
          <span className="muted" style={{ fontSize: '.8rem' }}>{filtrados.length} de {docs.length}</span>
          <BotonPapeleraRegistros acciones={accionesPapeleraDocumentos} onChanged={() => void cargar()} />
          <button className="btn btn-ghost" onClick={() => setVerCategorias(true)} title="Catálogo de categorías: agregar, renombrar o borrar">🏷 Categorías</button>
          {canWrite && <button className="btn btn-primary" onClick={() => setEditar('nuevo')}>＋ Agregar documento</button>}
        </div>
      </div>

      {/* Vencimientos: es un estado del archivo, no un control. */}
      {(porVencer > 0 || vencidos > 0) && (
        <div className="doc-avisos">
          <span className="doc-avisos-texto">Atención:</span>
          {vencidos > 0 && <span className="badge danger">⚠ {vencidos} vencido(s)</span>}
          {porVencer > 0 && <span className="badge warning">⏳ {porVencer} por vencer</span>}
        </div>
      )}

      {verCategorias && (
        <CategoriasDocumentoModal
          categorias={catalogo} docs={docs} canWrite={canWrite} actor={actor.email}
          onClose={() => setVerCategorias(false)}
          onChanged={cargar}
        />
      )}

      {vista === 'archivo' ? (
        loading ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Cargando…</p></div>
        ) : !filtrados.length ? (
          <div className="card">
            <EmptyState icon="🗂" message={docs.length ? 'Ningún documento coincide con la búsqueda' : 'Aún no hay documentos cargados'} />
          </div>
        ) : (
          /* Agrupado por lo único que apura. Los vencidos primero: en la
             tabla alfabética quedaban donde cayera su inicial. */
          BLOQUES.map((b) => {
            const grupo = filtrados.filter((d) => (estadoVence(d.vence) ?? 'sin') === b.key);
            if (!grupo.length) return null;
            return (
              <section key={b.key} className={`doc-bloque ${b.key}`}>
                <div className="doc-bloque-head">
                  <h3 className="doc-bloque-titulo">{b.titulo}</h3>
                  <span className="doc-bloque-n">{grupo.length}</span>
                  <small className="muted" style={{ fontSize: '.76rem' }}>{b.nota}</small>
                </div>
                <div className="doc-cards">
                  {grupo.map((d) => (
                    <article key={d.id} className={`doc-card ${b.key}`}>
                      <div>
                        <div className="doc-card-titulo">{d.nombre}</div>
                        {d.descripcion && <p className="doc-card-desc">{d.descripcion}</p>}
                      </div>
                      <div className="doc-card-meta">
                        <span className="badge">{d.categoria}</span>
                        {d.vence ? (
                          <span className="doc-plazo">
                            {plazoTexto(d.vence)} <span className="doc-plazo-fecha">· {date(d.vence)}</span>
                          </span>
                        ) : <span className="muted" style={{ fontSize: '.78rem' }}>Sin fecha de vencimiento</span>}
                      </div>
                      <div className="doc-card-pie">
                        <span className="doc-card-quien">{d.subido_por_nombre ?? d.subido_por ?? '—'}</span>
                        <button className="btn btn-sm btn-ghost" onClick={() => void ver(d)} title={d.filename}>📎 Ver</button>
                        {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setEditar(d)}>✎ Editar</button>}
                        {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setBorrar(d)} title="Enviar a la papelera">🗑</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })
        )
      ) : (
      <div className="card">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead><tr><th>Documento</th><th>Categoría</th><th>Vence</th><th>Cargado por</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !filtrados.length && (
                <tr><td colSpan={5}><EmptyState icon="🗂" message={docs.length ? 'Ningún documento coincide con la búsqueda' : 'Aún no hay documentos cargados'} /></td></tr>
              )}
              {!loading && filtrados.map((d) => {
                const est = estadoVence(d.vence);
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.nombre}</strong>
                      {d.descripcion && <div className="muted" style={{ fontSize: '.76rem' }}>{d.descripcion}</div>}
                    </td>
                    <td><span className="badge">{d.categoria}</span></td>
                    <td>
                      {d.vence ? (
                        <span style={{ color: est === 'vencido' ? 'var(--danger)' : est === 'por_vencer' ? 'var(--warning)' : undefined }}>
                          {date(d.vence)}{est === 'vencido' ? ' · vencido' : est === 'por_vencer' ? ' · por vencer' : ''}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="muted" style={{ fontSize: '.8rem' }}>{d.subido_por_nombre ?? d.subido_por ?? '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => void ver(d)} title={d.filename}>📎 Ver</button>
                      {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setEditar(d)}>✎ Editar</button>}
                      {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setBorrar(d)} title="Eliminar">🗑️</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {editar && (
        <DocumentoForm
          doc={editar === 'nuevo' ? null : editar} categorias={categorias} actor={actor}
          onClose={() => setEditar(null)}
          onSaved={async () => { setEditar(null); await cargar(); }}
        />
      )}
      {borrar && (
        <EnviarRegistroPapelera nombre={`«${borrar.nombre}»`} onClose={() => setBorrar(null)}
          onConfirm={async (motivo) => {
            await enviarDocumentoAPapelera(borrar.id, motivo);
            toast('Documento enviado a la papelera', 'success');
            setBorrar(null);
            await cargar();
          }}
        />
      )}
    </>
  );
}

function DocumentoForm({ doc, categorias, actor, onClose, onSaved }: {
  doc: DocumentoEmpresa | null; categorias: string[]; actor: Actor;
  onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(doc?.nombre ?? '');
  const [categoria, setCategoria] = useState(doc?.categoria ?? 'General');
  const [descripcion, setDescripcion] = useState(doc?.descripcion ?? '');
  const [vence, setVence] = useState(doc?.vence ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      await guardarDocumentoEmpresa({ nombre, categoria, descripcion, vence: vence || null, file: archivo, actor, anterior: doc });
      toast(doc ? 'Documento actualizado' : 'Documento agregado', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal
      title={doc ? `Editar · ${doc.nombre}` : 'Agregar documento'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="doc-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>}
    >
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <form id="doc-form" onSubmit={submit}>
        <div className="form-row">
          <label htmlFor="doc-titulo">Nombre del documento *</label>
          <input id="doc-titulo" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: RIF de la empresa, Registro mercantil…" autoFocus />
        </div>
        <div className="form-row">
          <label htmlFor="doc-categoria">Categoría</label>
          <input id="doc-categoria" className="input" list="doc-categorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Escribí para buscar o crear una nueva…" />
          <datalist id="doc-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
          <small className="muted">Las del catálogo aparecen al escribir; una categoría nueva se guarda en el catálogo al guardar el documento.</small>
        </div>
        <div className="form-row">
          <label htmlFor="doc-desc">Descripción</label>
          <textarea id="doc-desc" className="input" rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="doc-vence">Vence (opcional)</label>
          <input id="doc-vence" className="input" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
          <small className="muted">Si tiene vencimiento, el sistema lo marca en naranja 30 días antes y en rojo al vencer.</small>
        </div>
        <div className="form-row">
          <label htmlFor="doc-archivo">Archivo (PDF, imagen u Office){doc ? ' · dejalo vacío para mantener el actual' : ' *'}</label>
          <input id="doc-archivo" className="input" type="file" accept={ACEPTA_DOCUMENTACION} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          {doc && !archivo && <small className="muted">Actual: {doc.filename}</small>}
        </div>
      </form>
    </Modal>
  );
}
