import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from '@/shared/ui/Toast';
import { norm } from '@/shared/lib/texto';

interface Props {
  /** Todas las opciones disponibles del catálogo. */
  options: string[];
  /** Valores seleccionados. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Crear una opción nueva en el catálogo. Devuelve el nombre creado (o el existente). */
  onCreate?: (name: string) => Promise<string | null>;
  placeholder?: string;
  /** Texto de ayuda bajo el control. */
  hint?: string;
}

/**
 * Selector múltiple con BÚSQUEDA y chips. La lista está COLAPSADA y se despliega
 * como overlay al hacer foco/clic (igual que el buscador de productos en OP); se
 * cierra al hacer clic afuera o con Escape. Permite crear opciones nuevas validando
 * que no se repitan (sin distinguir mayúsculas/minúsculas). Estilos del sistema.
 */
export function SearchMultiSelect({ options, selected, onChange, onCreate, placeholder, hint }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [creando, setCreando] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const yaSeleccion = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);

  // Opciones que coinciden con la búsqueda y aún no están seleccionadas.
  const sugeridas = useMemo(() => {
    const t = norm(q);
    return options
      .filter((o) => !yaSeleccion.has(o.toLowerCase()))
      .filter((o) => !t || norm(o).includes(t))
      .sort((a, b) => a.localeCompare(b, 'es-VE'));
  }, [options, q, yaSeleccion]);

  // ¿El texto tipeado coincide EXACTO (case-insensitive) con alguna opción existente?
  const coincideExacta = useMemo(() => {
    const t = norm(q);
    return !!t && options.some((o) => norm(o) === t);
  }, [options, q]);

  const puedeCrear = !!onCreate && !!q.trim() && !coincideExacta;
  // Filas navegables del desplegable: sugeridas + (opcional) «crear».
  type Fila = { kind: 'opt'; value: string } | { kind: 'create'; value: string };
  const filas = useMemo<Fila[]>(() => {
    const f: Fila[] = sugeridas.map((o) => ({ kind: 'opt', value: o }));
    if (puedeCrear) f.push({ kind: 'create', value: q.trim() });
    return f;
  }, [sugeridas, puedeCrear, q]);

  // Cerrar al hacer clic afuera.
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

  function agregar(valor: string) {
    const v = valor.trim();
    if (!v) return;
    if (yaSeleccion.has(v.toLowerCase())) { toast(`"${v}" ya está seleccionada`, 'warning'); return; }
    onChange([...selected, v]);
    setQ('');
    setHi(0);
  }

  function quitar(valor: string) {
    onChange(selected.filter((s) => s !== valor));
  }

  async function crear() {
    const v = q.trim();
    if (!v || !onCreate) return;
    const existente = options.find((o) => o.toLowerCase() === v.toLowerCase());
    if (existente) { agregar(existente); return; }
    setCreando(true);
    try {
      const creado = await onCreate(v);
      if (creado) agregar(creado);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear', 'error');
    } finally {
      setCreando(false);
    }
  }

  function elegirFila(f: Fila) {
    if (f.kind === 'opt') agregar(f.value);
    else void crear();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, filas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filas[hi]) elegirFila(filas[hi]);
    } else if (e.key === 'Escape') {
      setOpen(false); setQ('');
    } else if (e.key === 'Backspace' && !q && selected.length) {
      // Backspace con el campo vacío quita el último chip.
      quitar(selected[selected.length - 1]);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Chips seleccionados */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.5rem' }}>
          {selected.map((s) => (
            <span key={s} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              {s}
              <button
                type="button"
                onClick={() => quitar(s)}
                title="Quitar"
                style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '.95rem' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input (colapsado): abre el desplegable al foco/clic */}
      <input
        className="input"
        autoComplete="off"
        value={q}
        placeholder={placeholder ?? '🔍 Buscar o crear…'}
        onFocus={() => { setOpen(true); setHi(0); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={onKeyDown}
      />

      {/* Overlay desplegable, solo cuando está abierto */}
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', zIndex: 60, top: '100%', left: 0, right: 0, marginTop: 2,
            maxHeight: 260, overflowY: 'auto',
            background: 'var(--bg-1, #11151c)', border: '1px solid var(--border, #2a3240)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          }}
        >
          {filas.length === 0 && (
            <div className="muted" style={{ padding: '.5rem .7rem', fontSize: '.85rem' }}>
              {q.trim() ? 'Ya está seleccionada.' : 'Todas las opciones ya están seleccionadas.'}
            </div>
          )}
          {filas.map((f, i) => (
            <div
              key={f.kind + ':' + f.value}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); elegirFila(f); }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: '.5rem .7rem', cursor: 'pointer', fontSize: '.9rem',
                background: i === hi ? 'var(--primary-soft, rgba(255,138,0,.15))' : 'transparent',
                color: f.kind === 'create' ? 'var(--primary-3, #ff8a00)' : 'var(--text, #e6e6e6)',
                fontWeight: f.kind === 'create' ? 600 : 400,
              }}
            >
              {f.kind === 'create' ? (creando ? 'Creando…' : `+ Crear "${f.value}"`) : f.value}
            </div>
          ))}
        </div>
      )}

      {hint && <div className="muted" style={{ fontSize: '.75rem', marginTop: '.4rem' }}>{hint}</div>}
    </div>
  );
}
