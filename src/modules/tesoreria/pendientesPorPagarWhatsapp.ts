/* ============================================================
   Golden Touch · Tesorería · «Pendientes por pagar» para WhatsApp
   El mismo reporte del PDF y del Excel, en texto con emojis para mandarlo por
   el chat: sirve para avisar qué hay que pagar, a quién y por dónde, sin abrir
   el sistema del otro lado.

   El formato es un acuerdo con quien lo lee en el teléfono: se fija con tests
   para que un cambio accidental se note aquí y no en el chat.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { ClaveSegmento, DatosPendientesPorPagar, FilaPendiente } from './pendientesPorPagar';

/** Emoji de cada segmento (uno distinto, de un vistazo). */
const EMOJI_SEGMENTO: Record<ClaveSegmento, string> = {
  compras_directas: '🛒',
  oc: '📄',
  servicios: '🔧',
  servicios_directos: '🧰',
  credito: '💳',
};

/** Emoji de cada método de pago, para ubicar «por dónde» sin leer. */
const EMOJI_METODO: Record<string, string> = {
  divisas_efectivo: '💵',
  efectivo_bs: '💵',
  transferencia: '🏦',
  pago_movil: '📱',
  binance_usdt: '🪙',
  zelle: '⚡',
  otro: '💳',
};

/** Número con separador de miles VE y dos decimales, sin símbolo. */
function num(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** dd/mm/aaaa a partir del ISO, sin depender de la zona horaria. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso.slice(0, 10);
}

/** «$12,00 · Bs 10.582,56». Sin tasa solo se conoce la moneda propia: no se inventa un 0. */
function montos(usd: number, bs: number, tasa: number): string {
  if (tasa > 0) return `$${num(usd)} · Bs ${num(bs)}`;
  const partes: string[] = [];
  if (usd > 0) partes.push(`$${num(usd)}`);
  if (bs > 0) partes.push(`Bs ${num(bs)}`);
  return partes.join(' · ') || '$0,00';
}

/** Un renglón: viñeta con código, proveedor y monto; debajo, estado y cómo se le paga. */
function lineasFila(f: FilaPendiente, tasa: number, credito: boolean): string[] {
  // El proveedor puede traer saltos de línea: en WhatsApp partirían la viñeta.
  const prov = f.proveedor.replace(/\s+/g, ' ').trim() || '—';
  const L = [`• *${f.codigo}* — ${prov} — *${montos(f.usd, f.bs, tasa)}*`];
  const emojiEstado = credito ? '🔁' : f.listaParaPagar ? '✅' : '⏳';
  L.push(`   ${emojiEstado} ${f.estado}`);
  for (const p of f.pagos) {
    L.push(`   ${EMOJI_METODO[p.metodo] ?? '💳'} ${p.texto.replace(/\s+/g, ' ').trim()}`);
  }
  return L;
}

export function textoPendientesPorPagarWhatsapp(d: DatosPendientesPorPagar): string {
  const L: string[] = [];
  L.push('🧾 *PENDIENTES POR PAGAR*');
  const emp = identidadEmpresa('MGG');
  L.push(`_${emp.nombre} · ${fechaCorta(d.generadoEn)}_`);
  if (d.tasa > 0) {
    L.push(`💱 _Tasa BCV: Bs ${num(d.tasa)} / $${d.tasaFecha ? ' · ' + fechaCorta(d.tasaFecha) : ''}_`);
  }

  if (!d.segmentos.length && !d.credito) {
    L.push('');
    L.push('No hay pendientes por pagar en este momento. ✅');
    return L.join('\n');
  }
  if (!d.segmentos.length) {
    L.push('');
    L.push('No hay pendientes por pagar inmediatos. Solo quedan cuentas a crédito abiertas. ✅');
  }

  for (const seg of d.segmentos) {
    L.push('');
    L.push(`${EMOJI_SEGMENTO[seg.clave]} *${seg.titulo} (${seg.filas.length})*`);
    for (const f of seg.filas) L.push(...lineasFila(f, d.tasa, false));
    L.push(`   _Subtotal: ${montos(seg.subUsd, seg.subBs, d.tasa)}_`);
  }

  if (d.segmentos.length) {
    L.push('');
    L.push(`💰 *TOTAL POR PAGAR:* ${d.totCant} ítem(s) · *${montos(d.totUsd, d.totBs, d.tasa)}*`);
  }

  // El crédito va aparte y FUERA del total: se salda por abonos en Tesorería.
  if (d.credito) {
    const c = d.credito;
    L.push('');
    L.push(`${EMOJI_SEGMENTO.credito} *${c.titulo} (${c.filas.length})*`);
    L.push('   _No entran en el total de arriba; se saldan por abonos._');
    for (const f of c.filas) L.push(...lineasFila(f, d.tasa, true));
    L.push(`   _Total a crédito: ${montos(c.subUsd, c.subBs, d.tasa)}_`);
  }
  return L.join('\n');
}
