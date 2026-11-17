/* ============================================================
   Golden Touch · Administración · Notificaciones Push y Alertas Inteligentes
   (PWA + Web Push + Web Audio + Hitos Descartables de Vigencia)
   ============================================================ */

import { playNotificationSound } from '@/shared/lib/sound';
import {
  activarNotificaciones,
  soportaPush,
  estadoPermisoNotif,
  emitirWebPush,
  isModuloNotifActivo,
} from '@/shared/lib/webpush';
import type { DocumentoEmpresa, StatusVencimiento } from './admin.repository';
import { diasRestantes } from './admin.repository';

const STORAGE_KEY_DESCARTES = 'mgg.admin.notif_descartes_v1';
const STORAGE_KEY_SONIDO_MUTED = 'mgg.admin.notif_sonido_muted';

/** Hitos canónicos de tiempo establecido para documentos por vencer o vencidos */
export type HitoVigencia =
  | 'vigente_ok'      // > 30 días: sin alerta
  | 'pv_30d'          // 16 a 30 días restantes
  | 'pv_15d'          // 8 a 15 días restantes
  | 'pv_7d'           // 4 a 7 días restantes
  | 'pv_3d'           // 2 a 3 días restantes
  | 'pv_1d'           // 0 a 1 día (vence hoy o mañana)
  | 'vencido_0d'      // Vencido hace 0 a 3 días
  | 'vencido_7d'      // Vencido hace 4 a 7 días
  | 'vencido_15d'     // Vencido hace 8 a 15 días
  | 'vencido_30d';    // Vencido hace 16 a 30 días (y múltiplos posteriores)

export interface RegistroDescarte {
  docId: string;
  hitoDescartado: HitoVigencia;
  descartadoEn: string; // ISO string
  proximoHitoEsperado: HitoVigencia | null;
  diasAlDescartar: number | null;
}

export interface AlertaDocumento {
  docId: string;
  nombre: string;
  empresaClave: string;
  fechaVencimiento: string | null;
  statusVencimiento: StatusVencimiento;
  diasRestantes: number | null;
  hitoActual: HitoVigencia;
  descartada: boolean;
  proximoHitoTexto: string;
  mensaje: string;
  urgencia: 'alta' | 'media' | 'baja';
}

/**
 * Determina el hito de tiempo actual de un documento según sus días restantes.
 */
export function calcularHitoVigencia(
  dias: number | null,
  statusManual?: StatusVencimiento,
): HitoVigencia {
  if (statusManual === 'no_vence' || dias === null) return 'vigente_ok';
  if (statusManual === 'vencido' || statusManual === 'vencido_en_tramite' || dias < 0) {
    const atraso = Math.abs(dias);
    if (atraso <= 3) return 'vencido_0d';
    if (atraso <= 7) return 'vencido_7d';
    if (atraso <= 15) return 'vencido_15d';
    return 'vencido_30d';
  }

  if (dias > 30) return 'vigente_ok';
  if (dias > 15) return 'pv_30d';
  if (dias > 7) return 'pv_15d';
  if (dias > 3) return 'pv_7d';
  if (dias > 1) return 'pv_3d';
  return 'pv_1d';
}

/**
 * Determina cuál es el siguiente hito establecido después del actual.
 */
export function siguienteHitoEstablecido(hito: HitoVigencia): HitoVigencia | null {
  switch (hito) {
    case 'pv_30d': return 'pv_15d';
    case 'pv_15d': return 'pv_7d';
    case 'pv_7d': return 'pv_3d';
    case 'pv_3d': return 'pv_1d';
    case 'pv_1d': return 'vencido_0d';
    case 'vencido_0d': return 'vencido_7d';
    case 'vencido_7d': return 'vencido_15d';
    case 'vencido_15d': return 'vencido_30d';
    case 'vencido_30d': return null; // se evalúa por intervalos
    default: return null;
  }
}

/**
 * Devuelve un texto amigable para mostrarle al usuario cuándo volverá a sonar la alerta si la descarta.
 */
export function textoProximoAviso(hito: HitoVigencia): string {
  switch (hito) {
    case 'pv_30d': return 'a los 15 días antes de vencer';
    case 'pv_15d': return 'a los 7 días antes de vencer';
    case 'pv_7d': return 'a los 3 días antes de vencer';
    case 'pv_3d': return '1 día antes de vencer';
    case 'pv_1d': return 'al vencer el documento';
    case 'vencido_0d': return 'a los 7 días de vencido si no se renueva';
    case 'vencido_7d': return 'a los 15 días de vencido';
    case 'vencido_15d': return 'a los 30 días de vencido';
    case 'vencido_30d': return 'en el siguiente corte mensual';
    default: return 'en el próximo cambio de estado';
  }
}

/**
 * Lee el almacén de descartes de notificaciones.
 */
export function leerDescartes(): Record<string, RegistroDescarte> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DESCARTES);
    return raw ? (JSON.parse(raw) as Record<string, RegistroDescarte>) : {};
  } catch {
    return {};
  }
}

/**
 * Guarda el descarte de un documento en su hito actual.
 * La notificación NO volverá a sonar hasta que alcance el siguiente hito establecido.
 */
export function descartarNotificacionDocumento(
  docId: string,
  hitoActual: HitoVigencia,
  diasRestantesVal: number | null,
): void {
  if (typeof window === 'undefined') return;
  const descartes = leerDescartes();
  const proximo = siguienteHitoEstablecido(hitoActual);
  descartes[docId] = {
    docId,
    hitoDescartado: hitoActual,
    descartadoEn: new Date().toISOString(),
    proximoHitoEsperado: proximo,
    diasAlDescartar: diasRestantesVal,
  };
  try {
    localStorage.setItem(STORAGE_KEY_DESCARTES, JSON.stringify(descartes));
  } catch (e) {
    console.warn('No se pudo guardar el descarte en localStorage', e);
  }
}

/**
 * Reactiva una alerta descartada previamente (por ejemplo, si el usuario quiere volver a recordarla).
 */
export function restaurarNotificacionDocumento(docId: string): void {
  if (typeof window === 'undefined') return;
  const descartes = leerDescartes();
  if (descartes[docId]) {
    delete descartes[docId];
    try {
      localStorage.setItem(STORAGE_KEY_DESCARTES, JSON.stringify(descartes));
    } catch { /* ignore */ }
  }
}

/**
 * Evalúa si una alerta debe sonar/notificar según su hito y sus descartes previos.
 * REGLA SOLICITADA:
 * "la notificación debe ser descartable y en ese caso no volver a sonar hasta el siguiente tiempo establecido en caso de no estar vigente"
 */
export function debeNotificarDocumento(
  docId: string,
  hitoActual: HitoVigencia,
  descartes: Record<string, RegistroDescarte> = leerDescartes(),
): boolean {
  if (hitoActual === 'vigente_ok') return false;

  const reg = descartes[docId];
  if (!reg) return true; // Nunca se ha descartado: debe sonar

  // Si ya se descartó en el MISMO hito actual, está silenciada
  if (reg.hitoDescartado === hitoActual) {
    return false;
  }

  // Si el hito cambió al siguiente tiempo establecido, se reactiva la alerta
  return true;
}

/**
 * Analiza un conjunto de documentos y genera la lista de alertas activas,
 * indicando cuáles deben sonar y cuáles están silenciadas temporalmente.
 */
export function evaluarAlertasDocumentos(
  documentos: DocumentoEmpresa[],
  hoyRef?: string,
  descartes: Record<string, RegistroDescarte> = leerDescartes(),
): {
  alertas: AlertaDocumento[];
  nuevasParaSonar: AlertaDocumento[];
  totalSilenciadas: number;
} {
  const alertas: AlertaDocumento[] = [];
  const nuevasParaSonar: AlertaDocumento[] = [];
  let totalSilenciadas = 0;

  for (const doc of documentos) {
    if (doc.statusVencimiento === 'no_vence' || !doc.fechaVencimiento) continue;

    const dias = diasRestantes(doc.fechaVencimiento, hoyRef);
    const hito = calcularHitoVigencia(dias, doc.statusVencimiento);
    if (hito === 'vigente_ok') continue;

    const debeSonar = debeNotificarDocumento(doc.id, hito, descartes);
    const proximoTexto = textoProximoAviso(hito);

    let urgencia: 'alta' | 'media' | 'baja' = 'media';
    let mensaje = '';

    if (dias !== null && dias < 0) {
      urgencia = 'alta';
      const atraso = Math.abs(dias);
      mensaje = `Vencido hace ${atraso} día(s). Requiere renovación urgente.`;
    } else if (dias !== null && dias <= 3) {
      urgencia = 'alta';
      mensaje = dias === 0 ? '¡Vence hoy!' : `Vence en ${dias} día(s). Atención inmediata.`;
    } else if (dias !== null && dias <= 7) {
      urgencia = 'media';
      mensaje = `Próximo a vencer en ${dias} días (en 1 semana).`;
    } else {
      urgencia = 'baja';
      mensaje = `Vence en ${dias} días. Planificar renovación.`;
    }

    const itemAlerta: AlertaDocumento = {
      docId: doc.id,
      nombre: doc.nombre,
      empresaClave: doc.empresaClave,
      fechaVencimiento: doc.fechaVencimiento,
      statusVencimiento: doc.statusVencimiento,
      diasRestantes: dias,
      hitoActual: hito,
      descartada: !debeSonar,
      proximoHitoTexto: proximoTexto,
      mensaje,
      urgencia,
    };

    alertas.push(itemAlerta);
    if (debeSonar) {
      nuevasParaSonar.push(itemAlerta);
    } else {
      totalSilenciadas += 1;
    }
  }

  // Ordenar por urgencia (vencidos primero, luego por menor días restantes)
  alertas.sort((a, b) => {
    const ordenUrg = { alta: 0, media: 1, baja: 2 };
    if (ordenUrg[a.urgencia] !== ordenUrg[b.urgencia]) {
      return ordenUrg[a.urgencia] - ordenUrg[b.urgencia];
    }
    return (a.diasRestantes ?? 9999) - (b.diasRestantes ?? 9999);
  });

  return { alertas, nuevasParaSonar, totalSilenciadas };
}

/**
 * Ejecuta el sonido de notificación nativo para administración si no está silenciado globalmente
 */
export function dispararSonidoAlertaAdmin(): void {
  if (typeof window === 'undefined') return;
  if (!isModuloNotifActivo('administracion')) return;
  const muted = localStorage.getItem(STORAGE_KEY_SONIDO_MUTED) === '1';
  if (muted) return;
  try {
    playNotificationSound();
  } catch { /* audio context error ignore */ }
}

/**
 * Envía una notificación Web Push / Notification nativa en el dispositivo
 * para el módulo de Administración (respetando si el módulo está activo en Ajustes)
 */
export async function emitirNotificacionPushNativa(titulo: string, cuerpo: string, url = '/administracion'): Promise<boolean> {
  return await emitirWebPush({
    titulo,
    cuerpo,
    url,
    modulo: 'administracion',
    tag: 'mgg-admin-alerta',
    vibrar: true,
  });
}

/**
 * Permite al usuario activar o consultar el estado de notificaciones push
 */
export { activarNotificaciones, soportaPush, estadoPermisoNotif };
