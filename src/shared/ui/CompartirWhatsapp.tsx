/* ============================================================
   Golden Touch · Pasar un aviso por WhatsApp

   El que carga el movimiento manda el aviso al grupo apenas lo guarda. Lo
   usan el surtidor de combustible y la vista de teléfono de comidas.

   POR QUÉ SE COMPARTE Y NO SE ABRE UN ENLACE (29/09/2026). El botón abría
   `wa.me/?text=…`, que mete el mensaje ENTERO dentro de una dirección web.
   El enlace se arma bien —se comprobó: el texto vuelve idéntico al
   decodificarlo—, pero WhatsApp muestra antes una pantalla propia,
   «Compartir en WhatsApp», y ahí los emojis salían como ◆? y los renglones
   quedaban pegados en un párrafo corrido. Eso ya no es algo que se arregle
   de este lado: el mensaje viaja bien, lo pinta mal la página del medio.

   La salida es no meterlo en una dirección: `navigator.share` le pasa el
   TEXTO al menú de compartir del teléfono, que se lo entrega a WhatsApp tal
   cual. Emojis y saltos de línea llegan enteros y se elige el chat de una.
   Donde ese menú no existe —una PC— se sigue usando el enlace, que para eso
   abre WhatsApp Web y ahí el texto sí entra bien en la caja del mensaje.
   ============================================================ */
import { useState, type MouseEvent } from 'react';
import { toast } from '@/shared/ui/Toast';
import { enlaceWhatsapp } from '@/shared/lib/whatsapp';

export function CompartirWhatsapp({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  // El menú de compartir del teléfono. En una PC no existe y se cae al enlace.
  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function compartir(e: MouseEvent<HTMLAnchorElement>) {
    if (!puedeCompartir) return;   // sin menú nativo, que siga el href de siempre
    e.preventDefault();
    try {
      await navigator.share({ text: texto });
    } catch (err) {
      // Cancelar el menú NO es un error: no se le avisa nada a nadie. Cualquier
      // otra falla cae al enlace de siempre, que es lo que había antes.
      if ((err as { name?: string })?.name === 'AbortError') return;
      window.open(enlaceWhatsapp(texto), '_blank', 'noopener,noreferrer');
    }
  }

  async function copiar() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(texto);
      else {
        // Navegador viejo o sin permiso: se copia con un textarea escondido.
        const ta = document.createElement('textarea');
        ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      setCopiado(true);
      toast('Mensaje copiado', 'success');
      setTimeout(() => setCopiado(false), 2500);
    } catch { toast('No se pudo copiar. Mantén el dedo sobre el texto para copiarlo.', 'error'); }
  }

  return (
    <div className="surt-compartir">
      <div className="surt-compartir-txt">{texto}</div>
      <div className="surt-compartir-btns">
        <a className="btn btn-wsp btn-grande" href={enlaceWhatsapp(texto)} target="_blank" rel="noopener noreferrer"
          onClick={(e) => void compartir(e)}>
          📲 Enviar por WhatsApp
        </a>
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => void copiar()}>
          {copiado ? '✅ Copiado' : '📋 Copiar'}
        </button>
      </div>
      {puedeCompartir && (
        <small className="muted" style={{ display: 'block', marginTop: '.45rem' }}>
          Se abre el menú de compartir del teléfono: elige WhatsApp y el chat. Así el mensaje
          llega con los emojis y los renglones enteros.
        </small>
      )}
    </div>
  );
}
