/* ============================================================
   Golden Touch · Retenciones · Impuestos y reglas: piezas puras de pantalla (R2)
   ============================================================ */
import { PERIODICIDADES, type CambioHistorial, type VersionImpuesto } from './impuestos.repository';
import { nombreColumna } from './erroresRetencion';
import { rotuloAutor, rotuloMotivo, rotuloTablaHistorial } from './rotulos';

const etiqueta = <K extends string>(xs: { key: K; label: string }[], k: K) => xs.find((x) => x.key === k)?.label ?? k;

/** «Mensual · vence el 15 · entrega en 2 días hábiles». */
export function resumenVersion(v: VersionImpuesto | null): string {
  if (!v) return 'Sin versión';
  const partes = [etiqueta(PERIODICIDADES, v.periodicidad)];
  if (v.venceDia) partes.push(`vence el día ${v.venceDia}`);
  partes.push(`entrega en ${v.plazoEntregaDias} día${v.plazoEntregaDias === 1 ? '' : 's'}${v.plazoDiasHabiles ? ' hábiles' : ''}`);
  if (v.convive) partes.push(`convive con ${v.otroSistemaNombre ?? 'otro sistema'}`);
  return partes.join(' · ');
}

/** Columnas que lleva cualquier cambio y no le dicen nada a quien lee el historial. */
const SIN_INTERES = new Set(['created_at', 'updated_at', 'id', 'actualizado_por', 'actualizado_en', 'creado_por', 'creado_en']);

/** « · cambió: el nombre, la fecha «desde»»: qué campos cambiaron, en palabras (nunca «serie_inicial»). */
export function cambiosTexto(h: Pick<CambioHistorial, 'antes' | 'despues'>): string {
  if (!h.antes || !h.despues) return '';
  const campos = Object.keys(h.despues).filter((k) => !SIN_INTERES.has(k) && JSON.stringify(h.antes?.[k]) !== JSON.stringify(h.despues?.[k]));
  return campos.length ? ` · cambió: ${campos.map(nombreColumna).join(', ')}` : '';
}

/** Un renglón del historial, en palabras: qué cambió (la tabla), quién y por qué (lo sembrado se dice «carga inicial»). */
export function lineaHistorial(h: { tabla?: string | null; actor: string | null; motivo: string | null }): { que: string | null; quien: string; motivo: string } {
  return {
    que: h.tabla ? rotuloTablaHistorial(h.tabla) : null,
    quien: rotuloAutor(h.actor),
    motivo: rotuloMotivo(h.motivo) || 'Sin motivo',
  };
}
