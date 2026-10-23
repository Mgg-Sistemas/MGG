/* ============================================================
   MGG · Retenciones v8 · El XML de ISLR desde el libro (lógica pura)

   Permite elegir el período de ISLR (mes) y preparar los datos para la
   generación y descarga del archivo XML oficial del SENIAT (Decreto 1.808).
   ============================================================ */

import type { RetencionPracticada } from '../datos/puerta';
import { armarXmlIslr, type ResultadoXmlIslr } from '../logica/xmlIslr';

export interface PeriodoXml {
  clave: string;
  periodo: string;
  texto: string;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const delIslr = (r: RetencionPracticada) => r.tipo === 'islr' && r.direccion === 'practicada';

/** Formato: «Octubre de 2026». */
export function nombrePeriodoXml(periodo: string): string {
  if (!/^\d{6}$/.test(periodo)) return periodo;
  const mesNum = Number(periodo.slice(4, 6)) - 1;
  const mes = MESES[mesNum] ?? '—';
  const anio = periodo.slice(0, 4);
  return `${mes[0]?.toUpperCase() ?? ''}${mes.slice(1)} de ${anio}`;
}

/** Obtiene los períodos disponibles de ISLR practicadas en el libro. */
export function periodosXml(libro: readonly RetencionPracticada[]): PeriodoXml[] {
  const vistos = new Map<string, PeriodoXml>();
  for (const r of libro) {
    if (!delIslr(r) || !/^\d{6}$/.test(r.periodo)) continue;
    if (!vistos.has(r.periodo)) {
      vistos.set(r.periodo, {
        clave: r.periodo,
        periodo: r.periodo,
        texto: nombrePeriodoXml(r.periodo),
      });
    }
  }
  return [...vistos.values()].sort((a, b) => b.clave.localeCompare(a.clave));
}

/** Prepara el resultado XML para la empresa y período indicados. */
export function prepararXmlIslr(
  libro: readonly RetencionPracticada[],
  periodo: string,
  empresa: { rif: string; razonSocial: string }
): ResultadoXmlIslr {
  return armarXmlIslr({
    rifAgente: empresa.rif,
    razonSocial: empresa.razonSocial,
    periodo,
    filas: libro.filter((r) => delIslr(r) && r.periodo === periodo),
  });
}
