/* ============================================================
   MGG · Inventario · detectar productos duplicados al darlos de alta

   OJO CON QUÉ ES «DUPLICADO» ACÁ. Que un material esté en Los Pinos Y en
   Matanzas es NORMAL y esperado: un producto es UNA ficha con existencias
   en varios almacenes (mascarillas en las dos sedes es el caso sano).
   El problema es otro: que se cree la MISMA ficha DOS VECES, una por
   almacén. Ahí el material queda partido en dos SKU, cada uno con su
   kardex y su costo promedio, los reportes de consumo no cuadran y nadie
   ve el stock completo. En producción ya pasó con PAÑO DE COCINA (una
   ficha en La Esperanza y otra en Los Pinos) y con CASITERITA, que tiene
   48.780 Kg en un SKU y 11.665 Kg en otro.

   Por eso el aviso no dice «no lo cargues acá», dice «esta ficha ya
   existe, sumale stock en tu almacén».

   `createProducto` no valida nada (un insert pelado), y en producción hay
   13 grupos duplicados: PINTURA EPOXICA GRIS ×3, DIESEL ×3, CASITERITA ×2
   con stock en las dos… Acá viven las piezas puras de la comparación: se
   testean sin base ni React.

   La decisión es ADVERTIR, no impedir: se muestran los parecidos con su
   stock por almacén y un botón para usar el existente, pero si el usuario
   insiste puede crearlo igual (hay materiales legítimamente parecidos).
   ============================================================ */

/** Palabras que no distinguen un material y solo ensucian la comparación. */
const RUIDO = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'CON', 'SIN', 'PARA', 'POR', 'A',
  'UND', 'UNIDAD', 'UNIDADES', 'KG', 'KGS', 'GR', 'GRS', 'LT', 'LTS', 'LITRO', 'LITROS',
  'ML', 'MTS', 'MT', 'METRO', 'METROS', 'PZA', 'PZAS', 'SACO', 'SACOS', 'BULTO', 'BULTOS',
]);

/**
 * Forma canónica de un nombre para compararlo: sin acentos, en mayúsculas,
 * sin signos y con los espacios colapsados. «Harina P.A.N.» y «HARINA PAN»
 * son el mismo material.
 */
export function normalizarNombre(nombre: string | null | undefined): string {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

/**
 * Tokens significativos de un nombre.
 *
 * Los números de UN SOLO dígito se conservan a propósito. En este catálogo la medida
 * es casi siempre lo ÚNICO que distingue dos materiales: «TORNILLO 3/8» y
 * «TORNILLO 1/2» normalizan a «TORNILLO 3 8» y «TORNILLO 1 2». Descartándolos por
 * cortos, los dos quedaban en «TORNILLO» a secas y el sistema los daba por el mismo.
 * Las letras sueltas sí se descartan: la «X» de «7" X .045"» no distingue nada.
 */
export function tokensNombre(nombre: string | null | undefined): string[] {
  return normalizarNombre(nombre)
    .split(' ')
    .filter((t) => (t.length > 1 || /^[0-9]$/.test(t)) && !RUIDO.has(t))
    .map(raiz);
}

/**
 * Raíz aproximada de una palabra, para que el singular y el plural sean el mismo
 * token: SARDINA/SARDINAS y GUANTE/GUANTES son el mismo material, y cargarlos dos
 * veces con y sin «s» es de las formas más comunes de duplicar una ficha.
 *
 * En español el plural es «-s» tras vocal y «-es» tras consonante, así que se saca la
 * «s» final y después la «e» final: GUANTES→GUANTE→GUANT y GUANTE→GUANT caen en lo
 * mismo, igual que MARCADORES→MARCADORE→MARCADOR y MARCADOR. No importa que la raíz
 * no sea una palabra real: solo se usa para comparar, y se aplica igual a los dos
 * lados. Los números no se tocan.
 */
function raiz(t: string): string {
  if (/[0-9]/.test(t)) return t;
  let r = t;
  if (r.length > 3 && r.endsWith('S')) r = r.slice(0, -1);
  if (r.length > 4 && r.endsWith('E')) r = r.slice(0, -1);
  return r;
}

/** Lo mínimo que hace falta de un producto para compararlo. */
export interface ProductoComparable {
  id: string;
  sku: string;
  nombre: string;
  unidad?: string | null;
  categoria?: string | null;
  almacen?: string | null;
  estado?: string | null;
  nombre_busqueda?: string | null;
  marca?: string | null;
}

export type NivelParecido = 'exacto' | 'muy_parecido' | 'parecido';

export interface Duplicado<T extends ProductoComparable = ProductoComparable> {
  producto: T;
  nivel: NivelParecido;
  /** 0 a 1. 1 = el nombre normalizado es idéntico. */
  score: number;
}

/**
 * Parecido entre dos nombres: tokens compartidos sobre el TOTAL de tokens distintos
 * de los dos (Jaccard). 1 = mismo nombre, 0 = nada que ver.
 *
 * Antes se dividía por el nombre más CORTO, y eso hacía que cualquier nombre corto
 * contenido en uno largo diera 1: escribir «TORNILLO 1/2» marcaba «TORNILLO
 * AUTOTALADRANTE», «TORNILLO TIRA FONDO 12X3» y dos más como el MISMO producto, y
 * encima frenaba el alta. Un aviso que salta con materiales distintos se vuelve ruido
 * y el operador aprende a ignorarlo, que es la peor forma de perder la función.
 * Con Jaccard, «TORNILLO 1 2» vs «TORNILLO AUTOTALADRANTE» comparten 1 de 4 → 0,25.
 */
export function parecidoNombre(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokensNombre(a);
  const tb = tokensNombre(b);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let comunes = 0;
  for (const t of setA) if (setB.has(t)) comunes += 1;
  const union = setA.size + setB.size - comunes;
  if (union <= 0) return 0;
  const score = comunes / union;

  // LA MEDIDA MANDA. En este catálogo hay familias enteras que solo se distinguen por
  // un número: 12 variantes de «TUBO EMT ACERO GALVANIZADO 3/4" X,XXMTS», 9 de «BROCA
  // DE ALTA VELOCIDAD TOLSEN x/y''», los DADO DE ROSCADO, los CARBONATO DE CALCIO M10
  // /M20/M200, las TAPA DE TOMACORRIENTE de 1 y 2 tomas. Comparten casi todas las
  // palabras, así que Jaccard las da por parecidas y el aviso saltaría cada vez que se
  // agrega una medida nueva. Si LOS DOS nombres traen números y esos números NO son los
  // mismos, son productos distintos: se penaliza el puntaje a la mitad.
  const numeros = (ts: string[]) => new Set(ts.filter((t) => /[0-9]/.test(t)));
  const na2 = numeros(ta);
  const nb2 = numeros(tb);
  if (na2.size && nb2.size) {
    let igualesNum = 0;
    for (const t of na2) if (nb2.has(t)) igualesNum += 1;
    const mismosNumeros = igualesNum === na2.size && igualesNum === nb2.size;
    if (!mismosNumeros) return score / 2;
  }
  return score;
}

/** ¿Los dos nombres son el MISMO nombre (ignorando acentos, signos y espacios)? */
export function mismoNombre(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarNombre(a);
  return !!na && na === normalizarNombre(b);
}

/** Umbral a partir del cual vale la pena avisar. Solo muestra la tarjeta; lo único que
 *  frena el alta es el nombre IDÉNTICO, así que un aviso de más es barato. */
const UMBRAL_AVISO = 0.5;

/**
 * Productos del catálogo que se parecen al nombre que se está escribiendo,
 * del más parecido al menos. Se comparan también `nombre_busqueda` y la marca,
 * porque el mismo material suele estar cargado con el nombre comercial en uno
 * y con el genérico en el otro.
 *
 * `excluirId` deja fuera al propio producto cuando se está editando.
 */
export function productosSimilares<T extends ProductoComparable>(
  nombre: string,
  productos: T[],
  opts: { excluirId?: string | null; limite?: number } = {},
): Duplicado<T>[] {
  const objetivo = normalizarNombre(nombre);
  if (objetivo.length < 3) return [];
  const limite = opts.limite ?? 5;

  const out: Duplicado<T>[] = [];
  for (const p of productos) {
    if (opts.excluirId && p.id === opts.excluirId) continue;
    // Un producto dado de baja igual cuenta: reactivarlo es mejor que duplicarlo.
    const score = Math.max(
      parecidoNombre(nombre, p.nombre),
      parecidoNombre(nombre, p.nombre_busqueda),
      p.marca ? parecidoNombre(nombre, `${p.marca} ${p.nombre}`) : 0,
    );
    if (score < UMBRAL_AVISO) continue;
    // «exacto» se decide por el NOMBRE, no por el puntaje: es el único nivel que frena
    // el alta, así que tiene que significar exactamente «esta ficha ya existe».
    const exacto = mismoNombre(nombre, p.nombre) || mismoNombre(nombre, p.nombre_busqueda);
    const nivel: NivelParecido = exacto ? 'exacto' : score >= 0.8 ? 'muy_parecido' : 'parecido';
    out.push({ producto: p, nivel, score });
  }
  return out
    .sort((a, b) => b.score - a.score || a.producto.nombre.localeCompare(b.producto.nombre, 'es'))
    .slice(0, limite);
}

/** ¿Hay al menos un candidato con el nombre exactamente igual? */
export function hayExacto(dups: Duplicado[]): boolean {
  return dups.some((d) => d.nivel === 'exacto');
}
