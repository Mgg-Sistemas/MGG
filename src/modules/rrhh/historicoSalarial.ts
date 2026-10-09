/* ============================================================
   MGG · RRHH · Histórico salarial (09-10-2026)

   Arma los renglones que salen en pantalla, en el PDF y en el Excel: cada
   cambio de sueldo (`personal_sueldos`) unido con la ficha de la persona
   (nombre, cédula, cargo). Es cuenta pura: sin base y sin pantalla, para poder
   probarla.

   El historial es de TODOS: los inactivos también salen, porque un cambio de
   sueldo de alguien que ya se fue respalda nóminas viejas.
   ============================================================ */
import type { Personal } from '@/shared/lib/types';
import type { CambioSueldoRegistro } from './personal.repository';
import { labelTipoCambio, variacionSueldo, type VariacionSueldo } from './cambioSueldo';
import { normalizarCargo } from './tabulador';

export interface RenglonHistoricoSalarial {
  id: string;
  /** Cuándo se cargó el cambio (timestamp). */
  fechaCambio: string;
  empleado: string;
  cedula: string;
  cargo: string;
  sueldoAnterior: number;
  sueldoNuevo: number;
  variacion: VariacionSueldo;
  tipo: string;
  motivo: string;
  vigenteDesde: string;
  cambiadoPor: string;
  /** Para filtrar por persona. */
  personalId: string;
}

type PersonaMin = Pick<Personal, 'id' | 'nombre' | 'apellido' | 'cedula' | 'cargo'>;

/** Une cada cambio con su persona. Si la ficha ya no existe, se dice en vez de inventar. */
export function armarHistoricoSalarial(
  cambios: CambioSueldoRegistro[],
  personal: PersonaMin[],
): RenglonHistoricoSalarial[] {
  const porId = new Map(personal.map((p) => [p.id, p]));
  return cambios.map((c) => {
    const p = porId.get(c.personalId);
    return {
      id: c.id,
      fechaCambio: c.createdAt,
      empleado: p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '(ficha eliminada)',
      cedula: p?.cedula ?? '',
      cargo: p?.cargo ?? '',
      sueldoAnterior: c.sueldoAnterior,
      sueldoNuevo: c.sueldoNuevo,
      variacion: variacionSueldo(c.sueldoAnterior, c.sueldoNuevo),
      tipo: labelTipoCambio(c.tipo),
      motivo: c.motivo,
      vigenteDesde: c.vigenteDesde,
      cambiadoPor: c.actorName || c.actor || '',
      personalId: c.personalId,
    };
  });
}

export interface FiltroHistorico {
  texto?: string;
  cargo?: string;
  /** Sobre `vigenteDesde` (YYYY-MM-DD, inclusive). */
  desde?: string;
  hasta?: string;
}

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Texto libre (nombre, cédula, cargo, motivo), cargo exacto y rango de vigencia. */
export function filtrarHistorico(filas: RenglonHistoricoSalarial[], f: FiltroHistorico): RenglonHistoricoSalarial[] {
  const q = sinAcentos(String(f.texto ?? '').trim());
  const cargo = normalizarCargo(f.cargo);
  const desde = String(f.desde ?? '').slice(0, 10);
  const hasta = String(f.hasta ?? '').slice(0, 10);
  return filas.filter((r) => {
    if (cargo && normalizarCargo(r.cargo) !== cargo) return false;
    if (desde && r.vigenteDesde < desde) return false;
    if (hasta && r.vigenteDesde > hasta) return false;
    if (q) {
      const todo = sinAcentos(`${r.empleado} ${r.cedula} ${r.cargo} ${r.motivo} ${r.cambiadoPor}`);
      if (!q.split(/\s+/).every((p) => todo.includes(p))) return false;
    }
    return true;
  });
}

/** «+25 %», «-12,5 %», o «—» cuando no había sueldo antes o no cambió. */
export function textoPct(v: VariacionSueldo): string {
  if (v.pct == null || v.direccion === 'igual') return '—';
  const n = Math.abs(v.pct).toLocaleString('es-VE', { maximumFractionDigits: 1 });
  return `${v.pct > 0 ? '+' : '-'}${n} %`;
}

/** Texto del rango, para el encabezado del reporte. */
export function textoRangoHistorico(f: FiltroHistorico): string {
  const partes: string[] = [];
  if (f.desde && f.hasta) partes.push(`vigentes del ${fmtDia(f.desde)} al ${fmtDia(f.hasta)}`);
  else if (f.desde) partes.push(`vigentes desde el ${fmtDia(f.desde)}`);
  else if (f.hasta) partes.push(`vigentes hasta el ${fmtDia(f.hasta)}`);
  if (normalizarCargo(f.cargo)) partes.push(`cargo ${normalizarCargo(f.cargo)}`);
  if (String(f.texto ?? '').trim()) partes.push(`búsqueda «${String(f.texto).trim()}»`);
  return partes.length ? partes.join(' · ') : 'Todos los cambios';
}

function fmtDia(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Cargos distintos que aparecen en el histórico, ordenados. */
export function cargosDelHistorico(filas: RenglonHistoricoSalarial[]): string[] {
  const set = new Set<string>();
  for (const r of filas) { const c = normalizarCargo(r.cargo); if (c) set.add(c); }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}
