import { useEffect, useRef, useState } from 'react';
import { recorteDeEncuadre, type Encuadre } from '@/modules/rrhh/encuadreFoto';

/**
 * Foto que llena su recuadro respetando el encuadre guardado (zoom y punto
 * centrado), con el mismo cálculo que «Ajustar la foto» (16/10/2026). Sin
 * encuadre se ve como siempre: cubrir y centrar.
 *
 * El recuadro se mide en vivo (ResizeObserver): la foto del expediente cambia
 * de proporción entre la PC y el teléfono, y el recorte se recalcula.
 */
export function ImagenEncuadrada({ src, alt, encuadre }: { src: string; alt: string; encuadre?: Encuadre | null }) {
  const caja = useRef<HTMLDivElement>(null);
  const [destino, setDestino] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setDestino({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setNat(null); }, [src]);

  let estilo: React.CSSProperties | undefined;
  if (destino && nat && destino.w > 0 && destino.h > 0) {
    const { sx, sy, sw } = recorteDeEncuadre(nat.w, nat.h, destino.w, destino.h, encuadre);
    if (sw > 0) {
      const k = destino.w / sw;
      estilo = { position: 'absolute', left: -sx * k, top: -sy * k, width: nat.w * k, height: nat.h * k, maxWidth: 'none', objectFit: 'fill' };
    }
  }

  return (
    <div ref={caja} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <img src={src} alt={alt} style={estilo}
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
    </div>
  );
}
