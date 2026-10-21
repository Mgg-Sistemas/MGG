import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  MAX_MINIMIZADAS, minimizar, moduloActual, quitarMinimizada, ventanaVisible,
} from '@/shared/lib/minimizadas';
import { toast } from '@/shared/ui/Toast';

interface ModalProps {
  title?: string;
  // 'sm' = chico y centrado (confirmaciones); md/lg/xl = pantalla completa (formularios).
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Ventana chica y centrada (igual que size 'sm'). Lo usan las pantallas traídas de Golden Touch (13-10). */
  compact?: boolean;
  onClose: () => void;
  /**
   * Minimizar a medida: la página decide cómo guardar y reabrir la ventana (p. ej. el detalle de
   * una orden). Sin esto, toda ventana grande se minimiza sola: queda oculta, con lo escrito
   * intacto, y su pestaña aparece en la barra de abajo (ver minimizadas.ts).
   */
  onMinimizar?: () => void;
  /** false: esta ventana no muestra «—» (por defecto lo muestran las grandes, no las confirmaciones). */
  minimizable?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** Una ventana dentro de otra minimizada se esconde con ella. */
const PadreOculto = createContext(false);

export function Modal({ title, size = 'md', compact = false, onClose, onMinimizar, minimizable, children, footer }: ModalProps) {
  // A pedido: el modal SOLO se cierra con la ✕ (o los botones explícitos del footer).
  // No se cierra al hacer clic afuera (backdrop) ni con la tecla Escape, para evitar
  // perder lo cargado por un clic accidental.
  const tam = compact ? 'sm' : size;
  const sizeClass = tam === 'sm' ? 'modal-sm' : tam === 'lg' ? 'modal-lg' : tam === 'xl' ? 'modal-xl' : '';

  const id = useId();
  const padreOculto = useContext(PadreOculto);
  const [min, setMin] = useState(false);
  const oculto = min || padreOculto;
  const titulo = title?.trim() || 'Ventana';
  const tituloAlMinimizar = useRef(titulo);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Solo dentro de la app (con un módulo donde dejarla); las confirmaciones chicas no se minimizan.
  const puedeMinimizar = !!onMinimizar || ((minimizable ?? tam !== 'sm') && moduloActual() !== null);

  function minimizarEstaVentana() {
    const m = moduloActual();
    if (!m) return;
    const r = minimizar(m.nombre, m.ruta, { id, titulo }, {
      restaurar: () => setMin(false),
      // La ✕ de la pestaña cierra la ventana: se muestra y se pide el cierre a la página (que puede preguntar).
      descartar: () => { quitarMinimizada(id); setMin(false); onCloseRef.current(); },
    });
    if (r === 'lleno') {
      toast(`Ya tienes ${MAX_MINIMIZADAS} pestañas minimizadas (el máximo). Restaura o descarta una para minimizar esta.`, 'warning');
      return;
    }
    tituloAlMinimizar.current = titulo;
    setMin(true);
  }

  // Si la página reutiliza esta ventana para OTRO registro mientras está minimizada, se muestra:
  // lo que el usuario acaba de pedir no puede quedar escondido.
  useEffect(() => {
    if (min && titulo !== tituloAlMinimizar.current) { quitarMinimizada(id); setMin(false); }
  }, [min, titulo, id]);

  // Al cerrarse (desmontarse) la pestaña sale de la barra.
  useEffect(() => () => quitarMinimizada(id), [id]);

  // La barra no restaura una ventana encima de otra: cuenta las que están a la vista.
  useEffect(() => {
    if (oculto) return;
    ventanaVisible(1);
    return () => ventanaVisible(-1);
  }, [oculto]);

  return createPortal(
    <PadreOculto.Provider value={oculto}>
      <div className="modal-backdrop" style={oculto ? { display: 'none' } : undefined}>
        <div className={`modal ${sizeClass}`}>
          <div className="modal-header">
            <h3 style={{ margin: 0 }}>{title ?? ''}</h3>
            <div style={{ display: 'flex', gap: '.35rem' }}>
              {puedeMinimizar && (
                <button type="button" className="btn btn-icon btn-ghost" onClick={onMinimizar ?? minimizarEstaVentana} title="Minimizar (queda en la barra de abajo)" aria-label="Minimizar">—</button>
              )}
              <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} title="Cerrar" aria-label="Cerrar">✕</button>
            </div>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </PadreOculto.Provider>,
    document.body
  );
}

interface ConfirmDialogProps {
  title?: string;
  /** Puede traer negritas, saltos o una lista. */
  message: ReactNode;
  /** Recuadro debajo del mensaje que MUESTRA lo que está en juego (ver VistaPrevia). */
  preview?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  success?: boolean;
  /** Si viene, el botón de confirmar se habilita solo cuando el usuario escribe este texto. */
  requireText?: string;
  requireLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title = 'Confirmar', message, preview, confirmText = 'Confirmar', danger, success, requireText, requireLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  // Comparación tolerante (sin distinguir may/min ni espacios): evita el «no pasa nada»
  // cuando el usuario escribe la palabra en otra caja.
  const matches = requireText == null || typed.trim().toLowerCase() === requireText.trim().toLowerCase();
  const confirmClass = danger ? 'btn-danger' : success ? 'btn-success' : 'btn-primary';
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className={`btn ${confirmClass}`} disabled={!matches} onClick={() => { if (matches) onConfirm(); }}>{confirmText}</button>
        </>
      }
    >
      {typeof message === 'string'
        ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{message}</p>
        : <div style={{ margin: 0 }}>{message}</div>}
      {preview}
      {requireText != null && (
        <div className="form-row" style={{ marginTop: '0.9rem', marginBottom: 0 }}>
          <label>{requireLabel ?? `Escribe ${requireText} para confirmar`}</label>
          <input className="input" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireText} />
        </div>
      )}
    </Modal>
  );
}
