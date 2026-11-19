/* ============================================================================
   MGG · Compras & Tesorería · Condiciones, vencimiento y alertas de créditos
   - Plazo en días en que vence el crédito y/o «Primero se recibe y luego se paga»
   - Cálculo determinista en huso horario Venezuela (America/Caracas)
   - Alertas automáticas a 2 días y 1 día del vencimiento (y vencidos / hoy)
   - Sin caracteres U+FE0F para compatibilidad limpia con mensajes de WhatsApp
   ============================================================================ */

import type { CreditoDetalle, CreditoModalidad, OfertaDetalle, Orden } from '../../shared/lib/types';

export type NivelAlertaCredito =
  | 'ninguna'
  | 'por_vencer_2d'
  | 'por_vencer_1d'
  | 'vence_hoy'
  | 'vencido';

export interface InfoCreditoResuelta {
  esCredito: boolean;
  configurado: boolean;
  modalidad: CreditoModalidad | null;
  dias: number | null;
  primeroRecibe: boolean;
  recibida: boolean;
  recibidaEn: string | null;
  fechaInicio: string | null;
  fechaVencimiento: string | null;
  fechaVencimientoFmt: string | null;
  diasRestantes: number | null;
  saldoPendiente: number;
  abiertaConSaldo: boolean;
  /** Activa alerta en Compras y Tesorería cuando faltan 2 días, 1 día, vence hoy o ya venció. */
  enAlertaVencimiento: boolean;
  nivelAlerta: NivelAlertaCredito;
  /** Texto breve para badges, selectores, tablas PDF y WhatsApp (libre de U+FE0F). */
  resumenCorto: string;
  /** Texto descriptivo para tarjetas de detalle en Compras y Tesorería. */
  resumenLargo: string;
  /** Mensaje accionable para el banner de alerta cuando está por vencer o vencido. */
  textoAlerta: string | null;
}

export interface AlertaCreditoItem {
  orden: Orden;
  codigo: string;
  tipo: 'OC' | 'OS';
  proveedorNombre: string;
  saldoPendiente: number;
  total: number;
  abonado: number;
  info: InfoCreditoResuelta;
}

export interface FuenteCredito {
  condiciones_pago?: string | null;
  estado?: string | null;
  oferta_detalle?: OfertaDetalle | null;
  detalle?: OfertaDetalle | null;
  oc_aprobada_en?: string | null;
  oc_creada_en?: string | null;
  created_at?: string | null;
  recibida_en?: string | null;
  total?: number | null;
  abonado_total?: number | null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha actual YYYY-MM-DD en zona horaria America/Caracas. */
export function hoyCaracasYmd(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback UTC-4 manual
  }
  const ve = new Date(now.getTime() - 4 * 3600_000);
  return ve.toISOString().slice(0, 10);
}

/** Convierte una fecha ISO o YYYY-MM-DD a YYYY-MM-DD en America/Caracas. */
export function isoAYmdCaracas(iso?: string | null): string | null {
  const s = (iso ?? '').trim();
  if (!s) return null;
  if (YMD_RE.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return hoyCaracasYmd(d);
}

function ymdAUtcMs(ymd: string): number | null {
  if (!YMD_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

/** Suma `dias` enteros a una fecha `YYYY-MM-DD` sin desviación por zona horaria. */
export function sumarDiasYmd(ymd: string, dias: number): string {
  const ms = ymdAUtcMs(ymd);
  if (ms === null) return ymd;
  const target = new Date(ms + Math.round(dias) * 86_400_000);
  return target.toISOString().slice(0, 10);
}

/** Diferencia exacta en días calendario (`hasta - desde`). Ej: mañana - hoy = +1. */
export function diferenciaDiasYmd(desdeYmd: string, hastaYmd: string): number | null {
  const a = ymdAUtcMs(desdeYmd);
  const b = ymdAUtcMs(hastaYmd);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Formatea `YYYY-MM-DD` como `DD/MM/AAAA`. */
export function formatearFechaCortaEs(ymd?: string | null): string {
  if (!ymd || !YMD_RE.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/** Limpia y normaliza el bloque `credito` para guardarlo en `OfertaDetalle`. */
export function normalizarCreditoDetalle(
  raw?: Partial<CreditoDetalle> | null,
  fechaBaseIso?: string | null,
): CreditoDetalle | null {
  if (!raw) return null;
  const diasNum = Number(raw.dias);
  const dias = Number.isFinite(diasNum) && diasNum > 0 ? Math.max(1, Math.round(diasNum)) : null;
  const primeroRecibe = raw.modalidad === 'primero_recibe' || Boolean(raw.primero_recibe);
  const modalidad: CreditoModalidad | null =
    raw.modalidad === 'primero_recibe' || (primeroRecibe && !dias)
      ? 'primero_recibe'
      : dias
        ? 'dias'
        : null;

  const vencExpl = raw.fecha_vencimiento && YMD_RE.test(raw.fecha_vencimiento.trim())
    ? raw.fecha_vencimiento.trim()
    : null;

  if (!modalidad && !dias && !primeroRecibe && !vencExpl) return null;

  const fechaInicio = isoAYmdCaracas(raw.fecha_inicio) ?? isoAYmdCaracas(fechaBaseIso) ?? null;
  const fechaVencimiento = vencExpl ?? (dias && fechaInicio ? sumarDiasYmd(fechaInicio, dias) : null);

  return {
    modalidad,
    dias,
    primero_recibe: primeroRecibe || null,
    fecha_inicio: fechaInicio,
    fecha_vencimiento: fechaVencimiento,
  };
}

/** Sella fecha_inicio y fecha_vencimiento al confirmar una OC a crédito. */
export function sellarVencimientoAlConfirmar(
  detalleActual: OfertaDetalle | null | undefined,
  confirmadaIso: string,
): OfertaDetalle | null {
  if (!detalleActual?.credito) return detalleActual ?? null;
  const cr = detalleActual.credito;
  const dias = Number(cr.dias) > 0 ? Math.max(1, Math.round(Number(cr.dias))) : null;
  const inicio = isoAYmdCaracas(confirmadaIso) ?? hoyCaracasYmd();
  const primeroRecibe = cr.modalidad === 'primero_recibe' || Boolean(cr.primero_recibe);
  // Si tiene días y la modalidad es por plazo ('dias'), fijamos el vencimiento desde la confirmación.
  // Si es 'primero_recibe', dejamos fecha_vencimiento sin congelar hasta recibir (o se previsualiza desde fecha_inicio).
  const fechaVencimiento = dias && cr.modalidad !== 'primero_recibe' ? sumarDiasYmd(inicio, dias) : null;
  return {
    ...detalleActual,
    credito: {
      ...cr,
      modalidad: cr.modalidad ?? (primeroRecibe && !dias ? 'primero_recibe' : dias ? 'dias' : null),
      dias,
      primero_recibe: primeroRecibe || null,
      fecha_inicio: inicio,
      fecha_vencimiento: fechaVencimiento,
    },
  };
}

/** Resuelve toda la información de vencimiento, modalidad y alertas de una orden u oferta a crédito. */
export function resolverInfoCredito(
  fuente: FuenteCredito,
  hoyYmd: string = hoyCaracasYmd(),
): InfoCreditoResuelta {
  const esCredito = fuente.condiciones_pago === 'credito' || fuente.estado === 'cuenta_abierta';
  const cr = fuente.oferta_detalle?.credito ?? fuente.detalle?.credito ?? null;

  const diasNum = Number(cr?.dias);
  const dias = Number.isFinite(diasNum) && diasNum > 0 ? Math.max(1, Math.round(diasNum)) : null;
  const primeroRecibe = cr?.modalidad === 'primero_recibe' || Boolean(cr?.primero_recibe);
  const modalidad: CreditoModalidad | null =
    cr?.modalidad === 'primero_recibe' || (primeroRecibe && !dias)
      ? 'primero_recibe'
      : dias
        ? 'dias'
        : null;

  const recibidaEn = fuente.recibida_en ?? null;
  const recibida = Boolean(recibidaEn);

  // Si es «primero recibe y luego paga» y ya se recibió con plazo en días, contar desde recepción si no había vencimiento explícito.
  const baseFecha =
    (primeroRecibe && recibida ? isoAYmdCaracas(recibidaEn) : null)
    ?? isoAYmdCaracas(cr?.fecha_inicio)
    ?? isoAYmdCaracas(fuente.oc_aprobada_en)
    ?? isoAYmdCaracas(fuente.oc_creada_en)
    ?? isoAYmdCaracas(fuente.created_at)
    ?? null;

  const fechaVencimiento =
    (cr?.fecha_vencimiento && YMD_RE.test(cr.fecha_vencimiento.trim()) ? cr.fecha_vencimiento.trim() : null)
    ?? (dias && baseFecha ? sumarDiasYmd(baseFecha, dias) : null);

  const fechaVencimientoFmt = fechaVencimiento ? formatearFechaCortaEs(fechaVencimiento) : null;
  const diasRestantes = fechaVencimiento ? diferenciaDiasYmd(hoyYmd, fechaVencimiento) : null;

  const total = Math.max(0, Number(fuente.total) || 0);
  const abonado = Math.max(0, Number(fuente.abonado_total) || 0);
  const saldoPendiente = Math.max(0, Math.round((total - abonado) * 100) / 100);
  const abiertaConSaldo = fuente.estado === 'cuenta_abierta' && saldoPendiente > 0.01;

  let nivelAlerta: NivelAlertaCredito = 'ninguna';
  if (abiertaConSaldo && diasRestantes !== null) {
    if (diasRestantes < 0) nivelAlerta = 'vencido';
    else if (diasRestantes === 0) nivelAlerta = 'vence_hoy';
    else if (diasRestantes === 1) nivelAlerta = 'por_vencer_1d';
    else if (diasRestantes === 2) nivelAlerta = 'por_vencer_2d';
  }
  const enAlertaVencimiento = nivelAlerta !== 'ninguna';
  const configurado = Boolean(dias || primeroRecibe || fechaVencimiento);

  // Construcción de etiquetas legibles (sin U+FE0F)
  let resumenCorto = 'Crédito';
  let resumenLargo = 'Cuenta a crédito';
  let textoAlerta: string | null = null;

  if (diasRestantes !== null && fechaVencimientoFmt) {
    if (abiertaConSaldo || fuente.estado === 'cuenta_abierta') {
      if (diasRestantes < 0) {
        const abs = Math.abs(diasRestantes);
        resumenCorto = `Vencido hace ${abs} ${abs === 1 ? 'día' : 'días'} (${fechaVencimientoFmt})`;
        resumenLargo = `Crédito vencido hace ${abs} ${abs === 1 ? 'día' : 'días'} · Venció el ${fechaVencimientoFmt}${dias ? ` (plazo ${dias}d)` : ''}`;
        textoAlerta = `Crédito vencido hace ${abs} ${abs === 1 ? 'día' : 'días'} (${fechaVencimientoFmt}) · Pagar crédito pendiente`;
      } else if (diasRestantes === 0) {
        resumenCorto = `Vence HOY (${fechaVencimientoFmt})`;
        resumenLargo = `El crédito vence HOY (${fechaVencimientoFmt})${dias ? ` · plazo ${dias} días` : ''}`;
        textoAlerta = `Vence HOY (${fechaVencimientoFmt}) · Pagar crédito pendiente`;
      } else if (diasRestantes === 1) {
        resumenCorto = `Vence en 1 día (${fechaVencimientoFmt})`;
        resumenLargo = `Falta 1 día para el vencimiento (${fechaVencimientoFmt})${dias ? ` · plazo ${dias} días` : ''}`;
        textoAlerta = `Falta 1 día para el vencimiento (${fechaVencimientoFmt}) · Pagar crédito pendiente`;
      } else if (diasRestantes === 2) {
        resumenCorto = `Vence en 2 días (${fechaVencimientoFmt})`;
        resumenLargo = `Faltan 2 días para el vencimiento (${fechaVencimientoFmt})${dias ? ` · plazo ${dias} días` : ''}`;
        textoAlerta = `Faltan 2 días para el vencimiento (${fechaVencimientoFmt}) · Pagar crédito pendiente`;
      } else {
        resumenCorto = `Vence en ${diasRestantes} días (${fechaVencimientoFmt})`;
        resumenLargo = `Crédito a ${dias ?? diasRestantes} días · Vence el ${fechaVencimientoFmt} (faltan ${diasRestantes} días)`;
      }
    } else if (dias) {
      resumenCorto = `Crédito ${dias} días (vence ${fechaVencimientoFmt})`;
      resumenLargo = `Crédito a ${dias} días · Vencimiento estimado ${fechaVencimientoFmt}`;
    } else {
      resumenCorto = `Vence ${fechaVencimientoFmt}`;
      resumenLargo = `Crédito con vencimiento el ${fechaVencimientoFmt}`;
    }

    if (primeroRecibe) {
      resumenCorto += recibida ? ' · Ya recibida' : ' · Primero recibe y luego paga';
      resumenLargo += recibida
        ? ' · Primero se recibe y luego se paga (ya recibida)'
        : ' · Primero se recibe la compra y luego se paga';
    }
  } else if (dias) {
    resumenCorto = primeroRecibe
      ? `Primero recibe y luego paga (${dias} días)`
      : `Crédito a ${dias} ${dias === 1 ? 'día' : 'días'}`;
    resumenLargo = primeroRecibe
      ? `Primero se recibe la compra y luego se paga · Plazo de ${dias} ${dias === 1 ? 'día' : 'días'}`
      : `Crédito con plazo de ${dias} ${dias === 1 ? 'día' : 'días'}`;
  } else if (primeroRecibe) {
    resumenCorto = recibida
      ? 'Primero recibe y luego paga (ya recibida)'
      : 'Primero se recibe y luego se paga';
    resumenLargo = recibida
      ? 'Primero se recibe la compra y luego se paga · Compra ya recibida, lista para pagar'
      : 'Primero se recibe la compra y luego se paga';
  }

  return {
    esCredito,
    configurado,
    modalidad,
    dias,
    primeroRecibe,
    recibida,
    recibidaEn,
    fechaInicio: baseFecha,
    fechaVencimiento,
    fechaVencimientoFmt,
    diasRestantes,
    saldoPendiente,
    abiertaConSaldo,
    enAlertaVencimiento,
    nivelAlerta,
    resumenCorto,
    resumenLargo,
    textoAlerta,
  };
}

function esOrdenServicio(o: Pick<Orden, 'clase' | 'codigo' | 'oc_codigo'>): boolean {
  if (o.clase === 'servicio') return true;
  const cod = (o.codigo ?? '').trim().toUpperCase();
  const oc = (o.oc_codigo ?? '').trim().toUpperCase();
  return cod.startsWith('SV-') || cod.startsWith('OS-') || oc.startsWith('OS-') || oc.startsWith('SV-');
}

/**
 * Devuelve las cuentas a crédito abiertas de Compras (OC y OS) que están
 * a 2 días o 1 día del vencimiento (o que vencen hoy / ya vencieron) y aún tienen saldo por pagar.
 */
export function listarAlertasCreditoPorVencer(
  ordenes: Orden[],
  proveedorNombrePorId?: Map<string, string> | ((proveedorId?: string | null) => string),
  hoyYmd: string = hoyCaracasYmd(),
): AlertaCreditoItem[] {
  const resolverProv = (id?: string | null): string => {
    if (!id) return 'Sin proveedor';
    if (typeof proveedorNombrePorId === 'function') return proveedorNombrePorId(id) || 'Sin proveedor';
    if (proveedorNombrePorId instanceof Map) return proveedorNombrePorId.get(id) ?? 'Sin proveedor';
    return 'Sin proveedor';
  };

  const alertas: AlertaCreditoItem[] = [];
  for (const o of ordenes) {
    const cod = (o.codigo ?? '').trim().toUpperCase();
    if (cod.startsWith('CD-') || cod.startsWith('SD-')) continue;
    if (o.estado !== 'cuenta_abierta') continue;

    const info = resolverInfoCredito(o, hoyYmd);
    if (!info.enAlertaVencimiento || info.saldoPendiente <= 0.01) continue;

    const total = Math.max(0, Number(o.total) || 0);
    const abonado = Math.max(0, Number(o.abonado_total) || 0);
    alertas.push({
      orden: o,
      codigo: o.oc_codigo || o.codigo,
      tipo: esOrdenServicio(o) ? 'OS' : 'OC',
      proveedorNombre: resolverProv(o.proveedor_id),
      saldoPendiente: info.saldoPendiente,
      total,
      abonado,
      info,
    });
  }

  return alertas.sort((a, b) => {
    const da = a.info.diasRestantes ?? 999;
    const db = b.info.diasRestantes ?? 999;
    if (da !== db) return da - db;
    return b.saldoPendiente - a.saldoPendiente;
  });
}
