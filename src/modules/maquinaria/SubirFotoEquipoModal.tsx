import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { listDocumentosEquipo, subirDocumentoEquipo, type DocumentoEquipo } from './maquinariaDocumentos.repository';
import { MAX_DOCUMENTOS_EQUIPO, espacioLibre, nombreFotoEquipo } from './maquinariaDocumentos';
import { prepararFotoOrden } from './osFotos.repository';

/**
 * Subir la foto del equipo desde su tarjeta (16/10/2026): «Tomar foto» con la
 * cámara o «Subir foto» desde un archivo. La foto queda en los 📎 documentos del
 * equipo (primer espacio libre), que es de donde salen las fotos del expediente.
 *
 * En el teléfono «Tomar foto» abre la cámara del sistema; en la PC (donde ese
 * atributo no abre nada) se usa la cámara web dentro de esta misma ventana.
 */
interface Props {
  equipoId: string;
  equipoNombre: string;
  fotos: number;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onSubida: () => void | Promise<void>;
  onVerFotos: () => void;
  onDocumentos: () => void;
}

/** ¿Pantalla táctil (teléfono/tablet)? Ahí la cámara la abre el propio sistema. */
const esTactil = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function SubirFotoEquipoModal({ equipoId, equipoNombre, fotos, actor, actorName, onClose, onSubida, onVerFotos, onDocumentos }: Props) {
  const [docs, setDocs] = useState<DocumentoEquipo[] | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [webcam, setWebcam] = useState(false);
  const camaraRef = useRef<HTMLInputElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listDocumentosEquipo(equipoId).then(setDocs).catch((e) => { toast(mensajeError(e, 'No se pudieron leer los documentos del equipo'), 'error'); setDocs([]); });
  }, [equipoId]);

  const espacio = docs ? espacioLibre(docs) : null;
  const lleno = docs !== null && espacio === null;

  async function subir(original: File) {
    if (!docs || espacio === null) return;
    setSubiendo(true);
    try {
      const file = await prepararFotoOrden(original);
      const nombre = nombreFotoEquipo(docs);
      await subirDocumentoEquipo({ equipoId, espacio, nombre, file, actor, actorNombre: actorName });
      toast(`📷 Foto subida a ${equipoNombre}`, 'success');
      await onSubida();
      onClose();
    } catch (e) {
      toast(mensajeError(e, 'No se pudo subir la foto'), 'error');
      setSubiendo(false);
    }
  }

  function recibir(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (f) void subir(f);
  }

  function tomarFoto() {
    if (!esTactil() && typeof navigator.mediaDevices?.getUserMedia === 'function') setWebcam(true);
    else camaraRef.current?.click();
  }

  return (
    <Modal title={`Foto del equipo · ${equipoNombre}`} onClose={() => !subiendo && onClose()} footer={
      <button className="btn btn-ghost" onClick={onClose} disabled={subiendo}>Cerrar</button>
    }>
      {webcam ? (
        <CamaraWeb ocupado={subiendo} onFoto={(f) => void subir(f)} onCancelar={() => setWebcam(false)}
          onSinCamara={() => { setWebcam(false); camaraRef.current?.click(); }} />
      ) : (
        <div style={{ display: 'grid', gap: '.6rem' }}>
          {docs === null && <p className="muted">Revisando los espacios del equipo…</p>}
          {lleno ? (
            <div className="card" style={{ borderColor: 'var(--warning, #ffae00)' }}>
              El equipo ya tiene los {MAX_DOCUMENTOS_EQUIPO} espacios de documentos ocupados. Para agregar otra foto, cambia o quita uno en <strong>📎 Documentos</strong>.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.6rem' }}>
              <button type="button" className="btn btn-primary" style={{ justifyContent: 'center', minHeight: 56 }} disabled={!docs || subiendo} onClick={tomarFoto}>
                📷 Tomar foto (cámara)
              </button>
              <button type="button" className="btn" style={{ justifyContent: 'center', minHeight: 56 }} disabled={!docs || subiendo} onClick={() => archivoRef.current?.click()}>
                🖼 Subir foto (archivo)
              </button>
            </div>
          )}
          {subiendo && <p className="muted">⏳ Subiendo la foto…</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
            {fotos > 0 && <button type="button" className="btn btn-sm btn-ghost" disabled={subiendo} onClick={() => { onClose(); onVerFotos(); }}>👁 Ver las fotos ({fotos})</button>}
            <button type="button" className="btn btn-sm btn-ghost" disabled={subiendo} onClick={() => { onClose(); onDocumentos(); }}>📎 Documentos del equipo</button>
          </div>
          <small className="muted">La foto queda en los documentos del equipo; la primera es la del expediente y la de la ficha PDF.</small>
        </div>
      )}
      <input ref={camaraRef} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto con la cámara" onChange={(e) => recibir(e.currentTarget)} />
      <input ref={archivoRef} type="file" accept="image/*" hidden aria-label="Elegir la foto" onChange={(e) => recibir(e.currentTarget)} />
    </Modal>
  );
}

/** Cámara web de la PC: vista en vivo y «Capturar». */
function CamaraWeb({ ocupado, onFoto, onCancelar, onSinCamara }: {
  ocupado: boolean; onFoto: (f: File) => void; onCancelar: () => void; onSinCamara: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let vivo = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (!vivo) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; void v.play().then(() => setListo(true)).catch(() => setListo(true)); }
      })
      .catch(() => {
        if (!vivo) return;
        toast('No se pudo abrir la cámara (sin cámara o sin permiso). Elige la foto desde un archivo.', 'warning');
        onSinCamara();
      });
    return () => { vivo = false; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (b) onFoto(new File([b], `foto-equipo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  return (
    <div style={{ display: 'grid', gap: '.6rem' }}>
      <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: '60vh', background: '#000', borderRadius: 8 }} />
      {!listo && <p className="muted">Abriendo la cámara… (si el navegador pregunta, permite el acceso)</p>}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={!listo || ocupado} onClick={capturar}>{ocupado ? 'Subiendo…' : '📸 Capturar'}</button>
        <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onCancelar}>← Volver</button>
      </div>
    </div>
  );
}
