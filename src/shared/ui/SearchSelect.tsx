import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SearchOption {
  value: string;
  label: string;
}

/**
 * Combobox con buscador: input que filtra una lista desplegable y selecciona al
 * hacer clic / Enter. Reemplaza a un <select> cuando hay muchas opciones
 * (productos, proveedores…). El valor seleccionado se controla por `value`.
 *
 * El desplegable se renderiza en un portal (position: fixed) para que nunca lo
 * recorte un contenedor con overflow (p. ej. una tabla dentro de .table-wrap).
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Buscar…',
  emptyText = 'Sin resultados',
  style,
  id,
  disabled = false,
  allowCreate = false,
  sinPreseleccion = false,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  style?: CSSProperties;
  id?: string;
  disabled?: boolean;
  /** Si true, permite escribir un valor que no está en la lista y crearlo (combobox creable). */
  allowCreate?: boolean;
  /**
   * Si true, al enfocar NO queda ninguna opción resaltada, así Enter no elige nada:
   * el evento burbujea y el formulario lo usa para pasar al campo siguiente.
   * Para elegir con el teclado hay que escribir (resalta la primera coincidencia)
   * o bajar con ↓. Sin esta prop el comportamiento es el de siempre.
   * Lo usan los modales de salidas, donde Enter recorre los campos.
   */
  sinPreseleccion?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Opción de "crear" (combobox creable): aparece si lo escrito no calza exacto con una opción.
  const queryTrim = query.trim();
  const exactExists = options.some((o) => o.label.toLowerCase() === queryTrim.toLowerCase());
  const showCreate = allowCreate && queryTrim !== '' && !exactExists;

  // Posiciona el desplegable bajo el input (coords de viewport, position: fixed).
  const updateRect = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateRect();
    const onScroll = () => updateRect();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Cerrar al hacer clic afuera (input + menú del portal) y limpiar el texto tecleado.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setQuery('');
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[hi]) {
        e.preventDefault();
        pick(filtered[hi].value);
      } else if (open && showCreate) {
        e.preventDefault();
        pick(queryTrim);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <input
        id={id}
        className="input"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : (selected?.label ?? value ?? '')}
        placeholder={selected ? selected.label : (value || placeholder)}
        onFocus={() => { if (disabled) return; setOpen(true); setQuery(''); setHi(sinPreseleccion ? -1 : 0); updateRect(); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && rect && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: 'fixed', zIndex: 9500, left: rect.left, top: rect.top, width: rect.width,
            maxHeight: 260, overflowY: 'auto',
            background: 'var(--bg-1, #11151c)', border: '1px solid var(--border, #2a3240)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          }}
        >
          {filtered.length === 0 && !showCreate && (
            <div className="muted" style={{ padding: '.5rem .7rem', fontSize: '.85rem' }}>{emptyText}</div>
          )}
          {showCreate && (
            <div
              role="option"
              onMouseDown={(e) => { e.preventDefault(); pick(queryTrim); }}
              style={{
                padding: '.45rem .7rem', cursor: 'pointer', fontSize: '.9rem',
                color: 'var(--primary-3, #ff8a00)', fontWeight: 600,
                borderBottom: filtered.length ? '1px solid var(--border, #2a3240)' : undefined,
              }}
            >
              ➕ Usar «{queryTrim}»
            </div>
          )}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: '.45rem .7rem', cursor: 'pointer', fontSize: '.9rem',
                background: i === hi ? 'var(--primary-soft, rgba(255,138,0,.15))' : 'transparent',
                color: o.value === value ? 'var(--primary-3, #ff8a00)' : 'var(--text, #e6e6e6)',
                fontWeight: o.value === value ? 600 : 400,
              }}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
