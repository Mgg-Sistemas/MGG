/* ============================================================
   Golden Touch · RRHH · Ajustar la foto (zoom y centrado)

   Se arrastra la foto para elegir qué queda en el centro y se mueve la barra
   para acercar. Lo que se ve aquí es EXACTAMENTE lo que va a salir en el
   carnet: mismo recorte, misma proporción (54 × 86 mm).

   El archivo no se recorta: se guardan tres números y el recorte se aplica al
   dibujar. Se puede volver a ajustar cuantas veces haga falta.
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import {
  ENCUADRE_NEUTRO, ZOOM_MAX, ZOOM_MIN, moverFoco, normalizarEncuadre, recorteDeEncuadre,
  type Encuadre,
} from './encuadreFoto';

/** Proporción del recuadro de la foto en el carnet (260 × 312 px). */
const VISTA_W = 260;
const VISTA_H = 312;

export function AjustarFoto({ fotoDataUrl, encuadreInicial, guardando, onGuardar, onCerrar, vistaW = VISTA_W, vistaH = VISTA_H, destino = 'el carnet' }: {
  fotoDataUrl: string;
  /** Recuadro de la vista (por defecto, el del carnet). Maquinaria lo usa apaisado, como la foto del expediente. */
  vistaW?: number;
  vistaH?: number;
  /** Dónde va a salir la foto, para el texto de ayuda. */
  destino?: string;
  encuadreInicial?: Encuadre | null;
  guardando?: boolean;
  onGuardar: (e: Encuadre) => void;
  onCerrar: () => void;
}) {
  const [encuadre, setEncuadre] = useState<Encuadre>(normalizarEncuadre(encuadreInicial));
  const [medidas, setMedidas] = useState<{ w: number; h: number } | null>(null);
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const arrastre = useRef<{ x: number; y: number } | null>(null);

  // Se carga la imagen una vez y se guarda su tamaño real: todo el cálculo del
  // recorte trabaja en píxeles de la foto, no del recuadro.
  useEffect(() => {
    let vigente = true;
    const im = new Image();
    im.onload = () => {
      if (!vigente) return;
      img.current = im;
      setMedidas({ w: im.width, h: im.height });
    };
    im.src = fotoDataUrl;
    return () => { vigente = false; };
  }, [fotoDataUrl]);

  // Se redibuja ante cualquier cambio del encuadre.
  useEffect(() => {
    const cv = lienzo.current;
    const im = img.current;
    if (!cv || !im || !medidas) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, vistaW, vistaH);
    const { sx, sy, sw, sh } = recorteDeEncuadre(medidas.w, medidas.h, vistaW, vistaH, encuadre);
    if (sw > 0 && sh > 0) ctx.drawImage(im, sx, sy, sw, sh, 0, 0, vistaW, vistaH);
  }, [encuadre, medidas, vistaW, vistaH]);

  function alBajar(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastre.current = { x: e.clientX, y: e.clientY };
  }

  function alMover(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!arrastre.current || !medidas) return;
    const dx = e.clientX - arrastre.current.x;
    const dy = e.clientY - arrastre.current.y;
    arrastre.current = { x: e.clientX, y: e.clientY };
    // El arrastre se mide en píxeles de pantalla: si el lienzo se ve más chico (teléfono), se corrige.
    const escala = vistaW / (e.currentTarget.getBoundingClientRect().width || vistaW);
    setEncuadre((prev) => moverFoco(prev, dx * escala, dy * escala, medidas.w, medidas.h, vistaW, vistaH));
  }

  function alSoltar(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    arrastre.current = null;
  }

  const estiloLienzo: CSSProperties = {
    width: vistaW, maxWidth: '100%', height: 'auto', aspectRatio: `${vistaW} / ${vistaH}`,
    borderRadius: 12, border: '2px solid var(--primary)',
    cursor: arrastre.current ? 'grabbing' : 'grab',
    touchAction: 'none', // si no, el navegador se queda con el gesto y no se puede arrastrar
    display: 'block', margin: '0 auto',
  };

  return (
    <Modal
      title="Ajustar la foto"
      onClose={onCerrar}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-ghost" disabled={guardando}
            onClick={() => setEncuadre(ENCUADRE_NEUTRO)}>↺ Centrar</button>
          <button className="btn btn-primary" disabled={guardando || !medidas}
            onClick={() => onGuardar(encuadre)}>
            {guardando ? 'Guardando…' : 'Guardar encuadre'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: '.8rem', marginTop: 0 }}>
        <strong>Arrastrá la foto</strong> para elegir qué queda en el centro y usa la barra para acercar.
        Lo que ves aquí es <strong>exactamente</strong> lo que va a salir en {destino}.
      </p>

      <canvas
        ref={lienzo}
        width={vistaW}
        height={vistaH}
        style={estiloLienzo}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '.8rem' }}>
        <span className="muted" style={{ fontSize: '.78rem' }}>Alejar</span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={encuadre.zoom}
          style={{ flex: 1 }}
          onChange={(e) => setEncuadre((prev) => normalizarEncuadre({ ...prev, zoom: Number(e.target.value) }))}
        />
        <span className="muted" style={{ fontSize: '.78rem' }}>Acercar</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 46, textAlign: 'right' }}>
          {encuadre.zoom.toFixed(2)}×
        </span>
      </div>

      {!medidas && <p className="muted" style={{ fontSize: '.8rem' }}>Cargando la foto…</p>}
    </Modal>
  );
}
