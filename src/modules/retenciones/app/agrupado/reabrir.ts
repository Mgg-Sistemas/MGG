/* ============================================================
   MGG · Retenciones v8 · Reabrir la retención para corregir la compra (lógica pura)

   La de la maqueta (v8-15-reabrir.js, R3-20; SQL 11b): la retención de IVA de
   una compra directa, finalizada (registrada) o declarada.
   - Finalizada: se reabre con motivo; la compra deja de estar finalizada y la
     retención queda «Reabierta, pendiente de revisar».
   - Declarada: primero se reabre el período.
   Al revisar se compara la compra con la que había al reabrir: sin cambios,
   se confirma; con cambios, se corrige con la regla de la última de su serie.
   ============================================================ */
import type { RetencionPracticada } from '../datos/puerta';

const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function reabrible(r: RetencionPracticada): boolean {
  return r.tipo === 'iva' && r.direccion === 'practicada' && r.docKind === 'compra_directa' && !r.anulada && (r.estado === 'registrada' || r.estado === 'declarada');
}

/** Lo que dice la casilla (sin reabrir). `periodoDeclarado`: el período ya se declaró. */
export function estadoCompra(r: RetencionPracticada, periodoDeclarado: boolean): string {
  return r.estado === 'declarada' || periodoDeclarado
    ? 'Declarada: para corregir la compra, primero se reabre el período'
    : 'Finalizada: lista para declarar. Compras no cambia el IVA, el % ni la moneda sin reabrirla';
}

export function validarMotivo(m: string): string | null {
  return m.trim() ? null : 'Pendiente: el motivo de la reapertura.';
}

export type TipoCorreccion = 'sitio' | 'sitio-ultima' | 'rehacer';

/** La regla de la última de su serie (la misma del recálculo). */
export function accionCorreccion(x: { numero: string; impresa: boolean; ultima: boolean; siguiente: string }): { tipo: TipoCorreccion; texto: string } {
  if (!x.impresa) return { tipo: 'sitio', texto: 'Se corrige con el mismo N° (todavía no se imprimió).' };
  if (x.ultima) return { tipo: 'sitio-ultima', texto: `Se corrige con el mismo N° ${x.numero}, porque es la última de su serie. Ya estaba impresa: se reimprime y se entrega de nuevo.` };
  return { tipo: 'rehacer', texto: `Ya estaba impresa y no es la última de su serie: el N° ${x.numero} se anula y se rehace con el N° ${x.siguiente}.` };
}

export interface FotoCompra { total: number; iva: number; moneda: string }

/** Lo que cambió la compra desde la reapertura. */
export function cambiosCompra(antes: FotoCompra, ahora: FotoCompra): string[] {
  const out: string[] = [];
  if (r2(antes.total) !== r2(ahora.total)) out.push(`total de ${fmt(antes.total)} a ${fmt(ahora.total)}`);
  if (r2(antes.iva) !== r2(ahora.iva)) out.push(`IVA de ${fmt(antes.iva)} a ${fmt(ahora.iva)}`);
  if ((antes.moneda || 'Bs') !== (ahora.moneda || 'Bs')) out.push(`moneda de ${antes.moneda || 'Bs'} a ${ahora.moneda || 'Bs'}`);
  return out;
}

export function botonRevisar(igual: boolean, tipo: TipoCorreccion): string {
  return igual ? 'Confirmar sin cambios' : tipo === 'rehacer' ? 'Anular y rehacer' : 'Registrar de nuevo';
}

export const ESTADOS_REABRIR: [string, string][] = [
  ['Finalizada:', 'registrada y lista para declarar. Se puede reabrir con motivo.'],
  ['Declarada:', 'el período ya se declaró. Para corregir la compra, primero se reabre el período.'],
];
