import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { textoDeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import {
  listCatalogosMaquinaria, addCatalogoMaquinaria, updateCatalogoMaquinaria, eliminarCatalogoMaquinaria,
  type CatalogoMaquinaria,
} from './maquinaria.repository';
import {
  listDocumentosEquipo, guardarDocumento, renombrarDocumento, eliminarDocumento,
  urlVerDocumento, urlDescargaDocumento, type DocumentoEquipo,
} from './maquinariaDocumentos.repository';
import { ACEPTA_DOC, MAX_DOCS_EQUIPO, limpiarNombreDoc, slotsDeEquipo } from './documentosEquipo';

/**
 * Documentos de un equipo (contrato, ficha técnica, póliza…): hasta 4, cada uno en
 * su propio espacio. Cada documento se sube, se ve, se cambia y se elimina solo.
 * El nombre se elige de un catálogo que se va llenando; el catálogo se administra
 * desde «🏷 Nombres de documentos».
 */
export function DocumentosEquipoModal({ equipo, canWrite, actor, onClose }: {
  equipo: { id: string; equipo: string };
  canWrite: boolean;
  actor: string;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocumentoEquipo[]>([]);
  const [nombres, setNombres] = useState<CatalogoMaquinaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [verCatalogo, setVerCatalogo] = useState(false);
  const [borrar, setBorrar] = useState<DocumentoEquipo | null>(null);

  const recargar = useCallback(async () => {
    try {
      const [d, n] = await Promise.all([listDocumentosEquipo(equipo.id), listCatalogosMaquinaria('documento')]);
      setDocs(d);
      setNombres(n);
    } catch (e) {
      toast(textoDeError(e, 'No se pudieron cargar los documentos'), 'error');
    } finally {
      setCargando(false);
    }
  }, [equipo.id]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['maquinaria_documentos', 'maquinaria_catalogos'], () => { void recargar(); });

  const opciones = useMemo<SearchOption[]>(
    () => nombres.filter((n) => n.activo).map((n) => ({ value: n.valor, label: n.valor })),
    [nombres],
  );

  /** Si el nombre es nuevo, queda en el catálogo para la próxima vez. */
  const recordarNombre = useCallback(async (nombre: string) => {
    if (nombres.some((n) => n.valor.toUpperCase() === nombre.toUpperCase())) return;
    try { await addCatalogoMaquinaria('documento', nombre); } catch { /* ya estaba: no importa */ }
  }, [nombres]);

  async function confirmarBorrado() {
    const d = borrar;
    setBorrar(null);
    if (!d) return;
    try {
      await eliminarDocumento(d);
      notify(`«${d.nombre}» eliminado de ${equipo.equipo}`, 'success');
      void recargar();
    } catch (e) {
      toast(textoDeError(e, 'No se pudo eliminar el documento'), 'error');
    }
  }

  return (
    <Modal
      title={`📁 Documentos · ${equipo.equipo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {canWrite && (
            <button className="btn btn-ghost" onClick={() => setVerCatalogo((v) => !v)}>
              🏷 {verCatalogo ? 'Ocultar nombres' : 'Nombres de documentos'}
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Hasta <strong>{MAX_DOCS_EQUIPO} documentos</strong> por equipo (PDF o imagen, máx. 15 MB cada uno).
        Cada uno se sube, se ve y se descarga por separado. Cargados: <strong>{docs.length} de {MAX_DOCS_EQUIPO}</strong>.
      </p>

      {verCatalogo && canWrite && <CatalogoNombresDoc nombres={nombres} onCambio={() => { void recargar(); }} />}

      {cargando ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '.75rem' }}>
          {slotsDeEquipo(docs).map(({ slot, doc }) => (
            <SlotDocumento
              key={`${slot}-${doc?.id ?? 'vacio'}`}
              slot={slot} doc={doc} equipoId={equipo.id} canWrite={canWrite} actor={actor}
              opciones={opciones} onRecordar={recordarNombre} onBorrar={setBorrar}
              onCambio={() => { void recargar(); }}
            />
          ))}
        </div>
      )}

      {borrar && (
        <ConfirmDialog
          title="Eliminar documento"
          message={`¿Eliminar «${borrar.nombre}» de ${equipo.equipo}? Se borra el archivo y el espacio queda libre.`}
          confirmText="Eliminar" danger
          onCancel={() => setBorrar(null)}
          onConfirm={() => { void confirmarBorrado(); }}
        />
      )}
    </Modal>
  );
}

/** Un espacio de documento: vacío (para subir) o con su documento (ver, descargar, cambiar, eliminar). */
function SlotDocumento({ slot, doc, equipoId, canWrite, actor, opciones, onRecordar, onBorrar, onCambio }: {
  slot: number;
  doc: DocumentoEquipo | null;
  equipoId: string;
  canWrite: boolean;
  actor: string;
  opciones: SearchOption[];
  onRecordar: (nombre: string) => Promise<void>;
  onBorrar: (doc: DocumentoEquipo) => void;
  onCambio: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [renombrando, setRenombrando] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cambiarRef = useRef<HTMLInputElement>(null);

  async function correr(fn: () => Promise<void>, fallo: string) {
    setBusy(true);
    try { await fn(); onCambio(); }
    catch (e) { toast(textoDeError(e, fallo), 'error'); }
    finally { setBusy(false); }
  }

  const subir = () => correr(async () => {
    const n = limpiarNombreDoc(nombre);
    if (!n) throw new Error('Elegí o escribí el nombre del documento.');
    if (!archivo) throw new Error('Elegí el archivo.');
    await guardarDocumento({ equipoId, slot, nombre: n, file: archivo, actor });
    await onRecordar(n);
    setNombre(''); setArchivo(null);
    if (fileRef.current) fileRef.current.value = '';
    notify(`«${n}» subido`, 'success');
  }, 'No se pudo subir el documento');

  const cambiarArchivo = (file: File) => correr(async () => {
    if (!doc) return;
    await guardarDocumento({ equipoId, slot, nombre: doc.nombre, file, actor, anterior: doc });
    notify(`Archivo de «${doc.nombre}» cambiado`, 'success');
  }, 'No se pudo cambiar el archivo');

  const guardarNombre = () => correr(async () => {
    if (!doc) return;
    const n = limpiarNombreDoc(nombre);
    if (!n) throw new Error('El nombre no puede quedar vacío.');
    await renombrarDocumento(doc.id, n, actor);
    await onRecordar(n);
    setRenombrando(false);
    notify(`Documento renombrado a «${n}»`, 'success');
  }, 'No se pudo cambiar el nombre');

  async function ver() {
    if (!doc) return;
    try { await previewFileUrl(await urlVerDocumento(doc.path), doc.filename, doc.nombre); }
    catch (e) { toast(textoDeError(e, 'No se pudo abrir el documento'), 'error'); }
  }

  async function descargar() {
    if (!doc) return;
    try {
      const a = document.createElement('a');
      a.href = await urlDescargaDocumento(doc);
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast(textoDeError(e, 'No se pudo descargar el documento'), 'error');
    }
  }

  return (
    <div className="card" style={{ margin: 0, borderLeft: `3px solid ${doc ? 'var(--success)' : 'var(--border)'}` }}>
      <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        Documento {slot} de {MAX_DOCS_EQUIPO}
      </div>

      {doc ? (
        <>
          {renombrando ? (
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
              <SearchSelect options={opciones} value={nombre} onChange={setNombre} allowCreate
                placeholder="Nombre del documento" emptyText="Escribí un nombre nuevo" style={{ flex: '1 1 180px' }} />
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={guardarNombre}>Guardar</button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setRenombrando(false)}>Cancelar</button>
            </div>
          ) : (
            <div style={{ fontWeight: 700, fontSize: '1rem', marginTop: '.2rem' }}>📄 {doc.nombre}</div>
          )}
          <div className="muted" style={{ fontSize: '.76rem', wordBreak: 'break-all' }}>{doc.filename}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>
            Subido {dateTime(doc.updated_at)} · {doc.updated_by ?? doc.created_by ?? '—'}
          </div>
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.55rem' }}>
            <button className="btn btn-sm btn-primary" onClick={() => void ver()}>👁 Ver</button>
            <button className="btn btn-sm btn-ghost" onClick={() => void descargar()}>↓ Descargar</button>
            {canWrite && !renombrando && (
              <button className="btn btn-sm btn-ghost" disabled={busy}
                onClick={() => { setNombre(doc.nombre); setRenombrando(true); }}>✎ Nombre</button>
            )}
            {canWrite && (
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => cambiarRef.current?.click()}>⇄ Cambiar archivo</button>
            )}
            {canWrite && (
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onBorrar(doc)}>🗑 Eliminar</button>
            )}
            <input ref={cambiarRef} type="file" accept={ACEPTA_DOC} hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void cambiarArchivo(f); }} />
          </div>
          {busy && <div className="muted" style={{ fontSize: '.76rem', marginTop: '.3rem' }}>Guardando…</div>}
        </>
      ) : canWrite ? (
        <div style={{ display: 'grid', gap: '.4rem', marginTop: '.4rem' }}>
          <SearchSelect options={opciones} value={nombre} onChange={setNombre} allowCreate
            placeholder="Nombre: CONTRATO, FICHA TÉCNICA…" emptyText="Escribí un nombre nuevo" />
          <input ref={fileRef} className="input" type="file" accept={ACEPTA_DOC}
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          <button className="btn btn-sm btn-primary" disabled={busy || !nombre.trim() || !archivo} onClick={subir}>
            {busy ? 'Subiendo…' : '⬆ Subir documento'}
          </button>
        </div>
      ) : (
        <div className="muted" style={{ marginTop: '.4rem', fontSize: '.85rem' }}>Vacío</div>
      )}
    </div>
  );
}

/** Catálogo de nombres de documentos: agregar, editar y borrar. */
function CatalogoNombresDoc({ nombres, onCambio }: { nombres: CatalogoMaquinaria[]; onCambio: () => void }) {
  const [nuevo, setNuevo] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editValor, setEditValor] = useState('');
  const [busy, setBusy] = useState(false);

  async function correr(fn: () => Promise<void>, fallo: string) {
    setBusy(true);
    try { await fn(); onCambio(); }
    catch (e) { toast(textoDeError(e, fallo), 'error'); }
    finally { setBusy(false); }
  }

  const agregar = () => correr(async () => {
    const v = limpiarNombreDoc(nuevo);
    if (!v) throw new Error('Escribí el nombre.');
    await addCatalogoMaquinaria('documento', v);
    setNuevo('');
    notify(`«${v}» agregado a los nombres`, 'success');
  }, 'No se pudo agregar el nombre');

  const guardar = () => correr(async () => {
    if (!editId) return;
    const v = limpiarNombreDoc(editValor);
    if (!v) throw new Error('El nombre no puede quedar vacío.');
    await updateCatalogoMaquinaria(editId, v);
    setEditId(null);
    notify('Nombre actualizado', 'success');
  }, 'No se pudo guardar el nombre');

  const borrar = (n: CatalogoMaquinaria) => correr(async () => {
    if (!window.confirm(`¿Borrar «${n.valor}» de los nombres? Los documentos ya cargados conservan su nombre.`)) return;
    await eliminarCatalogoMaquinaria(n.id);
    notify(`«${n.valor}» borrado de los nombres`, 'success');
  }, 'No se pudo borrar el nombre');

  return (
    <div className="card" style={{ marginBottom: '.8rem', borderLeft: '3px solid var(--primary)' }}>
      <div className="card-title" style={{ marginBottom: '.4rem' }}>🏷 Nombres de documentos</div>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <input className="input" placeholder="Nuevo nombre: CONTRATO, PÓLIZA…" value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }} style={{ flex: '1 1 200px' }} />
        <button className="btn btn-primary" disabled={busy} onClick={agregar}>+ Agregar</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.86rem' }}>
          <tbody>
            {!nombres.length && (
              <tr><td className="muted" style={{ textAlign: 'center' }}>Todavía no hay nombres. Se guardan solos al subir un documento.</td></tr>
            )}
            {nombres.map((n) => (
              <tr key={n.id}>
                <td>
                  {editId === n.id ? (
                    <input className="input" value={editValor} autoFocus
                      onChange={(e) => setEditValor(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void guardar(); if (e.key === 'Escape') setEditId(null); }} />
                  ) : <strong>{n.valor}</strong>}
                </td>
                <td className="actions" style={{ width: 170, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editId === n.id ? (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={guardar}>Guardar</button>
                      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditId(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setEditId(n.id); setEditValor(n.valor); }}>✎ Editar</button>
                      <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void borrar(n)}>🗑 Borrar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="muted">Editar o borrar un nombre acá no cambia los documentos ya cargados; para renombrar uno, usá ✎ Nombre en su tarjeta.</small>
    </div>
  );
}
