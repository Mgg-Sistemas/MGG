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
  /** Si se indica en false, omite el bloque de cuentas a crédito de Compras (por defecto true). */
  incluirCreditos?: boolean;
  /** Muestra la línea de 0 pendientes cuando no hay cuentas a crédito abiertas. */
  mostrarCeroCreditos?: boolean;
  /** Cuando el ámbito es `creditos`: el mensaje es exclusivamente de las OC y OS con cuenta a crédito. */
  soloCreditos?: boolean;
}

const MAX_CREDITOS_WSP = 30;

function unaLinea(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
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
  const emp = identidadEmpresa();

  /** Dinero según los interruptores de moneda. */
  const dinero = (usd: number, bs: number): string => {
    if (mostrarUsd && mostrarBs) return `$ ${num(usd)} · Bs ${num(bs)}`;
    if (mostrarUsd) return `$ ${num(usd)}`;
    return `Bs ${num(bs)}`;
  };

  const L: string[] = [];
  if (opts.soloCreditos) {
    const creditos = resumen.cuentasCredito ?? [];
    L.push(`💳 *Reporte de Cuentas a Crédito · OC y OS*`);
    L.push(`_${emp.nombre} · ${fechaCorta(opts.desde)} al ${fechaCorta(opts.hasta)}_`);
    if (opts.tasaBcv && opts.tasaBcv > 0) {
      L.push(`💱 _Tasa BCV: Bs ${num(opts.tasaBcv)} / $_`);
    }
    L.push('');
    if (!creditos.length) {
      L.push(`🧾 *CUENTAS A CRÉDITO (OC Y OS) PENDIENTES: 0*`);
      L.push(`✅ *SIN CUENTAS A CRÉDITO ABIERTAS EN COMPRAS*`);
      return L.join('\n');
    }
    L.push(`📊 *Cuentas abiertas (${resumen.creditosCount}):* OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount}`);
    L.push(`🧾 *Monto original:* ${dinero(resumen.creditosTotalUsd, resumen.creditosTotalBs)}`);
    L.push(`✅ *Abonado:* ${dinero(resumen.creditosAbonadoUsd, resumen.creditosAbonadoBs)}`);
    L.push(`💰 *Saldo pendiente:* *${dinero(resumen.creditosSaldoUsd, resumen.creditosSaldoBs)}*`);
    L.push('');
    const visibles = creditos.slice(0, MAX_CREDITOS_WSP);
    visibles.forEach((c, idx) => {
      const em = c.tipo === 'OS' ? '🔧' : '📦';
      const prov = unaLinea(c.proveedor) && unaLinea(c.proveedor) !== '—' ? ` · ${unaLinea(c.proveedor)}` : '';
      const tieneAbono = (c.abonado_usd || 0) > 0.009 || (c.abonado_bs || 0) > 0.009;
      const abonoTxt = tieneAbono
        ? ` _(abonado ${dinero(c.abonado_usd, c.abonado_bs)} de ${dinero(c.total_usd, c.total_bs)})_`
        : '';
      L.push(`${idx + 1}. ${em} *[${c.tipo}] ${unaLinea(c.codigo) || '—'}*${prov} — *Saldo:* ${dinero(c.saldo_usd, c.saldo_bs)}${abonoTxt}`);
    });
    if (creditos.length > visibles.length) {
      L.push(`   _… y ${creditos.length - visibles.length} cuenta(s) más en el PDF_`);
    }
    return L.join('\n');
  }

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

  const incluirCred = opts.incluirCreditos !== false;
  const creditos = resumen.cuentasCredito ?? [];
  if (incluirCred && creditos.length > 0) {
    L.push('');
    L.push(`💳 *Cuentas a crédito Compras · OC y OS (${resumen.creditosCount}):* ${dinero(resumen.creditosSaldoUsd, resumen.creditosSaldoBs)}`);
    L.push(`   _OC: ${resumen.creditosOcCount} · OS: ${resumen.creditosOsCount} · Abonado: ${dinero(resumen.creditosAbonadoUsd, resumen.creditosAbonadoBs)} de ${dinero(resumen.creditosTotalUsd, resumen.creditosTotalBs)}_`);
    const visibles = creditos.slice(0, MAX_CREDITOS_WSP);
    visibles.forEach((c, idx) => {
      const em = c.tipo === 'OS' ? '🔧' : '📦';
      const prov = unaLinea(c.proveedor) && unaLinea(c.proveedor) !== '—' ? ` · ${unaLinea(c.proveedor)}` : '';
      const tieneAbono = (c.abonado_usd || 0) > 0.009 || (c.abonado_bs || 0) > 0.009;
      const abonoTxt = tieneAbono
        ? ` _(abonado ${dinero(c.abonado_usd, c.abonado_bs)} de ${dinero(c.total_usd, c.total_bs)})_`
        : '';
      L.push(`${idx + 1}. ${em} *[${c.tipo}] ${unaLinea(c.codigo) || '—'}*${prov} — *Saldo:* ${dinero(c.saldo_usd, c.saldo_bs)}${abonoTxt}`);
    });
    if (creditos.length > visibles.length) {
      L.push(`   _… y ${creditos.length - visibles.length} cuenta(s) más en el PDF_`);
    }
  } else if (incluirCred && opts.mostrarCeroCreditos) {
    L.push('');
    L.push(`💳 *Cuentas a crédito Compras · OC y OS:* 0 pendientes ✅`);
  }

  return L.join('\n');
}
