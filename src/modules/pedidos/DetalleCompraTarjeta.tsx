import { useState, type ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { ContextoCompraTarjeta, type OrdenTarjeta } from './ContextoCompraTarjeta';

export function DetalleCompraTarjeta({ orden, titulo, children }: { orden?: OrdenTarjeta; titulo: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <ContextoCompraTarjeta orden={orden} titulo={titulo} estado="" detalle={[]} compacto />
    <button className="btn btn-primary" style={{ width: '100%', marginTop: '.65rem' }} onClick={() => setOpen(true)}>👁 Ver detalle</button>
    {open && <Modal title={titulo} onClose={() => setOpen(false)}><div className="compras-panel">{children}</div></Modal>}
  </>;
}
