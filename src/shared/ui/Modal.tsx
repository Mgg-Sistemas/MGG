import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title?: string;
  // 'sm' = chico y centrado (confirmaciones); md/lg/xl = pantalla completa (formularios).
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Ventana chica y centrada (igual que size 'sm'). Lo usan las pantallas traídas de Golden Touch (13-10). */
  compact?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, size = 'md', compact = false, onClose, children, footer }: ModalProps) {
  // A pedido: el modal SOLO se cierra con la ✕ (o los botones explícitos del footer).
  // No se cierra al hacer clic afuera (backdrop) ni con la tecla Escape, para evitar
  // perder lo cargado por un clic accidental.
  const tam = compact ? 'sm' : size;
  const sizeClass = tam === 'sm' ? 'modal-sm' : tam === 'lg' ? 'modal-lg' : tam === 'xl' ? 'modal-xl' : '';
  return createPortal(
    <div className="modal-backdrop">
      <div className={`modal ${sizeClass}`}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{title ?? ''}</h3>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
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
