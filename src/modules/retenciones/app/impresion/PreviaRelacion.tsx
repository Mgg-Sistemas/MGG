/* ============================================================
   MGG · Retenciones · Impresión · La vista previa de una relación, con sus cortes

   Como la maqueta (v8-16, v8PaginasRelacion y v8EscalarPaginas): la vista
   previa es la hoja del ejemplar, cortada en páginas carta como saldrá
   impresa. Se monta la relación entera fuera de pantalla, se miden sus
   filas (medirRelacion) y se reparten (paginarRelacion) con los mismos
   cortes en las dos hojas de columnas. Cada página va reducida al ancho
   disponible, con «Página N de M · columnas de la hoja X de 2». Hasta 30
   páginas; más, en CSV o Excel.
   ============================================================ */

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { medidasHoja } from './formatos';
import { HojaRelacion } from './HojaRelacion';
import { medirRelacion, paginarRelacion, type PaginacionRelacion } from './paginar';
import type { DatosRelacion, Orientacion } from './tipos';
import './hojas.css';

const MAX_PAGINAS = 30;

export function PreviaRelacion({ datos, orientacion }: { datos: DatosRelacion; orientacion: Orientacion }) {
  const { ancho: W, alto: H } = medidasHoja(orientacion);
  const medir = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [paginacion, setPaginacion] = useState<PaginacionRelacion | null>(null);
  const [escala, setEscala] = useState(1);

  useLayoutEffect(() => {
    if (!medir.current) return;
    setPaginacion(paginarRelacion(medirRelacion(medir.current), H));
    const disponible = (caja.current?.clientWidth ?? W) - 28;
    setEscala(Math.min(1, disponible / W));
  }, [datos, orientacion, H, W]);

  const paginas = paginacion?.paginas ?? [];
  return (
    <div ref={caja}>
      {createPortal(
        <div ref={medir} aria-hidden="true" style={{ position: 'absolute', left: -30000, top: 0, width: W, visibility: 'hidden' }}>
          <HojaRelacion datos={datos} orientacion={orientacion} />
        </div>,
        document.body,
      )}
      {!paginacion && <p className="v8-relp-midiendo">Midiendo las páginas…</p>}
      {paginacion && (
        <>
          <p className="v8-relp-nota">
            {paginas.length} página(s) en {orientacion === 'vertical' ? 'vertical' : 'horizontal'}
            {paginas.length > MAX_PAGINAS ? `: se muestran ${MAX_PAGINAS}. Para todo, CSV o Excel.` : '.'}
          </p>
          <div className="v8-relp">
            {paginas.slice(0, MAX_PAGINAS).map((p, i) => (
              <figure key={i} className="v8-relp-hoja">
                <div className="v8-relp-caja" style={{ width: W * escala, height: H * escala }}>
                  <div className="v8-relp-escala" style={{ width: W, height: H, transform: `scale(${escala})` }}>
                    <HojaRelacion datos={datos} orientacion={orientacion} pagina={p} />
                  </div>
                </div>
                <figcaption>Página {i + 1} de {paginas.length}{paginacion.grupos > 1 ? ` · columnas de la hoja ${p.grupo + 1} de ${paginacion.grupos}` : ''}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
