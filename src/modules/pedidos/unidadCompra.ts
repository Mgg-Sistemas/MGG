/* ============================================================
   MGG · Compras · Unidad de compra vs unidad de uso (05-10-2026)

   Se compra en una medida (BULTO, CAJA, CUÑETE…) y se usa en otra (KG,
   UNIDAD, GALÓN…). Regla de la administradora:

   · El INVENTARIO se lleva SIEMPRE en la unidad de uso: la de la ficha del
     producto. Kardex, existencias, PMP, salidas, cocina y fundición no cambian.
   · La unidad de compra PUEDE CAMBIAR POR PROVEEDOR: uno vende el azúcar en
     bultos de 50 kg y otro en sacos de 25 kg. Cada renglón de la oferta lleva
     su propia unidad y su factor, y la OC los hereda tal cual.
   · En la oferta y la OC, cantidad y precio están en la unidad de COMPRA (lo
     que factura el proveedor). Al recibir se convierte: cantidad × factor
     entra al inventario y el costo por unidad de uso es precio ÷ factor.

   Sin unidad de compra (o factor 1) el renglón se compra en la unidad de uso,
   como siempre: las órdenes viejas no cambian.
   ============================================================ */

/** Lo mínimo de un renglón para convertir. */
export interface ConUnidadCompra {
  unidad?: string | null;
  unidad_compra?: string | null;
  factor_compra?: number | null;
}

/** Una presentación de compra: en qué se compra y cuántas unidades de uso trae. */
export interface PresentacionCompra {
  unidad_compra: string;
  factor_compra: number;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Normaliza el nombre de la unidad (mayúsculas, sin espacios de más). */
export function normalizarUnidad(u: string | null | undefined): string {
  return (u ?? '').toString().trim().replace(/\s+/g, ' ').toUpperCase();
}

/* Sinónimos de las medidas básicas (07-10-2026): KG, KILO y KILOGRAMO son la
   misma unidad; LT, L y LITRO también. Si se «compra en KILOGRAMO» un producto
   que se usa en KILOGRAMO, no hay conversión que hacer y no se pregunta
   «¿cuántos kilogramos trae cada kilogramo?». */
const SINONIMOS: Record<string, string> = {
  KG: 'KILOGRAMO', KGS: 'KILOGRAMO', KILO: 'KILOGRAMO', KILOS: 'KILOGRAMO', KILOGRAMO: 'KILOGRAMO', KILOGRAMOS: 'KILOGRAMO',
  GR: 'GRAMO', G: 'GRAMO', GRS: 'GRAMO', GRAMO: 'GRAMO', GRAMOS: 'GRAMO',
  LT: 'LITRO', L: 'LITRO', LTS: 'LITRO', LITRO: 'LITRO', LITROS: 'LITRO',
  ML: 'MILILITRO', MILILITRO: 'MILILITRO', MILILITROS: 'MILILITRO',
  GAL: 'GALON', GALON: 'GALON', GALONES: 'GALON', 'GALÓN': 'GALON',
  UND: 'UNIDAD', UN: 'UNIDAD', U: 'UNIDAD', UNID: 'UNIDAD', UNIDAD: 'UNIDAD', UNIDADES: 'UNIDAD', PZA: 'UNIDAD', PIEZA: 'UNIDAD', PIEZAS: 'UNIDAD',
  PAR: 'PAR', PARES: 'PAR',
  MT: 'METRO', M: 'METRO', MTS: 'METRO', METRO: 'METRO', METROS: 'METRO',
  TON: 'TONELADA', TONELADA: 'TONELADA', TONELADAS: 'TONELADA',
};

/** La unidad «canónica»: KG, KILO y KILOGRAMO → KILOGRAMO. Lo desconocido queda como está. */
export function unidadCanonica(u: string | null | undefined): string {
  const n = normalizarUnidad(u).replace(/\.$/, '');
  return SINONIMOS[n] ?? n;
}

/** ¿Son la misma medida (contando sinónimos)? Vacíos no cuentan. */
export function mismaUnidad(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = unidadCanonica(a); const cb = unidadCanonica(b);
  return !!ca && !!cb && ca === cb;
}

/** ¿Hay que preguntar el factor? Solo cuando se compra en una medida DISTINTA a la de uso. */
export function pideFactor(unidadCompra: string | null | undefined, unidadUso: string | null | undefined): boolean {
  return !!normalizarUnidad(unidadCompra) && !mismaUnidad(unidadCompra, unidadUso);
}

/** El factor válido del renglón: > 0 y con unidad de compra distinta a la de uso; si no, 1. */
export function factorDe(it: ConUnidadCompra | null | undefined): number {
  if (!it || !pideFactor(it.unidad_compra, it.unidad)) return 1;
  const f = Number(it.factor_compra);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/** ¿El renglón se compra en otra medida distinta a la de uso? */
export function usaUnidadCompra(it: ConUnidadCompra | null | undefined): boolean {
  if (!it) return false;
  const uc = normalizarUnidad(it.unidad_compra);
  if (!uc || mismaUnidad(uc, it.unidad)) return false;
  return factorDe(it) !== 1 || uc !== normalizarUnidad(it.unidad);
}

/** Lo que entra al inventario (unidad de uso) por una cantidad en unidad de compra. */
export function cantidadEnUso(it: ConUnidadCompra, cantidadCompra: number): number {
  return r4((Number(cantidadCompra) || 0) * factorDe(it));
}

/** El costo por unidad de uso a partir del precio por unidad de compra. */
export function costoPorUnidadDeUso(it: ConUnidadCompra, precioCompra: number): number {
  return Number(((Number(precioCompra) || 0) / factorDe(it)).toFixed(4));
}

/**
 * Cuántas unidades de compra hacen falta para cubrir una cantidad de uso.
 * Se redondea hacia arriba: el proveedor vende bultos enteros (520 kg en
 * bultos de 50 → 11 bultos). Con factor 1 la cantidad queda igual.
 */
export function cantidadCompraPara(cantidadUso: number, factor: number): number {
  const f = Number(factor) > 0 ? Number(factor) : 1;
  const q = Number(cantidadUso) || 0;
  if (f === 1) return r4(q);
  return Math.ceil(r4(q / f) - 1e-9);
}

/**
 * Cambia la unidad de compra de un renglón conservando lo que se pidió en
 * unidad de uso. Devuelve los campos a aplicar al renglón.
 */
export function cambiarPresentacion<T extends ConUnidadCompra & { cantidad: number }>(
  it: T,
  nueva: { unidad_compra: string | null; factor_compra: number | null },
): Pick<T, 'cantidad'> & { unidad_compra: string | null; factor_compra: number | null } {
  const enUso = cantidadEnUso(it, it.cantidad);
  const uc = normalizarUnidad(nueva.unidad_compra) || null;
  const f = uc && Number(nueva.factor_compra) > 0 ? Number(nueva.factor_compra) : null;
  return { cantidad: cantidadCompraPara(enUso, uc && f ? f : 1), unidad_compra: uc, factor_compra: uc ? f : null };
}

/** Elige la presentación: la del proveedor si existe; si no, la de la ficha; si no, ninguna. */
export function presentacionSugerida(
  delProveedor: PresentacionCompra | null | undefined,
  deLaFicha: { unidad_compra?: string | null; unidades_empaque?: number | null } | null | undefined,
): PresentacionCompra | null {
  if (delProveedor && normalizarUnidad(delProveedor.unidad_compra) && Number(delProveedor.factor_compra) > 0)
    return { unidad_compra: normalizarUnidad(delProveedor.unidad_compra), factor_compra: Number(delProveedor.factor_compra) };
  const uc = normalizarUnidad(deLaFicha?.unidad_compra);
  const f = Number(deLaFicha?.unidades_empaque);
  if (uc && Number.isFinite(f) && f > 0) return { unidad_compra: uc, factor_compra: f };
  return null;
}

const fmt = (n: number) => r4(n).toLocaleString('es-VE', { maximumFractionDigits: 4 });

/** «10 BULTO (= 500 KILOGRAMO)» o «500 KILOGRAMO» si se compra en la unidad de uso. */
export function textoCantidadCompra(it: ConUnidadCompra, cantidadCompra: number): string {
  const uso = normalizarUnidad(it.unidad);
  if (!usaUnidadCompra(it)) return `${fmt(cantidadCompra)}${uso ? ` ${uso}` : ''}`;
  return `${fmt(cantidadCompra)} ${normalizarUnidad(it.unidad_compra)} (= ${fmt(cantidadEnUso(it, cantidadCompra))}${uso ? ` ${uso}` : ''})`;
}

/** «1 BULTO = 50 KILOGRAMO»: la equivalencia sola, para etiquetas. */
export function textoEquivalencia(it: ConUnidadCompra): string {
  if (!usaUnidadCompra(it)) return '';
  const uso = normalizarUnidad(it.unidad);
  return `1 ${normalizarUnidad(it.unidad_compra)} = ${fmt(factorDe(it))}${uso ? ` ${uso}` : ''}`;
}
