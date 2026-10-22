/* ============================================================
   MGG · Retenciones v8 · El salto directo a un N° de comprobante

   El aviso de la maqueta bajo la búsqueda (v8-3-listas.js:234, v8Directo;
   estilos .v8-directo de v8-estilos.css:149-150 y :427-428).
   ============================================================ */

import type { RetencionPracticada } from '../datos/puerta';
import { directoPorNumero } from './numeroDirecto';
import './rv8-salto-directo.css';

export function SaltoDirecto({ q, retenciones, onAbrir }: { q: string; retenciones: readonly RetencionPracticada[]; onAbrir: (r: RetencionPracticada) => void }) {
  const d = directoPorNumero(q, retenciones);
  if (!d) return null;
  if (d.tipo === 'uno') {
    return (
      <div className="rv8-directo" role="status">
        <span>N° <b className="mono">{d.numero}</b> · {d.texto}</span>
        <button type="button" className="btn btn-primary" onClick={() => onAbrir(d.r)}>Abrir</button>
      </div>
    );
  }
  if (d.tipo === 'varios') {
    return (
      <div className="rv8-directo" role="status">
        <span>Ese número existe en {d.opciones.length} series: {d.series}. Elegir cuál abrir:</span>
        <span className="rv8-directo-opc">
          {d.opciones.map((o) => <button key={o.r.id} type="button" className="btn" onClick={() => onAbrir(o.r)}>{o.texto}</button>)}
        </span>
      </div>
    );
  }
  return <div className="rv8-directo vacio" role="status"><span>No hay un comprobante con el N° <b className="mono">{d.numero}</b>.</span></div>;
}
