/* ============================================================
   MGG · Involucrados de planta · búsqueda y selección

   Los nombres de quienes trabajaron una colada se escribían a mano,
   uno por línea. Cada quien los tipeaba distinto —«JUAN RAMONS»,
   «Juan Ramos»— y no había manera de corregir ni de dar de baja a
   nadie. Ahora salen de un catálogo.

   Dos cuidados que valen más que el buscador:

   1) Una colada vieja puede tener nombres que NO están en el catálogo
      (o que se desactivaron después). Esos nombres NO se pierden: se
      muestran igual, marcados, porque el reporte ya los lleva.

   2) Lo que se guarda son NOMBRES, no ids. Un papel firmado no puede
      cambiar de firmante porque alguien se renombró en el catálogo.
   ============================================================ */

export interface PersonaCatalogo {
  id: string;
  nombre: string;
  cargo?: string | null;
  estado: string;
}

/** Una opción de la lista: del catálogo o heredada de la colada. */
export interface OpcionInvolucrado {
  nombre: string;
  cargo: string;
  /** `false` = no está en el catálogo activo; viene del reporte que ya existía. */
  enCatalogo: boolean;
  elegido: boolean;
}

/** Normaliza para comparar: sin acentos, sin dobles espacios, en minúscula. */
export function clave(nombre: string): string {
  return (nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Limpia un nombre escrito a mano: sin espacios de sobra, en mayúsculas. */
export function limpiarNombre(nombre: string): string {
  return (nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Quita repetidos respetando el orden y la forma en que se escribió el primero. */
export function sinRepetidos(nombres: string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const n of nombres ?? []) {
    const limpio = (n ?? '').trim();
    if (!limpio) continue;
    const k = clave(limpio);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(limpio);
  }
  return out;
}

/**
 * La lista completa para elegir: el catálogo activo más los nombres que ya
 * traía la colada y no están en él. Los elegidos van primero, y dentro de
 * cada bloque en orden alfabético.
 */
export function opcionesInvolucrados(
  catalogo: PersonaCatalogo[],
  elegidos: string[],
): OpcionInvolucrado[] {
  const marcados = new Set(sinRepetidos(elegidos).map(clave));
  const out: OpcionInvolucrado[] = [];
  const vistos = new Set<string>();

  for (const p of catalogo ?? []) {
    if (p.estado !== 'activo') continue;
    const k = clave(p.nombre);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push({ nombre: p.nombre, cargo: (p.cargo ?? '').trim(), enCatalogo: true, elegido: marcados.has(k) });
  }

  // Los que ya estaban en la colada y no figuran en el catálogo activo.
  for (const n of sinRepetidos(elegidos)) {
    const k = clave(n);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push({ nombre: n, cargo: '', enCatalogo: false, elegido: true });
  }

  return out.sort((a, b) => {
    if (a.elegido !== b.elegido) return a.elegido ? -1 : 1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

/** Filtra por lo que se escribió en el buscador (nombre o cargo). */
export function buscar(opciones: OpcionInvolucrado[], texto: string): OpcionInvolucrado[] {
  const q = clave(texto);
  if (!q) return opciones;
  return opciones.filter((o) => clave(o.nombre).includes(q) || clave(o.cargo).includes(q));
}

/** Agrega o saca un nombre de la selección, sin duplicarlo. */
export function alternar(elegidos: string[], nombre: string): string[] {
  const limpio = (nombre ?? '').trim();
  if (!limpio) return elegidos;
  const k = clave(limpio);
  const actuales = sinRepetidos(elegidos);
  return actuales.some((n) => clave(n) === k)
    ? actuales.filter((n) => clave(n) !== k)
    : [...actuales, limpio];
}

/** Lee el cuadro de texto viejo (un nombre por línea) para no perder lo cargado. */
export function desdeTexto(texto: string): string[] {
  return sinRepetidos((texto ?? '').split('\n').map((s) => s.trim()));
}
