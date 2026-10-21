/* ============================================================
   MGG · Compras · «Avisar» por WhatsApp (21-10-2026)
   Todos los botones de WhatsApp de Compras abren ESTA ventana, la misma que usa
   Combustible al avisar un movimiento: el mensaje a la vista, «📋 Copiar mensaje» y
   «💬 Enviar por WhatsApp». Antes algunos mandaban directo y otros solo copiaban.
   En el teléfono el envío va por la hoja de compartir del sistema (el texto viaja como
   string, llega exacto con sus emojis); en la PC por el enlace derecho a api.whatsapp.com
   (nunca wa.me, que se come los emojis). Nada se envía solo.
   ============================================================ */
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { compartirMovimiento, enlaceWhatsapp, puedeCompartir } from '@/modules/combustible/mensajeMovimiento';

interface Props {
  titulo: string;
  texto: string;
  onClose: () => void;
}

export function MensajeWhatsappModal({ titulo, texto, onClose }: Props) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      toast('Mensaje copiado', 'success');
    } catch {
      // Sin permiso de portapapeles (o navegador viejo): se muestra para copiar a mano.
      toast('No se pudo copiar solo. Mantené presionado el texto para copiarlo.', 'warning');
    }
  }

  return (
    <Modal title={titulo} size="md" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="surt-rotulo">Avisar</div>
      <div className="surt-grid2">
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => void copiar()}>📋 Copiar mensaje</button>
        {/* Sin hoja de compartir no se toca nada: navega el `href` solo (abrirlo a mano desde una
            promesa lo frenaría el bloqueador de ventanas, que solo deja abrir dentro del toque). */}
        <a
          className="btn btn-primary btn-grande"
          href={enlaceWhatsapp(texto)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (!puedeCompartir()) return;
            e.preventDefault();
            void compartirMovimiento(texto);
          }}
        >
          💬 Enviar por WhatsApp
        </a>
      </div>
      <pre className="surt-mensaje">{texto}</pre>
    </Modal>
  );
}
