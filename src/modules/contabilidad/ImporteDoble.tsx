/* ============================================================
   MGG · Contabilidad · Un importe, dos monedas

   Regla de diseño de todo el módulo (usuario, 20/10 13:58 y 14:00):
   una sola columna por importe (Debe, Haber, Saldo…), nunca «Debe Bs» y
   «Debe $» lado a lado. La cifra principal va en la moneda que elige el
   usuario con el selector Bs / $ de la vista; la equivalente va debajo,
   pequeña y tenue. En PDF y Excel sale solo la moneda elegida.

   La elección se recuerda en el navegador y es la misma en todas las
   vistas del módulo (lista, rejilla, libros y estados): si se cambia en
   una, las demás abren con ella.
   ============================================================ */

import { useEffect, useState } from 'react';
import { formatoSaldo, type MonedaInforme } from './logica/reportes';

const CLAVE = 'mgg.contabilidad.moneda';
const EVENTO = 'mgg:contabilidad-moneda';

function leerMoneda(): MonedaInforme {
  try {
    return localStorage.getItem(CLAVE) === 'USD' ? 'USD' : 'VES';
  } catch {
    return 'VES';
  }
}

/** La moneda principal de las vistas, compartida y recordada. */
export function useMonedaVista(): [MonedaInforme, (m: MonedaInforme) => void] {
  const [moneda, setMoneda] = useState<MonedaInforme>(leerMoneda);
  useEffect(() => {
    const alCambiar = () => setMoneda(leerMoneda());
    window.addEventListener(EVENTO, alCambiar);
    return () => window.removeEventListener(EVENTO, alCambiar);
  }, []);
  const cambiar = (m: MonedaInforme) => {
    try { localStorage.setItem(CLAVE, m); } catch { /* sin almacenamiento: vale solo para esta vista */ }
    setMoneda(m);
    window.dispatchEvent(new Event(EVENTO));
  };
  return [moneda, cambiar];
}

export function SelectorMoneda({ valor, onCambio }: { valor: MonedaInforme; onCambio: (m: MonedaInforme) => void }) {
  return (
    <label className="cont-param"><span className="dim">Moneda</span>
      <select className="select" value={valor} onChange={(e) => onCambio(e.target.value as MonedaInforme)}>
        <option value="VES">Bolívares (Bs)</option>
        <option value="USD">Dólares ($)</option>
      </select>
    </label>
  );
}

const cifra = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const simbolo = (m: MonedaInforme) => (m === 'VES' ? 'Bs' : '$');
const otra = (m: MonedaInforme): MonedaInforme => (m === 'VES' ? 'USD' : 'VES');

/** El par (principal, equivalente) a partir de los montos en Bs y en $. */
export const par = (moneda: MonedaInforme, ves: number, usd: number) =>
  moneda === 'VES' ? { valor: ves, eq: usd } : { valor: usd, eq: ves };

interface PropsImporte {
  /** En la moneda principal. */
  valor: number;
  /** En la otra moneda; sin él solo sale la principal. */
  eq?: number;
  moneda: MonedaInforme;
  /** Saldo: los acreedores entre paréntesis, como Galac. */
  saldo?: boolean;
  /** Celda vacía si los dos son cero (Debe/Haber de un asiento). */
  vacioSiCero?: boolean;
  /** Con el símbolo en la principal (la lista de comprobantes no lleva encabezado «Expresado en…»). */
  conSimbolo?: boolean;
}

/**
 * La principal sin símbolo cuando el informe ya dice «Expresado en…»;
 * la equivalente siempre con el suyo, para que no se confunda.
 */
export function ImporteDoble({ valor, eq, moneda, saldo, vacioSiCero, conSimbolo }: PropsImporte) {
  if (vacioSiCero && !valor && !eq) return null;
  const formato = (v: number) => (saldo ? formatoSaldo(v, cifra) : cifra(v));
  const principal = formato(valor);
  return (
    <>
      <span className="mono">{conSimbolo ? `${simbolo(moneda)} ${principal}` : principal}</span>
      {eq !== undefined && <span className="cont-equiv mono">{simbolo(otra(moneda))} {formato(eq)}</span>}
    </>
  );
}

/** El recuadro de la moneda en la esquina de la cabecera (Galac F1 p.77), ahora para elegirla. */
export function RecuadroMoneda() {
  const [moneda, setMoneda] = useMonedaVista();
  return (
    <select className="cont-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as MonedaInforme)} aria-label="Moneda principal">
      <option value="VES">Bolívar (Bs)</option>
      <option value="USD">Dólar ($)</option>
    </select>
  );
}
