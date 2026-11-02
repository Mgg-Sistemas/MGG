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

   LAS FOTOS VAN CON EL MENSAJE (MGG, 02-11-2026). Pedido de la administradora
   para las salidas: la foto tiene que salir en el WhatsApp. Un enlace de
   WhatsApp no puede llevar imágenes, así que con `fotos` el botón pasa los
   ARCHIVOS a la hoja de compartir (`navigator.share({ files, text })`):
   teléfono, y Chrome/Edge en la PC, eligen WhatsApp y las fotos llegan con el
   texto debajo. Antes de abrir la hoja se copia el texto, porque algunas
   versiones de WhatsApp sueltan el texto cuando van archivos: se pega y
   listo. Donde no se pueden adjuntar archivos, el mensaje lleva un renglón
   con el enlace de cada foto. Nada se manda solo: todo es con el botón.
   Sin `fotos`, el componente hace exactamente lo de siempre.
   ============================================================ */
import { useEffect, useState, type MouseEvent } from 'react';
import { toast } from '@/shared/ui/Toast';
import { enlaceWhatsapp } from '@/shared/lib/whatsapp';
import { adjuntaArchivos, modoEnvioWhatsapp, textoConEnlacesDeFotos } from '@/shared/lib/fotosWhatsapp';

/** Las fotos que acompañan al mensaje. */
export interface FotosParaWhatsapp {
  /** Las fotos como archivos (las que se adjuntan). */
  archivos: File[];
  /** Enlaces firmados de las fotos, para cuando el navegador no adjunta archivos. */
  enlaces?: string[];
  /** Todavía se están preparando: el botón espera para no mandar el mensaje sin ellas. */
  cargando?: boolean;
}

/** Siempre el mismo arreglo vacío: uno nuevo en cada render dispararía las miniaturas sin fin. */
const SIN_ARCHIVOS: File[] = [];

export function CompartirWhatsapp({ texto, fotos }: { texto: string; fotos?: FotosParaWhatsapp }) {
  const [copiado, setCopiado] = useState(false);
  // El menú de compartir del teléfono. En una PC no existe y se cae al enlace.
  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const archivos = fotos?.archivos ?? SIN_ARCHIVOS;
  const conFotos = !!fotos && (fotos.cargando || archivos.length > 0 || (fotos.enlaces?.length ?? 0) > 0);
  const modo = modoEnvioWhatsapp({
    hayFotos: archivos.length > 0,
    adjuntaArchivos: typeof navigator !== 'undefined' && adjuntaArchivos(navigator, archivos),
    hojaCompartir: puedeCompartir,
  });
  // Lo que se manda (y se ve): si las fotos no van adjuntas, con el enlace de cada una.
  const mensaje = modo === 'archivos' ? texto : textoConEnlacesDeFotos(texto, fotos?.enlaces ?? []);
  const miniaturas = useMiniaturas(archivos);

  async function compartir(e: MouseEvent<HTMLAnchorElement>) {
    if (fotos?.cargando) {
      e.preventDefault();
      toast('Un momento: se están preparando las fotos.', 'info');
      return;
    }
    if (modo === 'enlace') return;   // sin menú nativo, que siga el href de siempre
    e.preventDefault();
    try {
      if (modo === 'archivos') {
        // Sin `await`: la hoja de compartir tiene que abrirse dentro del mismo toque.
        try { void navigator.clipboard?.writeText(mensaje).catch(() => {}); } catch { /* sin portapapeles */ }
        await navigator.share({ files: archivos, text: mensaje });
      } else {
        await navigator.share({ text: mensaje });
      }
    } catch (err) {
      // Cancelar el menú NO es un error: no se le avisa nada a nadie. Cualquier
      // otra falla cae al enlace de siempre, que es lo que había antes.
      if ((err as { name?: string })?.name === 'AbortError') return;
      if (modo === 'archivos') toast('No se pudieron adjuntar las fotos: se abre WhatsApp solo con el texto.', 'warning');
      window.open(enlaceWhatsapp(mensaje), '_blank', 'noopener,noreferrer');
    }
  }

  async function copiar() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(mensaje);
      else {
        // Navegador viejo o sin permiso: se copia con un textarea escondido.
        const ta = document.createElement('textarea');
        ta.value = mensaje; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      setCopiado(true);
      toast('Mensaje copiado', 'success');
      setTimeout(() => setCopiado(false), 2500);
    } catch { toast('No se pudo copiar. Mantén el dedo sobre el texto para copiarlo.', 'error'); }
  }

  return (
    <div className="surt-compartir">
      <div className="surt-compartir-txt">{mensaje}</div>
      {conFotos && (
        <div style={{ marginBottom: '.6rem' }}>
          {miniaturas.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '.4rem', marginBottom: '.35rem' }}>
              {miniaturas.map((m) => (
                <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${m.nombre}`}>
                  <img src={m.url} alt={m.nombre}
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }} />
                </a>
              ))}
            </div>
          )}
          <small className="muted" style={{ display: 'block' }}>
            {fotos?.cargando
              ? 'Preparando las fotos…'
              : modo === 'archivos'
                ? `📷 Las fotos (${archivos.length}) se envían junto con el mensaje. Si WhatsApp no pone el texto debajo de las fotos, pégalo: queda copiado al tocar «Enviar».`
                : 'Este navegador no adjunta fotos: el mensaje lleva el enlace de cada foto (vale 7 días).'}
          </small>
        </div>
      )}
      <div className="surt-compartir-btns">
        <a className="btn btn-wsp btn-grande" href={enlaceWhatsapp(mensaje)} target="_blank" rel="noopener noreferrer"
          aria-disabled={fotos?.cargando || undefined}
          onClick={(e) => void compartir(e)}>
          📲 Enviar por WhatsApp
        </a>
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => void copiar()}>
          {copiado ? '✅ Copiado' : '📋 Copiar'}
        </button>
      </div>
      {puedeCompartir && !conFotos && (
        <small className="muted" style={{ display: 'block', marginTop: '.45rem' }}>
          Se abre el menú de compartir del teléfono: elige WhatsApp y el chat. Así el mensaje
          llega con los emojis y los renglones enteros.
        </small>
      )}
    </div>
  );
}

/** Miniaturas de las fotos que se van a mandar (se sueltan al cambiar o salir). */
function useMiniaturas(archivos: File[]): { url: string; nombre: string }[] {
  const [mins, setMins] = useState<{ url: string; nombre: string }[]>([]);
  useEffect(() => {
    if (!archivos.length || typeof URL.createObjectURL !== 'function') { setMins((m) => (m.length ? [] : m)); return; }
    const xs = archivos.map((f) => ({ url: URL.createObjectURL(f), nombre: f.name }));
    setMins(xs);
    return () => { xs.forEach((x) => URL.revokeObjectURL(x.url)); };
  }, [archivos]);
  return mins;
}
