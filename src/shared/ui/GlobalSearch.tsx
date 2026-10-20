import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { intentarSalir } from '@/shared/lib/minimizadas';
import {
  buscarGlobal, etiquetaResultado, iconoResultado, type ResultadoBusqueda,
} from '@/shared/lib/globalSearch';

/**
 * Buscador global: busca en productos, proveedores y órdenes; muestra los
 * resultados en una lista y, al hacer clic, navega a la vista correspondiente
 * abriendo el detalle del elemento.
 */
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ResultadoBusqueda[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activo, setActivo] = useState(0);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  // Búsqueda con debounce.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      buscarGlobal(term)
        .then((r) => { setResults(r); setActivo(0); })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function ir(r: ResultadoBusqueda) {
    setOpen(false);
    setQ('');
    setResults([]);
    if (!intentarSalir(r.ruta)) return; // con pestañas minimizadas pregunta antes de salir del módulo
    navigate(r.ruta);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => (a + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); ir(results[activo]); }
  }

  const mostrar = open && q.trim().length >= 2;

  return (
    <div className="search-box" ref={boxRef} style={{ position: 'relative' }}>
      <input
        placeholder="Buscar productos, proveedores, órdenes…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {mostrar && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
            background: 'var(--bg-2, #11161f)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', boxShadow: '0 12px 32px rgba(0,0,0,.45)',
            maxHeight: 380, overflowY: 'auto', padding: '.35rem',
          }}
        >
          {loading ? (
            <div className="muted" style={{ padding: '.6rem .7rem', fontSize: '.85rem' }}>Buscando…</div>
          ) : !results.length ? (
            <div className="muted" style={{ padding: '.6rem .7rem', fontSize: '.85rem' }}>Sin resultados para “{q.trim()}”.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.tipo}-${r.id}`}
                type="button"
                onMouseEnter={() => setActivo(i)}
                onClick={() => ir(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '.6rem', width: '100%',
                  padding: '.5rem .6rem', border: 'none', borderRadius: 'var(--r-sm, 6px)',
                  background: i === activo ? 'var(--bg-1, rgba(255,255,255,.05))' : 'transparent',
                  color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '1rem', width: 20, textAlign: 'center' }}>{iconoResultado(r.tipo)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.titulo}</span>
                  <span className="muted mono" style={{ display: 'block', fontSize: '.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.subtitulo}</span>
                </span>
                <span className="badge" style={{ fontSize: '.66rem' }}>{etiquetaResultado(r.tipo)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
