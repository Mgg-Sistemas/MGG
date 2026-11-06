/* ============================================================
   Golden Touch · Tesorería · Resumen del reporte para WhatsApp
   (02/11/2026 - actualizado 06/11/2026)

   La misma información del reporte (movimientos, pendientes por pagar o
   cuentas a crédito), en texto PUNTUAL para mandarla por el chat sin abrir el
   sistema del otro lado: un ítem por renglón con su monto, método de pago
   asociado, y al final el resumen por método y total consolidado.

   Alineado con los interruptores de moneda:
   - Solo Bolívares (Bs): se expresa en Bs (sin dólares).
   - Solo Dólares ($): se expresa en $ USD (a tasa BCV).
   - Ambos (Bs y $): muestra monto nativo y su equivalente.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { AmbitoTesoreria, FilaReporteTesoreria, TipoFlujoTesoreria } from './reporteTesoreriaMoldeable';
import { generarBloquesPreparacion, type PreparacionPorPagar } from './pendientesPorPagar';

/** Emoji de encabezado por ámbito (uno distinto, de un vistazo). */
const EMOJI_AMBITO: Record<AmbitoTesoreria, string> = {
  movimientos: '📊',
  por_pagar: '🧾',
  creditos_cartera: '🤝',
};

/** Nombre corto de cada ámbito para el encabezado. */
const TITULO_AMBITO: Record<AmbitoTesoreria, string> = {
  movimientos: 'Movimientos de caja',
  por_pagar: 'Pendientes por pagar',
  creditos_cartera: 'Cuentas a crédito (cartera)',
};

/** Marcador de cada renglón según el tipo de flujo: a dónde va o de dónde viene la plata. */
const EMOJI_FLUJO: Record<TipoFlujoTesoreria, string> = {
  egreso: '🔻',
  ingreso: '🔺',
  traslado: '🔁',
};

/** Tope de ítems listados: más allá, el mensaje dejaría de ser puntual. */
const LIMITE_ITEMS = 40;

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
  /** Respetan los interruptores maestros de moneda del reporte. */
  mostrarUsd?: boolean;
  mostrarBs?: boolean;
  /** Tasa oficial BCV de la jornada para conversiones. */
  tasaRef?: number;
  /** «Por preparar» (solo por_pagar, si el toggle está encendido): totales nativos por moneda/método. */
  preparacion?: PreparacionPorPagar;
}

/**
 * Arma el aviso de WhatsApp para un ámbito del reporte de Tesorería.
 * Cada renglón es un ítem con su código, proveedor, monto formateado según la
 * moneda seleccionada, datos de pago y al final el resumen y total consolidado.
 */
export function textoWhatsappTesoreria(filas: FilaReporteTesoreria[], opts: OpcionesWhatsappTesoreria): string {
  const mostrarUsd = opts.mostrarUsd !== false;
  const mostrarBs = opts.mostrarBs !== false;
  const soloUsd = mostrarUsd && !mostrarBs;
  const soloBs = !mostrarUsd && mostrarBs;
  const emp = identidadEmpresa('MGG');

  const L: string[] = [];
  L.push(`${EMOJI_AMBITO[opts.ambito]} *Reporte de Tesorería — ${TITULO_AMBITO[opts.ambito]}*`);
  L.push(`_${emp.nombre} · ${fechaCorta(opts.desde)} al ${fechaCorta(opts.hasta)}_`);
  if (opts.tasaRef && opts.tasaRef > 0) {
    L.push(`💱 _Tasa BCV: Bs ${num(opts.tasaRef)} / $_`);
  }
  L.push('');

  if (!filas.length) {
    L.push('Sin registros en este ámbito. ✅');
    return L.join('\n');
  }

  filas.slice(0, LIMITE_ITEMS).forEach((f, i) => {
    const enBs = (f.moneda_original || '').toUpperCase() === 'BS';
    let montoTxt = '';

    if (soloUsd) {
      montoTxt = `$ ${num(f.monto_usd || 0)}`;
    } else if (soloBs) {
      montoTxt = `Bs ${num(f.monto_bs || 0)}`;
    } else {
      // Ambos
      if (enBs) {
        const eq = f.monto_usd ? ` ($ ${num(f.monto_usd)})` : '';
        montoTxt = `Bs ${num(f.monto_original)}${eq}`;
      } else {
        const eq = f.monto_bs ? ` (Bs ${num(f.monto_bs)})` : '';
        const pref = (f.moneda_original || '').toUpperCase() === 'USD' ? '$' : f.moneda_original;
        montoTxt = `${pref} ${num(f.monto_original)}${eq}`;
      }
    }

    const cod = f.codigo && f.codigo.trim() && f.codigo !== '—' ? `${f.codigo.trim()} · ` : '';
    L.push(`${i + 1}. ${EMOJI_FLUJO[f.tipo_movimiento]} ${cod}${etiquetaFila(f)} — *${montoTxt}*`);

    const textoPago = unaLinea(f.datos_pago_resumen || f.metodo_pago);
    if (textoPago && textoPago !== '—') {
      const pLower = textoPago.toLowerCase();
      const emojiMetodo = pLower.includes('móvil') || pLower.includes('movil') ? '📱'
        : pLower.includes('transferencia') ? '🏦'
        : pLower.includes('zelle') ? '⚡'
        : pLower.includes('efectivo') ? '💵'
        : pLower.includes('binance') ? '🪙'
        : '💳';
      L.push(`   ${emojiMetodo} ${textoPago}`);
    } else if (f.estado && f.estado !== '—') {
      const emojiEst = f.estado.toLowerCase().includes('lista') ? '✅' : '⏳';
      L.push(`   ${emojiEst} ${f.estado}`);
    }
  });

  if (filas.length > LIMITE_ITEMS) {
    L.push(`… (+${filas.length - LIMITE_ITEMS} ítem(s) más)`);
  }

  // «Por preparar» (solo por_pagar, con el toggle encendido)
  const prep = opts.preparacion;
  if (opts.ambito === 'por_pagar' && prep) {
    const prepRes = generarBloquesPreparacion(prep, opts.tasaRef || 0, { mostrarUsd, mostrarBs });
    if (prepRes.bloques.length > 0 || prepRes.sinMetodoTexto) {
      L.push('');
      L.push('📋 *Resumen de pagos por método:*');
      for (const b of prepRes.bloques) {
        const em = b.esDivisa ? '💵' : '🪙';
        L.push(`${em} *${b.etiqueta}: ${b.totalTexto} (${b.nOrdenes} pago${b.nOrdenes === 1 ? '' : 's'})*`);
        for (const m of b.metodos) {
          L.push(`   • ${m.label}: ${m.montoTexto} · ${m.nOrdenes} op.`);
        }
      }
      if (prepRes.sinMetodoTexto) {
        L.push(`⏳ _${prepRes.sinMetodoTexto}_`);
      }
    }
  }

  // Total consolidado
  let totUsd = 0;
  let totBs = 0;
  for (const f of filas) { totUsd += f.monto_usd || 0; totBs += f.monto_bs || 0; }
  const partes: string[] = [];
  if (soloUsd) {
    partes.push(`$ ${num(totUsd)}`);
  } else if (soloBs) {
    partes.push(`Bs ${num(totBs)}`);
  } else {
    if (mostrarUsd) partes.push(`$ ${num(totUsd)}`);
    if (mostrarBs) partes.push(`Bs ${num(totBs)}`);
  }

  L.push('');
  L.push(`💰 *Total consolidado (${filas.length}):* ${partes.join(' · ')}`);
  return L.join('\n');
}
