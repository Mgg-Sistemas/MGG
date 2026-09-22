/* ============================================================
   MGG · Campo de fecha en formato venezolano

   Dos formas de cargar la misma fecha, porque las dos hacen falta:
   · ESCRIBIRLA a mano en dd/mm/aaaa — es lo más rápido para una fecha vieja.
     Poner la fecha de nacimiento de alguien de 1973 con el calendario son
     como cincuenta clics.
   · ELEGIRLA en el CALENDARIO con el botón 📅 — para fechas cercanas.

   Por qué no alcanza con el campo de fecha del navegador: lo muestra según el
   idioma con el que esté configurada la máquina. En una en inglés pide
   mm/dd/aaaa, y ahí «03/04» deja de ser el 3 de abril y pasa a ser el 4 de
   marzo sin que nadie lo note. Acá siempre se escribe dd/mm/aaaa.

   Hacia afuera el valor SIEMPRE es aaaa-mm-dd (lo que guarda la base).
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { errorFechaVe, isoAVe, mascaraFechaVe, veAIso } from '@/shared/lib/fechaVe';

export interface FechaVeProps {
  /** Valor en ISO (aaaa-mm-dd). Cadena vacía = sin fecha. */
  value: string;
  /** Devuelve ISO, o '' mientras la fecha está incompleta. */
  onChange: (iso: string) => void;
  /** ¿Se admite una fecha futura? Una fecha de nacimiento, no. */
  futuro?: boolean;
  minAnio?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Texto de ayuda debajo (la edad calculada, por ejemplo). */
  ayuda?: React.ReactNode;
}

export function FechaVe({
  value, onChange, futuro = true, minAnio = 1900,
  placeholder = 'dd/mm/aaaa', disabled, id, ayuda,
}: FechaVeProps) {
  // Lo que se ve mientras se escribe. No se deriva de `value` en cada tecla:
  // si lo hiciera, al escribir «3» el campo se vaciaría solo porque «3»
  // todavía no es una fecha válida.
  const [texto, setTexto] = useState(() => isoAVe(value));
  const [tocado, setTocado] = useState(false);
  const calendario = useRef<HTMLInputElement>(null);

  // Si el valor cambia desde afuera (se abre otra ficha), se reescribe.
  useEffect(() => {
    const desdeAfuera = isoAVe(value);
    setTexto((actual) => (veAIso(actual) === (value || null) ? actual : desdeAfuera));
  }, [value]);

  function escribir(v: string) {
    const conBarras = mascaraFechaVe(v);
    setTexto(conBarras);
    const iso = veAIso(conBarras);
    // Mientras está incompleta se avisa con '' en vez de dejar el valor viejo:
    // si no, borrar el campo no borraría la fecha guardada.
    onChange(iso ?? '');
  }

  function abrirCalendario() {
    const el = calendario.current;
    if (!el) return;
    // showPicker() es lo que abre el calendario sin que el campo esté visible.
    // No está en todos los navegadores: si no está, se hace foco y click.
    const conPicker = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof conPicker.showPicker === 'function') {
      try { conPicker.showPicker(); return; } catch { /* algunos lo niegan sin gesto del usuario */ }
    }
    el.focus();
    el.click();
  }

  const error = tocado ? errorFechaVe(texto, { futuro, minAnio }) : null;

  return (
    <>
      <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
        <input
          id={id}
          className="input mono"
          value={texto}
          onChange={(e) => escribir(e.target.value)}
          onBlur={() => setTocado(true)}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          disabled={disabled}
          aria-invalid={!!error}
          style={{ flex: 1, minWidth: 0, borderColor: error ? 'var(--danger)' : undefined }}
        />
        <button type="button" className="btn btn-sm btn-ghost" onClick={abrirCalendario}
          disabled={disabled} title="Elegir en el calendario" aria-label="Elegir en el calendario">📅</button>
        {/* El campo nativo existe solo para prestar su calendario. Queda fuera
            de la vista y fuera del recorrido con Tab, para no duplicar el campo. */}
        <input
          ref={calendario}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value || ''}
          onChange={(e) => { const iso = e.target.value; setTexto(isoAVe(iso)); onChange(iso); }}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      </div>
      {error
        ? <small style={{ color: 'var(--danger)' }}>{error}</small>
        : ayuda
          ? <small className="muted">{ayuda}</small>
          : null}
    </>
  );
}
