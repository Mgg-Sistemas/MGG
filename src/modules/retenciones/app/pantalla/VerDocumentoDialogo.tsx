/* ============================================================
   MGG · Retenciones v8 · «Ver OC»

   El detalle de la OC o de la compra directa, el mismo de la pantalla de
   hoy (DetalleDocumento.tsx), en un diálogo de solo lectura. Lo abre
   quien tenga el permiso de Pedidos (Compras está dentro de Pedidos).
   ============================================================ */

import { Modal } from '@/shared/ui/Modal';
import { DetalleCompraDirecta, DetalleOrdenCompra } from '../../DetalleDocumento';
import type { RetencionItem } from '../datos/puerta';

export function VerDocumentoDialogo({ item, onCerrar }: { item: RetencionItem; onCerrar: () => void }) {
  const titulo = item.kind === 'oc' ? `OC ${item.ocCodigo ?? ''}` : `Compra directa ${item.ocCodigo ?? ''}`;
  return (
    <Modal title={titulo} size="lg" onClose={onCerrar} footer={<button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>}>
      {item.kind === 'oc' && item.orden && <DetalleOrdenCompra item={item} />}
      {item.kind === 'compra_directa' && item.compra && <DetalleCompraDirecta compra={item.compra} />}
      {!item.orden && !item.compra && <p className="muted">No se encontró el detalle del documento.</p>}
    </Modal>
  );
}
