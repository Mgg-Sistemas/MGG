import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Selección múltiple buscable con lista DESPLEGABLE (como el buscador de OP):
 * cerrada muestra las opciones elegidas como chips; al hacer click se abre el
 * buscador con la lista. Cada fila se clickea para marcar/desmarcar. Tema oscuro.
 */
export function MultiSelectBuscador({
  opciones,
  seleccionadas,
  onToggle,
  placeholder = 'Seleccionar…',
  alto = 240,
}: {
  opciones: string[];
  seleccionadas: string[];
  onToggle: (valor: string, checked: boolean) => void;
  placeholder?: string;
  alto?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const sel = useMemo(() => new Set(seleccionadas), [seleccionadas]);

  // Cerrar al hacer click afuera.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return opciones
      .filter((o) => !t || o.toLowerCase().includes(t))
      .slice()
      .sort((a, b) => {
        const sa = sel.has(a) ? 0 : 1;
        const sb = sel.has(b) ? 0 : 1;
        if (sa !== sb) return sa - sb; // seleccionadas primero
        return a.localeCompare(b, 'es');
      });
  }, [opciones, q, sel]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Campo cerrado (trigger): chips de seleccionadas + flecha. */}
      <div
        className="input"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.3rem',
          cursor: 'pointer', minHeight: 42, paddingTop: '.3rem', paddingBottom: '.3rem',
        }}
      >
        {seleccionadas.length === 0 && (
          <span className="muted" style={{ fontSize: '.88rem' }}>{placeholder}</span>
        )}
        {seleccionadas.map((s) => (
          <span
            key={s}
            onClick={(e) => { e.stopPropagation(); onToggle(s, false); }}
            title="Quitar"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '.3rem',
              padding: '.12rem .45rem', borderRadius: 999, fontSize: '.78rem',
              background: 'rgba(255,138,0,.15)', border: '1px solid var(--primary, #ff8a00)',
              color: 'var(--primary-3, #ffd07a)',
            }}
          >
            {s} <span aria-hidden="true">✕</span>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', opacity: .6, fontSize: '.8rem' }}>{open ? '▴' : '▾'}</span>
      </div>

      {/* Lista desplegable. */}
      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 60, top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--bg-1, #11151c)', border: '1px solid var(--border, #2a3240)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.45)', overflow: 'hidden',
          }}
        >
          <input
            className="input"
            autoFocus
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0 }}
          />
          <div style={{ maxHeight: alto, overflowY: 'auto', padding: '.25rem' }}>
            {filtradas.length === 0 && (
              <div className="muted" style={{ padding: '.5rem .6rem', fontSize: '.85rem' }}>Sin resultados</div>
            )}
            {filtradas.map((o) => {
              const checked = sel.has(o);
              return (
                <div
                  key={o}
                  role="option"
                  aria-selected={checked}
                  onClick={() => onToggle(o, !checked)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem',
                    padding: '.45rem .6rem', borderRadius: 6, cursor: 'pointer',
                    borderLeft: `3px solid ${checked ? 'var(--primary, #ff8a00)' : 'transparent'}`,
                    background: checked ? 'rgba(255,138,0,.12)' : 'transparent',
                    color: checked ? 'var(--primary-3, #ffd07a)' : 'var(--text)',
                    fontWeight: checked ? 600 : 400,
                  }}
                  onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
                  onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: '.85rem' }}>{o}</span>
                  {checked && <span aria-hidden="true" style={{ fontSize: '.9rem' }}>✓</span>}
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ padding: '.3rem .6rem', borderTop: '1px solid var(--border)', fontSize: '.75rem' }}>
            {seleccionadas.length} seleccionada(s)
          </div>
        </div>
      )}
    </div>
  );
}
