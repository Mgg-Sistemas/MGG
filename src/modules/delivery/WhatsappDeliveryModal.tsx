/* ============================================================
   MGG · Delivery · ventana «Avisar por WhatsApp» (31/10/2026)
   Equivale al MensajeWhatsappModal de MGG (que GT no tiene): el mensaje a
   la vista con «Enviar por WhatsApp» y «Copiar» (CompartirWhatsapp de GT).
   Nada se envía solo.
   ============================================================ */
import { Modal } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';

export function WhatsappDeliveryModal({ titulo, texto, onClose }: { titulo: string; texto: string; onClose: () => void }) {
  return (
    <Modal title={`💬 ${titulo}`} onClose={onClose} minimizable={false}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <CompartirWhatsapp texto={texto} />
    </Modal>
  );
}
