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

/**
 * Lo que se imprime cuando el traslado NO lleva autorización.
 *
 * Desde el 28-09-2026 el reparto de víveres entre cocinas hecho desde
 * Distribución de Alimentación se ejecuta solo: la comida sale de una cocina de
 * la empresa y entra a otra, no se va a ningún lado, y hacer esperar el almuerzo
 * a que uno de los dos autorizantes esté frente a la pantalla no cuidaba nada.
 * El mismo traslado hecho desde el módulo de Traslados sí se autoriza.
 */
export const SIN_AUTORIZACION_NOMBRE = 'NO REQUIERE AUTORIZACIÓN (reparto entre cocinas)';

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
 * Desde este día quién aprueba sale de la lista «Usuarios autorizados para:» de
 * Roles y Permisos (28-10-2026). Una aprobación de otra persona a partir de esa
 * fecha es legítima y figura con SU nombre; las de antes siguen la regla vieja.
 */
export const INICIO_LISTA_AUTORIZADOS = '2026-10-28T00:00:00-04:00';

export interface OpcionesAutorizante {
  /** Cuándo se aprobó (aprobada_en). */
  aprobadaEn?: string | null;
  /** Nombre real de quien aprobó (de la tabla usuarios). */
  nombre?: string | null;
}

/**
 * ¿El papel muestra a quien de verdad apretó «Aprobar»? Sí para Leydis y Jesús y
 * para cualquier aprobación desde la lista de autorizados; no para las viejas de
 * otra persona, que figuran a nombre de Leydis (y entonces no va la firma de quien
 * aprobó, aunque hoy tenga una cargada).
 */
export function figuraQuienAprobo(aprobadaPor: string | null | undefined, aprobadaEn?: string | null): boolean {
  const correo = (aprobadaPor ?? '').trim().toLowerCase();
  if (!correo) return false;
  if (puedeAutorizarSalidas(correo)) return true;
  return !!aprobadaEn && new Date(aprobadaEn).getTime() >= new Date(INICIO_LISTA_AUTORIZADOS).getTime();
}

/**
 * Quién figura en «Autorizado por».
 *
 * Leydis Rengel y Jesús Lozada figuran con su nombre de siempre. Las 107
 * solicitudes que aprobó otra persona antes de la regla figuran como autorizadas
 * por Leydis Rengel, con su firma: así lo dispuso Jesús Lozada el 14-09-2026.
 * Desde el 28-10-2026 aprueba cualquiera de la lista de autorizados, y figura él.
 * La base conserva en `aprobada_por` quién apretó el botón; esto solo cambia lo
 * que se muestra.
 */
export function autorizanteDe(
  aprobadaPor: string | null | undefined,
  sinAutorizacion?: boolean | null,
  opts?: OpcionesAutorizante,
): Autorizante {
  const correo = (aprobadaPor ?? '').trim().toLowerCase();
  // El reparto entre cocinas no espera firma de nadie: decir «pendiente de
  // aprobación» en un papel que ya movió el stock haría buscar una firma que no
  // existe.
  if (!correo && sinAutorizacion) return { nombre: SIN_AUTORIZACION_NOMBRE, firma: false, pendiente: false };
  if (!correo) return { nombre: '— (pendiente de aprobación) —', firma: false, pendiente: true };
  if (!puedeAutorizarSalidas(correo) && figuraQuienAprobo(correo, opts?.aprobadaEn)) {
    return { nombre: (opts?.nombre?.trim() || correo).toUpperCase(), firma: false, pendiente: false };
  }
  const quien = puedeAutorizarSalidas(correo) ? correo : CORREO_FIRMA;
  return { nombre: AUTORIZAN_SALIDAS[quien], firma: quien === CORREO_FIRMA, pendiente: false };
}
