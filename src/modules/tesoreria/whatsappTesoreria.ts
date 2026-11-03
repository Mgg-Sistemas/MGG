/* ============================================================
   MGG · Tesorería · Resumen del reporte para WhatsApp (03-11-2026)
   Traído de Golden Touch (whatsappTesoreria.ts, 02-11-2026).

   La misma información del reporte (movimientos, pendientes por pagar o
   cuentas a crédito) en texto PUNTUAL para mandarlo por el chat: un ítem por
   renglón con su monto en la moneda propia y, al final, el total consolidado
   en $ y Bs.

   Emojis SIN el selector U+FE0F (WhatsApp se lo come y llega un cuadrito):
   uno de encabezado por ámbito, un marcador por renglón según el flujo
   (egreso/ingreso/traslado) y 💰 en el total.

   Builder PURO sobre las filas ya normalizadas: no toca Supabase ni la
   pantalla; el formato lo fija su prueba. Nada se manda solo: el texto se
   comparte con el botón de CompartirWhatsapp.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { AmbitoTesoreria, FilaReporteTesoreria, TipoFlujoTesoreria } from './reporteTesoreriaMoldeable';

/** Emoji de encabezado por ámbito. */
const EMOJI_AMBITO: Record<AmbitoTesoreria, string> = {
  movimientos: '📊',
  por_pagar: '🧾',
  creditos_cartera: '🤝',
};

/** Nombre corto de cada ámbito para el encabezado. */
export const TITULO_AMBITO_WHATSAPP: Record<AmbitoTesoreria, string> = {
  movimientos: 'Movimientos de caja',
  por_pagar: 'Pendientes por pagar',
  creditos_cartera: 'Cuentas a crédito (cartera)',
};

/** Marcador de cada renglón según el tipo de flujo. */
const EMOJI_FLUJO: Record<TipoFlujoTesoreria, string> = {
  egreso: '🔻',
  ingreso: '🔺',
  traslado: '🔁',
};

/** Tope de ítems listados: más allá, el mensaje dejaría de ser puntual. */
export const LIMITE_ITEMS_WHATSAPP = 40;

/** Número con separador de miles VE y dos decimales, sin símbolo. */
function num(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** dd/mm/aaaa a partir del ISO, sin depender de la zona horaria. */
function fechaCorta(iso: string): string {
  const [a, m, d] = (iso || '').slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : (iso || '').slice(0, 10);
}

/** Texto a una sola línea (en el chat un salto partiría el renglón). */
function unaLinea(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Quién/qué es la fila: proveedor o cliente si lo hay; si no, categoría; si no, concepto. */
function etiquetaFila(f: FilaReporteTesoreria): string {
  const prov = unaLinea(f.contraparte);
  if (prov && prov !== '—') return prov;
  return unaLinea(f.categoria) || unaLinea(f.concepto) || '—';
}

export interface OpcionesWhatsappTesoreria {
  ambito: AmbitoTesoreria;
  desde: string;
  hasta: string;
  /** Respetan los interruptores maestros de moneda del reporte (al menos uno activo). */
  mostrarUsd?: boolean;
  mostrarBs?: boolean;
}

/**
 * Arma el aviso de WhatsApp para un ámbito del reporte de Tesorería.
 * Cada renglón es un ítem con su monto en la moneda propia; el total es
 * consolidado y BRUTO (suma de los equivalentes de todas las filas en $ y Bs).
 */
export function textoWhatsappTesoreria(filas: FilaReporteTesoreria[], opts: OpcionesWhatsappTesoreria): string {
  const mostrarUsd = opts.mostrarUsd !== false;
  const mostrarBs = opts.mostrarBs !== false;
  const emp = identidadEmpresa();

  const L: string[] = [];
  L.push(`${EMOJI_AMBITO[opts.ambito]} *Reporte de Tesorería — ${TITULO_AMBITO_WHATSAPP[opts.ambito]}*`);
  L.push(`_${emp.nombre} · ${fechaCorta(opts.desde)} al ${fechaCorta(opts.hasta)}_`);
  L.push('');

  if (!filas.length) {
    L.push('Sin registros en este ámbito. ✅');
    return L.join('\n');
  }

  filas.slice(0, LIMITE_ITEMS_WHATSAPP).forEach((f, i) => {
    L.push(`${i + 1}. ${EMOJI_FLUJO[f.tipo_movimiento]} ${etiquetaFila(f)} — *${f.moneda_original} ${num(f.monto_original)}*`);
  });
  if (filas.length > LIMITE_ITEMS_WHATSAPP) {
    L.push(`… (+${filas.length - LIMITE_ITEMS_WHATSAPP} ítem(s) más)`);
  }

  // Total consolidado y bruto: suma de los equivalentes de TODAS las filas,
  // aunque mezclen monedas (USDT 1:1 con USD; Bs por la tasa aplicada en cada fila).
  let totUsd = 0;
  let totBs = 0;
  for (const f of filas) { totUsd += f.monto_usd || 0; totBs += f.monto_bs || 0; }
  const partes: string[] = [];
  if (mostrarUsd) partes.push(`$ ${num(totUsd)}`);
  if (mostrarBs) partes.push(`Bs ${num(totBs)}`);

  L.push('');
  L.push(`💰 *Total (${filas.length}):* ${partes.join(' · ')}`);
  return L.join('\n');
}
