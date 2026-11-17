/* ============================================================
   MGG · Modal de Pre-salidas para Inventario en PC
   17-11-2026.
   ============================================================ */
import { Modal } from '@/shared/ui/Modal';
import { PreSalidasView } from './PreSalidasView';
import type { ProductoEnAlmacen } from './inventarioTelefono.repository';

interface Props {
  almacen: string;
  productos: ProductoEnAlmacen[];
  actor: string;
  actorName: string | null;
  quien: string;
  onClose: () => void;
}

export function PreSalidasModal({
  almacen,
  productos,
  actor,
  actorName,
  quien,
  onClose,
}: Props) {
  return (
    <Modal
      title="⏳ Pre-salidas de Almacén (Borradores para WhatsApp)"
      size="xl"
      onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}
    >
      <PreSalidasView
        almacen={almacen}
        productos={productos}
        actor={actor}
        actorName={actorName}
        quien={quien}
        onVolver={onClose}
        onSalidaHecha={() => {
          onClose();
        }}
      />
    </Modal>
  );
}
