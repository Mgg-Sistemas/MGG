/* ============================================================
   MGG · Retenciones v8 · La barra de las listas (R3-11)

   El HTML de `v8Barra` de la maqueta: búsqueda con «N resultado(s)», los
   filtros (cada opción con su cuenta), el orden, y los filtros activos con
   «Quitar filtros». En el teléfono los filtros se pliegan.
   ============================================================ */

import { nf } from '../listas/paginador';

export interface FiltroBarra {
  campo: string;
  etiqueta: string;
  valor: string;
  opciones: { valor: string; texto: string; cuenta?: number }[];
}

interface Props {
  q: string;
  placeholder: string;
  resultados: number;
  /** «documento(s)», «retención(es)»…: para el nombre accesible de la barra. */
  unidad: string;
  filtros: FiltroBarra[];
  orden?: { valor: string; opciones: { valor: string; texto: string }[] };
  onQ: (q: string) => void;
  onFiltro: (campo: string, valor: string) => void;
  onOrden?: (valor: string) => void;
  onQuitar: () => void;
}

export function BarraLista({ q, placeholder, resultados, unidad, filtros, orden, onQ, onFiltro, onOrden, onQuitar }: Props) {
  const activos = filtros.filter((f) => f.valor);
  const movil = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
  return (
    <div className="v8-barra" role="search" aria-label={`Buscar y filtrar ${unidad}`}>
      <div className="v8-buscar">
        <span className="v8-campo-q">
          <input type="search" className="texto" value={q} placeholder={placeholder} aria-label={placeholder}
            autoComplete="off" onChange={(e) => onQ(e.target.value)} />
          {q && <button type="button" className="v8-limpiar" aria-label="Limpiar la búsqueda" onClick={() => onQ('')}>×</button>}
        </span>
        <span className="v8-res" role="status" aria-live="polite">{nf(resultados)} resultado(s)</span>
      </div>
      <details className="v8-filtros" open={!movil}>
        <summary>Filtros{activos.length ? ` (${activos.length})` : ''}</summary>
        <div className="v8-filtros-c">
          {filtros.map((f) => (
            <label key={f.campo} className="campo">
              <span>{f.etiqueta}</span>
              <select className="select" value={f.valor} onChange={(e) => onFiltro(f.campo, e.target.value)}>
                <option value="">Todos</option>
                {f.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}{o.cuenta != null ? ` (${nf(o.cuenta)})` : ''}</option>)}
              </select>
            </label>
          ))}
          {orden && onOrden && (
            <label className="campo">
              <span>Orden</span>
              <select className="select" value={orden.valor} onChange={(e) => onOrden(e.target.value)}>
                {orden.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
              </select>
            </label>
          )}
        </div>
      </details>
      {(activos.length > 0 || q) && (
        <div className="v8-activos">
          {q && <span className="v8-chip">Búsqueda: «{q}»</span>}
          {activos.map((f) => (
            <span key={f.campo} className="v8-chip">{f.etiqueta}: {f.opciones.find((o) => o.valor === f.valor)?.texto ?? f.valor}</span>
          ))}
          <button type="button" className="mini" onClick={onQuitar}>Quitar filtros</button>
        </div>
      )}
    </div>
  );
}
