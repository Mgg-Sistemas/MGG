import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface SearchOption {
  value: string;
  label: string;
  /** Texto secundario a la derecha (código, cantidad…); también se busca. */
  hint?: string;
  /** Otras características por las que se puede encontrar la opción (no se muestran, salvo la que coincide). */
  keywords?: string[];
  /** Grupo al que pertenece (27/10/2026): si alguna opción lo trae, se pinta una cabecera antes de la
   *  primera opción de cada grupo, en el orden en que vienen las opciones. No se busca por él. */
  group?: string;
  /** Ícono de la cabecera del grupo («🚜»). */
  groupIcon?: string;
}

/**
 * Cabecera de grupo que va ANTES de la opción `i` de la lista visible, o null si no lleva:
 * solo cuando la opción trae `group` y es la primera de su grupo (la anterior es de otro).
 * Las opciones sin grupo no cortan la lista: no pintan cabecera.
 */
export function cabeceraDeGrupo(visibles: SearchOption[], i: number): { group: string; icon?: string } | null {
  const o = visibles[i];
  if (!o?.group) return null;
  if (i > 0 && visibles[i - 1].group === o.group) return null;
  return { group: o.group, icon: o.groupIcon };
}

/** Normaliza para buscar: minúsculas y SIN acentos (así "peramanal" encuentra "Peramanál").
 *  Se usa \p{Diacritic} (propiedad Unicode) en vez de un rango con caracteres
 *  combinantes literales, para que ningún paso del bundler/encoding lo altere. */
const normBusqueda = (s: string): string => {
  try {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  } catch {
    return (s ?? '').toLowerCase().trim();
  }
};

/**
 * Filtra por TODAS las características de la opción (etiqueta, texto secundario y keywords).
 * Cada palabra escrita tiene que aparecer en alguna de ellas. Devuelve, por opción, la
 * keyword que coincidió cuando la etiqueta y el texto secundario no alcanzan, para mostrarla.
 */
export function filtrarOpciones(options: SearchOption[], query: string): { opcion: SearchOption; por: string | null }[] {
  const palabras = normBusqueda(query).split(/\s+/).filter(Boolean);
  if (!palabras.length) return options.map((opcion) => ({ opcion, por: null }));
  const out: { opcion: SearchOption; por: string | null }[] = [];
  for (const o of options) {
    const base = normBusqueda(`${o.label} ${o.hint ?? ''}`);
    const kws = (o.keywords ?? []).map((k) => ({ k, n: normBusqueda(k) }));
    const todo = `${base} ${kws.map((x) => x.n).join(' ')}`;
    if (!palabras.every((p) => todo.includes(p))) continue;
    const faltan = palabras.filter((p) => !base.includes(p));
    const por = faltan.length ? kws.find((x) => faltan.every((p) => x.n.includes(p)))?.k ?? kws.find((x) => faltan.some((p) => x.n.includes(p)))?.k ?? null : null;
    out.push({ opcion: o, por });
  }
  return out;
}

/** Apariencia del panel (colores/borde/sombra). La POSICIÓN se calcula aparte
 *  porque el panel se monta en un portal (position: fixed) para que ningún
 *  contenedor con overflow (tablas, modales) lo recorte. */
const PANEL_LOOK: CSSProperties = {
  overflowY: 'auto',
  background: 'var(--surface-2, #182230)',
  border: '1.5px solid rgba(255, 138, 0, 0.45)',
  borderRadius: 12,
  boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 138, 0, 0.15)',
};
/** Cabecera de grupo del desplegable: pegada arriba mientras se baja por su grupo. */
const GRUPO_STYLE: CSSProperties = {
  position: 'sticky', top: 0, zIndex: 2,
  padding: '.45rem .85rem', fontSize: '.75rem', fontWeight: 800, letterSpacing: '.06em',
  textTransform: 'uppercase', color: '#FF8A00',
  background: '#0f172a', borderBottom: '1px solid rgba(255, 138, 0, 0.25)',
};
const optStyle = (activo: boolean, sel: boolean): CSSProperties => ({
  minHeight: 46,
  display: 'flex',
  alignItems: 'center',
  padding: '.65rem .9rem',
  cursor: 'pointer',
  fontSize: '.98rem',
  background: activo ? 'rgba(255, 138, 0, 0.16)' : sel ? 'rgba(255, 138, 0, 0.08)' : 'transparent',
  color: sel ? 'var(--primary-2, #ffa733)' : 'var(--text, #f8fafc)',
  fontWeight: sel ? 700 : 500,
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  transition: 'background 0.15s ease',
});

/** Máximo de opciones que se PINTAN a la vez (se filtra sobre TODO el catálogo, pero
 *  solo se renderiza este tope para que el tecleo no se trabe con listas grandes). */
const MAX_OPCIONES = 80;

interface AnchorPos { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/** Calcula la posición fija del panel anclada al input, con flip hacia arriba si
 *  no hay espacio abajo. Se recalcula al hacer scroll (en cualquier contenedor) o
 *  al redimensionar, mientras el panel está abierto. */
function useAnchoredPos(anchorRef: RefObject<HTMLElement>, open: boolean): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const isMobile = window.innerWidth <= 640;
      const flip = spaceBelow < (isMobile ? 180 : 200) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(140, Math.min(isMobile ? 320 : 260, (flip ? spaceAbove : spaceBelow) - 12));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8));
      const width = Math.min(r.width, window.innerWidth - 16);
      setPos(flip
        ? { left, width, bottom: window.innerHeight - r.top + 2, maxHeight }
        : { left, width, top: r.bottom + 2, maxHeight });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [open, anchorRef]);
  return pos;
}

/** Panel desplegable montado en un portal (body) con posición fija anclada al input. */
function DropdownPortal({ anchorRef, panelRef, open, onClose, children }: {
  anchorRef: RefObject<HTMLElement>; panelRef: RefObject<HTMLDivElement>; open: boolean; onClose?: () => void; children: ReactNode;
}) {
  const pos = useAnchoredPos(anchorRef, open);
  if (!open || !pos) return null;
  const style: CSSProperties = {
    ...PANEL_LOOK, position: 'fixed', zIndex: 9500,
    left: pos.left, width: pos.width, maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box', maxHeight: pos.maxHeight,
    ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
  };
  return createPortal(
    <>
      <div
        role="presentation"
        style={{ position: 'fixed', inset: 0, zIndex: 9499, background: 'transparent' }}
        onMouseDown={onClose}
        onTouchStart={onClose}
      />
      <div ref={panelRef} role="listbox" style={style}>
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * Combobox con buscador: input que filtra una lista desplegable y selecciona al
 * hacer clic / Enter. Reemplaza a un <select> cuando hay muchas opciones
 * (productos, proveedores…). El valor seleccionado se controla por `value`.
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
  createLabel,
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
  sinPreseleccion?: boolean;
  /** Si true, permite escribir un valor que no está en la lista y crearlo (combobox creable). */
  allowCreate?: boolean;
  /** Cómo se lee la opción de crear (ej. «➕ Registrar vehículo externo»). */
  createLabel?: (query: string) => string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const coincidencias = useMemo(() => filtrarOpciones(options, query), [options, query]);
  const filtered = useMemo(() => coincidencias.map((c) => c.opcion), [coincidencias]);
  // Solo se pintan las primeras MAX_OPCIONES (rendimiento con catálogos grandes).
  const visiblesCo = coincidencias.length > MAX_OPCIONES ? coincidencias.slice(0, MAX_OPCIONES) : coincidencias;
  const visibles = visiblesCo.map((c) => c.opcion);

  // Opción de «crear» (combobox creable): aparece si lo escrito no calza exacto con una opción.
  const queryTrim = query.trim();
  const showCreate = allowCreate && queryTrim !== '' && !options.some((o) => o.label.toLowerCase() === queryTrim.toLowerCase());

  // Cerrar al hacer clic afuera (y limpiar el texto tecleado). El panel vive en un
  // portal, así que un clic dentro de él NO se considera «afuera».
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
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
      setHi((h) => Math.min(h + 1, visibles.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && visibles[hi]) {
        e.preventDefault();
        pick(visibles[hi].value);
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
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', ...style }}>
      <input
        ref={inputRef}
        id={id}
        className="input"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : (selected?.label ?? (allowCreate ? value : ''))}
        placeholder={selected ? selected.label : ((allowCreate && value) || placeholder)}
        onFocus={() => { if (disabled) return; setOpen(true); setQuery(''); setHi(sinPreseleccion ? -1 : 0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={onKeyDown}
      />
      <DropdownPortal anchorRef={inputRef} panelRef={panelRef} open={open && !disabled} onClose={() => setOpen(false)}>
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
            {createLabel ? createLabel(queryTrim) : `➕ Usar «${queryTrim}»`}
          </div>
        )}
        {visiblesCo.map(({ opcion: o, por }, i) => {
          const cab = cabeceraDeGrupo(visibles, i);
          return (
            <div key={o.value}>
              {cab && (
                <div role="presentation" style={GRUPO_STYLE}>
                  {cab.icon ? `${cab.icon} ` : ''}{cab.group}
                </div>
              )}
              <div
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
                onMouseEnter={() => setHi(i)}
                style={optStyle(i === hi, o.value === value)}
              >
                {o.hint || por ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{o.label}</div>
                      {por && <div className="muted" style={{ fontSize: '.72rem', fontWeight: 400 }}>contiene: {por}</div>}
                    </div>
                    {/* El hint puede ser un nombre largo (teléfono: nombre oficial del equipo): se acota con «…» para no desbordar. */}
                    {o.hint && <span className="muted mono" title={o.hint} style={{ fontSize: '.72rem', fontWeight: 400, whiteSpace: 'nowrap', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.hint}</span>}
                  </div>
                ) : o.label}
              </div>
            </div>
          );
        })}
        {filtered.length > visibles.length && (
          <div className="muted" style={{ padding: '.4rem .7rem', fontSize: '.78rem', borderTop: '1px solid var(--border, #2a3240)' }}>
            …y {filtered.length - visibles.length} más · sigue escribiendo para afinar
          </div>
        )}
      </DropdownPortal>
    </div>
  );
}

/**
 * Combobox con buscador que ADEMÁS permite escribir un valor nuevo (creatable).
 * Para campos tipo «lugar de extracción / supervisor» donde el texto se guarda
 * en un catálogo si no existía. El `value` es texto libre (no un id).
 */
export function SearchCreateSelect({
  options,
  value,
  onChange,
  placeholder = 'Escribe o elige…',
  emptyText = 'Sin coincidencias',
  style,
  id,
  disabled = false,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  style?: CSSProperties;
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const norm = (s: string) => normBusqueda(s);

  // Texto LOCAL del input: manda mientras el campo está enfocado. Antes el input estaba
  // controlado 100% por `value` (estado del padre): cada tecla iba al padre y volvía, y si
  // el padre re-renderizaba pesado el estado quedaba 1-2 letras atrás. El input mostraba lo
  // tecleado (buffer del navegador) pero la opción «Usar «…» (nuevo)» — dibujada desde ese
  // estado atrasado — salía CORTADA ("MANTENIMIENTO DE " en vez de "…MOLINO"). Con estado
  // local, input y opción salen SIEMPRE del mismo texto y nunca se desfasan.
  const [text, setText] = useState(value);
  // Resincroniza con el valor externo SOLO cuando el desplegable está CERRADO (cambio
  // programático: precarga al editar, transformación del padre como mayúsculas, reset…).
  // Mientras está abierto (el usuario tecleando/eligiendo), el estado LOCAL es la única
  // fuente de verdad — así un re-render pesado del padre nunca pisa lo tecleado ni lo
  // borra (antes se usaba un `focusedRef` que podía quedar desincronizado y dejar la
  // búsqueda sin filtrar). El filtrado siempre corre sobre este `text`.
  useEffect(() => { if (!open) setText(value); }, [value, open]);

  const filtered = useMemo(() => {
    const q = norm(text);
    if (!q) return options;
    return options.filter((o) => norm(o).includes(q));
  }, [options, text]);
  const exact = options.some((o) => norm(o) === norm(text));
  const showCreate = text.trim() !== '' && !exact;
  // Lista navegable con teclado: primero la opción «crear» (si aplica), luego las coincidencias.
  const items = useMemo(
    () => [...(showCreate ? [{ create: true, val: text }] : []), ...filtered.map((o) => ({ create: false, val: o }))],
    [showCreate, text, filtered],
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(v: string) { setText(v); onChange(v); setOpen(false); }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && items[hi]) { e.preventDefault(); pick(items[hi].val); } }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', ...style }}>
      <input
        ref={inputRef}
        id={id}
        className="input"
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onFocus={() => { if (!disabled) { setOpen(true); setHi(-1); } }}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value); setOpen(true); setHi(-1); }}
        onKeyDown={onKeyDown}
      />
      <DropdownPortal anchorRef={inputRef} panelRef={panelRef} open={open && !disabled && (items.length > 0 || !text)}>
        {items.length === 0 && <div className="muted" style={{ padding: '.5rem .7rem', fontSize: '.85rem' }}>{emptyText}</div>}
        {items.map((it, i) => (
          <div
            key={(it.create ? '__new__' : '') + it.val}
            role="option"
            aria-selected={!it.create && norm(it.val) === norm(text)}
            onMouseDown={(e) => { e.preventDefault(); pick(it.val); }}
            onMouseEnter={() => setHi(i)}
            style={optStyle(i === hi, !it.create && norm(it.val) === norm(text))}
          >
            {it.create ? <span><span style={{ color: 'var(--primary-3, #ff8a00)' }}>➕ Usar</span> «{it.val}» <span className="muted">(nuevo)</span></span> : it.val}
          </div>
        ))}
      </DropdownPortal>
    </div>
  );
}
