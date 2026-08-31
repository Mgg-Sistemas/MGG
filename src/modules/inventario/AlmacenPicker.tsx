import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { listAlmacenes, nombreCortoAlmacen } from './almacenes.repository';
import type { Almacen } from '@/shared/lib/types';

const SIN_SEDE = 'Sin sede';

/** Hook interno: carga la tabla de almacenes (o usa la lista provista). */
function useAlmacenes(provided?: Almacen[]): Almacen[] {
  const [rows, setRows] = useState<Almacen[]>(provided ?? []);
  useEffect(() => {
    if (provided) { setRows(provided); return; }
    let cancel = false;
    listAlmacenes().then((r) => { if (!cancel) setRows(r); }).catch(() => { /* RLS/red */ });
    return () => { cancel = true; };
  }, [provided]);
  return rows;
}

/**
 * Selector de almacén COMPACTO (un solo `<select>` con la jerarquía Sede → Almacén
 * como `optgroup`). Para celdas de tabla y filtros donde el picker de dos pasos no
 * entra. Opcionalmente agrega una opción "Todos" (filtros) y nombres legados.
 */
export function AlmacenSelectAgrupado({
  value, onChange, almacenes: provided, todosLabel, extraNombres, style, required, disabled, className, soloSedes,
}: {
  value: string;
  onChange: (nombre: string) => void;
  almacenes?: Almacen[];
  todosLabel?: string;
  extraNombres?: string[];
  style?: CSSProperties;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Si se pasa, limita las opciones a los almacenes de ESAS sedes (evita saltar a otra sede). */
  soloSedes?: string[];
}) {
  const rows = useAlmacenes(provided);
  const activos = useMemo(() => {
    const base = rows.filter((a) => a.estado === 'activo');
    // Un arreglo VACÍO también filtra (deja cero opciones): es «este usuario no puede
    // elegir ninguna sede acá», no «mostrale todas». Para no filtrar se pasa undefined.
    if (soloSedes) return base.filter((a) => soloSedes.includes(a.sede?.trim() || SIN_SEDE));
    return base;
  }, [rows, soloSedes]);
  const porSede = useMemo(() => {
    const m = new Map<string, Almacen[]>();
    activos.forEach((a) => {
      const s = a.sede?.trim() || SIN_SEDE;
      (m.get(s) ?? m.set(s, []).get(s)!).push(a);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [activos]);
  // Nombres legados (de productos) que no están en la tabla de almacenes.
  const enTabla = useMemo(() => new Set(activos.map((a) => a.nombre)), [activos]);
  const otros = (extraNombres ?? []).filter((n) => n && !enTabla.has(n));

  return (
    <select className={className ?? 'select'} value={value} onChange={(e) => onChange(e.target.value)} style={style} required={required} disabled={disabled}>
      {todosLabel != null ? <option value="">{todosLabel}</option> : <option value="">— elegí el almacén —</option>}
      {porSede.map(([sede, alms]) => (
        <optgroup key={sede} label={sede}>
          {alms.map((a) => <option key={a.id} value={a.nombre}>{nombreCortoAlmacen(a, rows)}</option>)}
        </optgroup>
      ))}
      {otros.length > 0 && (
        <optgroup label="Otros">
          {otros.map((n) => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/**
 * Selector de almacén en dos pasos: SEDE (principal) → ALMACÉN de esa sede.
 * Ej.: elegís "MATANZAS" y abajo aparecen sus almacenes. El valor que sale por
 * `onChange` es el NOMBRE del almacén (como lo guarda productos/existencias).
 *
 * Se carga la lista de almacenes solo (o se le pasa `almacenes` ya cargados). Si
 * `value` es un almacén legado que no está en la tabla, se acepta igual.
 */
export function AlmacenPicker({
  value, onChange, almacenes: provided, label = 'Almacén', sedeLabel = 'Sede', required, disabled, extraOpciones, preferirPrincipal, excluirCasiterita, soloSedes,
}: {
  value: string;
  onChange: (nombre: string) => void;
  almacenes?: Almacen[];
  label?: string;
  sedeLabel?: string;
  required?: boolean;
  disabled?: boolean;
  /** Opciones especiales que no son almacenes de la tabla (ej. "Consumo Interno"). */
  extraOpciones?: string[];
  /** Al elegir una sede, autoselecciona su almacén PRINCIPAL (general, sin padre)
   *  en vez de dejar el almacén vacío. El usuario puede cambiarlo a un subalmacén. */
  preferirPrincipal?: boolean;
  /** Oculta los almacenes de casiterita (los que llevan "casiterita" en el nombre).
   *  Se usa en la recepción de compras: la mercancía comprada va a Matanza / almacenes
   *  normales, NUNCA a casiterita (ese inventario entra por su propio flujo, Los Pinos). */
  excluirCasiterita?: boolean;
  /** Limita el selector a estas sedes (por usuario/correo). Solo se muestran esas
   *  sedes y sus almacenes; el usuario no puede recibir/elegir en otra sede. */
  soloSedes?: string[];
}) {
  const [rows, setRows] = useState<Almacen[]>(provided ?? []);
  useEffect(() => {
    if (provided) { setRows(provided); return; }
    let cancel = false;
    listAlmacenes().then((r) => { if (!cancel) setRows(r); }).catch(() => { /* RLS/red */ });
    return () => { cancel = true; };
  }, [provided]);

  const activos = useMemo(() => {
    let base = rows.filter((a) => a.estado === 'activo');
    if (excluirCasiterita) base = base.filter((a) => !/casiterita/i.test(a.nombre));
    // Ídem: el arreglo vacío deja cero opciones a propósito (ver AlmacenSelectAgrupado).
    if (soloSedes) base = base.filter((a) => soloSedes.includes(a.sede?.trim() || SIN_SEDE));
    return base;
  }, [rows, excluirCasiterita, soloSedes]);
  const extras = extraOpciones ?? [];

  const sedes = useMemo(() => {
    const set = new Set<string>();
    activos.forEach((a) => set.add(a.sede?.trim() || SIN_SEDE));
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    return extras.length ? [...extras.map((e) => `· ${e}`), ...arr] : arr;
  }, [activos, extras]);

  // Sede a la que pertenece el value actual (para precargar el primer paso).
  const sedeDeValue = useMemo(() => {
    if (extras.includes(value)) return `· ${value}`;
    const a = activos.find((x) => x.nombre === value);
    return a ? (a.sede?.trim() || SIN_SEDE) : '';
  }, [activos, value, extras]);
  const [sede, setSede] = useState(sedeDeValue);
  useEffect(() => { if (sedeDeValue && sedeDeValue !== sede) setSede(sedeDeValue); /* eslint-disable-next-line */ }, [sedeDeValue]);

  const esExtra = sede.startsWith('· ');
  const almsDeSede = useMemo(
    () => activos.filter((a) => (a.sede?.trim() || SIN_SEDE) === sede),
    [activos, sede],
  );

  function cambiarSede(s: string) {
    setSede(s);
    // Si la sede elegida es una opción especial (extra), el valor ES esa opción.
    if (s.startsWith('· ')) { onChange(s.slice(2)); return; }
    // "General por defecto": autoselecciona el almacén PRINCIPAL de la sede (sin padre).
    if (preferirPrincipal) {
      const alms = activos.filter((a) => (a.sede?.trim() || SIN_SEDE) === s);
      const principal = alms.find((a) => !a.parent_id);
      onChange(principal ? principal.nombre : '');
      return;
    }
    onChange('');
  }

  return (
    <div className="form-grid">
      <div className="form-row">
        <label>{sedeLabel}</label>
        <select className="select" value={sede} onChange={(e) => cambiarSede(e.target.value)} disabled={disabled} required={required}>
          <option value="">— elegí la sede —</option>
          {sedes.map((s) => <option key={s} value={s}>{s.startsWith('· ') ? s.slice(2) : s}</option>)}
        </select>
      </div>
      <div className="form-row">
        <label>{label}</label>
        <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || !sede || esExtra} required={required}>
          <option value="">{!sede ? '— elegí primero la sede —' : esExtra ? value : '— elegí el almacén —'}</option>
          {!esExtra && almsDeSede.map((a) => <option key={a.id} value={a.nombre}>{nombreCortoAlmacen(a, rows)}</option>)}
        </select>
      </div>
    </div>
  );
}
