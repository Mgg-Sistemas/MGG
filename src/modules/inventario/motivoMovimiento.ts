/* ============================================================
   MGG · Inventario · el motivo de un movimiento manual
   ------------------------------------------------------------
   Una entrada, una salida o un ajuste cargados a mano son los
   únicos movimientos que cambian el stock SIN un documento
   detrás: no hay orden de compra, ni salida aprobada, ni
   recepción. Si no queda escrito por qué se hicieron, meses
   después nadie puede reconstruir qué pasó con el material.

   Por eso el motivo es obligatorio en los cuatro tipos que se
   cargan a mano y mueven stock. Los movimientos que nacen de
   otro módulo (una recepción de compra, una salida aprobada,
   la cocina) ya traen su documento y su código, así que no
   pasan por esta exigencia.
   ============================================================ */
import type { TipoMovimiento } from '@/shared/lib/types';

/** Largo mínimo del motivo. «Merma» y «Rotura» entran; «ok» y «x» no. */
export const MOTIVO_MINIMO = 5;

/**
 * Tipos cargados a mano que exigen motivo. Se listan los que CREAN o DESTRUYEN
 * stock. Quedan fuera a propósito:
 *  · `transferencia`, porque el traslado ya escribe solo «Transferencia a X» y
 *    el origen y el destino cuentan la historia;
 *  · `creacion`, que escribe sola «Stock inicial al dar de alta el producto»;
 *  · `fundicion` / `fin_fundicion`, que marcan el producto sin mover stock.
 */
export const TIPOS_CON_MOTIVO: TipoMovimiento[] = ['entrada', 'salida', 'ajuste', 'consumo'];

/** Solo los movimientos cargados a mano; los que vienen de otro módulo traen su documento. */
export const REF_MANUAL = 'manual';

export function requiereMotivo(tipo: TipoMovimiento, refTipo?: string | null): boolean {
  const ref = (refTipo ?? REF_MANUAL).trim() || REF_MANUAL;
  if (ref !== REF_MANUAL) return false;
  return TIPOS_CON_MOTIVO.includes(tipo);
}

/**
 * Qué está mal en el motivo escrito. `null` = sirve.
 * Se exige largo mínimo y al menos una letra, para que «12345» o «-----» no
 * pasen como explicación.
 */
export function errorMotivo(tipo: TipoMovimiento, detalle: string | null | undefined, refTipo?: string | null): string | null {
  if (!requiereMotivo(tipo, refTipo)) return null;
  const texto = (detalle ?? '').trim();
  if (!texto) return `Escribí el motivo: una ${etiqueta(tipo)} cargada a mano necesita decir por qué se hizo.`;
  if (texto.length < MOTIVO_MINIMO) return `El motivo es muy corto: escribí al menos ${MOTIVO_MINIMO} caracteres que expliquen la ${etiqueta(tipo)}.`;
  if (!/\p{L}/u.test(texto)) return 'El motivo tiene que decir algo: escribilo en palabras, no solo números o guiones.';
  return null;
}

function etiqueta(tipo: TipoMovimiento): string {
  if (tipo === 'entrada') return 'entrada';
  if (tipo === 'salida') return 'salida';
  if (tipo === 'consumo') return 'salida por consumo';
  return 'corrección de stock';
}

/** Motivos frecuentes por tipo: se ofrecen como atajo para que escribir no cueste. */
export const MOTIVOS_SUGERIDOS: Partial<Record<TipoMovimiento, string[]>> = {
  entrada: ['Compra sin orden de compra', 'Devolución de material no usado', 'Material donado', 'Aparecido en conteo físico'],
  salida: ['Entrega a personal', 'Material dañado o vencido', 'Devolución al proveedor', 'Préstamo a otra área'],
  consumo: ['Consumo en proceso de producción', 'Prueba de planta', 'Muestra para análisis'],
  ajuste: ['Conteo físico', 'Rotura', 'Corrección de carga', 'Merma'],
};

export function motivosSugeridos(tipo: TipoMovimiento): string[] {
  return MOTIVOS_SUGERIDOS[tipo] ?? [];
}
