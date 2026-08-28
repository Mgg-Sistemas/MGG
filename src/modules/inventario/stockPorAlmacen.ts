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

/** «Matanzas › General»: el almacén con su sede, para que dos nombres parecidos no se confundan. */
export function etiquetaAlmacen(nombre: string, almacenes: Pick<Almacen, 'nombre' | 'sede'>[]): string {
  const sede = sedeDeAlmacen(nombre, almacenes);
  return sede === SIN_SEDE ? nombre : `${nombreSedeCorto(sede)} › ${nombre}`;
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
export function filtrarKardex<M extends Pick<Movimiento, 'almacen'>>(movs: M[], filtro: string | null): M[] {
  if (!filtro) return movs;
  if (filtro === FILTRO_SIN_ALMACEN) return movs.filter(sinAlmacen);
  return movs.filter((m) => sinAlmacen(m) || (m.almacen ?? '').trim() === filtro);
}

/**
 * Entradas y salidas del ámbito elegido. Con un almacén, SOLO cuentan las líneas de ese
 * almacén (las sin almacén no se le pueden atribuir); sin filtro cuentan todas.
 */
export function entradasSalidas(movs: Pick<Movimiento, 'almacen' | 'delta'>[], filtro: string | null): { entradas: number; salidas: number } {
  const base = !filtro ? movs
    : filtro === FILTRO_SIN_ALMACEN ? movs.filter(sinAlmacen)
    : movs.filter((m) => (m.almacen ?? '').trim() === filtro);
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
