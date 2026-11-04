/* ============================================================
   MGG · RRHH · Resumen del reporte para WhatsApp (04-11-2026)

   La misma información del reporte dinámico de RRHH en texto PUNTUAL
   para mandarlo por chat directivo: resumen de métricas clave, empresas
   incluidas, estadísticas de carga familiar y totales salariales.

   Builder PURO sobre las filas ya procesadas y su resumen.
   ============================================================ */

import type {
  AmbitoRrhh,
  FilaReporteRrhh,
  ResumenReporteRrhh,
  ModoAgrupacionRrhh,
} from './reporteRrhhDinamico';
import { fmtMonedaUsd, fmtNum2, fmtPct } from './reporteRrhhDinamico';

export interface ParametrosWhatsappRrhh {
  ambito: AmbitoRrhh;
  agrupacion: ModoAgrupacionRrhh;
  empresasTexto: string;
  resumen: ResumenReporteRrhh;
  filas: FilaReporteRrhh[];
  desde?: string;
  hasta?: string;
}

export function textoWhatsappRrhh(p: ParametrosWhatsappRrhh): string {
  const lineas: string[] = [];

  const ahora = new Date().toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (p.ambito === 'historico_salarial') {
    lineas.push('📜 *REPORTE DE HISTÓRICO SALARIAL · MGG*');
    lineas.push(`📅 Generado: ${ahora}`);
    if (p.desde || p.hasta) {
      lineas.push(`⏱ Período: ${p.desde || 'Inicio'} al ${p.hasta || 'Hoy'}`);
    }
    lineas.push(`🏢 Empresas: ${p.empresasTexto}`);
    lineas.push('');
    lineas.push('📊 *MÉTRICAS CLAVE:*');
    lineas.push(`• Total Cambios Registrados: ${p.resumen.totalCambiosSueldo}`);
    lineas.push(`• Personas con Ajustes: ${p.resumen.totalPersonas}`);
    lineas.push(`• Incremento Total de Nómina: ${fmtMonedaUsd(p.resumen.incrementoTotalUsd)} / mes`);
    lineas.push(`• Ajuste Porcentual Promedio: ${fmtPct(p.resumen.promedioAumentoPct)}`);
    lineas.push(`• Masa Salarial Actual: ${fmtMonedaUsd(p.resumen.masaSalarialUsd)} / mes`);
    lineas.push('');

    if (p.filas.length > 0) {
      lineas.push(`📋 *DETALLE (${Math.min(p.filas.length, 15)} de ${p.filas.length}):*`);
      p.filas.slice(0, 15).forEach((f, idx) => {
        if (f.esGrupo) {
          lineas.push(`${idx + 1}. *${f.nombreCompleto}*: +${fmtMonedaUsd(f.variacionUsd || 0)} (${f.totalPersonas} pers.)`);
        } else {
          lineas.push(
            `${idx + 1}. *${f.nombreCompleto}* (${f.cargo}): ${fmtMonedaUsd(f.sueldoAnterior || 0)} ➔ *${fmtMonedaUsd(f.sueldoNuevo || 0)}* (+${fmtPct(f.variacionPct || 0)})`,
          );
        }
      });
      if (p.filas.length > 15) lineas.push(`_... y ${p.filas.length - 15} registros más en el informe completo._`);
    }
  } else if (p.ambito === 'historico_cargos') {
    lineas.push('💬 *REPORTE DE TABULADOR Y CARGOS · MGG*');
    lineas.push(`📅 Generado: ${ahora}`);
    lineas.push('');
    lineas.push('📊 *MÉTRICAS CLAVE:*');
    lineas.push(`• Cargos Registrados: ${p.resumen.totalRegistros}`);
    lineas.push(`• Costo Mensual Proyectado: ${fmtMonedaUsd(p.resumen.masaSalarialUsd)}`);
    lineas.push(`• Sueldo Promedio por Cargo: ${fmtMonedaUsd(p.resumen.sueldoPromedioUsd)}`);
    lineas.push('');

    lineas.push('💼 *TOP CARGOS:*');
    p.resumen.topCargos.forEach((c, idx) => {
      lineas.push(`${idx + 1}. *${c.nombre}*: ${fmtMonedaUsd(c.masaUsd)} (${c.personas} colaboradores)`);
    });
  } else {
    // Ámbito Personal / Directorio
    lineas.push('👥 *REPORTE DE PERSONAL Y NÓMINA · MGG*');
    lineas.push(`📅 Generado: ${ahora}`);
    lineas.push(`🏢 Empresas: ${p.empresasTexto}`);
    lineas.push('');
    lineas.push('📊 *CONSOLIDADO DE NÓMINA:*');
    lineas.push(`• Total Colaboradores: *${p.resumen.totalPersonas}* (${p.resumen.activos} activos, ${p.resumen.inactivos} inactivos)`);
    lineas.push(`• Género: ${p.resumen.hombres} Hombres · ${p.resumen.mujeres} Mujeres`);
    lineas.push(`• Masa Salarial Mensual: *${fmtMonedaUsd(p.resumen.masaSalarialUsd)}*`);
    lineas.push(`• Equivalente en Bolívares: Bs ${fmtNum2(p.resumen.masaSalarialBs)} (BCV: ${fmtNum2(p.resumen.tasaBcvReferencia)})`);
    lineas.push(`• Salario Promedio: ${fmtMonedaUsd(p.resumen.sueldoPromedioUsd)} (Mín: ${fmtMonedaUsd(p.resumen.sueldoMinUsd)} | Máx: ${fmtMonedaUsd(p.resumen.sueldoMaxUsd)})`);
    lineas.push('');
    lineas.push('👶 *FAMILIA Y CARGA FAMILIAR:*');
    lineas.push(`• Con Hijos: *${p.resumen.conHijos}* colaboradores (${p.resumen.totalHijos} hijos en total)`);
    lineas.push(`• Hijos Menores de 18: *${p.resumen.totalHijosMenores}* niños`);
    lineas.push(`• Sin Hijos: *${p.resumen.sinHijos}* colaboradores`);
    lineas.push('');

    if (p.resumen.topDepartamentos.length > 0) {
      lineas.push('📁 *POR DEPARTAMENTO:*');
      p.resumen.topDepartamentos.forEach((d, idx) => {
        lineas.push(`${idx + 1}. *${d.nombre}*: ${d.personas} pers. · ${fmtMonedaUsd(d.masaUsd)} (${d.porcentaje}%)`);
      });
      lineas.push('');
    }

    if (p.agrupacion !== 'detallado' && p.filas.length > 0) {
      lineas.push(`📋 *DESGLOSE (${p.agrupacion.toUpperCase()}):*`);
      p.filas.slice(0, 10).forEach((f, idx) => {
        lineas.push(`${idx + 1}. *${f.nombreCompleto}*: ${f.totalPersonas} pers. · ${fmtMonedaUsd(f.masaSalarialUsd || 0)} (${f.pctTotal}%)`);
      });
    }
  }

  return lineas.join('\n');
}

