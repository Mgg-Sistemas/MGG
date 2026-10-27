/* ============================================================
   Golden Touch · Control de Maquinaria · Reportes para WhatsApp
   (26/10/2026)

   Generadores de texto formateado con negritas de WhatsApp (*negrita*),
   viñetas limpias y emojis estándar (sin el selector invisible U+FE0F
   que WhatsApp pierde o rompe).

   Cubre todos los movimientos clave:
   1. Solicitud / Orden de Servicio
   2. Reporte de Lavado de Equipo
   3. Reporte de Avería / Cambio de Estado de Equipo
   4. Solicitud de Compra de Repuestos para Equipo
   ============================================================ */
import { num as fmtNum } from '@/shared/lib/format';

/** Limpia cualquier selector invisible U+FE0F que descompone emojis en WhatsApp. */
const sinSelector = (s: string) => s.replace(/\uFE0F/g, '');

const fechaHoraVE = (d: Date = new Date()): string => {
  const f = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  return f.replace(/,\s*/, ' · ');
};

/* ── 1. Solicitud / Orden de Servicio ── */

export interface DatosServicioWhatsapp {
  codigo?: string | null;
  equipo: string;
  tipoEquipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  tipoServicio: string;
  urgencia?: 'normal' | 'urgente' | string | null;
  horasActuales?: number | null;
  kmActuales?: number | null;
  responsable?: string | null;
  solicitante?: string | null;
  descripcion?: string | null;
  repuestos?: Array<{
    nombre: string;
    cantidad: number;
    unidad?: string | null;
    a_comprar?: number | null;
  }>;
  fecha?: string | Date | null;
}

export function textoServicioWhatsapp(d: DatosServicioWhatsapp): string {
  const urgente = d.urgencia === 'urgente';
  const fechaStr = d.fecha ? fechaHoraVE(new Date(d.fecha)) : fechaHoraVE();
  const eqDetalle = [d.tipoEquipo, d.marca, d.modelo].filter(Boolean).join(' · ');

  const lineas: string[] = [
    sinSelector(`🔧 *MINERAL GROUP GUAYANA C.A.*`),
    sinSelector(`${urgente ? '🚨 *SOLICITUD DE SERVICIO URGENTE*' : '🛠️ *SOLICITUD DE SERVICIO*'}`),
    d.codigo ? `*Código:* ${d.codigo}` : '',
    `*Fecha:* ${fechaStr}`,
    '',
    sinSelector(`🚜 *EQUIPO:* ${d.equipo}`),
    eqDetalle ? `*Detalle:* ${eqDetalle}` : '',
    `*Tipo de servicio:* ${d.tipoServicio.toUpperCase()}`,
    d.horasActuales != null ? `*Horómetro actual:* ${fmtNum(d.horasActuales)} h` : '',
    d.kmActuales != null ? `*Kilometraje actual:* ${fmtNum(d.kmActuales)} km` : '',
    d.responsable ? `*Responsable / Mecánico:* ${d.responsable}` : '',
    d.solicitante ? `*Solicitado por:* ${d.solicitante}` : '',
  ].filter(Boolean);

  if (d.descripcion?.trim()) {
    lineas.push('');
    lineas.push(sinSelector(`📋 *DESCRIPCIÓN / TRABAJO A REALIZAR:*`));
    lineas.push(d.descripcion.trim());
  }

  if (d.repuestos && d.repuestos.length > 0) {
    lineas.push('');
    lineas.push(sinSelector(`🔩 *REPUESTOS / INSUMOS REQUERIDOS:*`));
    d.repuestos.forEach((r) => {
      const cant = `${fmtNum(r.cantidad)} ${r.unidad || 'und'}`;
      const compra = r.a_comprar != null && r.a_comprar > 0 ? ` (🛒 Comprar: ${fmtNum(r.a_comprar)})` : '';
      lineas.push(` • ${r.nombre}: *${cant}*${compra}`);
    });
  }

  lineas.push('');
  lineas.push(sinSelector(`_Enviado desde el Sistema MGG_`));

  return lineas.join('\n');
}

/* ── 2. Reporte de Lavado de Equipo ── */

export interface DatosLavadoWhatsapp {
  equipo: string;
  tipoEquipo?: string | null;
  tipoLavado: string;
  lavador?: string | null;
  responsable?: string | null;
  horasEquipo?: number | null;
  kmEquipo?: number | null;
  notas?: string | null;
  fecha?: string | Date | null;
}

export function textoLavadoWhatsapp(d: DatosLavadoWhatsapp): string {
  const fechaStr = d.fecha ? fechaHoraVE(new Date(d.fecha)) : fechaHoraVE();
  const lineas: string[] = [
    sinSelector(`🚿 *MINERAL GROUP GUAYANA C.A.*`),
    sinSelector(`✨ *REPORTE DE LAVADO DE EQUIPO*`),
    `*Fecha:* ${fechaStr}`,
    '',
    sinSelector(`🚜 *EQUIPO:* ${d.equipo}`),
    d.tipoEquipo ? `*Tipo:* ${d.tipoEquipo}` : '',
    `*Tipo de lavado:* ${d.tipoLavado.toUpperCase()}`,
    d.lavador ? `*Lavador:* ${d.lavador}` : '',
    d.responsable ? `*Registrado por:* ${d.responsable}` : '',
    d.horasEquipo != null ? `*Horas equipo:* ${fmtNum(d.horasEquipo)} h` : '',
    d.kmEquipo != null ? `*KM equipo:* ${fmtNum(d.kmEquipo)} km` : '',
  ].filter(Boolean);

  if (d.notas?.trim()) {
    lineas.push('');
    lineas.push(`*Observaciones:* ${d.notas.trim()}`);
  }

  lineas.push('');
  lineas.push(sinSelector(`_Enviado desde el Sistema MGG_`));

  return lineas.join('\n');
}

/* ── 3. Reporte de Avería / Cambio de Estado ── */

export interface DatosAveriaEstadoWhatsapp {
  equipo: string;
  tipoEquipo?: string | null;
  estadoNuevo: string;
  estadoAnterior?: string | null;
  motivo: string;
  responsable?: string | null;
  horasActuales?: number | null;
  kmActuales?: number | null;
  ubicacion?: string | null;
  fecha?: string | Date | null;
}

export function textoAveriaEstadoWhatsapp(d: DatosAveriaEstadoWhatsapp): string {
  const fechaStr = d.fecha ? fechaHoraVE(new Date(d.fecha)) : fechaHoraVE();
  const esAveria = /averiada|parada|taller|espera/i.test(d.estadoNuevo);
  const icono = esAveria ? '⚠️' : '✅';
  const titulo = esAveria ? 'REPORTE DE AVERÍA / PARADA' : 'CAMBIO DE ESTADO DE EQUIPO';

  const lineas: string[] = [
    sinSelector(`🚨 *MINERAL GROUP GUAYANA C.A.*`),
    sinSelector(`${icono} *${titulo}*`),
    `*Fecha:* ${fechaStr}`,
    '',
    sinSelector(`🚜 *EQUIPO:* ${d.equipo}`),
    d.tipoEquipo ? `*Tipo:* ${d.tipoEquipo}` : '',
    `*Nuevo estado:* *${d.estadoNuevo.toUpperCase()}*`,
    d.estadoAnterior ? `*Estado anterior:* ${d.estadoAnterior.toUpperCase()}` : '',
    d.horasActuales != null ? `*Horómetro:* ${fmtNum(d.horasActuales)} h` : '',
    d.kmActuales != null ? `*Kilometraje:* ${fmtNum(d.kmActuales)} km` : '',
    d.ubicacion ? `*Ubicación:* ${d.ubicacion}` : '',
    d.responsable ? `*Reportado por:* ${d.responsable}` : '',
    '',
    sinSelector(`📋 *MOTIVO / FALLA DETECTADA:*`),
    d.motivo.trim(),
    '',
    sinSelector(`_Enviado desde el Sistema MGG_`),
  ].filter(Boolean);

  return lineas.join('\n');
}

/* ── 4. Solicitud de Compra de Repuestos ── */

export interface DatosCompraRepuestosWhatsapp {
  ordenServicio?: string | null;
  solicitudPedido?: string | null;
  equipo: string;
  piezas: Array<{ nombre: string; cantidad: number; unidad?: string | null }>;
  solicitante?: string | null;
  fecha?: string | Date | null;
}

export function textoCompraRepuestosWhatsapp(d: DatosCompraRepuestosWhatsapp): string {
  const fechaStr = d.fecha ? fechaHoraVE(new Date(d.fecha)) : fechaHoraVE();
  const lineas: string[] = [
    sinSelector(`🛒 *MINERAL GROUP GUAYANA C.A.*`),
    sinSelector(`📦 *SOLICITUD DE COMPRA DE REPUESTOS*`),
    d.ordenServicio ? `*Orden de Servicio:* ${d.ordenServicio}` : '',
    d.solicitudPedido ? `*Solicitud de Pedido:* ${d.solicitudPedido}` : '',
    `*Fecha:* ${fechaStr}`,
    '',
    sinSelector(`🚜 *EQUIPO DESTINO:* ${d.equipo}`),
    d.solicitante ? `*Solicitado por:* ${d.solicitante}` : '',
    '',
    sinSelector(`🔩 *PIEZAS / INSUMOS A COMPRAR:*`),
  ].filter(Boolean);

  d.piezas.forEach((p) => {
    lineas.push(` • ${p.nombre}: *${fmtNum(p.cantidad)} ${p.unidad || 'und'}*`);
  });

  lineas.push('');
  lineas.push(sinSelector(`_Compras asignará marca comercial y especificaciones técnicas_`));
  lineas.push(sinSelector(`_Enviado desde el Sistema MGG_`));

  return lineas.join('\n');
}

/* ── 5. Ficha de Filtros y Repuestos del Equipo para Compras ── */

export interface DatosFichaFiltrosWhatsapp {
  equipo: string;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  motor?: string | null;
  horasActuales?: number | null;
  filtros: Array<{
    sistema: string;
    tipo: string;
    numeroParte?: string | null;
    equivalencias?: string[] | null;
    especificacion?: string | null;
  }>;
}

export function textoFichaFiltrosWhatsapp(d: DatosFichaFiltrosWhatsapp): string {
  const lineas: string[] = [
    sinSelector(`🔍 *MINERAL GROUP GUAYANA C.A.*`),
    sinSelector(`🚜 *FICHA DE FILTROS Y ESPECIFICACIONES*`),
    `*Equipo:* *${d.equipo}*`,
    [d.tipo, d.marca, d.modelo].filter(Boolean).join(' · '),
    d.motor ? `*Motor:* ${d.motor}` : '',
    d.horasActuales != null ? `*Horómetro actual:* ${fmtNum(d.horasActuales)} h` : '',
    '',
    sinSelector(`🏷️ *FILTROS Y NÚMEROS DE PARTE:*`),
  ].filter(Boolean);

  if (!d.filtros.length) {
    lineas.push(` • _Sin ficha de repuestos cargada aún_`);
  } else {
    d.filtros.forEach((f) => {
      const parte = f.numeroParte ? ` OEM: ${f.numeroParte}` : '';
      const equiv = f.equivalencias && f.equivalencias.length > 0 ? ` (Marcas: ${f.equivalencias.join(' · ')})` : '';
      const esp = f.especificacion ? ` [${f.especificacion}]` : '';
      lineas.push(` • *${f.tipo}:*${parte}${equiv}${esp}`);
    });
  }

  lineas.push('');
  lineas.push(sinSelector(`_Enviado desde el Sistema MGG_`));
  return lineas.join('\n');
}

/* ── 6. Reporte de Estado y Mantenimiento de Máquina / Vehículo ── */

export interface DatosEstadoEquipoWhatsapp {
  equipo: string;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  estado: string;
  encargado?: string | null;
  horometro?: number | null;
  kilometraje?: number | null;
  horasFaltantes?: number | null;
  nivelAviso?: 'ok' | 'proximo' | 'vencido' | string | null;
  unidadAviso?: 'h' | 'km' | null;
}

export function textoEstadoEquipoWhatsapp(d: DatosEstadoEquipoWhatsapp): string {
  const lineas: string[] = [
    sinSelector(`🚜 *MINERAL GROUP GUAYANA C.A.*`),
    sinSelector(`📋 *ESTADO DE MÁQUINA / VEHÍCULO*`),
    `*Equipo:* *${d.equipo}*`,
    [d.tipo, d.marca, d.modelo].filter(Boolean).join(' · '),
    d.encargado ? `*Encargado responsable:* 👤 ${d.encargado}` : '',
    `*Condición actual:* ${d.estado.toUpperCase()}`,
    '',
    sinSelector(`⏱️ *LECTURAS Y HORAS DE SERVICIO:*`),
  ].filter(Boolean);

  if (d.horometro != null) lineas.push(` • Horómetro: *${fmtNum(d.horometro)} h*`);
  if (d.kilometraje != null) lineas.push(` • Kilometraje: *${fmtNum(d.kilometraje)} km*`);

  if (d.nivelAviso === 'vencido' && d.horasFaltantes != null) {
    lineas.push(` • ⛔ *Mantenimiento VENCIDO por:* ${fmtNum(Math.abs(d.horasFaltantes))} ${d.unidadAviso || 'h'}`);
  } else if (d.nivelAviso === 'proximo' && d.horasFaltantes != null) {
    lineas.push(` • ⚠️ *Próximo mantenimiento en:* ${fmtNum(d.horasFaltantes)} ${d.unidadAviso || 'h'}`);
  } else if (d.horasFaltantes != null) {
    lineas.push(` • 🟢 *Faltan para mantenimiento:* ${fmtNum(d.horasFaltantes)} ${d.unidadAviso || 'h'}`);
  } else {
    lineas.push(` • _Sin intervalo de mantenimiento asignado_`);
  }

  lineas.push('');
  lineas.push(sinSelector(`_Generado desde la vista móvil de MGG_`));
  return lineas.join('\n');
}

/* ── 7. Alerta de mantenimiento próximo / vencido con la respuesta del encargado ── */

export interface DatosAlertaMantenimientoWhatsapp {
  equipo: string;
  placa?: string | null;
  nivel: 'proximo' | 'vencido';
  unidad: 'h' | 'km';
  /** Lectura vigente del contador (horómetro en h, odómetro en km). */
  lectura: number | null;
  /** Frecuencia del servicio (cada N h / km). */
  frecuencia: number | null;
  /** Lo que resta para el servicio (negativo = ya pasado). */
  restante: number | null;
  decision: 'hara' | 'no_hara';
  mensaje: string;
  responsable: string;
  /** ISO o dd/mm/aaaa: si ya viene como dd/mm/aaaa se usa tal cual. */
  fecha: string;
}

const fechaAlerta = (f: string): string => {
  if (/^\d{2}\/\d{2}\/\d{4}/.test(f)) return f;
  const d = new Date(f);
  return Number.isNaN(d.getTime()) ? f : fechaHoraVE(d);
};

/**
 * Texto de la alerta de mantenimiento (26/10/2026). La primera línea cambia según el nivel:
 * «ALERTA MANTENIMIENTO - RETRASADO» (vencido) o «ALERTA MANTENIMIENTO - PRÓXIMO».
 * Vencido → «pasado por N h»; próximo → «faltan N h».
 */
export function textoAlertaMantenimientoWhatsapp(d: DatosAlertaMantenimientoWhatsapp): string {
  const vencido = d.nivel === 'vencido';
  const u = d.unidad;
  const lecturaLinea = d.lectura == null
    ? ''
    : u === 'h' ? `⏱ Horómetro: ${fmtNum(d.lectura)} h` : `🛣 Kilometraje: ${fmtNum(d.lectura)} km`;
  const cada = d.frecuencia != null
    ? `Servicio cada ${fmtNum(d.frecuencia)} ${u}`
    : `Servicio por ${u === 'h' ? 'horas' : 'kilómetros'}`;
  const resto = d.restante == null
    ? ''
    : vencido ? `pasado por ${fmtNum(Math.abs(d.restante))} ${u}` : `faltan ${fmtNum(d.restante)} ${u}`;

  const lineas: string[] = [
    sinSelector(vencido ? '🚨 *ALERTA MANTENIMIENTO - RETRASADO*' : '⚠️ *ALERTA MANTENIMIENTO - PRÓXIMO*'),
    sinSelector(`🚜 Equipo: ${d.equipo}${d.placa ? ` · Placa ${d.placa}` : ''}`),
    sinSelector(lecturaLinea),
    sinSelector(`🔧 ${cada}${resto ? ` · ${resto}` : ''}`),
    sinSelector(`📅 ${fechaAlerta(d.fecha)}`),
    sinSelector(d.decision === 'hara' ? '✅ Decisión: SÍ se hará el mantenimiento' : '❌ Decisión: NO se hará el mantenimiento'),
    sinSelector(`📝 Mensaje: ${d.mensaje.trim()}`),
    sinSelector(`👤 Responsable: ${d.responsable}`),
  ].filter(Boolean);

  lineas.push('');
  lineas.push(sinSelector(`_Enviado desde el Sistema MGG_`));
  return lineas.join('\n');
}
