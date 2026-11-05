/* ============================================================
   MGG · Cocina · Histórico de distribución (05-11-2026)

   Pedido de la administradora: cuando se reparte el mercado entre las cocinas y
   el resguardo, que quede un histórico con su reporte en PDF y su mensaje de
   WhatsApp. Cada reparto ya es un traslado de Salidas (TRA-…) con el motivo
   «Reparto del mercado #N de ORIGEN a DESTINO · nota»: acá se lee ese motivo y
   se arman los textos. Puro: no toca Supabase ni la pantalla. Los emojis van
   sin el selector U+FE0F (WhatsApp lo convierte en un cuadrito).
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';

export interface LineaRepartoHist {
  nombre: string;
  cantidad: number;
  unidad: string | null;
  /** Costo unitario con el que viajó (puede faltar). */
  precio: number | null;
}

export interface RepartoHist {
  id: string;
  codigo: string;
  estado: string;
  /** Cuándo se hizo el reparto (ISO). */
  fecha: string;
  ejecutadaEn: string | null;
  mercado: number | null;
  origen: string;
  destino: string;
  nota: string | null;
  quien: string | null;
  lineas: LineaRepartoHist[];
}

const RE_MOTIVO = /^Reparto del mercado #(\d+) de (.+?) a (.+?)(?: · (.*))?$/;

/** Lee «Reparto del mercado #4 de Los Pinos a Resguardo Matanzas · PARA MATANZA». null si no es un reparto. */
export function leerMotivoReparto(motivo: string | null | undefined): { mercado: number; origen: string; destino: string; nota: string | null } | null {
  const m = RE_MOTIVO.exec((motivo ?? '').trim());
  if (!m) return null;
  return { mercado: Number(m[1]), origen: m[2].trim(), destino: m[3].trim(), nota: m[4]?.trim() || null };
}

/** ¿El reparto toca esta cocina (sale de ella o le llega)? */
export function tocaCocina(r: Pick<RepartoHist, 'origen' | 'destino'>, cocina: string): boolean {
  const n = (s: string) => s.trim().toLowerCase();
  return n(r.origen) === n(cocina) || n(r.destino) === n(cocina);
}

export function valorReparto(r: Pick<RepartoHist, 'lineas'>): number {
  return Math.round(r.lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0) * 100) / 100;
}

const ESTADOS: Record<string, string> = {
  ejecutada: 'Entregado', aprobada: 'Aprobado · falta mover el stock', por_aprobar: 'Por aprobar',
  rechazada: 'Rechazado', cancelada: 'Cancelado', anulada: 'Anulado',
};
export const etiquetaEstadoReparto = (e: string) => ESTADOS[e] ?? e;

function num(n: number): string {
  return (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });
}
function usd(n: number): string {
  return `$${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** «05/11/2026 10:02 a. m.» en hora de Venezuela. */
export function fechaHoraReparto(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const f = d.toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' });
  const h = d.toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true });
  return `${f} ${h}`;
}
const unaLinea = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** El WhatsApp de UN reparto. */
export function mensajeReparto(r: RepartoHist): string {
  const L: string[] = [];
  L.push('🚚 *DISTRIBUCIÓN DE VÍVERES*');
  L.push(`🔹 *Traslado:* ${r.codigo}`);
  if (r.mercado != null) L.push(`🍲 *Mercado:* #${r.mercado}`);
  L.push(`📤 *De:* ${r.origen}`);
  L.push(`📥 *A:* ${r.destino}`);
  L.push(`📅 *Fecha:* ${fechaHoraReparto(r.fecha)}`);
  if (unaLinea(r.quien)) L.push(`👤 *Registró:* ${unaLinea(r.quien)}`);
  if (unaLinea(r.nota)) L.push(`📌 *Nota:* ${unaLinea(r.nota)}`);
  L.push('');
  L.push(`📦 *Víveres (${r.lineas.length}):*`);
  for (const l of r.lineas) L.push(`• ${unaLinea(l.nombre)} — ${num(l.cantidad)}${l.unidad ? ` ${l.unidad}` : ''}`);
  const v = valorReparto(r);
  L.push('');
  if (v > 0) L.push(`💵 *Valor:* ${usd(v)}`);
  L.push(`📊 *Estado:* *${etiquetaEstadoReparto(r.estado)}*`);
  L.push(`🏢 *${identidadEmpresa().nombre}*`);
  return L.join('\n');
}

/** El WhatsApp del histórico (varios repartos): uno por renglón y el total. */
export function mensajeHistoricoRepartos(rs: RepartoHist[], rango: { desde: string; hasta: string; cocina?: string | null }): string {
  const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
  const L: string[] = [];
  L.push('🚚 *HISTÓRICO DE DISTRIBUCIÓN*');
  if (rango.cocina) L.push(`🍲 *Cocina:* ${rango.cocina}`);
  L.push(`📅 *Del* ${dia(rango.desde)} *al* ${dia(rango.hasta)}`);
  L.push('');
  if (!rs.length) { L.push('Sin repartos en ese período.'); return L.join('\n'); }
  rs.forEach((r, i) => {
    const v = valorReparto(r);
    L.push(`${i + 1}. 🔹 *${r.codigo}* · ${fechaHoraReparto(r.fecha)}`);
    L.push(`    ${r.origen} ➡ ${r.destino} · ${r.lineas.length} víver(es)${v > 0 ? ` · ${usd(v)}` : ''} · ${etiquetaEstadoReparto(r.estado)}`);
  });
  const total = rs.reduce((a, r) => a + valorReparto(r), 0);
  L.push('');
  L.push(`💰 *Total (${rs.length} ${rs.length === 1 ? 'reparto' : 'repartos'}):* *${usd(total)}*`);
  L.push(`🏢 *${identidadEmpresa().nombre}*`);
  return L.join('\n');
}
