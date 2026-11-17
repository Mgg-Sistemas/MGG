/* ============================================================
   Golden Touch · Administración · Utilidades de Vigencia y Caducidad
   (05/11/2026)

   Cálculo y traducción bidireccional entre Fecha de Vencimiento y
   Tiempo de Vigencia (días, meses, años), y asignación automática
   del Status de Vigencia según la cercanía al vencimiento.
   ============================================================ */

import type { Prioridad, StatusVencimiento } from './admin.repository';
import { STATUS_VENCIMIENTO_COLOR, calcularStatusVencimiento, diasRestantes } from './admin.repository';

/** Estado de vencimiento usando el aviso propio del ítem como umbral de `por_vencer`
 *  (en vez del fijo de 30 días). `avisoDias` null/undefined → 30. */
export function statusConAviso(
  fechaVencimiento: string | null | undefined,
  avisoDias: number | null | undefined,
  opts?: { esTramite?: boolean; statusManual?: StatusVencimiento; hoyRef?: string },
): StatusVencimiento {
  const statusManual = opts?.statusManual ?? (opts?.esTramite ? 'vencido_en_tramite' : undefined);
  const umbral = avisoDias != null && avisoDias > 0 ? avisoDias : 30;
  return calcularStatusVencimiento(fechaVencimiento, statusManual, umbral, opts?.hoyRef);
}

/** Orden para listas por prioridad: alta(0) < media(1) < baja(2) < sin prioridad(3). */
export function ordenPrioridad(p: Prioridad | null | undefined): number {
  return p === 'alta' ? 0 : p === 'media' ? 1 : p === 'baja' ? 2 : 3;
}

export type UnidadVigencia = 'dias' | 'meses' | 'anos';

export interface PresetVigencia {
  id: string;
  label: string;
  labelCorto: string;
  cantidad: number;
  unidad: UnidadVigencia;
  esNoVence?: boolean;
}

export const PRESETS_TIEMPO_VIGENCIA: PresetVigencia[] = [
  { id: '15d', label: '15 días', labelCorto: '15d', cantidad: 15, unidad: 'dias' },
  { id: '30d', label: '1 mes (30 días)', labelCorto: '1m', cantidad: 1, unidad: 'meses' },
  { id: '90d', label: '3 meses (Trimestre)', labelCorto: '3m', cantidad: 3, unidad: 'meses' },
  { id: '180d', label: '6 meses (Semestre)', labelCorto: '6m', cantidad: 6, unidad: 'meses' },
  { id: '1a', label: '1 año (12 meses)', labelCorto: '1 año', cantidad: 1, unidad: 'anos' },
  { id: '2a', label: '2 años', labelCorto: '2 años', cantidad: 2, unidad: 'anos' },
  { id: '5a', label: '5 años', labelCorto: '5 años', cantidad: 5, unidad: 'anos' },
  { id: 'no_vence', label: 'No vence (Permanente)', labelCorto: 'No vence', cantidad: 0, unidad: 'dias', esNoVence: true },
];

/** Obtiene la fecha de hoy en formato YYYY-MM-DD en la zona local */
export function obtenerHoyIso(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Suma un tiempo de vigencia (días, meses o años) a una fecha base (YYYY-MM-DD).
 * Si la fecha base no es provista o es inválida, se toma la fecha de hoy.
 */
export function sumarTiempoVigencia(
  fechaBaseIso: string | null | undefined,
  cantidad: number,
  unidad: UnidadVigencia,
): string {
  const base = fechaBaseIso && /^\d{4}-\d{2}-\d{2}$/.test(fechaBaseIso)
    ? fechaBaseIso
    : obtenerHoyIso();

  const [y, m, d] = base.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  if (unidad === 'dias') {
    date.setDate(date.getDate() + cantidad);
  } else if (unidad === 'meses') {
    const diaOriginal = date.getDate();
    date.setMonth(date.getMonth() + cantidad);
    // Control de fin de mes (ej: 31 de marzo + 1 mes -> no desbordar a mayo)
    if (date.getDate() < diaOriginal) {
      date.setDate(0);
    }
  } else if (unidad === 'anos') {
    const diaOriginal = date.getDate();
    date.setFullYear(date.getFullYear() + cantidad);
    if (date.getDate() < diaOriginal) {
      date.setDate(0);
    }
  }

  const resY = date.getFullYear();
  const resM = String(date.getMonth() + 1).padStart(2, '0');
  const resD = String(date.getDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

export interface InfoCercaniaVigencia {
  status: StatusVencimiento;
  dias: number | null;
  label: string;
  badgeLabel: string;
  color: string;
  bg: string;
  border: string;
  urgente: boolean;
  esCritico: boolean;
}

/**
 * Determina el status de vigencia automáticamente según la cercanía a vencer,
 * devolviendo además el texto explicativo y los colores correspondientes.
 *
 * Reglas de cercanía:
 *  - Sin fecha de vencimiento: 'no_vence'
 *  - Días < 0: 'vencido' (o 'vencido_en_tramite' si se indicó trámite activo)
 *  - Días <= 15: 'por_vencer' con urgencia crítica
 *  - Días <= 30: 'por_vencer' (mes en curso)
 *  - Días > 30: 'vigente'
 */
export function calcularStatusPorCercania(
  fechaVencimiento: string | null | undefined,
  options?: {
    esTramite?: boolean;
    statusManual?: StatusVencimiento;
    hoyRef?: string;
  },
): InfoCercaniaVigencia {
  const { esTramite = false, statusManual, hoyRef } = options || {};

  // Caso 1: Sin fecha de vencimiento o marcado explícitamente como permanente
  if (!fechaVencimiento || statusManual === 'no_vence') {
    const cfg = STATUS_VENCIMIENTO_COLOR.no_vence;
    return {
      status: 'no_vence',
      dias: null,
      label: 'Documento permanente (sin fecha de caducidad)',
      badgeLabel: 'Permanente',
      color: cfg.color,
      bg: cfg.bg,
      border: cfg.border,
      urgente: false,
      esCritico: false,
    };
  }

  const dias = diasRestantes(fechaVencimiento, hoyRef);

  if (dias === null) {
    const cfg = STATUS_VENCIMIENTO_COLOR.no_vence;
    return {
      status: 'no_vence',
      dias: null,
      label: 'Sin vencimiento',
      badgeLabel: 'Permanente',
      color: cfg.color,
      bg: cfg.bg,
      border: cfg.border,
      urgente: false,
      esCritico: false,
    };
  }

  // Caso 2: Ya vencido (dias < 0)
  if (dias < 0) {
    const diasPasados = Math.abs(dias);
    const esEnTramite = esTramite || statusManual === 'vencido_en_tramite';

    if (esEnTramite) {
      const cfg = STATUS_VENCIMIENTO_COLOR.vencido_en_tramite;
      return {
        status: 'vencido_en_tramite',
        dias,
        label: `Caducó hace ${diasPasados} ${diasPasados === 1 ? 'día' : 'días'} (Trámite de renovación en curso)`,
        badgeLabel: `En trámite (-${diasPasados}d)`,
        color: cfg.color,
        bg: cfg.bg,
        border: cfg.border,
        urgente: true,
        esCritico: true,
      };
    }

    const cfg = STATUS_VENCIMIENTO_COLOR.vencido;
    return {
      status: 'vencido',
      dias,
      label: `Caducó hace ${diasPasados} ${diasPasados === 1 ? 'día' : 'días'} — Requiere renovación inmediata`,
      badgeLabel: `Vencido hace ${diasPasados}d`,
      color: cfg.color,
      bg: cfg.bg,
      border: cfg.border,
      urgente: true,
      esCritico: true,
    };
  }

  // Caso 3: Hoy vence (dias === 0)
  if (dias === 0) {
    return {
      status: 'por_vencer',
      dias: 0,
      label: '¡Vence hoy! Requiere atención inmediata',
      badgeLabel: '¡Vence hoy!',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.15)',
      border: '#ef4444',
      urgente: true,
      esCritico: true,
    };
  }

  // Caso 4: Por vencer crítico (próximos 15 días)
  if (dias <= 15) {
    const cfg = STATUS_VENCIMIENTO_COLOR.por_vencer;
    return {
      status: 'por_vencer',
      dias,
      label: `Alerta: vence en ${dias} ${dias === 1 ? 'día' : 'días'}`,
      badgeLabel: `Vence en ${dias}d`,
      color: cfg.color,
      bg: cfg.bg,
      border: cfg.border,
      urgente: true,
      esCritico: true,
    };
  }

  // Caso 5: Por vencer mes en curso (16 a 30 días)
  if (dias <= 30) {
    const cfg = STATUS_VENCIMIENTO_COLOR.por_vencer;
    return {
      status: 'por_vencer',
      dias,
      label: `Por vencer en ${dias} días (planificar renovación este mes)`,
      badgeLabel: `Vence en ${dias}d`,
      color: cfg.color,
      bg: cfg.bg,
      border: cfg.border,
      urgente: false,
      esCritico: false,
    };
  }

  // Caso 6: Vigente a mediano plazo (31 a 90 días)
  if (dias <= 90) {
    const cfg = STATUS_VENCIMIENTO_COLOR.vigente;
    const mesesAprox = Math.ceil(dias / 30);
    return {
      status: 'vigente',
      dias,
      label: `Vigente por ~${mesesAprox} meses (${dias} días restantes)`,
      badgeLabel: `Vigente (${dias}d)`,
      color: cfg.color,
      bg: cfg.bg,
      border: cfg.border,
      urgente: false,
      esCritico: false,
    };
  }

  // Caso 7: Vigente a largo plazo (> 90 días)
  const cfg = STATUS_VENCIMIENTO_COLOR.vigente;
  const meses = Math.floor(dias / 30.44);
  const anos = (dias / 365.25).toFixed(1);
  const textoTiempo = dias >= 365 ? `~${anos} años (${dias} días)` : `~${meses} meses (${dias} días)`;

  return {
    status: 'vigente',
    dias,
    label: `Vigente al día — Vence en ${textoTiempo}`,
    badgeLabel: `Vigente (${dias >= 365 ? `${anos}a` : `${meses}m`})`,
    color: cfg.color,
    bg: cfg.bg,
    border: cfg.border,
    urgente: false,
    esCritico: false,
  };
}

export interface DetalleHoverVigencia {
  titulo: string;
  detalle: string;
  tiempoRestanteTexto: string;
  dias: number | null;
  badge: string;
  color: string;
  bg: string;
  border: string;
  esCritico: boolean;
}

/**
 * Genera la información detallada para el Hover y visualización de cuenta regresiva
 * de un documento o item, indicando con precisión cuántos días o tiempo queda
 * para vencimiento o de vigencia.
 */
export function obtenerDetalleHoverVigencia(
  fechaVencimiento: string | null | undefined,
  statusVencimiento?: StatusVencimiento,
  notaTramite?: string | null,
  hoyRef?: string,
): DetalleHoverVigencia {
  const esTramite = statusVencimiento === 'vencido_en_tramite';
  const info = calcularStatusPorCercania(fechaVencimiento, {
    esTramite,
    statusManual: statusVencimiento,
    hoyRef,
  });

  let tiempoRestanteTexto = 'Sin caducidad (Vigente permanente)';
  if (info.dias !== null) {
    if (info.dias < 0) {
      const absDias = Math.abs(info.dias);
      const meses = Math.floor(absDias / 30);
      tiempoRestanteTexto = meses >= 1
        ? `Venció hace ${absDias} días (~${meses} ${meses === 1 ? 'mes' : 'meses'})`
        : `Venció hace ${absDias} ${absDias === 1 ? 'día' : 'días'}`;
    } else if (info.dias === 0) {
      tiempoRestanteTexto = '¡Vence hoy!';
    } else {
      const meses = Math.floor(info.dias / 30.44);
      if (info.dias >= 365) {
        const anos = (info.dias / 365.25).toFixed(1);
        tiempoRestanteTexto = `Quedan ${info.dias} días (~${anos} años de vigencia)`;
      } else if (meses >= 1) {
        tiempoRestanteTexto = `Quedan ${info.dias} días (~${meses} ${meses === 1 ? 'mes' : 'meses'} de vigencia)`;
      } else {
        tiempoRestanteTexto = `Quedan ${info.dias} ${info.dias === 1 ? 'día' : 'días'} de vigencia`;
      }
    }
  }

  const titulo = info.label;
  const detalle = [
    tiempoRestanteTexto,
    notaTramite ? `Nota de trámite: ${notaTramite}` : null,
  ].filter(Boolean).join(' · ');

  return {
    titulo,
    detalle,
    tiempoRestanteTexto,
    dias: info.dias,
    badge: info.badgeLabel,
    color: info.color,
    bg: info.bg,
    border: info.border,
    esCritico: info.esCritico,
  };
}
