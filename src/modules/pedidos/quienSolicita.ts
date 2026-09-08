/* ============================================================
   MGG · Quién pide una orden, según su clase
   Los dos formularios guardan la persona en campos CRUZADOS, y
   por eso conviene un solo lugar que lo sepa:

     PRODUCTOS  ci_solicitante      = quién PIDE (el campo del formulario)
                solicitante_persona = quién CARGÓ la solicitud

     SERVICIOS  solicitante_persona = quién PIDE («Quién lo solicita»)
                ci_solicitante      = la cédula, un número

   Invertir la prioridad sin mirar la clase hace que los servicios
   muestren un número de cédula donde va un nombre.
   ============================================================ */
import { esServicioOrden } from './pedidos.repository';

type OrdenPersona = {
  clase?: string | null;
  codigo?: string | null;
  solicitante_persona?: string | null;
  ci_solicitante?: string | null;
  solicitante?: string | null;
  solicitante_email?: string | null;
};

const limpio = (v: string | null | undefined): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

/** El nombre de quien PIDE. `null` si la orden no lo tiene. */
export function quienSolicita(o: OrdenPersona | null | undefined): string | null {
  if (!o) return null;
  if (esServicioOrden(o)) return limpio(o.solicitante_persona) ?? limpio(o.ci_solicitante);
  return limpio(o.ci_solicitante) ?? limpio(o.solicitante_persona);
}

/**
 * El nombre de quien CARGÓ la solicitud, cuando aporta algo: si es la misma
 * persona que pide, no hay nada que aclarar y devuelve `null`.
 */
export function quienCargo(o: OrdenPersona | null | undefined): string | null {
  if (!o) return null;
  const cargo = limpio(o.solicitante_persona);
  if (!cargo) return null;
  const pide = quienSolicita(o);
  return pide && pide.toUpperCase() === cargo.toUpperCase() ? null : cargo;
}

/** Quién pide, y si no se sabe, lo mejor que haya para no dejar el hueco vacío. */
export function quienSolicitaConRespaldo(o: OrdenPersona | null | undefined, respaldo?: string | null): string {
  return quienSolicita(o) ?? limpio(o?.solicitante) ?? limpio(respaldo) ?? limpio(o?.solicitante_email) ?? '—';
}
