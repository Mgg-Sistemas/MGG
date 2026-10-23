/* Golden Touch · Retenciones · «Se leyó …» bajo un monto escrito a mano (D41): muestra cómo se entendió
   el número cuando lleva punto o coma; si no se entiende, lo dice. */
import { textoLeido } from './validarCarga';

export function SeLeyo({ texto, decimales = 2 }: { texto: string; decimales?: number }) {
  if (!/[.,]/.test(texto ?? '')) return null;
  const leido = textoLeido(texto, decimales);
  return leido == null
    ? <small className="hint" style={{ color: 'var(--danger)' }}>No se entiende: escribe 1.234,56 o 1234,56.</small>
    : <small className="hint muted">Se leyó {leido}</small>;
}
