/* ============================================================
   MGG · Cocina · Qué bloques del mercado están encendidos

   El panel tenía cuatro botones en fila —Disponible, Movimientos,
   Ambos, Distribución— y el usuario pidió tarjetas con switch, donde
   se vea encendido lo que se está mirando.

   Con switches, «Ambos» deja de ser un botón: es tener Disponible y
   Movimientos encendidos a la vez. Quedan tres llaves para las mismas
   cuatro combinaciones, y la palabra «ambos» sobrevive nada más como
   el valor guardado (así lo que cada quien dejó elegido sigue valiendo
   y no hay nada que migrar).

   Distribución es un panel entero, no una tabla más: encenderlo apaga
   los otros dos y encender cualquiera de los otros dos lo apaga.

   Nunca quedan las tres apagadas: una pantalla sin nada no es una
   opción que alguien quiera elegir. Apagar la última encendida no
   hace nada.
   ============================================================ */

/** Qué bloque se está mirando. Se recuerda por usuario. */
export type Vista = 'disponible' | 'movimientos' | 'ambos' | 'distribucion';

/** Las tres llaves de la fila de tarjetas. */
export type LlaveVista = 'disponible' | 'movimientos' | 'distribucion';

/** ¿Está encendida esta llave con la vista actual? */
export function vistaEncendida(vista: Vista, llave: LlaveVista): boolean {
  if (llave === 'distribucion') return vista === 'distribucion';
  if (llave === 'disponible') return vista === 'disponible' || vista === 'ambos';
  return vista === 'movimientos' || vista === 'ambos';
}

/**
 * La vista que queda al tocar una llave.
 *
 * Tocar la única llave encendida devuelve la misma vista: no se apaga la luz
 * del cuarto en el que estás parado.
 */
export function alternarVista(vista: Vista, llave: LlaveVista): Vista {
  if (llave === 'distribucion') return vista === 'distribucion' ? vista : 'distribucion';
  // Desde Distribución, tocar una de las otras dos la enciende sola.
  if (vista === 'distribucion') return llave;
  if (vista === 'ambos') return llave === 'disponible' ? 'movimientos' : 'disponible';
  return vista === llave ? vista : 'ambos';
}

/** Lo que dice cada tarjeta: título, para qué sirve y cómo se llama en la ayuda. */
export const TARJETAS_VISTA: Array<{ llave: LlaveVista; titulo: string; detalle: string }> = [
  { llave: 'disponible', titulo: '📋 Disponible', detalle: 'Qué hay de cada víver y cuánto queda' },
  { llave: 'movimientos', titulo: '🧾 Movimientos', detalle: 'Entradas, traslados, consumos y mermas' },
  { llave: 'distribucion', titulo: '📊 Distribución', detalle: 'Consumo por día, lote de compra y reorden' },
];
