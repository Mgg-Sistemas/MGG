/* ============================================================
   MGG · Despiece de la res en canal

   Una RES EN CANAL no se usa: se despieza. Lo que entra al inventario no es
   «262,5 kg de res», son los CORTES —mechada, molida, bistec, los que hagan
   falta— más una MERMA que no entra a ningún lado pero tiene que quedar
   escrita, porque es la diferencia entre lo que se pagó y lo que se puede
   cocinar.

   EL COSTO. Se pagó por la res ENTERA, merma incluida. Así que el costo total
   se reparte entre los kg ÚTILES, no entre los kg comprados: si de 262,5 kg
   pagados a $5,30 quedan 240 kg de cortes, esos 240 kg valen $5,80 cada uno.
   Repartirlo a $5,30 dejaría $119,25 sin dueño, plata pagada que el inventario
   no registra en ninguna parte.

   El último corte absorbe el redondeo para que los subtotales sumen EXACTO lo
   que dice la factura.
   ============================================================ */

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Tolerancia en kg: absorbe el redondeo de la balanza, no un error de carga. */
export const TOLERANCIA_KG = 0.01;

/** Los cortes que siempre se ofrecen. Se pueden agregar otros al despiezar. */
export const CORTES_SUGERIDOS = ['CARNE MECHADA', 'CARNE MOLIDA', 'CARNE PARA BISTEC'] as const;

/**
 * ¿Este ítem se recibe despiezado?
 * Se reconoce por el NOMBRE y no por el SKU porque el SKU se renumera y ya hubo
 * dos fichas de RES EN CANAL con códigos distintos (CAR-001 y CAR-009).
 */
export function esDespiezable(nombre: string | null | undefined): boolean {
  return /\bres\s+en\s+canal\b/i.test(String(nombre ?? '').trim());
}

/** El nombre de un corte, como se guarda: sin espacios de más y en mayúscula. */
export function normalizarCorte(nombre: string | null | undefined): string {
  return String(nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export interface CorteDespiece {
  nombre: string;
  kg: number;
  /** Ficha existente, si la hay. Si viene vacío se crea una con ese nombre. */
  productoId?: string | null;
}

export interface CorteCalculado extends CorteDespiece {
  nombre: string;
  kg: number;
  /** $/kg con el que entra al inventario (ya lleva el peso de la merma). */
  costoUnitario: number;
  /** kg × costoUnitario. El último corte absorbe el redondeo. */
  subtotal: number;
  /** Qué tajada de la res es este corte, en % de los kg que llegaron. */
  pct: number;
}

export interface DespieceInput {
  /** Kg de res que llegaron. */
  kgRecibidos: number;
  /** Lo que se pagó por esos kg (sin IVA ni otros conceptos). */
  costoTotal: number;
  cortes: CorteDespiece[];
  mermaKg: number;
}

export interface DespieceCalculado {
  /** Kg que sí entran al inventario (Σ cortes). */
  kgUtiles: number;
  /** Σ cortes + merma. Tiene que dar los kg recibidos. */
  kgRepartidos: number;
  /** kgRecibidos − kgRepartidos. Positivo = falta repartir. */
  diferenciaKg: number;
  /** costoTotal ÷ kgUtiles. */
  costoPorKg: number;
  cortes: CorteCalculado[];
  mermaKg: number;
  /** Lo que la merma le carga encima a los cortes. */
  costoMerma: number;
  /** % de la res que SÍ se puede cocinar. */
  pctUtiles: number;
  /** % que se fue en merma. Con los cortes cuadrados, pctUtiles + pctMerma = 100. */
  pctMerma: number;
  /** Σ subtotales. Siempre igual a costoTotal cuando hay cortes. */
  totalCortes: number;
  /** true si se puede confirmar la recepción. */
  cuadra: boolean;
  /** Qué falta o qué está mal, en palabras. */
  problemas: string[];
}

/**
 * Reparte el costo de la res entre sus cortes.
 *
 * No valida por validar: devuelve los problemas para que la pantalla los
 * muestre y el botón de confirmar decida. Lo que sí garantiza es que, si
 * `cuadra`, la suma de los subtotales es EXACTAMENTE el costo total.
 */
export function calcularDespiece(input: DespieceInput): DespieceCalculado {
  const kgRecibidos = round2(num(input.kgRecibidos));
  const costoTotal = round2(num(input.costoTotal));
  const mermaKg = round2(Math.max(0, num(input.mermaKg)));

  // Los cortes sin nombre o sin kg no cuentan: son filas que el usuario dejó
  // a medio llenar, no cortes de cero kilos.
  const limpios = input.cortes
    .map((c) => ({ ...c, nombre: normalizarCorte(c.nombre), kg: round2(num(c.kg)) }))
    .filter((c) => c.nombre !== '' && c.kg > 0);

  const kgUtiles = round2(limpios.reduce((a, c) => a + c.kg, 0));
  const kgRepartidos = round2(kgUtiles + mermaKg);
  const diferenciaKg = round2(kgRecibidos - kgRepartidos);
  const costoPorKg = kgUtiles > 0 ? round4(costoTotal / kgUtiles) : 0;

  /* El % se mide sobre los kg que LLEGARON, no sobre los útiles: así cortes y
     merma suman 100 y se lee de un vistazo cuánto de la res se aprovechó. */
  const pctDe = (kg: number) => (kgRecibidos > 0 ? round2((kg / kgRecibidos) * 100) : 0);
  // El último corte absorbe el redondeo: así los subtotales suman el costo
  // exacto de la factura y no aparece un centavo perdido.
  const cortes: CorteCalculado[] = limpios.map((c, i) => {
    const esUltimo = i === limpios.length - 1;
    const subtotal = esUltimo
      ? round2(costoTotal - limpios.slice(0, i).reduce((a, x) => a + round2(x.kg * costoPorKg), 0))
      : round2(c.kg * costoPorKg);
    return { ...c, costoUnitario: costoPorKg, subtotal, pct: pctDe(c.kg) };
  });
  const totalCortes = round2(cortes.reduce((a, c) => a + c.subtotal, 0));

  const problemas: string[] = [];
  if (!limpios.length) problemas.push('Cargá al menos un corte con su peso.');
  const repetidos = nombresRepetidos(limpios.map((c) => c.nombre));
  if (repetidos.length) problemas.push(`Hay cortes repetidos: ${repetidos.join(', ')}. Juntalos en una sola línea.`);
  if (kgRecibidos <= 0) problemas.push('Indicá cuántos kg de res llegaron.');
  else if (Math.abs(diferenciaKg) > TOLERANCIA_KG) {
    problemas.push(diferenciaKg > 0
      ? `Faltan ${diferenciaKg.toFixed(2)} kg por repartir: los cortes más la merma dan ${kgRepartidos.toFixed(2)} y llegaron ${kgRecibidos.toFixed(2)}.`
      : `Se repartieron ${Math.abs(diferenciaKg).toFixed(2)} kg de más: los cortes más la merma dan ${kgRepartidos.toFixed(2)} y solo llegaron ${kgRecibidos.toFixed(2)}.`);
  }

  return {
    kgUtiles, kgRepartidos, diferenciaKg, costoPorKg, cortes, mermaKg,
    costoMerma: round2(mermaKg * costoPorKg),
    pctUtiles: pctDe(kgUtiles),
    pctMerma: pctDe(mermaKg),
    totalCortes,
    cuadra: problemas.length === 0,
    problemas,
  };
}

/** Los nombres que aparecen más de una vez. */
function nombresRepetidos(nombres: string[]): string[] {
  const visto = new Set<string>();
  const dupe = new Set<string>();
  for (const n of nombres) { if (visto.has(n)) dupe.add(n); else visto.add(n); }
  return Array.from(dupe);
}

/* ───────────── Reparto de los cortes entre las cocinas ───────────── */

export interface LineaReparto {
  /** Nombre del corte, ya normalizado. */
  corte: string;
  cocinaId: string;
  kg: number;
}

export interface RepartoCalculado {
  /** Por cocina: qué corte y cuántos kg le tocan. */
  porCocina: Map<string, Array<{ corte: string; kg: number }>>;
  /** Por corte: cuántos kg quedan sin repartir (se quedan en el almacén que recibe). */
  quedaEnOrigen: Array<{ corte: string; kg: number }>;
  problemas: string[];
  cuadra: boolean;
}

/**
 * Reparte los cortes entre las cocinas.
 *
 * No se puede mandar más de lo que hay de cada corte. Lo que no se reparte NO
 * es un error: se queda en el almacén que recibe, que es lo normal cuando la
 * res es para esa misma cocina.
 */
export function calcularReparto(cortes: CorteCalculado[], reparto: LineaReparto[]): RepartoCalculado {
  const disponible = new Map<string, number>();
  for (const c of cortes) disponible.set(c.nombre, round2((disponible.get(c.nombre) ?? 0) + c.kg));

  const porCocina = new Map<string, Array<{ corte: string; kg: number }>>();
  const usado = new Map<string, number>();
  const problemas: string[] = [];

  for (const r of reparto) {
    const corte = normalizarCorte(r.corte);
    const kg = round2(num(r.kg));
    if (!corte || kg <= 0 || !r.cocinaId) continue;
    if (!disponible.has(corte)) { problemas.push(`«${corte}» no es uno de los cortes de esta res.`); continue; }
    usado.set(corte, round2((usado.get(corte) ?? 0) + kg));
    const lista = porCocina.get(r.cocinaId) ?? [];
    // Dos líneas del mismo corte a la misma cocina se juntan: es un solo envío.
    const ya = lista.find((x) => x.corte === corte);
    if (ya) ya.kg = round2(ya.kg + kg); else lista.push({ corte, kg });
    porCocina.set(r.cocinaId, lista);
  }

  for (const [corte, hay] of disponible) {
    const va = usado.get(corte) ?? 0;
    if (va - hay > TOLERANCIA_KG) {
      problemas.push(`De ${corte} se están repartiendo ${va.toFixed(2)} kg y solo hay ${hay.toFixed(2)}.`);
    }
  }

  const quedaEnOrigen = Array.from(disponible.entries())
    .map(([corte, hay]) => ({ corte, kg: round2(hay - (usado.get(corte) ?? 0)) }))
    .filter((x) => x.kg > TOLERANCIA_KG);

  return { porCocina, quedaEnOrigen, problemas, cuadra: problemas.length === 0 };
}
