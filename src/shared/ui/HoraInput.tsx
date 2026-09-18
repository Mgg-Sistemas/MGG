/* Selector de hora (HH:mm). Si el dato viejo era texto que no se reconoce como
   hora, se muestra debajo para no perderlo de vista al corregirlo. */
import type { CSSProperties } from 'react';
import { aHora24 } from '@/shared/lib/hora';

export function HoraInput({ value, onChange, disabled, style }: {
  value: string | null | undefined;
  onChange: (hhmm: string) => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const h24 = aHora24(value);
  const viejo = (value ?? '').trim();
  return (
    <>
      <input className="input" type="time" value={h24} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} style={{ minWidth: 110, ...style }} />
      {viejo && !h24 && <small className="muted" style={{ display: 'block', fontSize: '.7rem' }}>Antes: «{viejo}»</small>}
    </>
  );
}
