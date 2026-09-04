/* ============================================================
   MGG · Inventario · Stock por sede/almacén para la trazabilidad
   El almacenista veía tres números distintos para el mismo producto:
   «Stock» en la lista (solo su sede), «Stock actual» en el modal de
   trazabilidad (global, de todas las sedes) y «saldo» en cada línea
   del kardex (del almacén de esa línea). Los tres eran correctos y
   ninguno decía de qué ámbito era. Estas funciones puras arman el
   desglose por sede → almacén y el filtro del kardex por almacén,
   para que el modal responda primero «¿cuánto hay y dónde?».
   La sede vive solo en `almacenes.sede` (texto); las existencias y
   los movimientos guardan el NOMBRE del almacén.
   ⚠ Las recepciones de orden de compra (`recibirOrdenParcial`) se
   insertan SIN almacén y con saldo/PMP GLOBALES (325 filas en
   producción): acá se tratan como líneas «sin almacén», se muestran
   siempre y no se cuentan en las entradas «de» un almacén.
   ============================================================ */
import type { Almacen, Existencia, Movimiento } from '@/shared/lib/types';

export const SIN_SEDE = 'Sin sede';
/** Clave del chip «recepciones de compra (sin almacén)» en el filtro del kardex. */
export const FILTRO_SIN_ALMACEN = '__sin_almacen__';

/** «CENTRO DE FUNDICION - MATANZAS» → «Matanzas»; «CENTRO DE ACOPIO - LA ESPERANZA» → «Acopio La Esperanza». */
export function nombreSedeCorto(sede: string | null | undefined): string {
  const s = String(sede ?? '').trim();
  if (!s || s.toLowerCase() === SIN_SEDE.toLowerCase()) return SIN_SEDE;
  const r = s.replace(/^CENTRO DE FUNDICI[OÓ]N\s*-\s*/i, '').replace(/^CENTRO DE ACOPIO\s*-\s*/i, 'Acopio ');
  return r.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
}

/** Sede de un almacén por su nombre (texto). Sin sede o almacén desconocido → «Sin sede». */
export function sedeDeAlmacen(nombre: string | null | undefined, almacenes: Pick<Almacen, 'nombre' | 'sede'>[]): string {
  const a = almacenes.find((x) => x.nombre === nombre);
  const s = a?.sede?.trim();
  return s || SIN_SEDE;
}

/**
 * Agrega las existencias de un conjunto de almacenes por producto: stock sumado
 * y costo unitario del conjunto.
 *
 * El costo NO se apaga cuando no hay stock. Un producto agotado sigue valiendo
 * lo que costó la última vez, y ponerlo en 0 hacía parecer que nunca se le cargó
 * precio: PEPINO tenía 1,27 guardado en La Esperanza y la tabla mostraba $0,00,
 * mezclándolo visualmente con los productos que de verdad no tienen costo.
 *
 * El VALOR sí queda en cero, porque se calcula como stock × costo: un producto
 * en cero muestra su precio pero no suma nada al inventario.
 */
export function agregarExistencias(
  // `stock` y `costo_promedio` se aceptan nulos a propósito: el tipo `Existencia`
  // los declara `number`, pero la tabla sí devuelve NULL (hay filas con costo en
  // null, son parte de la cola «Sin costo»). Mejor admitirlo en la firma que
  // confiar en un tipo que la base no respeta.
  filas: Array<{ producto_id: string; almacen: string; stock: number | null; costo_promedio: number | null }>,
  incluye: (almacen: string) => boolean,
): Map<string, { stock: number; costo: number }> {
  const agg = new Map<string, { stock: number; valor: number; ultimoCosto: number }>();
  for (const e of filas ?? []) {
    if (!incluye(e.almacen)) continue;
    const cur = agg.get(e.producto_id) ?? { stock: 0, valor: 0, ultimoCosto: 0 };
    const st = Number(e.stock) || 0;
    const c = Number(e.costo_promedio) || 0;
    cur.stock += st;
    cur.valor += st * c;
    // Sin stock en ninguno de los almacenes se muestra el costo MÁS ALTO de los
    // conocidos: subvalorar el inventario es el error que se está corrigiendo.
    if (c > cur.ultimoCosto) cur.ultimoCosto = c;
    agg.set(e.producto_id, cur);
  }
  const out = new Map<string, { stock: number; costo: number }>();
  for (const [id, v] of agg) {
    out.set(id, { stock: v.stock, costo: v.stock > 0 ? v.valor / v.stock : v.ultimoCosto });
  }
  return out;
}

/**
 * Cómo se rotula la columna «Almacén» de un export.
 *
 * NO se usa `producto.almacen`: ese es el almacén «hogar» de la ficha, que puede
 * apuntar a un subalmacén de OTRA sede que la exportada. Por eso un reporte de
 * Matanza salía con filas que decían «Viveres y Art. Limpieza» (Los Pinos)
 * mezcladas con «DEPOSITO» (Matanza).
 *
 * Un export sale siempre de una sede y se rotula con ELLA —Matanza, Los Pinos,
 * Acopio La Esperanza—, no con el subalmacén, que es detalle interno.
 */
export interface ExportRotulo {
  /** Sede desde la que se exporta: rotula TODAS las filas. */
  sede?: string | null;
  /** Resuelve la sede por producto cuando no hay una sede fija (Depósito). */
  almacenes?: Pick<Almacen, 'nombre' | 'sede'>[];
}

export function rotuloAlmacen(
  // `almacen` se acepta nulo aunque `Producto` lo declare `string`: hay fichas
  // viejas sin almacén hogar y no deben romper un export.
  producto: { almacen: string | null | undefined },
  rot?: ExportRotulo,
): string {
  const fija = (rot?.sede ?? '').trim();
  if (fija) return fija;
  const alms = rot?.almacenes ?? [];
  const propio = producto.almacen ?? '';
  if (!alms.length) return propio;
  const sede = sedeDeAlmacen(propio, alms);
  // Un almacén que ya no está en la tabla conserva su nombre crudo: mejor un
  // dato viejo visible que una celda en blanco.
  return sede === SIN_SEDE ? propio : nombreSedeCorto(sede);
}

/** «Matanzas › General»: el almacén con su sede, para que dos nombres parecidos no se confundan. */
export function etiquetaAlmacen(nombre: string, almacenes: Pick<Almacen, 'nombre' | 'sede'>[]): string {
  const sede = sedeDeAlmacen(nombre, almacenes);
  return sede === SIN_SEDE ? nombre : `${nombreSedeCorto(sede)} › ${nombre}`;
}

/**
 * Almacén PRINCIPAL de una sede: dónde cae el material que no va a un
 * subalmacén específico. Es el destino por defecto al crear un producto
 * estando parado en esa sede.
 *
 * No sirve tomar el primero de la lista: viene ordenada por nombre, así que
 * Matanza arrancaría en «COMBUSTIBLE» y Los Pinos en «INSUMOS Y CONSUMIBLES».
 * El orden de preferencia es:
 *   1. el almacén que se llama como la sede  (Los Pinos, La Esperanza)
 *   2. el «General» / «Principal» de esa sede (Matanza, Parguaza, El Burro)
 *   3. cualquier otro que no sea subalmacén
 * Devuelve null si la sede no tiene ningún almacén propio.
 */
export function almacenPrincipalDeSede(
  sede: string | null | undefined,
  almacenes: Pick<Almacen, 'nombre' | 'sede' | 'parent_id'>[],
): string | null {
  const s = String(sede ?? '').trim().toUpperCase();
  if (!s) return null;
  const propios = (almacenes ?? []).filter((a) => (a.sede ?? '').trim().toUpperCase() === s);
  if (!propios.length) return null;
  // Los subalmacenes (casiterita, víveres…) nunca son el destino por defecto;
  // si la sede SOLO tiene subalmacenes, se usan igual antes que devolver null.
  const base = propios.filter((a) => !a.parent_id);
  const candidatos = base.length ? base : propios;

  const corto = nombreSedeCorto(sede).replace(/^Acopio\s+/i, '').trim().toUpperCase();
  const norm = (n: string) => n.trim().toUpperCase();

  const porNombreDeSede = candidatos.find((a) => norm(a.nombre) === corto);
  if (porNombreDeSede) return porNombreDeSede.nombre;

  const general = candidatos.find((a) => /^(GENERAL|PRINCIPAL)\b/.test(norm(a.nombre)));
  if (general) return general.nombre;

  return candidatos[0].nombre;
}

/**
 * ¿Es un almacén de MINERAL? (casiterita / estaño en bruto / estaño refinado)
 *
 * Son los únicos subalmacenes vigentes del sistema: el resto —víveres, papelería,
 * combustible, embalaje— dejó de usarse y el material va al principal de la sede.
 * Por eso son los únicos que siguen siendo un destino elegible además del padre.
 */
export function esAlmacenMineral(nombre: string | null | undefined): boolean {
  const n = String(nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // ESTAÑO → ESTANO
    .toUpperCase();
  return /CASITERITA|SNO\s*[2₂]|ESTANO/.test(n);
}

export interface DestinoAlmacen { nombre: string; label: string }

/**
 * Destinos elegibles de un traslado, agrupados por sede: el almacén PADRE de cada
 * una y sus almacenes de mineral.
 *
 * No alcanza con filtrar `!parent_id`: la jerarquía casi no existe en los datos.
 * Matanza tiene DOCE almacenes raíz (COMBUSTIBLE, DEPOSITO, Papelería, Resguardo…)
 * y ninguno marcado como padre, así que el desplegable listaba los doce. El padre
 * se resuelve por nombre —`almacenPrincipalDeSede`—, que da «General» en Matanza y
 * «GENERAL - EL BURRO» en El Burro.
 */
export function destinosDeTraslado(
  almacenes: Pick<Almacen, 'nombre' | 'sede' | 'parent_id' | 'estado'>[],
): Array<[string, DestinoAlmacen[]]> {
  const activos = (almacenes ?? []).filter((a) => a.estado === 'activo');
  const sedes = Array.from(new Set(activos.map((a) => (a.sede ?? '').trim() || SIN_SEDE)));

  const grupos: Array<[string, DestinoAlmacen[]]> = [];
  for (const sede of sedes.sort((a, b) => a.localeCompare(b, 'es'))) {
    const propios = activos.filter((a) => ((a.sede ?? '').trim() || SIN_SEDE) === sede);
    const principal = sede === SIN_SEDE ? null : almacenPrincipalDeSede(sede, propios);

    const minerales = propios
      .filter((a) => a.nombre !== principal && esAlmacenMineral(a.nombre))
      .map((a) => ({ nombre: a.nombre, label: a.nombre }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));

    // «Sin sede» no tiene principal que valga: se listan todos sus almacenes.
    const cabeza: DestinoAlmacen[] = principal
      ? [{ nombre: principal, label: principal }]
      : sede === SIN_SEDE
        ? propios.map((a) => ({ nombre: a.nombre, label: a.nombre })).sort((a, b) => a.label.localeCompare(b.label, 'es'))
        : [];

    const lista = [...cabeza, ...minerales.filter((m) => !cabeza.some((c) => c.nombre === m.nombre))];
    if (lista.length) grupos.push([sede, lista]);
  }
  return grupos;
}

const mismaSede = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

/** ¿El movimiento no registró almacén? (recepciones de OC y filas anteriores a la columna). */
export function sinAlmacen(m: Pick<Movimiento, 'almacen'>): boolean {
  return !(m.almacen ?? '').trim();
}

export interface AlmacenStock { almacen: string; stock: number; costo: number }
export interface SedeStock { sede: string; etiqueta: string; stock: number; esOrigen: boolean; almacenes: AlmacenStock[] }

/**
 * Desglose sede → almacén de las existencias de UN producto (las filas ya vienen filtradas
 * por producto). Solo almacenes con stock ≠ 0. La sede desde la que se abrió el modal va
 * primero (`esOrigen`); después, por stock descendente.
 */
export function desglosePorSede(
  existencias: Pick<Existencia, 'almacen' | 'stock' | 'costo_promedio'>[],
  almacenes: Pick<Almacen, 'nombre' | 'sede'>[],
  origenSede?: string | null,
): { sedes: SedeStock[]; total: number } {
  const porSede = new Map<string, SedeStock>();
  let total = 0;
  for (const e of existencias) {
    const st = Number(e.stock) || 0;
    if (st === 0) continue;
    total += st;
    const sede = sedeDeAlmacen(e.almacen, almacenes);
    let s = porSede.get(sede);
    if (!s) {
      s = { sede, etiqueta: nombreSedeCorto(sede), stock: 0, esOrigen: mismaSede(sede, origenSede), almacenes: [] };
      porSede.set(sede, s);
    }
    s.stock += st;
    s.almacenes.push({ almacen: e.almacen, stock: st, costo: Number(e.costo_promedio) || 0 });
  }
  const sedes = [...porSede.values()];
  for (const s of sedes) s.almacenes.sort((a, b) => b.stock - a.stock);
  sedes.sort((a, b) => Number(b.esOrigen) - Number(a.esOrigen) || b.stock - a.stock);
  return { sedes, total: Math.round(total * 1e6) / 1e6 };
}

/** Stock del producto en un almacén concreto (0 si no hay fila). */
export function stockEn(existencias: Pick<Existencia, 'almacen' | 'stock'>[], almacen: string | null | undefined): number {
  if (!almacen) return 0;
  return Number(existencias.find((e) => e.almacen === almacen)?.stock) || 0;
}

/**
 * Almacenes que aparecen en el kardex, para los chips de filtro: primero los de la sede
 * desde la que se abrió el modal, luego por cantidad de movimientos, luego por nombre.
 * Las líneas sin almacén no entran acá (ver `contarSinAlmacen`).
 */
export function almacenesDelKardex(
  movs: Pick<Movimiento, 'almacen'>[],
  almacenes: Pick<Almacen, 'nombre' | 'sede'>[],
  origenSede?: string | null,
): string[] {
  const conteo = new Map<string, number>();
  for (const m of movs) {
    if (sinAlmacen(m)) continue;
    const a = (m.almacen ?? '').trim();
    conteo.set(a, (conteo.get(a) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .sort((x, y) => {
      const ox = mismaSede(sedeDeAlmacen(x[0], almacenes), origenSede) ? 0 : 1;
      const oy = mismaSede(sedeDeAlmacen(y[0], almacenes), origenSede) ? 0 : 1;
      return ox - oy || y[1] - x[1] || x[0].localeCompare(y[0]);
    })
    .map(([a]) => a);
}

/** Cuántas líneas del kardex no registraron almacén (recepciones de compra). */
export function contarSinAlmacen(movs: Pick<Movimiento, 'almacen'>[]): number {
  return movs.filter(sinAlmacen).length;
}

/**
 * Kardex filtrado. null = todo; FILTRO_SIN_ALMACEN = solo las líneas sin almacén; un
 * almacén = sus líneas MÁS las líneas sin almacén (una recepción de compra sí entró a
 * algún almacén, solo que el dato no lo dice: esconderla haría creer que el stock apareció
 * de la nada). El ámbito de cada línea se rotula aparte (`sinAlmacen`).
 */
/**
 * La SALIDA de una consolidación de almacenes no se muestra en el kardex.
 *
 * Consolidar Matanza generó un par de líneas por producto: la salida del almacén
 * que se vació y la entrada a «General». La salida aparecía en rojo, con signo
 * negativo y saldo 0 —«-443,6 KILOGRAMO · Materias Primas»— como si se hubiera
 * despachado material, cuando en la práctica no se movió nada de lugar: fue una
 * fusión administrativa de dos almacenes de la MISMA sede.
 *
 * Se conserva la ENTRADA, que es la que explica de dónde salió el saldo que hoy
 * está en «General», y se conservan las dos filas en la base: esto es lo que se
 * muestra, no lo que se guarda.
 */
export function esSalidaDeConsolidacion(m: Pick<Movimiento, 'ref_tipo' | 'delta'>): boolean {
  return m.ref_tipo === 'consolidacion' && (Number(m.delta) || 0) < 0;
}

export function filtrarKardex<M extends Pick<Movimiento, 'almacen' | 'ref_tipo' | 'delta'>>(movs: M[], filtro: string | null): M[] {
  const base = movs.filter((m) => !esSalidaDeConsolidacion(m));
  if (!filtro) return base;
  if (filtro === FILTRO_SIN_ALMACEN) return base.filter(sinAlmacen);
  return base.filter((m) => sinAlmacen(m) || (m.almacen ?? '').trim() === filtro);
}

/**
 * Entradas y salidas del ámbito elegido. Con un almacén, SOLO cuentan las líneas de ese
 * almacén (las sin almacén no se le pueden atribuir); sin filtro cuentan todas.
 */
export function entradasSalidas(movs: Pick<Movimiento, 'almacen' | 'delta' | 'ref_tipo'>[], filtro: string | null): { entradas: number; salidas: number } {
  // Se descarta lo mismo que el listado: si la salida de consolidación no se ve,
  // tampoco puede estar sumando en el total de «salidas» del período.
  const visibles = movs.filter((m) => !esSalidaDeConsolidacion(m));
  const base = !filtro ? visibles
    : filtro === FILTRO_SIN_ALMACEN ? visibles.filter(sinAlmacen)
    : visibles.filter((m) => (m.almacen ?? '').trim() === filtro);
  const entradas = base.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0);
  const salidas = base.filter((m) => m.delta < 0).reduce((a, m) => a + Math.abs(m.delta), 0);
  return { entradas: Math.round(entradas * 1e6) / 1e6, salidas: Math.round(salidas * 1e6) / 1e6 };
}

export interface AjustePmp { antes: number | null; despues: number; compra: number | null }

/**
 * Ajuste del PMP en cada recompra, POR ALMACÉN: cuál era el PMP de ese almacén antes de la
 * entrada y en cuánto quedó. `costo_promedio` de un movimiento es el PMP del almacén de la
 * línea (las líneas sin almacén llevan el PMP global y se siguen entre sí).
 * Devuelve además el costo inicial (primer costo registrado, cronológico).
 */
export function ajustesPmpPorAlmacen(movs: Pick<Movimiento, 'id' | 'at' | 'delta' | 'almacen' | 'costo_promedio' | 'precio_unitario'>[]): { ajustes: Map<string, AjustePmp>; costoInicial: number | null } {
  const ajustes = new Map<string, AjustePmp>();
  let costoInicial: number | null = null;
  const crono = [...movs].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const ultimo = new Map<string, number>();
  for (const m of crono) {
    if (costoInicial == null && (m.costo_promedio != null || m.precio_unitario != null)) {
      costoInicial = m.costo_promedio ?? m.precio_unitario ?? null;
    }
    const clave = (m.almacen ?? '').trim();
    const pmp = m.costo_promedio ?? null;
    if (m.delta > 0 && pmp != null) {
      ajustes.set(m.id, { antes: ultimo.get(clave) ?? null, despues: pmp, compra: m.precio_unitario ?? null });
    }
    if (pmp != null) ultimo.set(clave, pmp);
  }
  return { ajustes, costoInicial };
}

/* ── Reconstrucción del par origen → destino de un traslado ──────────────────
   `transferir()` (movimientos.repository.ts) y `trasladoMaterial()` (salidas)
   escriben DOS movimientos, y cada uno guarda en `almacen` SU PROPIO lado: el
   otro extremo queda embutido en el texto de `detalle`. Así, la fila dice
   «Traslado a X» y el badge muestra el almacén contrario, sin que nada aclare
   cuál es cuál. Acá se reconstruye el par para poder mostrarlo explícito.

   ⚠ EL SEPARADOR « · » NO SIRVE PARA CORTAR. `nombreUnicoSubalmacen()`
   (almacenes.repository.ts) le pega « · <padre> » a un subalmacén cuyo nombre
   ya estaba ocupado, así que hay nombres que LO CONTIENEN: con
   «Traslado a Viveres y Art. Limpieza · La Esperanza · SOLICITUD DE TRASLADO»,
   cortar por el primer « · » devuelve «Viveres y Art. Limpieza», que existe de
   verdad pero es de OTRA SEDE. Son 31 movimientos reales en producción.
   Por eso se compara contra los nombres de almacén reales, del MÁS LARGO al
   más corto, y el corte por « · » queda solo como último recurso marcado. */

/** Los cuatro prefijos que conviven en el histórico. El orden importa: «desde» antes que «a». */
const PREFIJOS_TRASLADO: { txt: string; salida: boolean }[] = [
  { txt: 'Transferencia desde ', salida: false },
  { txt: 'Transferencia a ', salida: true },
  { txt: 'Traslado desde ', salida: false },
  { txt: 'Traslado a ', salida: true },
];

export interface TrasladoPar {
  origen: string;
  destino: string;
  /** Lo que quedó del detalle una vez separado el nombre del almacén (el motivo). */
  nota: string;
  /** true si la contraparte coincidió con un almacén real; false = se cortó a ciegas. */
  resuelto: boolean;
}

/**
 * Par origen → destino de un movimiento de traslado, o `null` si no se puede afirmar.
 *
 * Devuelve `null` cuando el movimiento no es un traslado, cuando el detalle no trae
 * ninguno de los prefijos conocidos, o cuando todavía no llegó la lista de almacenes
 * (se carga async): preferimos no pintar nada antes que pintar un origen inventado.
 */
export function trasladoDeMovimiento(
  m: Pick<Movimiento, 'almacen' | 'detalle'> & { tipo?: string | null },
  almacenes: Pick<Almacen, 'nombre' | 'sede'>[],
): TrasladoPar | null {
  if (m.tipo != null && m.tipo !== 'transferencia') return null;
  const detalle = (m.detalle ?? '').trim();
  if (!detalle || !almacenes.length) return null;

  const pref = PREFIJOS_TRASLADO.find((p) => detalle.startsWith(p.txt));
  if (!pref) return null;
  const resto = detalle.slice(pref.txt.length).trim();
  if (!resto) return null;

  // Coincidencia contra almacenes reales, del más largo al más corto: así
  // «Viveres y Art. Limpieza · La Esperanza» le gana a «Viveres y Art. Limpieza».
  let contraparte = '';
  let nota = '';
  let resuelto = false;
  const nombres = almacenes
    .map((a) => (a.nombre ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const n of nombres) {
    if (resto === n) { contraparte = n; nota = ''; resuelto = true; break; }
    if (resto.startsWith(`${n} · `)) { contraparte = n; nota = resto.slice(n.length + 3).trim(); resuelto = true; break; }
  }
  if (!resuelto) {
    // Último recurso: cortar por el primer « · ». Queda marcado como no resuelto
    // para que la pantalla muestre el texto crudo en vez de afirmar una sede.
    const i = resto.indexOf(' · ');
    contraparte = i >= 0 ? resto.slice(0, i).trim() : resto;
    nota = i >= 0 ? resto.slice(i + 3).trim() : '';
  }

  const propio = (m.almacen ?? '').trim();
  return pref.salida
    ? { origen: propio, destino: contraparte, nota, resuelto }
    : { origen: contraparte, destino: propio, nota, resuelto };
}
