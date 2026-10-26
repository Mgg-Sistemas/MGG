import { num } from '@/shared/lib/format';

/**
 * Enlace directo a WhatsApp sin redirigir por wa.me (que corrompe emojis).
 */
export function enlaceWhatsappMaquinaria(texto: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}

/**
 * En dispositivos móviles que admiten navigator.share, usa la hoja de compartir nativa;
 * de lo contrario abre WhatsApp Web / app con el enlace directo.
 */
export async function compartirTextoMaquinaria(texto: string, titulo = 'Reporte de Maquinaria'): Promise<void> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: titulo, text: texto });
      return;
    } catch {
      // Si el usuario cancela o falla, cae al enlace web
    }
  }
  if (typeof window !== 'undefined') {
    window.open(enlaceWhatsappMaquinaria(texto), '_blank', 'noopener,noreferrer');
  }
}

export interface SolicitudServicioParams {
  codigo: string;
  tipo?: string | null;
  urgencia?: string | null;
  equipoNombre: string;
  placaOSerial?: string | null;
  horometro?: number | null;
  kilometraje?: number | null;
  repuestos?: Array<{ nombre: string; cantidad?: number | null; unidad?: string | null }>;
  nota?: string | null;
  solicitante?: string | null;
}

export function mensajeSolicitudServicio(p: SolicitudServicioParams): string {
  const lineas: string[] = [
    '🚜 *SOLICITUD DE SERVICIO / MANTENIMIENTO*',
    `📋 *Orden:* ${p.codigo}`,
    `🚜 *Equipo:* ${p.equipoNombre}${p.placaOSerial ? ` (${p.placaOSerial})` : ''}`,
  ];

  if (p.horometro != null) lineas.push(`⏱️ *Horómetro:* ${num(p.horometro)} h`);
  if (p.kilometraje != null) lineas.push(`🛣️ *Kilometraje:* ${num(p.kilometraje)} km`);
  if (p.tipo) lineas.push(`🔧 *Tipo:* ${p.tipo.toUpperCase()}`);
  if (p.urgencia) lineas.push(`⚠️ *Prioridad:* ${p.urgencia.toUpperCase()}`);

  if (p.repuestos && p.repuestos.length > 0) {
    lineas.push('', '🛠️ *Repuestos e insumos requeridos:*');
    for (const r of p.repuestos) {
      const cant = r.cantidad != null ? ` x${num(r.cantidad)}${r.unidad ? ` ${r.unidad}` : ''}` : '';
      lineas.push(`• ${r.nombre}${cant}`);
    }
  }

  if (p.nota) {
    lineas.push('', `📝 *Observaciones:* ${p.nota}`);
  }

  if (p.solicitante) {
    lineas.push(`👤 *Solicitado por:* ${p.solicitante}`);
  }

  lineas.push('', `⏰ _${new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}_`);
  lineas.push('_MGG · Control de Maquinaria y Equipos_');

  return lineas.join('\n');
}

export interface RegistroLavadoParams {
  equipoNombre: string;
  placa?: string | null;
  tipoLavado?: string | null;
  responsable?: string | null;
  nota?: string | null;
  fecha?: string | null;
}

export function mensajeRegistroLavado(p: RegistroLavadoParams): string {
  const lineas: string[] = [
    '🚿 *REGISTRO DE LAVADO*',
    `🚜 *Equipo:* ${p.equipoNombre}${p.placa ? ` (${p.placa})` : ''}`,
  ];

  if (p.tipoLavado) lineas.push(`🧼 *Tipo de lavado:* ${p.tipoLavado}`);
  if (p.responsable) lineas.push(`👤 *Realizado por:* ${p.responsable}`);
  if (p.nota) lineas.push(`📝 *Observaciones:* ${p.nota}`);

  lineas.push('', `⏰ _${new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', dateStyle: 'medium', timeStyle: 'short' }).format(p.fecha ? new Date(p.fecha) : new Date())}_`);
  lineas.push('_MGG · Control de Maquinaria y Equipos_');

  return lineas.join('\n');
}

export interface ReporteAveriaParams {
  equipoNombre: string;
  placaOSerial?: string | null;
  horometro?: number | null;
  kilometraje?: number | null;
  ubicacion?: string | null;
  falla: string;
  reportadoPor?: string | null;
}

export function mensajeReporteAveria(p: ReporteAveriaParams): string {
  const lineas: string[] = [
    '🚨 *REPORTE DE MAQUINARIA AVERIADA / FUERA DE SERVICIO*',
    `🚜 *Equipo:* ${p.equipoNombre}${p.placaOSerial ? ` (${p.placaOSerial})` : ''}`,
  ];

  if (p.horometro != null) lineas.push(`⏱️ *Horómetro actual:* ${num(p.horometro)} h`);
  if (p.kilometraje != null) lineas.push(`🛣️ *Kilometraje:* ${num(p.kilometraje)} km`);
  if (p.ubicacion) lineas.push(`📍 *Ubicación:* ${p.ubicacion}`);

  lineas.push('', `⚠️ *Falla o motivo:* ${p.falla}`);

  if (p.reportadoPor) {
    lineas.push(`👤 *Reportado por:* ${p.reportadoPor}`);
  }

  lineas.push('', `⏰ _${new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}_`);
  lineas.push('_MGG · Control de Maquinaria y Equipos_');

  return lineas.join('\n');
}

export interface LecturaHorometroParams {
  equipoNombre: string;
  horometro?: number | null;
  kilometraje?: number | null;
  registradoPor?: string | null;
  nota?: string | null;
}

export function mensajeLecturaHorometro(p: LecturaHorometroParams): string {
  const lineas: string[] = [
    '⏱️ *LECTURA DE HORÓMETRO / KM*',
    `🚜 *Equipo:* ${p.equipoNombre}`,
  ];

  if (p.horometro != null) lineas.push(`⏱️ *Horómetro:* ${num(p.horometro)} h`);
  if (p.kilometraje != null) lineas.push(`🛣️ *Kilometraje:* ${num(p.kilometraje)} km`);
  if (p.nota) lineas.push(`📝 *Nota:* ${p.nota}`);
  if (p.registradoPor) lineas.push(`👤 *Registrado por:* ${p.registradoPor}`);

  lineas.push('', `⏰ _${new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}_`);
  lineas.push('_MGG · Control de Maquinaria y Equipos_');

  return lineas.join('\n');
}
