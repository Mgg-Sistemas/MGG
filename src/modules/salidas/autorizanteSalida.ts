/* ============================================================
   MGG · Salidas · Quién autoriza salidas y traslados

   Regla de la empresa: las salidas y los traslados los AUTORIZAN
   únicamente Leydis Rengel y Jesús Lozada. Nadie más.

   Hasta el 14-09-2026 el sistema dejaba aprobar a cualquiera con
   control total del módulo, y el almacenista lo tenía: Kelvin Peña
   aprobó 107 solicitudes y el papel las imprimía con su nombre en
   «Autorizado por». Ahora la regla vive en tres lugares:
   · la pantalla (solo ellos ven el botón Aprobar),
   · la base de datos (un trigger rechaza cualquier otra aprobación),
   · el documento (acá abajo).
   ============================================================ */

/** Los únicos que autorizan salidas y traslados, por correo. */
export const AUTORIZAN_SALIDAS: Record<string, string> = {
  'jhzgcontabilidad@gmail.com': 'LEYDIS RENGEL',
  'mineralgroupguayanaca@gmail.com': 'JESUS LOZADA',
};

/** Dueña de la firma escaneada que lleva el formato. */
export const CORREO_FIRMA = 'jhzgcontabilidad@gmail.com';
export const NOMBRE_FIRMA = AUTORIZAN_SALIDAS[CORREO_FIRMA];

/** ¿Este correo puede autorizar salidas y traslados? */
export function puedeAutorizarSalidas(correo: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(AUTORIZAN_SALIDAS, (correo ?? '').trim().toLowerCase());
}

export interface Autorizante {
  /** Nombre a imprimir debajo de la línea. */
  nombre: string;
  /** ¿Se estampa la firma escaneada encima de la línea? */
  firma: boolean;
  /** ¿Todavía no la autorizó nadie habilitado? */
  pendiente: boolean;
}

/**
 * Quién figura en «Autorizado por».
 *
 * Solo puede figurar uno de los dos autorizados. Las 107 solicitudes que aprobó
 * otra persona antes de la regla figuran como autorizadas por Leydis Rengel, con
 * su firma: así lo dispuso Jesús Lozada el 14-09-2026. La base conserva en
 * `aprobada_por` quién apretó el botón; esto solo cambia lo que se muestra.
 */
export function autorizanteDe(aprobadaPor: string | null | undefined): Autorizante {
  const correo = (aprobadaPor ?? '').trim().toLowerCase();
  if (!correo) return { nombre: '— (pendiente de aprobación) —', firma: false, pendiente: true };
  const quien = puedeAutorizarSalidas(correo) ? correo : CORREO_FIRMA;
  return { nombre: AUTORIZAN_SALIDAS[quien], firma: quien === CORREO_FIRMA, pendiente: false };
}
