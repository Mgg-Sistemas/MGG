/* Golden Touch · Retenciones · Un monto o % que se escribe a mano (D41, Lote 1).
   El texto es del campo (se pueden teclear «1.234,5» o «0,125» sin que se borre); el número se
   lee con leerMonto. Vacío o ilegible avisa con null: quien lo usa no guarda y dice qué campo. */
import { useEffect, useState } from 'react';
import { leerMonto, numeroATexto } from './validarCarga';
import { SeLeyo } from './SeLeyo';

export function CampoMonto({ valor, onValor, decimales = 2, placeholder }: {
  valor: number | null | undefined;
  /** El número leído; null = vacío o no se entiende. */
  onValor: (n: number | null) => void;
  decimales?: number;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(() => numeroATexto(valor));
  // Si el valor cambia desde afuera (recarga), el campo lo muestra.
  useEffect(() => {
    setTexto((t) => (t.trim() && leerMonto(t) === valor ? t : numeroATexto(valor)));
  }, [valor]);
  return (
    <>
      <input className="input mono" value={texto} inputMode="decimal" placeholder={placeholder}
        onChange={(e) => { const t = e.target.value; setTexto(t); onValor(t.trim() ? leerMonto(t) : null); }} />
      <SeLeyo texto={texto} decimales={decimales} />
    </>
  );
}
