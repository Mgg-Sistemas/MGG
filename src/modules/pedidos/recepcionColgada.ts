/* ============================================================
   MGG · Recepción · orden «apartada» que nadie terminó

   24-11-2026. OC-2026-0269 (SP-2026-0269) quedó con `recibida_en`
   y `recibida_por` puestos a las 18:34, pero sin un solo movimiento
   de stock y sin el evento final «recibida». Quien la apartó se quedó
   a mitad de camino; al querer recibirla con otro usuario, la pantalla
   decía «Esta orden ya fue recibida» aunque el inventario no había
   cambiado.

   Antes solo podía recuperarla EL MISMO usuario. Acá vive la regla,
   junta y probada:

   · el mismo usuario siempre puede retomar la suya (aunque ya haya
     entrado parte del stock: el repository salta lo ya recibido);
   · otro usuario solo puede liberarla si pasaron 15 minutos y NO hay
     movimientos: así no se le quita una recepción a alguien que está
     cargándola ahora, ni se duplica una recepción a medias.
   ============================================================ */

/** Margen para no pisar una recepción que todavía está en curso. */
export const MINUTOS_PARA_RECUPERAR_RECEPCION = 15;

export interface EstadoRecepcionColgada {
  /** `recibida_en` tal como está en la base. */
  recibidaEn: string | null;
  /** Quién apartó la orden. */
  recibidaPor: string | null;
  /** Quién intenta recibir ahora. */
  actorEmail: string;
  /** Ya existe el evento «recibida» en el historial. */
  yaTermino: boolean;
  /** Ya hay entradas de stock a nombre de esta orden. */
  hayMovimientos: boolean;
  /** Reloj inyectable para probar sin esperar 15 minutos. */
  ahora?: number;
}

/**
 * ¿Se puede soltar la reserva y volver a apartar la orden?
 * Con `true` se limpian `recibida_en`/`recibida_por` y se reintenta.
 */
export function puedeRetomarRecepcionColgada(e: EstadoRecepcionColgada): boolean {
  if (!e.recibidaEn || e.yaTermino) return false;
  // La propia recepción se retoma siempre: es la que se cortó a mitad.
  if (e.recibidaPor === e.actorEmail) return true;
  // Otro usuario no puede tocar una recepción que ya movió mercadería.
  if (e.hayMovimientos) return false;
  const apartadaEn = Date.parse(e.recibidaEn);
  if (!Number.isFinite(apartadaEn)) return false;
  const ahora = e.ahora ?? Date.now();
  return ahora - apartadaEn >= MINUTOS_PARA_RECUPERAR_RECEPCION * 60 * 1000;
}
