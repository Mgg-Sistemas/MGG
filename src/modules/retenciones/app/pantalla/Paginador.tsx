/* ============================================================
   MGG · Retenciones v8 · El paginador numerado (R3-3)

   El HTML de `v8Paginador` de la maqueta, con la lógica de
   listas/paginador.ts: «Mostrando X–Y de N», primera · anterior · números
   con elipsis · siguiente · última, «Ir a la página» y filas por página.
   En el teléfono queda «página / total» con flechas grandes.
   ============================================================ */

import { useState, type ReactNode } from 'react';
import {
  TAMANOS_PAGINA, ELIPSIS, avisoIrPagina, destinoDeshabilitado, leerIrPagina, mostrarSelectorFilas,
  nf, numeroDePaginas, numerosPagina, rangoVisible,
} from '../listas/paginador';

interface Props {
  total: number;
  pagina: number;
  tamano: number;
  /** «documento(s)», «retención(es)»… */
  unidad: string;
  onPagina: (p: number) => void;
  onTamano: (t: number) => void;
}

export function Paginador({ total, pagina, tamano, unidad, onPagina, onTamano }: Props) {
  const paginas = numeroDePaginas(total, tamano);
  const { desde, hasta } = rangoVisible(total, pagina, tamano);
  const [ir, setIr] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const boton = (destino: number, contenido: ReactNode, etiqueta: string, ext = false) => (
    <button type="button" className={`v8-pb${ext ? ' ext' : ''}`} aria-label={etiqueta}
      disabled={destinoDeshabilitado(destino, pagina, paginas)} onClick={() => onPagina(destino)}>{contenido}</button>
  );
  const irA = () => {
    const n = leerIrPagina(ir, paginas);
    if (n == null) { setAviso(avisoIrPagina(paginas)); return; }
    setAviso(null); setIr(''); onPagina(n);
  };

  return (
    <nav className="v8-pag" aria-label="Páginas de la lista">
      <span className="v8-pag-info">
        {total ? `Mostrando ${nf(desde)}–${nf(hasta)} de ${nf(total)}` : 'Sin resultados'} <span className="muted">{unidad}</span>
      </span>
      {paginas > 1 && (
        <span className="v8-pag-nav">
          {boton(1, '«', 'Primera página', true)}
          {boton(pagina - 1, <>‹<span className="v8-pag-txt"> Anterior</span></>, 'Página anterior')}
          <span className="v8-pag-nums">
            {numerosPagina(pagina, paginas).map((x, i) => (x === ELIPSIS
              ? <span key={`e${i}`} className="v8-pag-el" aria-hidden="true">…</span>
              : <button key={x} type="button" className="v8-pb num" aria-current={x === pagina ? 'page' : undefined}
                aria-label={`Página ${x}`} onClick={() => onPagina(x)}>{nf(x)}</button>))}
          </span>
          <span className="v8-pag-movil">{nf(pagina)} / {nf(paginas)}</span>
          {boton(pagina + 1, <><span className="v8-pag-txt">Siguiente </span>›</>, 'Página siguiente')}
          {boton(paginas, '»', 'Última página', true)}
        </span>
      )}
      {paginas > 1 && (
        <span className="v8-pag-ir">
          <label>
            <span className="v8-pag-ir-t">Ir a la página</span>{' '}
            <input type="number" min={1} max={paginas} inputMode="numeric" className="texto" value={ir} placeholder={String(pagina)}
              aria-label={`Ir a la página (de 1 a ${paginas})`} onChange={(e) => setIr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') irA(); }} />
          </label>
          <button type="button" className="mini" onClick={irA}>Ir</button>
          {aviso && <span className="v8-pag-aviso" role="alert">{aviso}</span>}
        </span>
      )}
      {mostrarSelectorFilas(tamano, total) && (
        <label className="v8-pag-tam">
          <span>Filas</span>
          <select className="select" aria-label="Filas por página" value={tamano} onChange={(e) => onTamano(Number(e.target.value))}>
            {TAMANOS_PAGINA.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}
