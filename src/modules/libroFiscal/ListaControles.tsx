/* ============================================================
   Golden Touch · Libro fiscal · Controles de las listas

   · BarraLista — búsqueda con su «×», el número de resultados, los filtros con
     cuántos quedan en cada opción, el orden, los filtros activos y «Quitar
     filtros». En el teléfono los filtros se pliegan.
   · Paginador — primera · anterior · números con «…» · siguiente · última;
     «Ir a la página» y filas por página.
   ============================================================ */
import { useEffect, useState } from 'react';
import { numerosPagina, TAMANOS_PAGINA, type Pagina } from './listas';

const nf = (n: number) => n.toLocaleString('es-VE');

export interface OpcionFiltro { valor: string; texto: string; cuenta?: number }
export interface ControlFiltro {
  campo: string;
  etiqueta: string;
  valor: string;
  opciones: OpcionFiltro[];
  /** Cuántas hay con «Todos». */
  total?: number;
}

export function BarraLista({
  q, onQ, placeholder, resultados, unidad, filtros, onFiltro, orden, onOrden, onQuitar, extra,
}: {
  q: string;
  onQ: (q: string) => void;
  placeholder: string;
  resultados: number;
  unidad: string;
  filtros: ControlFiltro[];
  onFiltro: (campo: string, valor: string) => void;
  orden?: { valor: string; opciones: Array<[string, string]> };
  onOrden?: (valor: string) => void;
  onQuitar: () => void;
  extra?: React.ReactNode;
}) {
  // La búsqueda se escribe al momento y se aplica a los 200 ms: no repinta la lista con cada tecla.
  const [texto, setTexto] = useState(q);
  useEffect(() => { setTexto(q); }, [q]);
  useEffect(() => {
    if (texto === q) return;
    const t = setTimeout(() => onQ(texto), 200);
    return () => clearTimeout(t);
  }, [texto, q, onQ]);

  const activos = filtros.filter((f) => f.valor);
  const movil = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;

  return (
    <div className="lf-barra" role="search" aria-label={`Buscar y filtrar ${unidad}`}>
      <div className="lf-buscar">
        <span className="lf-campo-q">
          <input type="search" className="input" value={texto} placeholder={placeholder} aria-label={placeholder}
            autoComplete="off" onChange={(e) => setTexto(e.target.value)} />
          {texto && (
            <button type="button" className="lf-limpiar" aria-label="Limpiar la búsqueda" onClick={() => { setTexto(''); onQ(''); }}>×</button>
          )}
        </span>
        <span className="lf-res" role="status" aria-live="polite">{nf(resultados)} {unidad}</span>
      </div>
      <details className="lf-filtros" open={!movil}>
        <summary>Filtros{activos.length ? ` (${activos.length})` : ''}</summary>
        <div className="lf-filtros-c">
          {filtros.map((f) => (
            <label key={f.campo} className="lf-campo">
              <span>{f.etiqueta}</span>
              <select className="select" value={f.valor} onChange={(e) => onFiltro(f.campo, e.target.value)}>
                <option value="">Todos{f.total != null ? ` (${nf(f.total)})` : ''}</option>
                {f.opciones.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.texto}{o.cuenta != null ? ` (${nf(o.cuenta)})` : ''}</option>
                ))}
              </select>
            </label>
          ))}
          {orden && onOrden && (
            <label className="lf-campo">
              <span>Ordenar por</span>
              <select className="select" value={orden.valor} onChange={(e) => onOrden(e.target.value)}>
                {orden.opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          )}
          {extra}
        </div>
      </details>
      {(activos.length > 0 || q) && (
        <div className="lf-activos">
          {q && <span className="lf-chip">Búsqueda: «{q}»</span>}
          {activos.map((f) => (
            <span key={f.campo} className="lf-chip">{f.etiqueta}: {f.opciones.find((o) => o.valor === f.valor)?.texto ?? f.valor}</span>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onQuitar}>Quitar filtros</button>
        </div>
      )}
    </div>
  );
}

export function Paginador<T>({ pagina, tam, unidad, onPagina, onTam }: {
  pagina: Pagina<T>;
  tam: number;
  unidad: string;
  onPagina: (p: number) => void;
  onTam: (t: number) => void;
}) {
  const { pag, paginas, desde, hasta, total } = pagina;
  const [ir, setIr] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const irA = () => {
    const n = Math.round(Number(ir));
    if (!(n >= 1 && n <= paginas)) { setAviso(`Indica una página entre 1 y ${nf(paginas)}.`); return; }
    setAviso(null); setIr(''); onPagina(n);
  };
  const boton = (p: number, contenido: React.ReactNode, etiqueta: string, cls = '') => (
    <button type="button" className={`lf-pb ${cls}`} disabled={p < 1 || p > paginas || p === pag} aria-label={etiqueta} onClick={() => onPagina(p)}>
      {contenido}
    </button>
  );

  return (
    <nav className="lf-pag" aria-label="Páginas de la lista">
      <span className="lf-pag-info">
        {total ? `Mostrando ${nf(desde)}–${nf(hasta)} de ${nf(total)}` : 'Sin resultados'} <span className="muted">{unidad}</span>
      </span>
      {paginas > 1 && (
        <span className="lf-pag-nav">
          {boton(1, '«', 'Primera página', 'ext')}
          {boton(pag - 1, <>‹<span className="lf-pag-txt"> Anterior</span></>, 'Página anterior')}
          <span className="lf-pag-nums">
            {numerosPagina(pag, paginas).map((x, i) => (x === '…'
              ? <span key={`e${i}`} className="lf-pag-el" aria-hidden="true">…</span>
              : (
                <button key={x} type="button" className="lf-pb num" aria-current={x === pag ? 'page' : undefined}
                  aria-label={`Página ${x}`} onClick={() => x !== pag && onPagina(x)}>{nf(x)}</button>
              )))}
          </span>
          <span className="lf-pag-movil">{nf(pag)} / {nf(paginas)}</span>
          {boton(pag + 1, <><span className="lf-pag-txt">Siguiente </span>›</>, 'Página siguiente')}
          {boton(paginas, '»', 'Última página', 'ext')}
        </span>
      )}
      {paginas > 1 && (
        <span className="lf-pag-ir">
          <label>
            <span className="lf-pag-ir-t">Ir a la página</span>{' '}
            <input type="number" min={1} max={paginas} inputMode="numeric" className="input" value={ir} placeholder={String(pag)}
              aria-label={`Ir a la página (de 1 a ${paginas})`} onChange={(e) => setIr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); irA(); } }} />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={irA}>Ir</button>
          {aviso && <small className="lf-pag-aviso" role="alert">{aviso}</small>}
        </span>
      )}
      {total > TAMANOS_PAGINA[0] && (
        <label className="lf-pag-tam">
          <span>Filas</span>
          <select className="select" value={tam} aria-label="Filas por página" onChange={(e) => onTam(Number(e.target.value))}>
            {TAMANOS_PAGINA.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}
