/* ============================================================
   MGG · RRHH · Tabulador por cargo (09-10-2026)

   La cuenta pura del tabulador, sin base ni pantalla, para probarla renglón
   por renglón:
   · qué cargo es «el mismo» (mayúsculas y espacios no cuentan);
   · qué hace falta para guardar una fila (motivo obligatorio, monto ≥ 0);
   · a quién le cambia el sueldo si se aplica el tabulador, y a quién no.

   REGLAS
   · Una fila con sueldo 0 está «sin definir»: NO se aplica a nadie. Así la
     carga inicial de cargos cuyo personal cobra montos distintos no pisa
     sueldos reales por accidente.
   · Una fila desactivada tampoco se aplica.
   · Solo entra el personal ACTIVO con cargo. Los inactivos conservan su sueldo.
   · Se compara a centavos, igual que el cambio de sueldo de la ficha.
   ============================================================ */
import { aCentavos, huboCambioSueldo, variacionSueldo, type VariacionSueldo } from './cambioSueldo';

export const MIN_MOTIVO_TABULADOR = 3;

/** «conductor », «Conductor» y «CONDUCTOR» son el mismo cargo. */
export function normalizarCargo(cargo: unknown): string {
  return String(cargo ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export interface FilaTabulador {
  id: string;
  cargo: string;
  /** USD mensual. 0 = sin definir. */
  sueldoBase: number;
  vigenteDesde: string;
  activo: boolean;
  updatedAt: string;
  actualizadoPor: string | null;
  actualizadoPorNombre: string | null;
}

/** ¿La fila sirve para aplicarse? Activa y con monto. */
export function filaAplicable(f: Pick<FilaTabulador, 'sueldoBase' | 'activo'>): boolean {
  return f.activo && aCentavos(f.sueldoBase) > 0;
}

export interface FilaTabuladorInput {
  cargo: string;
  sueldoBase: unknown;
  vigenteDesde?: string | null;
  motivo?: string | null;
  activo?: boolean;
}

/**
 * Qué falta para poder guardar una fila. Devuelve el reclamo o `null`.
 * El motivo se pide SIEMPRE: también al dar de alta, porque es lo que explica
 * de dónde salió el monto.
 */
export function validarFilaTabulador(input: FilaTabuladorInput): string | null {
  if (normalizarCargo(input.cargo).length < 2) return 'Indicá el cargo.';
  const monto = Number(input.sueldoBase);
  if (!Number.isFinite(monto)) return 'El sueldo del tabulador tiene que ser un número.';
  if (monto < 0) return 'El sueldo del tabulador no puede ser negativo.';
  const motivo = String(input.motivo ?? '').trim();
  if (motivo.length < MIN_MOTIVO_TABULADOR) {
    return `Escribí el motivo del cambio (mínimo ${MIN_MOTIVO_TABULADOR} letras): queda en el historial del tabulador.`;
  }
  if (input.vigenteDesde && !/^\d{4}-\d{2}-\d{2}$/.test(input.vigenteDesde)) {
    return 'La fecha desde la que rige no es válida.';
  }
  return null;
}

/** Lo mínimo de una persona para saber si el tabulador la toca. */
export interface PersonaParaTabulador {
  id: string;
  nombre: string;
  apellido?: string | null;
  cedula?: string | null;
  cargo?: string | null;
  sueldo_base: number | string | null;
  activo: boolean;
}

export interface CambioPorTabulador {
  persona: PersonaParaTabulador;
  cargo: string;
  anterior: number;
  nuevo: number;
  variacion: VariacionSueldo;
}

export interface DiffTabulador {
  /** A quién le cambia el sueldo, de cuánto a cuánto. */
  cambios: CambioPorTabulador[];
  /** Activos cuyo cargo está en el tabulador y ya cobran ese monto. */
  sinCambio: PersonaParaTabulador[];
  /** Activos con cargo que no figura en el tabulador (o figura sin definir / inactivo). */
  sinTabulador: PersonaParaTabulador[];
  /** Activos sin cargo cargado: no hay con qué compararlos. */
  sinCargo: PersonaParaTabulador[];
}

/**
 * Lo que pasaría si se aplica el tabulador, ANTES de tocar nada. Es lo que se
 * muestra en la vista previa y lo que la persona confirma.
 *
 * Replica la regla de la función `aplicar_tabulador` de la base; si una cambia,
 * tiene que cambiar la otra.
 */
export function diffAplicarTabulador(personal: PersonaParaTabulador[], tabulador: FilaTabulador[]): DiffTabulador {
  const porCargo = new Map<string, FilaTabulador>();
  for (const f of tabulador) {
    if (filaAplicable(f)) porCargo.set(normalizarCargo(f.cargo), f);
  }
  const out: DiffTabulador = { cambios: [], sinCambio: [], sinTabulador: [], sinCargo: [] };
  const ordenado = [...personal].sort((a, b) =>
    `${a.apellido ?? ''} ${a.nombre}`.localeCompare(`${b.apellido ?? ''} ${b.nombre}`, 'es'));
  for (const p of ordenado) {
    if (!p.activo) continue;
    const cargo = normalizarCargo(p.cargo);
    if (!cargo) { out.sinCargo.push(p); continue; }
    const fila = porCargo.get(cargo);
    if (!fila) { out.sinTabulador.push(p); continue; }
    const anterior = aCentavos(p.sueldo_base);
    const nuevo = aCentavos(fila.sueldoBase);
    if (!huboCambioSueldo(anterior, nuevo)) { out.sinCambio.push(p); continue; }
    out.cambios.push({ persona: p, cargo: fila.cargo, anterior, nuevo, variacion: variacionSueldo(anterior, nuevo) });
  }
  return out;
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY', como lo escribe la base en el motivo. */
export function fechaMotivo(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/** El motivo que queda en el historial salarial de cada persona tocada. */
export function motivoTabulador(vigenteDesde: string): string {
  return `Tabulador aplicado · ${fechaMotivo(vigenteDesde)}`;
}

/** Resumen de una pasada, en una frase. */
export function resumenAplicacion(d: Pick<DiffTabulador, 'cambios' | 'sinCambio' | 'sinTabulador'>): string {
  const partes: string[] = [];
  partes.push(d.cambios.length === 1 ? '1 persona cambia de sueldo' : `${d.cambios.length} personas cambian de sueldo`);
  partes.push(`${d.sinCambio.length} ya cobran lo del tabulador`);
  if (d.sinTabulador.length) partes.push(`${d.sinTabulador.length} con cargo fuera del tabulador (no se tocan)`);
  return partes.join(' · ');
}

/* ───────── Historial del tabulador ───────── */

export type AccionTabulador = 'alta' | 'cambio' | 'baja' | 'reactivacion';

export interface HistorialTabulador {
  id: string;
  tabuladorId: string | null;
  cargo: string;
  accion: AccionTabulador | string;
  sueldoAnterior: number;
  sueldoNuevo: number;
  vigenteDesde: string | null;
  motivo: string;
  cambiadoPor: string | null;
  cambiadoPorNombre: string | null;
  createdAt: string;
}

export function labelAccionTabulador(a: string | null | undefined): string {
  switch (a) {
    case 'alta': return 'Alta';
    case 'baja': return 'Desactivado';
    case 'reactivacion': return 'Reactivado';
    case 'cambio': return 'Cambio';
    default: return '—';
  }
}

/** Filtra el historial por cargo (normalizado). Vacío = todos. */
export function filtrarHistorialPorCargo<T extends { cargo: string }>(filas: T[], cargo: string): T[] {
  const c = normalizarCargo(cargo);
  if (!c) return filas;
  return filas.filter((f) => normalizarCargo(f.cargo) === c);
}
