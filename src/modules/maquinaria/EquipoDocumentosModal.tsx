import { useQuien } from '@/shared/lib/directorioUsuarios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { mensajeError } from '@/shared/lib/errores';
import { dateTime } from '@/shared/lib/format';
import { listActivosMaquinaria } from './maquinaria.repository';
import { MaquinariaCatalogoModal } from './MaquinariaCatalogoModal';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import {
  listDocumentosEquipo, subirDocumentoEquipo, cambiarArchivoDocumento, renombrarDocumento,
  eliminarDocumentoEquipo, urlDocumentoEquipo, type DocumentoEquipo,
} from './maquinariaDocumentos.repository';
import {
  ACCEPT_DOCUMENTO, MAX_DOCUMENTOS_EQUIPO, MAX_MB_DOCUMENTO, espaciosVisibles,
  nombreDescargaDocumento, normalizarNombreDocumento, tamanoLegible, validarArchivoDocumento,
} from './maquinariaDocumentos';

interface Props {
  equipo: MaquinariaEquipo;
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onClose: () => void;
}

/**
 * Documentos de un equipo (contrato, catálogo, póliza…): 4 espacios independientes.
 * Cada uno se sube, se ve/descarga, se renombra, se le cambia el archivo y se elimina
 * por separado. Los nombres salen del catálogo (y uno nuevo se guarda solo). En vivo.
 */
export function EquipoDocumentosModal({ equipo, canWrite, actor, actorName, onClose }: Props) {
  const [docs, setDocs] = useState<DocumentoEquipo[]>([]);
  const [nombres, setNombres] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [catalogoOpen, setCatalogoOpen] = useState(false);

  const recargar = useCallback(async () => {
    const [d, n] = await Promise.all([
      listDocumentosEquipo(equipo.id),
      listActivosMaquinaria('documento').catch(() => [] as string[]),
    ]);
    setDocs(d);
    setNombres(n);
  }, [equipo.id]);

  useEffect(() => {
    recargar()
      .catch((e) => toast(mensajeError(e, 'No se pudieron cargar los documentos'), 'error'))
      .finally(() => setCargando(false));
  }, [recargar]);
  useRealtime(['maquinaria_documentos', 'maquinaria_catalogos'], () => { void recargar().catch(() => {}); });

  const alCambiar = useCallback(async () => {
    try { await recargar(); } catch { /* el tiempo real lo trae igual */ }
  }, [recargar]);

  const listId = `maq-doc-nombres-${equipo.id}`;

  return (
    <Modal
      title={`📎 Documentos · ${equipo.equipo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {canWrite && (
            <button className="btn btn-ghost" onClick={() => setCatalogoOpen(true)} title="Editar, desactivar o eliminar los nombres guardados">
              🏷 Nombres guardados
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
        Hasta <strong>{MAX_DOCUMENTOS_EQUIPO} documentos</strong> por equipo, en PDF o imagen de hasta {MAX_MB_DOCUMENTO} MB cada uno.
        Cada espacio es independiente; al cargar uno aparece el siguiente libre. <strong>{docs.length} de {MAX_DOCUMENTOS_EQUIPO}</strong> cargados.
      </p>
      <datalist id={listId}>
        {nombres.map((n) => <option key={n} value={n} />)}
      </datalist>

      {cargando ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '.75rem' }}>
          {espaciosVisibles(docs).map(({ espacio, doc }) => (
            <EspacioDocumento
              // La key cambia al llenarse o vaciarse el espacio: la tarjeta arranca limpia.
              key={doc?.id ?? `libre-${espacio}`}
              espacio={espacio}
              doc={doc}
              equipoId={equipo.id}
              canWrite={canWrite}
              actor={actor}
              actorName={actorName}
              listId={listId}
              onCambio={alCambiar}
            />
          ))}
        </div>
      )}

      {catalogoOpen && (
        <MaquinariaCatalogoModal canWrite={canWrite} tabInicial="documento" onClose={() => setCatalogoOpen(false)} />
      )}
    </Modal>
  );
}

interface EspacioProps {
  espacio: number;
  doc: DocumentoEquipo | null;
  equipoId: string;
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  listId: string;
  onCambio: () => Promise<void>;
}

type Trabajo = '' | 'subir' | 'cambiar' | 'nombre' | 'eliminar';

function EspacioDocumento({ espacio, doc, equipoId, canWrite, actor, actorName, listId, onCambio }: EspacioProps) {
  const [trabajando, setTrabajando] = useState<Trabajo>('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  // Campos no controlados (con ref): un refresco en vivo no borra lo que se está escribiendo.
  const nombreRef = useRef<HTMLInputElement>(null);
  const renombreRef = useRef<HTMLInputElement>(null);
  const cambiarRef = useRef<HTMLInputElement>(null);
  const ocupado = trabajando !== '';

  function aceptable(f: File | null): File | null {
    if (!f) return null;
    const problema = validarArchivoDocumento(f);
    if (problema) { toast(problema, 'error'); return null; }
    return f;
  }

  async function subir() {
    const nombre = normalizarNombreDocumento(nombreRef.current?.value);
    if (!nombre) {
      toast('Pon el nombre del documento: elígelo de la lista o escribe uno nuevo.', 'error');
      nombreRef.current?.focus();
      return;
    }
    if (!archivo) { toast('Elige el archivo (PDF o imagen).', 'error'); return; }
    setTrabajando('subir');
    try {
      await subirDocumentoEquipo({ equipoId, espacio, nombre, file: archivo, actor, actorNombre: actorName });
      toast(`«${nombre}» subido`, 'success');
      await onCambio();
    } catch (e) {
      toast(mensajeError(e, 'No se pudo subir el documento'), 'error');
    } finally {
      setTrabajando('');
    }
  }

  async function ver() {
    if (!doc) return;
    try {
      previewArchivo(await urlDocumentoEquipo(doc.path), nombreDescargaDocumento(doc.nombre, doc.archivo));
    } catch (e) {
      toast(mensajeError(e, 'No se pudo abrir el documento'), 'error');
    }
  }

  async function cambiarArchivo(f: File | null) {
    if (cambiarRef.current) cambiarRef.current.value = '';
    const nuevo = aceptable(f);
    if (!nuevo || !doc) return;
    setTrabajando('cambiar');
    try {
      await cambiarArchivoDocumento(doc, nuevo, actor, actorName);
      toast(`Archivo de «${doc.nombre}» cambiado`, 'success');
      await onCambio();
    } catch (e) {
      toast(mensajeError(e, 'No se pudo cambiar el archivo'), 'error');
    } finally {
      setTrabajando('');
    }
  }

  async function guardarNombre() {
    if (!doc) return;
    const nombre = normalizarNombreDocumento(renombreRef.current?.value);
    if (!nombre) { toast('El nombre no puede quedar vacío.', 'error'); return; }
    if (nombre === doc.nombre) { setEditandoNombre(false); return; }
    setTrabajando('nombre');
    try {
      await renombrarDocumento(doc.id, nombre);
      toast('Nombre actualizado', 'success');
      setEditandoNombre(false);
      await onCambio();
    } catch (e) {
      toast(mensajeError(e, 'No se pudo cambiar el nombre'), 'error');
    } finally {
      setTrabajando('');
    }
  }

  async function eliminar() {
    if (!doc) return;
    setConfirmarEliminar(false);
    setTrabajando('eliminar');
    try {
      await eliminarDocumentoEquipo(doc);
      toast(`«${doc.nombre}» eliminado`, 'success');
      await onCambio();
    } catch (e) {
      toast(mensajeError(e, 'No se pudo eliminar el documento'), 'error');
    } finally {
      setTrabajando('');
    }
  }

  const nombreQuien = useQuien();
  const quien = doc ? nombreQuien(doc.subido_por_nombre, doc.subido_por) : null;

  return (
    <div className="card" style={{ padding: '.75rem', margin: 0, display: 'grid', gap: '.5rem', alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
        <span className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>Documento {espacio}</span>
        {doc ? <span className="badge success">Cargado</span> : <span className="badge">Libre</span>}
      </div>

      {doc ? (
        <>
          {editandoNombre ? (
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
              <input
                ref={renombreRef}
                className="input"
                list={listId}
                autoComplete="off"
                autoFocus
                defaultValue={doc.nombre}
                aria-label={`Nuevo nombre del documento ${espacio}`}
                style={{ flex: '1 1 150px', minWidth: 0 }}
                onChange={(e) => { e.target.value = e.target.value.toUpperCase(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void guardarNombre(); if (e.key === 'Escape') setEditandoNombre(false); }}
              />
              <button className="btn btn-sm btn-primary" disabled={ocupado} onClick={() => void guardarNombre()}>
                {trabajando === 'nombre' ? 'Guardando…' : 'Guardar'}
              </button>
              <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => setEditandoNombre(false)}>Cancelar</button>
            </div>
          ) : (
            <strong style={{ fontSize: '.95rem', overflowWrap: 'anywhere' }}>{doc.nombre}</strong>
          )}

          <div className="muted" style={{ fontSize: '.74rem', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
            {doc.archivo ?? 'archivo'} · {tamanoLegible(doc.tamano)}
            <br />
            {dateTime(doc.updated_at ?? doc.created_at)}{quien ? ` · ${quien}` : ''}
          </div>

          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" disabled={ocupado} onClick={() => void ver()}>👁 Ver / descargar</button>
            {canWrite && (
              <>
                <button className="btn btn-sm btn-ghost" disabled={ocupado} title="Cambiar el nombre del documento" onClick={() => setEditandoNombre(true)}>✎ Nombre</button>
                <button className="btn btn-sm btn-ghost" disabled={ocupado} title="Reemplazar el archivo por otro" onClick={() => cambiarRef.current?.click()}>
                  {trabajando === 'cambiar' ? 'Subiendo…' : '⇄ Cambiar archivo'}
                </button>
                <button className="btn btn-sm btn-ghost" disabled={ocupado} style={{ color: 'var(--danger)' }} title="Eliminar este documento" onClick={() => setConfirmarEliminar(true)}>
                  {trabajando === 'eliminar' ? 'Eliminando…' : '🗑 Eliminar'}
                </button>
                <input
                  ref={cambiarRef}
                  type="file"
                  accept={ACCEPT_DOCUMENTO}
                  hidden
                  aria-label={`Nuevo archivo para ${doc.nombre}`}
                  onChange={(e) => void cambiarArchivo(e.target.files?.[0] ?? null)}
                />
              </>
            )}
          </div>
        </>
      ) : canWrite ? (
        <>
          <input
            ref={nombreRef}
            className="input"
            list={listId}
            autoComplete="off"
            placeholder="Nombre (ej. CONTRATO)"
            aria-label={`Nombre del documento ${espacio}`}
            onChange={(e) => { e.target.value = e.target.value.toUpperCase(); }}
          />
          <input
            type="file"
            className="input"
            accept={ACCEPT_DOCUMENTO}
            aria-label={`Archivo del documento ${espacio}`}
            onChange={(e) => {
              const f = aceptable(e.target.files?.[0] ?? null);
              if (!f) e.target.value = '';
              setArchivo(f);
            }}
          />
          <small className="muted" style={{ fontSize: '.72rem', marginTop: '-.25rem' }}>
            PDF o imagen (JPG, PNG, WEBP o GIF) · hasta {MAX_MB_DOCUMENTO} MB
          </small>
          <button className="btn btn-sm btn-primary" disabled={ocupado} onClick={() => void subir()}>
            {trabajando === 'subir' ? 'Subiendo…' : '⬆ Subir documento'}
          </button>
        </>
      ) : (
        <span className="muted" style={{ fontSize: '.82rem' }}>Sin documento.</span>
      )}

      {confirmarEliminar && doc && (
        <ConfirmDialog
          title="Eliminar documento"
          message={`¿Eliminar «${doc.nombre}» de este equipo? Se borra el archivo y el espacio queda libre para otro.`}
          confirmText="Eliminar"
          danger
          onCancel={() => setConfirmarEliminar(false)}
          onConfirm={() => void eliminar()}
        />
      )}
    </div>
  );
}
