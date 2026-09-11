/* ============================================================
   MGG · Salidas · Quién firma «Autorizado por»

   El documento imprimía SIEMPRE «Leydis Rengel» con su firma escaneada,
   sin mirar quién había aprobado. De 179 solicitudes aprobadas, 105 las
   aprobó otra persona: esos papeles salieron con el nombre y la firma
   de alguien que no intervino.

   Una firma dice de quién es la responsabilidad. Acá se decide con dos
   reglas simples:

   · El papel nombra a QUIEN APROBÓ, no a un cargo fijo.
   · La firma escaneada se estampa SOLO cuando aprobó su dueña. Los
     demás salen con la línea vacía, para firmar a mano.
   ============================================================ */

/** Dueña de la firma escaneada que lleva el formato de salidas y traslados. */
export const CORREO_FIRMA = 'jhzgcontabilidad@gmail.com';
export const NOMBRE_FIRMA = 'LEYDIS RENGEL';

export interface Autorizante {
  /** Nombre a imprimir debajo de la línea. */
  nombre: string;
  /** ¿Se estampa la firma escaneada encima de la línea? */
  firma: boolean;
  /** ¿Todavía no la aprobó nadie? */
  pendiente: boolean;
}

/**
 * Quién autoriza el documento.
 *
 * Manda `aprobada_por`: la autorización es el acto de aprobar. `ejecutada_por`
 * queda de respaldo para las que se cerraron sin pasar por aprobación, donde
 * el único nombre disponible es el de quien la cerró.
 */
export function autorizanteDe(
  aprobadaPor: string | null | undefined,
  ejecutadaPor: string | null | undefined,
  nombrePorCorreo: (correo: string) => string,
): Autorizante {
  const correo = (aprobadaPor ?? '').trim() || (ejecutadaPor ?? '').trim();
  if (!correo) return { nombre: '— (pendiente de aprobación) —', firma: false, pendiente: true };

  if (correo.toLowerCase() === CORREO_FIRMA) {
    return { nombre: NOMBRE_FIRMA, firma: true, pendiente: false };
  }

  const nombre = (nombrePorCorreo(correo) ?? '').trim();
  // Sin ficha de usuario queda el correo: peor es imprimir un nombre inventado.
  return { nombre: (nombre || correo).toUpperCase(), firma: false, pendiente: false };
}
