import { useMemo, useState } from 'react';

/**
 * Lista buscable de selección múltiple (checkboxes con filtro). Reemplaza a una
 * grilla larga de checkboxes cuando hay muchas opciones. Las seleccionadas se
 * muestran primero. Mantiene los estilos del sistema (tema oscuro).
 */
export function MultiSelectBuscador({
  opciones,
  seleccionadas,
  onToggle,
  placeholder = 'Buscar…',
  alto = 220,
}: {
  opciones: string[];
  seleccionadas: string[];
  onToggle: (valor: string, checked: boolean) => void;
  placeholder?: string;
  alto?: number;
}) {
  const [q, setQ] = useState('');
  const sel = useMemo(() => new Set(seleccionadas), [seleccionadas]);

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
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-1)' }}>
      <input
        className="input"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ border: 'none', borderBottom: '1px solid var(--border)', borderRadius: '8px 8px 0 0' }}
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
  );
}
