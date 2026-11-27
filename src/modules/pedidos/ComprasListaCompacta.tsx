import './compras-listas.css';

export const POR_PAGINA_COMPRAS = 8;

export function PaginasCompras({ total, pagina, onChange }: { total: number; pagina: number; onChange: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_COMPRAS));
  const actual = Math.min(pagina, paginas);
  return <div className="compras-paginacion">
    <span>{total ? `${(actual - 1) * POR_PAGINA_COMPRAS + 1}–${Math.min(actual * POR_PAGINA_COMPRAS, total)} de ${total} órdenes` : 'Sin resultados'}</span>
    <div><button className="btn btn-ghost" disabled={actual <= 1} onClick={() => onChange(actual - 1)}>Anterior</button>
      <span>{actual} / {paginas}</span>
      <button className="btn btn-ghost" disabled={actual >= paginas} onClick={() => onChange(actual + 1)}>Siguiente</button></div>
  </div>;
}
