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

export type OrdenPersona = {
  clase?: string | null;
  codigo?: string | null;
  solicitante_persona?: string | null;
  ci_solicitante?: string | null;
  solicitante?: string | null;
  solicitante_email?: string | null;
  oc_creada_por?: string | null;
  oc_creada_en?: string | null;
  aprobada_por?: string | null;
  aprobada_en?: string | null;
  created_at?: string | null;
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

/**
 * El nombre del ANALISTA que realizó o gestionó la solicitud (para la firma de la OC y reportes).
 * NUNCA devuelve a quien pide (el solicitante) ni la unidad solicitante.
 *
 * En PRODUCTOS:
 *   - `solicitante_persona` guarda a quien CARGÓ la solicitud en Compras (ej: NAZARET SALAZAR).
 *   - Si coincide con quien pide o falta, busca por correo resuelto (`oc_creada_por`, `aprobada_por`, `solicitante_email`).
 *
 * En SERVICIOS:
 *   - `solicitante_persona` es quien PIDE el servicio, por lo que NO se usa como analista.
 *   - Se busca el analista en los correos resueltos (`oc_creada_por`, `aprobada_por`, `solicitante_email`).
 */
export function analistaDeOrden(
  o: OrdenPersona | null | undefined,
  resolverPersona?: (email?: string | null, fecha?: string | null) => string | null | undefined,
): string {
  if (!o) return 'Analista de Compras';

  const pide = quienSolicita(o);
  const esDistintoDePide = (nombre: string | null | undefined): boolean => {
    const n = limpio(nombre);
    if (!n) return false;
    if (pide && n.toUpperCase() === pide.toUpperCase()) return false;
    return true;
  };

  const resolver = (email?: string | null, fecha?: string | null): string | null => {
    const e = limpio(email);
    if (!e) return null;
    if (!resolverPersona) return e.includes('@') ? null : e;
    const res = limpio(resolverPersona(e, fecha));
    if (!res || res === '—' || res === '-') return null;
    return res.includes('@') ? null : res;
  };

  const esServicio = esServicioOrden(o);

  if (!esServicio) {
    // 1. En productos, solicitante_persona es la persona que cargó la orden (el analista)
    const cargo = limpio(o.solicitante_persona);
    if (cargo && esDistintoDePide(cargo)) return cargo;
  }

  // 2. Analista que creó la OC
  const creadorOc = resolver(o.oc_creada_por, o.oc_creada_en);
  if (creadorOc && esDistintoDePide(creadorOc)) return creadorOc;

  // 3. Analista que aprobó la solicitud
  const aprobador = resolver(o.aprobada_por, o.aprobada_en);
  if (aprobador && esDistintoDePide(aprobador)) return aprobador;

  // 4. Analista que registró la solicitud (solicitante_email resuelto a persona)
  const creadorSolicitud = resolver(o.solicitante_email, o.created_at);
  if (creadorSolicitud && esDistintoDePide(creadorSolicitud)) return creadorSolicitud;

  // 5. En productos, si solicitante_persona existe (incluso si no había con quién contrastarlo)
  if (!esServicio) {
    const cargo = limpio(o.solicitante_persona);
    if (cargo) return cargo;
  }

  return 'Analista de Compras';
}
