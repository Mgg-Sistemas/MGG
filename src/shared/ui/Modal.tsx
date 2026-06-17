import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title?: string;
  // 'sm' = chico y centrado (confirmaciones); md/lg/xl = pantalla completa (formularios).
  size?: 'sm' | 'md' | 'lg' | 'xl';
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, size = 'md', onClose, children, footer }: ModalProps) {
  // A pedido: el modal SOLO se cierra con la ✕ (o los botones explícitos del footer).
  // No se cierra al hacer clic afuera (backdrop) ni con la tecla Escape, para evitar
  // perder lo cargado por un clic accidental.
  const sizeClass = size === 'sm' ? 'modal-sm' : size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : '';
  return createPortal(
    <div className="modal-backdrop">
      <div className={`modal ${sizeClass}`}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{title ?? ''}</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>✕</button>
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
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title = 'Confirmar', message, confirmText = 'Confirmar', danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); }}>{confirmText}</button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}
