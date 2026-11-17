/* ============================================================
   Golden Touch · Administración · compartir un reporte por WhatsApp
   El flujo estándar del sistema: NO descarga un TXT — muestra el texto y lo
   manda por WhatsApp con `shared/ui/CompartirWhatsapp` (navigator.share en
   teléfono → emojis y saltos enteros; wa.me en PC) o lo copia. Mismo patrón
   que `pedidos/OrdenPagarWhatsappModal`. El texto llega ya armado (puro).
   ============================================================ */
import { Modal } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';

export function WhatsAppReporteModal({ titulo, texto, onClose }: {
  titulo: string;
  texto: string;
  onClose: () => void;
}) {
  return (
    <Modal title={`💬 WhatsApp · ${titulo}`} onClose={onClose}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="muted hint" style={{ marginTop: 0 }}>
        Copia el mensaje o envíalo directo por WhatsApp, con el formato y los emojis listos:
      </p>
      <CompartirWhatsapp texto={texto} />
    </Modal>
  );
}
