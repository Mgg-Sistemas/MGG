/* ============================================================
   Golden Touch · Compras · Resumen del reporte para WhatsApp
   (10/11/2026)

   La analítica del reporte de compras en texto puntual con emojis, para mandar
   por el chat sin abrir el sistema: totales del rango, por estado, el titular
   (departamento que más gastó), el top de ítems y la tasa BCV usada. Coherente
   con el aviso de Tesorería (con emojis).

   Respeta los interruptores maestros de moneda:
   - Solo $ : montos en dólares.
   - Solo Bs: montos en bolívares.
   - Ambos  : $ y su equivalente en Bs.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { ResumenReporteCompras } from './comprasMoldeable';

export interface OpcionesWhatsappCompras {
  desde: string;
  hasta: string;
  /** Respetan los interruptores maestros de moneda del reporte. */
  mostrarUsd?: boolean;
  mostrarBs?: boolean;
  /** Tasa BCV del día para mostrar. */
  tasaBcv?: number;
}

/** Número con separador de miles VE y dos decimales, sin símbolo. */
function num(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** dd/mm/aaaa a partir del ISO, sin depender de la zona horaria. */
function fechaCorta(iso: string): string {
  const [a, m, d] = (iso || '').slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : (iso || '').slice(0, 10);
}

/**
 * Arma el aviso de WhatsApp del reporte de Compras. Solo lee el resumen (ya
 * calculado por el motor); no vuelve a sumar.
 */
export function textoWhatsappCompras(resumen: ResumenReporteCompras, opts: OpcionesWhatsappCompras): string {
  const mostrarUsd = opts.mostrarUsd !== false;
  const mostrarBs = opts.mostrarBs !== false;
  const emp = identidadEmpresa('GT');

  /** Dinero según los interruptores de moneda. */
  const dinero = (usd: number, bs: number): string => {
    if (mostrarUsd && mostrarBs) return `$ ${num(usd)} · Bs ${num(bs)}`;
    if (mostrarUsd) return `$ ${num(usd)}`;
    return `Bs ${num(bs)}`;
  };

  const L: string[] = [];
  L.push(`🧾 *Reporte de Compras*`);
  L.push(`_${emp.nombre} · ${fechaCorta(opts.desde)} al ${fechaCorta(opts.hasta)}_`);
  if (opts.tasaBcv && opts.tasaBcv > 0) {
    L.push(`💱 _Tasa BCV: Bs ${num(opts.tasaBcv)} / $_`);
  }
  L.push('');

  L.push(`📊 *Total del rango (${resumen.totalCompras}):* ${dinero(resumen.totalUsd, resumen.totalBs)}`);
  L.push(`✅ *Finalizadas (${resumen.finalizadasCount}):* ${dinero(resumen.finalizadasUsd, resumen.finalizadasBs)}`);
  L.push(`⏳ *Pendientes (${resumen.pendientesCount}):* ${dinero(resumen.pendientesUsd, resumen.pendientesBs)}`);
  L.push(`💰 *Pagado:* ${dinero(resumen.pagadoUsd, resumen.pagadoBs)}`);

  if (resumen.deptoQueMasGasto) {
    const top = resumen.rankingDeptoGasto[0];
    L.push('');
    L.push(`🏆 *Departamento que más gastó:* ${resumen.deptoQueMasGasto} — ${dinero(top.usd, top.bs)}`);
    L.push(`   _(el ranking por departamento no incluye las compras directas)_`);
  }

  if (resumen.topItems.length) {
    const it = resumen.topItems[0];
    const cant = it.cantidad != null ? ` · ${num(it.cantidad)} u.` : '';
    L.push(`🔝 *Ítem más comprado:* ${it.nombre} — $ ${num(it.usd)}${cant}`);
  }

  if (resumen.comprasDirectasPorCategoriaGasto.length) {
    L.push('');
    L.push(`🧾 *Compras directas (por categoría de gasto):* ${dinero(resumen.totalDirectasUsd, resumen.totalDirectasBs)}`);
  }

  return L.join('\n');
}
