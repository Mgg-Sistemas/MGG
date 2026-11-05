/* ============================================================
   MGG · Inventario · Resumen del reporte para WhatsApp · Matanzas (04-11-2026)

   La misma información del reporte dinámico de Matanzas en texto
   PUNTUAL para compartir por chat directivo y grupos operativos:
   resumen de métricas clave, subalmacenes incluidos, stock,
   valuaciones, alertas críticas y detalle resumido.

   Builder PURO sobre las filas ya filtradas y su resumen.
   ============================================================ */

import type {
  AmbitoInventarioMatanzas,
  FilaReporteMatanzas,
  ModoAgrupacionMatanzas,
  ResumenReporteMatanzas,
} from './reporteInventarioMatanzasDinamico';
import {
  AMBITOS_INVENTARIO_MATANZAS,
  fmtMonedaUsd,
  fmtMonedaBs,
  fmtNum,
  fmtPesoKg,
} from './reporteInventarioMatanzasDinamico';

export interface ParametrosWhatsappMatanzas {
  ambito: AmbitoInventarioMatanzas;
  agrupacion: ModoAgrupacionMatanzas;
  subalmacenesTexto: string;
  columnasClaves?: string[];
  resumen: ResumenReporteMatanzas;
  filas: FilaReporteMatanzas[];
  desde?: string;
  hasta?: string;
}

export function textoWhatsappMatanzas(p: ParametrosWhatsappMatanzas): string {
  const lineas: string[] = [];

  const ahora = new Date().toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const ambitoMeta = AMBITOS_INVENTARIO_MATANZAS.find((a) => a.id === p.ambito);
  const tieneCol = (clave: string) => !p.columnasClaves || p.columnasClaves.includes(clave);

  lineas.push(`📦 *REPORTE DINÁMICO · MATANZAS*`);
  lineas.push(`🏭 *Sede:* CENTRO DE FUNDICION - MATANZAS`);
  lineas.push(`📍 *Ámbito:* ${ambitoMeta?.label || p.ambito.toUpperCase()}`);
  lineas.push(`📅 *Fecha:* ${ahora}`);
  if (p.desde || p.hasta) {
    lineas.push(`⏱ *Período:* ${p.desde || 'Inicio'} al ${p.hasta || 'Hoy'}`);
  }
  lineas.push(`🏢 *Subalmacenes:* ${p.subalmacenesTexto}`);
  lineas.push(`💵 *Tasa BCV:* ${p.resumen.tasaBcv} Bs/$`);
  lineas.push('');

  lineas.push('📊 *MÉTRICAS CLAVE:*');
  lineas.push(`• Total Registros: ${p.resumen.totalRegistros}`);

  if (p.ambito === 'casiterita') {
    if (tieneCol('peso_seco')) {
      lineas.push(`• Peso Seco Mineral: ${fmtPesoKg(p.resumen.pesoSecoKg)}`);
    }
    if (tieneCol('peso_puro_sn')) {
      lineas.push(`• Estaño Fino Puro (Sn): ${fmtPesoKg(p.resumen.pesoPuroSnKg)}`);
    }
    if (tieneCol('valor_usd')) {
      lineas.push(`• Valuación Mineral: ${fmtMonedaUsd(p.resumen.valuacionTotalUsd)} (Equiv. ${fmtMonedaBs(p.resumen.valuacionTotalBs)})`);
    }
  } else if (p.ambito === 'movimientos') {
    if (tieneCol('cantidad')) {
      lineas.push(`• Unidades Movidas: ${fmtNum(p.resumen.totalUnidades)}`);
      lineas.push(`• Entradas: ${p.resumen.entradasCount} · Salidas/Traslados: ${p.resumen.salidasCount}`);
    }
    if (tieneCol('costo_total')) {
      lineas.push(`• Total Transacciones: ${fmtMonedaUsd(p.resumen.valuacionTotalUsd)}`);
    }
  } else {
    // stock / criticos
    if (tieneCol('stock')) {
      lineas.push(`• Unidades en Stock: ${fmtNum(p.resumen.totalUnidades)}`);
    }
    if (tieneCol('valor_usd')) {
      lineas.push(`• Valuación Total: ${fmtMonedaUsd(p.resumen.valuacionTotalUsd)} (Equiv. ${fmtMonedaBs(p.resumen.valuacionTotalBs)})`);
    }
    if (tieneCol('minimo')) {
      lineas.push(`• Alertas de Stock Crítico: ${p.resumen.articulosCriticos}`);
      lineas.push(`• Existencias en $0 (sin costo): ${p.resumen.articulosSinCosto}`);
    }
  }

  lineas.push('');

  // Muestra de los primeros 10 registros
  if (p.filas.length > 0) {
    lineas.push(`📋 *DETALLE RESUMIDO (${Math.min(p.filas.length, 10)} de ${p.filas.length}):*`);
    p.filas.slice(0, 10).forEach((f, idx) => {
      if (p.ambito === 'casiterita') {
        lineas.push(`${idx + 1}. *${f.precinto_lote}* (${f.procedencia}): ${fmtPesoKg(f.peso_seco)} · Ley: ${f.ley_sn_pct}% · ${fmtMonedaUsd(f.valor_usd)}`);
      } else if (p.ambito === 'movimientos') {
        lineas.push(`${idx + 1}. *${f.tipo}* [${f.fecha}]: ${f.sku} - ${f.nombre} (${f.cantidad} ${f.unidad}) ➔ ${f.destino}`);
      } else {
        lineas.push(`${idx + 1}. *${f.sku}* - ${f.nombre}: ${fmtNum(f.stock)} ${f.unidad} | ${fmtMonedaUsd(f.valor_usd)} [${f.almacen}]`);
      }
    });

    if (p.filas.length > 10) {
      lineas.push(`_... y ${p.filas.length - 10} registros más en el informe oficial PDF/Excel._`);
    }
  } else {
    lineas.push('_No se encontraron registros con los filtros seleccionados._');
  }

  lineas.push('');
  lineas.push('Generado desde *MGG · Sistema de Gestión*');

  return lineas.join('\n');
}

