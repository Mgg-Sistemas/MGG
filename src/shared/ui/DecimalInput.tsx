/* ============================================================
   MGG · Input decimal es-VE: acepta coma O punto como separador decimal.
   Mantiene un buffer de texto propio para que se pueda tipear "0," sin que
   el valor controlado lo reformatee a mitad de camino. Emite number|null.
   Para leyes/%/tasas chicas (NO para pesos en Kg con separador de miles).
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Parser de decimales: el ÚLTIMO separador (coma o punto) es el decimal; los
 * demás puntos/comas se ignoran. `0.48` y `0,48` valen ambos 0,48.
 */
export function parseDecimal(s: string): number | null {
  const raw = String(s ?? '').trim().replace(/\s/g, '');
  if (raw === '') return null;
  const sep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
  const t = sep >= 0
    ? raw.slice(0, sep).replace(/[.,]/g, '') + '.' + raw.slice(sep + 1).replace(/[.,]/g, '')
    : raw;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** number → texto es-VE (coma como decimal) para mostrar en el input. */
function toText(v: number | null | undefined): string {
  return v == null || !Number.isFinite(Number(v)) ? '' : String(v).replace('.', ',');
}

export interface DecimalInputProps {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
}

export function DecimalInput({ value, onChange, className, style, placeholder, disabled, title, ...rest }: DecimalInputProps) {
  const [text, setText] = useState<string>(() => toText(value));
  const editing = useRef(false);

  // Sincroniza desde el valor externo SOLO cuando el usuario no está tipeando,
  // para no pisar "0," mientras escribe. Compara por valor parseado.
  useEffect(() => {
    if (!editing.current && parseDecimal(text) !== (value ?? null)) setText(toText(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      className={className}
      style={style}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      value={text}
      onFocus={() => { editing.current = true; }}
      onBlur={() => { editing.current = false; setText(toText(value)); }}
      onChange={(e) => {
        // Permite dígitos, coma/punto y signo negativo mientras tipea.
        const raw = e.target.value.replace(/[^\d.,-]/g, '');
        setText(raw);
        onChange(parseDecimal(raw));
      }}
    />
  );
}
