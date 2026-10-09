/* ============================================================
   MGG · RRHH · Vacaciones y descansos en PDF y Excel (09-10-2026)

   Los renglones que salen en los dos reportes, armados sin base y sin
   pantalla para poder probarlos: cada vacación o descanso unido con la ficha
   de la persona (nombre, cédula, cargo, departamento), con sus fechas, los
   días que dura y su estado.

   Alcance: lo del MES visible en el calendario (lo que se cruza con el mes),
   o TODO lo cargado. Los filtros de la pantalla (departamento, búsqueda,
   «solo con descansos») se respetan: el reporte es lo que se está viendo.
   ============================================================ */
import type { Personal, RrhhEvento } from '@/shared/lib/types';
import type { Descanso } from './descansos.repository';
import { diasDe } from './descansosPlan';

type PersonaMin = Pick<Personal, 'id' | 'nombre' | 'apellido' | 'cedula' | 'cargo' | 'departamento'>;

export interface RangoMes {
  /** AAAA-MM-DD, primer día. */
  desde: string;
  /** AAAA-MM-DD, último día. */
  hasta: string;
}

export interface FilaVacacion {
  id: string;
  empleado: string;
  cedula: string;
  departamento: string;
  cargo: string;
  desde: string;
  hasta: string;
  dias: number;
  /** «Procesada» (ya fue a Tesorería) o «Programada». */
  estado: string;
  /** Se solapa con otra persona del mismo departamento. */
  cruce: boolean;
  nota: string;
  cargadoPor: string;
}

export interface FilaDescanso {
  id: string;
  empleado: string;
  cedula: string;
  departamento: string;
  cargo: string;
  desde: string;
  hasta: string;
  dias: number;
  /** «Plan» o «Manual». */
  origen: string;
  nota: string;
  cargadoPor: string;
}

const nombreDe = (p?: PersonaMin) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '(ficha eliminada)');

/** ¿El rango [desde, hasta] toca el mes? Extremos incluidos. */
export function tocaRango(desde: string | null | undefined, hasta: string | null | undefined, mes: RangoMes | null): boolean {
  if (!mes) return true;
  const a = String(desde ?? '').slice(0, 10);
  const b = String(hasta ?? '').slice(0, 10);
  if (!a || !b) return false;
  return a <= mes.hasta && b >= mes.desde;
}

function diasInclusive(desde: string, hasta: string): number {
  if (!desde || !hasta) return 0;
  const n = diasDe({ desde: desde.slice(0, 10), hasta: hasta.slice(0, 10) });
  return n > 0 ? n : 0;
}

/**
 * Vacaciones para el reporte: del mes (si se pasa) o todas, ordenadas por
 * fecha de inicio y luego por nombre. Solo las que tienen fechas.
 */
export function armarFilasVacaciones(
  eventos: RrhhEvento[],
  personal: PersonaMin[],
  conflictoIds: Set<string>,
  mes: RangoMes | null,
): FilaVacacion[] {
  const porId = new Map(personal.map((p) => [p.id, p]));
  return eventos
    .filter((e) => e.fecha_desde && e.fecha_hasta && tocaRango(e.fecha_desde, e.fecha_hasta, mes))
    .map((e) => {
      const p = porId.get(e.personal_id);
      const desde = String(e.fecha_desde).slice(0, 10);
      const hasta = String(e.fecha_hasta).slice(0, 10);
      return {
        id: e.id,
        empleado: nombreDe(p),
        cedula: p?.cedula ?? '',
        departamento: p?.departamento ?? '',
        cargo: p?.cargo ?? '',
        desde,
        hasta,
        dias: Number(e.dias) || diasInclusive(desde, hasta),
        estado: e.procesada ? 'Procesada' : 'Programada',
        cruce: conflictoIds.has(e.id),
        nota: e.descripcion ?? '',
        cargadoPor: e.actor_name || e.creado_por || '',
      };
    })
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.empleado.localeCompare(b.empleado, 'es'));
}

/**
 * Descansos para el reporte: solo de las personas que se están viendo
 * (los filtros de la pantalla), del mes o todos. Ordenados por fecha y nombre.
 */
export function armarFilasDescansos(
  descansos: Descanso[],
  personasVisibles: PersonaMin[],
  mes: RangoMes | null,
): FilaDescanso[] {
  const porId = new Map(personasVisibles.map((p) => [p.id, p]));
  return descansos
    .filter((d) => porId.has(d.personal_id) && tocaRango(d.desde, d.hasta, mes))
    .map((d) => {
      const p = porId.get(d.personal_id);
      return {
        id: d.id,
        empleado: nombreDe(p),
        cedula: p?.cedula ?? '',
        departamento: p?.departamento ?? '',
        cargo: p?.cargo ?? '',
        desde: d.desde.slice(0, 10),
        hasta: d.hasta.slice(0, 10),
        dias: diasInclusive(d.desde, d.hasta),
        origen: d.origen === 'plan' ? 'Plan' : 'Manual',
        nota: d.nota ?? '',
        cargadoPor: d.actor_name || d.created_by || '',
      };
    })
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.empleado.localeCompare(b.empleado, 'es'));
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «octubre de 2026» a partir del primer día del mes. */
export function nombreMes(mes: RangoMes): string {
  const y = Number(mes.desde.slice(0, 4));
  const m = Number(mes.desde.slice(5, 7));
  return `${MESES[m - 1] ?? ''} de ${y}`.trim();
}

/** Texto del alcance para el encabezado: mes, departamento, búsqueda. */
export function textoAlcance(o: { mes: RangoMes | null; departamento?: string; texto?: string; soloConDescansos?: boolean }): string {
  const partes: string[] = [o.mes ? nombreMes(o.mes) : 'todo lo cargado'];
  if (o.departamento) partes.push(`departamento ${o.departamento}`);
  if (String(o.texto ?? '').trim()) partes.push(`búsqueda «${String(o.texto).trim()}»`);
  if (o.soloConDescansos) partes.push('solo con descansos');
  return partes.join(' · ');
}

/** Total de días de la lista (para el pie). */
export function totalDias(filas: { dias: number }[]): number {
  return filas.reduce((a, f) => a + (Number(f.dias) || 0), 0);
}
