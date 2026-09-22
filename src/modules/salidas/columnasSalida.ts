import type { EstadoSolicitudSalida, ScopeSalida, SolicitudSalida } from '@/shared/lib/types';

/**
 * Las columnas del tablero de solicitudes.
 *
 * Vive aparte de la página porque ahora la usan DOS pantallas: el tablero
 * —que muestra las últimas— y el histórico —que muestra todo lo demás—. Si la
 * lista viviera en una de las dos, la otra tendría su propia copia y tarde o
 * temprano dirían cosas distintas de la misma solicitud.
 *
 * «Ejecutada» se parte en dos: la que SÍ descontó stock/caja y la que se cerró
 * «sin descontar» (mov_ref = 'manual_externo', el descuento se hizo por fuera).
 * Es la misma fila de la base (estado 'ejecutada'): la diferencia vive en
 * mov_ref, no en un estado nuevo. Los almacenistas confundían ambos botones
 * porque el tablero las mezclaba.
 */
export type SolColKey = EstadoSolicitudSalida | 'ejecutada_sin_descuento';

export interface ColumnaSalida {
  key: SolColKey;
  label: string;
  /** En Traslados el stock se «mueve», no se «descuenta». */
  labelTraslado?: string;
  /** Clase de badge (y tono del chip del filtro). */
  badge: string;
  match: (s: SolicitudSalida) => boolean;
}

export const SOL_COLS: ColumnaSalida[] = [
  { key: 'por_aprobar', label: 'Por aprobar', badge: 'warning', match: (s) => s.estado === 'por_aprobar' },
  { key: 'aprobada', label: 'Aprobada', badge: 'info', match: (s) => s.estado === 'aprobada' },
  { key: 'ejecutada', label: 'Ejecutada (descontó)', labelTraslado: 'Ejecutada (movió stock)', badge: 'success', match: (s) => s.estado === 'ejecutada' && s.mov_ref !== 'manual_externo' },
  { key: 'ejecutada_sin_descuento', label: 'Cerrada sin descontar', labelTraslado: 'Cerrada sin mover', badge: 'warning', match: (s) => s.estado === 'ejecutada' && s.mov_ref === 'manual_externo' },
  { key: 'cancelada', label: 'Cancelada', badge: 'danger', match: (s) => s.estado === 'cancelada' },
];

/** Columna (etiqueta + color) que le corresponde a una solicitud. */
export const colDe = (s: SolicitudSalida): ColumnaSalida | undefined => SOL_COLS.find((c) => c.match(s));

/** Etiqueta de la columna según la pestaña: en Traslados el stock se «mueve», no se «descuenta». */
export const etiquetaCol = (col: ColumnaSalida | undefined, scope: ScopeSalida): string =>
  (scope === 'traslado' && col?.labelTraslado) || col?.label || '';

export const etiquetaDe = (s: SolicitudSalida): string => etiquetaCol(colDe(s), s.scope);

/** La clave de columna de una solicitud, para comparar contra un filtro guardado. */
export const claveColDe = (s: SolicitudSalida): SolColKey | '' => colDe(s)?.key ?? '';
