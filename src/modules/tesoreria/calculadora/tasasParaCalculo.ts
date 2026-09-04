/* ============================================================
   MGG · Tesorería · las tasas que alimentan la calculadora

   El motor (`@/shared/lib/calculo`) no sabe de dónde salen las tasas: recibe dos
   mapas y opera. Acá se arman esos mapas con lo que MGG ya tiene —`getTasaHoy()`
   para BCV y `getTasasMercado()` para el paralelo— sin agregar ninguna fuente.

   DOS REGLAS QUE IMPORTAN:

   1. SOLO ENTRA LO QUE TIENE TASA. Una moneda sin tasa no da un número, da un
      error; ofrecerla enseña al usuario a chocarse. Si Binance no respondió, la
      calculadora simplemente no entiende «usdt» ese rato, y lo dice.

   2. ESTO INFORMA, NO VALORA. Ninguna de estas tasas se guarda en un documento
      ni decide cuánto vale una compra: la calculadora es una herramienta de
      escritorio. Lo que valora sigue siendo el camino de siempre.

   Todo bolívar. No hay tabla de pares: euros → bolívares → USDT, con una
   conversión intermedia y sin inventar cruces que nadie anotó.
   ============================================================ */

/** Lo que hace falta saber para armar los mapas. Todo en Bs por 1 unidad. */
export interface FuentesTasa {
  /** Bs por 1 USD (BCV). De `getTasaHoy().usd`. */
  bcvUsd: number | null;
  /** Bs por 1 EUR (BCV). De `getTasaHoy().eur`. */
  bcvEur: number | null;
  /** Bs por 1 USDT (Binance P2P). De `getTasasMercado().usdtVes`. */
  usdtVes: number | null;
  /** COP por 1 USD. De `getTasasMercado().copUsd` — ojo, NO es Bs por COP. */
  copPorUsd: number | null;
}

export interface MapasCalculo {
  /** Cómo se puede escribir cada moneda → su código. */
  alias: Map<string, string>;
  /** Código → cuántos bolívares vale una unidad. */
  enBolivares: Map<string, number>;
  /** Las que quedaron fuera por no tener tasa, para poder explicarlo. */
  sinTasa: string[];
}

/** Formas de escribir cada moneda. El motor normaliza a mayúsculas antes de buscar. */
const ESCRITURAS: Record<string, string[]> = {
  VES: ['BS', 'VES', 'BSS', 'BOLIVAR', 'BOLIVARES', 'BOLÍVAR', 'BOLÍVARES'],
  USD: ['$', 'USD', 'DOLAR', 'DOLARES', 'DÓLAR', 'DÓLARES', 'DOLLARS'],
  EUR: ['€', 'EUR', 'EURO', 'EUROS'],
  USDT: ['USDT', 'TETHER'],
  COP: ['COP', 'PESO', 'PESOS', 'PESOCOL'],
};

const SIMBOLOS: Record<string, string> = { VES: 'Bs', USD: '$', EUR: '€', USDT: 'USDT', COP: 'COP' };

/** Símbolo con el que se escribe un monto de esa moneda. */
export function simboloDeCalculo(codigo: string): string {
  return SIMBOLOS[codigo] ?? codigo;
}

/** Nombre largo, para los mensajes de error del motor. */
export function nombreDeCalculo(codigo: string): string {
  return ({ VES: 'bolívares', USD: 'dólares', EUR: 'euros', USDT: 'USDT', COP: 'pesos colombianos' })[codigo] ?? codigo;
}

/**
 * Arma los mapas que consume `calcular()`.
 *
 * El bolívar siempre vale 1: es la unidad de referencia y no depende de ninguna
 * fuente, así que la calculadora nunca se queda sin al menos una moneda.
 */
export function mapasDeCalculo(f: FuentesTasa): MapasCalculo {
  const enBolivares = new Map<string, number>([['VES', 1]]);

  const poner = (codigo: string, bs: number | null | undefined) => {
    if (bs != null && Number.isFinite(bs) && bs > 0) enBolivares.set(codigo, bs);
  };

  poner('USD', f.bcvUsd);
  poner('EUR', f.bcvEur);
  poner('USDT', f.usdtVes);

  // `copUsd` viene como COP por 1 USD, no como Bs por COP. Para pasarlo a
  // bolívares hace falta el BCV: Bs/COP = (Bs/USD) ÷ (COP/USD). Sin el BCV no
  // hay forma de anclarlo, así que el peso queda fuera en vez de aproximarse.
  if (f.copPorUsd != null && f.copPorUsd > 0 && f.bcvUsd != null && f.bcvUsd > 0) {
    poner('COP', f.bcvUsd / f.copPorUsd);
  }

  const alias = new Map<string, string>();
  const sinTasa: string[] = [];
  for (const [codigo, formas] of Object.entries(ESCRITURAS)) {
    if (!enBolivares.has(codigo)) { sinTasa.push(codigo); continue; }
    for (const forma of formas) alias.set(forma, codigo);
  }

  return { alias, enBolivares, sinTasa };
}
