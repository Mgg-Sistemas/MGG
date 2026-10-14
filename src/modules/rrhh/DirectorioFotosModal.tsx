/* ============================================================
   MGG · RRHH · Directorio de fotos (modal) (14-10-2026)
   En pantalla: tarjetas una AL LADO de la otra (foto, nombre, cargo).
   Al imprimir: PDF con una persona DEBAJO de la otra (directorioFotosPdf).
   Las fotos se bajan de una en una (veinte descargas a la vez contra el
   almacén se rechazan a medias) y se recortan con el encuadre del carnet.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Personal } from '@/shared/lib/types';
import { encuadreFoto, inicialesDe, ordenarDirectorio, personaDirectorio, resumenDirectorio, textoCargo, type PersonaDirectorio } from './directorioFotos';

/** Tamaño de la foto recortada que se guarda (px): sirve para la tarjeta y para el PDF. */
const FOTO_W = 220;
const FOTO_H = 270;

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('No cargó la foto'));
    img.src = src;
  });
}

/** La foto recortada con el encuadre de la ficha, como JPEG data URL; null si no hay o no cargó. */
async function fotoRecortada(p: Personal): Promise<string | null> {
  if (!p.foto_url) return null;
  try {
    const img = await cargarImagen(p.foto_url);
    const cv = document.createElement('canvas');
    cv.width = FOTO_W; cv.height = FOTO_H;
    const cx = cv.getContext('2d');
    if (!cx) return null;
    const e = encuadreFoto(img, FOTO_W, FOTO_H, p);
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, FOTO_W, FOTO_H);
    cx.drawImage(img, e.x, e.y, e.dw, e.dh);
    return cv.toDataURL('image/jpeg', 0.85);
  } catch { return null; }
}

export function DirectorioFotosModal({ visibles, total, empresa, emitidoPor, onClose }: {
  visibles: Personal[]; total: number; empresa?: string | null; emitidoPor: string; onClose: () => void;
}) {
  const personas = useMemo(() => ordenarDirectorio(visibles.map((p) => ({ ...personaDirectorio(p), fotoDataUrl: null as string | null, _p: p }))), [visibles]);
  const [fotos, setFotos] = useState<Record<string, string | null>>({});
  const [hechas, setHechas] = useState(0);
  const [generando, setGenerando] = useState(false);
  const vivo = useRef(true);

  // Una por una, en orden: la pantalla se va llenando y el botón de imprimir se habilita al final.
  useEffect(() => {
    vivo.current = true;
    (async () => {
      for (let i = 0; i < personas.length; i++) {
        if (!vivo.current) return;
        const p = personas[i];
        const url = await fotoRecortada(p._p);
        if (!vivo.current) return;
        setFotos((f) => ({ ...f, [p.id]: url }));
        setHechas(i + 1);
      }
    })();
    return () => { vivo.current = false; };
  }, [personas]);

  const listas = hechas >= personas.length;
  const resumen = resumenDirectorio(personas.length, total);

  async function imprimir() {
    setGenerando(true);
    try {
      const { verDirectorioFotosPdf } = await import('./directorioFotosPdf');
      const lista: PersonaDirectorio[] = personas.map((p) => ({
        id: p.id, ficha: p.ficha, nombre: p.nombre, cargo: p.cargo, departamento: p.departamento, cedula: p.cedula, fechaIngreso: p.fechaIngreso,
        fotoDataUrl: fotos[p.id] ?? null,
      }));
      await verDirectorioFotosPdf({ personas: lista, empresa, resumen, emitidoPor });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenerando(false); }
  }

  return (
    <Modal title="📷 Directorio de fotos del personal" size="xl" onClose={onClose}
      footer={<>
        <span className="muted" style={{ marginRight: 'auto', fontSize: '.85rem' }}>
          {resumen}{!listas ? ` · cargando fotos ${hechas}/${personas.length}…` : ''}
        </span>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={() => void imprimir()} disabled={!listas || generando || !personas.length}
          title="PDF con una persona debajo de la otra, para imprimir">
          {generando ? 'Generando…' : '🖨 Imprimir / PDF'}
        </button>
      </>}>
      <p className="hint muted" style={{ marginTop: 0 }}>
        Las fotos salen con el mismo encuadre del carnet. En pantalla van una al lado de la otra; al imprimir, una debajo de la otra. Solo para administración.
      </p>
      {!personas.length && <p className="muted">No hay personal en el listado (revisa el filtro).</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '.75rem' }}>
        {personas.map((p) => {
          const foto = fotos[p.id];
          const cargada = p.id in fotos;
          return (
            <div key={p.id} className="card" style={{ padding: '.5rem', textAlign: 'center', display: 'grid', gap: '.35rem', justifyItems: 'center' }}>
              <div style={{ width: 110, height: 135, borderRadius: 6, overflow: 'hidden', border: '2px solid var(--primary)', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {foto
                  ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span className="muted" style={{ fontSize: cargada ? '1.6rem' : '.75rem', fontWeight: 800 }}>{cargada ? inicialesDe(p._p) : '…'}</span>}
              </div>
              <strong style={{ fontSize: '.85rem', lineHeight: 1.15 }}>{p.nombre}</strong>
              <span className="muted" style={{ fontSize: '.75rem', lineHeight: 1.15 }}>{textoCargo(p._p)}</span>
              {p.ficha && <span className="mono muted" style={{ fontSize: '.7rem' }}>Ficha {p.ficha}</span>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
