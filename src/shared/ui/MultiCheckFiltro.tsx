import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/**
 * Filtro desplegable de selección MÚLTIPLE con casillas, del tamaño de un
 * `select` de la barra de filtros (12-10-2026: la administradora pidió marcar
 * varias categorías a la vez en Inventario).
 *
 * Cerrado se ve como un desplegable y dice «Todas…», una opción o «COCINA +2».
 * Abierto: buscador (si hay muchas opciones), «Todas» para limpiar, y una
 * casilla por opción. Nada se cierra al marcar: se marcan varias seguidas y se
 * cierra con click afuera o Escape.
 */
export function MultiCheckFiltro({
  opciones,
  seleccionadas,
  onChange,
  todasLabel = 'Todas',
  titulo,
  maxWidth = 200,
  alto = 260,
}: {
  opciones: string[];
  seleccionadas: string[];
  onChange: (valores: string[]) => void;
  /** Texto cuando no hay nada marcado (= sin filtro). */
  todasLabel?: string;
  /** title/tooltip del control. */
  titulo?: string;
  maxWidth?: number;
  alto?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const sel = useMemo(() => new Set(seleccionadas), [seleccionadas]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setQ(''); }
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); setQ(''); } }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return opciones.filter((o) => !t || o.toLowerCase().includes(t));
  }, [opciones, q]);

  const toggle = (o: string) => {
    const next = sel.has(o) ? seleccionadas.filter((s) => s !== o) : [...seleccionadas, o];
    // Se devuelve en el orden de la lista, para que «COCINA +2» sea estable.
    onChange(opciones.filter((x) => next.includes(x)));
  };

  const resumen = resumenSeleccion(seleccionadas, todasLabel);

  return (
    <div ref={wrapRef} style={{ position: 'relative', maxWidth, minWidth: 150, flex: '0 1 auto' }}>
      <button
        type="button"
        className="select"
        title={titulo ?? (seleccionadas.length ? seleccionadas.join(' · ') : undefined)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
          fontWeight: seleccionadas.length ? 600 : undefined,
          color: seleccionadas.length ? 'var(--primary-3, #ffd07a)' : undefined,
          borderColor: seleccionadas.length ? 'var(--primary, #ff8a00)' : undefined,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumen}</span>
        <span aria-hidden="true" style={{ opacity: .6, fontSize: '.8rem' }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          style={{
            position: 'absolute', zIndex: 60, top: '100%', left: 0, minWidth: '100%', width: 'max-content', maxWidth: 320, marginTop: 4,
            background: 'var(--bg-1, #11151c)', border: '1px solid var(--border, #2a3240)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.45)', overflow: 'hidden',
          }}
        >
          {opciones.length > 8 && (
            <input
              className="input"
              autoFocus
              placeholder="Buscar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0 }}
            />
          )}
          <div style={{ maxHeight: alto, overflowY: 'auto', padding: '.25rem' }}>
            <label style={filaStyle(false)} title="Quitar el filtro: se muestran todas">
              <input type="checkbox" checked={seleccionadas.length === 0} onChange={() => { onChange([]); setQ(''); }} />
              <span style={{ fontSize: '.85rem', fontStyle: 'italic' }}>{todasLabel}</span>
            </label>
            {filtradas.length === 0 && (
              <div className="muted" style={{ padding: '.5rem .6rem', fontSize: '.85rem' }}>Sin resultados</div>
            )}
            {filtradas.map((o) => {
              const checked = sel.has(o);
              return (
                <label key={o} style={filaStyle(checked)} role="option" aria-selected={checked}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(o)} />
                  <span style={{ fontSize: '.85rem' }}>{o}</span>
                </label>
              );
            })}
          </div>
          <div className="muted" style={{ padding: '.3rem .6rem', borderTop: '1px solid var(--border)', fontSize: '.75rem', display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
            <span>{seleccionadas.length ? `${seleccionadas.length} marcada(s)` : 'Sin filtro'}</span>
            <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .4rem', fontSize: '.75rem' }} onClick={() => { setOpen(false); setQ(''); }}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}

function filaStyle(checked: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.35rem .6rem', borderRadius: 6, cursor: 'pointer',
    borderLeft: `3px solid ${checked ? 'var(--primary, #ff8a00)' : 'transparent'}`,
    background: checked ? 'rgba(255,138,0,.12)' : 'transparent',
    color: checked ? 'var(--primary-3, #ffd07a)' : 'var(--text)',
    fontWeight: checked ? 600 : 400,
  };
}

/** Lo que dice el control cerrado: «Todas…», la única marcada, o «PRIMERA +N». */
export function resumenSeleccion(seleccionadas: string[], todasLabel: string): string {
  if (!seleccionadas.length) return todasLabel;
  if (seleccionadas.length === 1) return seleccionadas[0];
  return `${seleccionadas[0]} +${seleccionadas.length - 1}`;
}
