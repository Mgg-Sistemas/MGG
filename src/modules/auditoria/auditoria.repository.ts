/* ============================================================
   MGG · Auditoría de Usuarios (solo administradores)
   Dos fuentes:
   · Tiempo conectado → tabla `user_sessions` (login/heartbeat/logout).
   · Actividad (qué hizo cada quién) → RPC `auditoria_actividad`, un feed
     AGREGADO que une los campos actor/fecha de todas las tablas con actor
     (creó/aprobó/ejecutó/confirmó/cerró). No es un diff campo-por-campo.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { listSesiones, listConectadosAhora, type UserSession } from '@/modules/usuarios/userSessions.repository';

export type { UserSession };
export { listSesiones, listConectadosAhora };

export interface ActividadEvento {
  tabla: string;
  actor: string;
  actor_name: string | null;
  ts: string;         // ISO
  accion: string;     // creó · aprobó · ejecutó · confirmó · cerró
  /** QUÉ se tocó, armado en la base con hasta cuatro datos de la fila
   *  (código, producto, motivo, almacén…). Nulo si esa tabla no tiene
   *  ninguna columna que sirva para describirla. */
  detalle: string | null;
}

/** Lo que se muestra en la columna «Qué»: el detalle real, o un aviso honesto. */
export function queHizo(a: Pick<ActividadEvento, 'detalle'>): string {
  return (a.detalle ?? '').trim() || 'sin detalle registrado';
}

/** ¿Este evento tiene algo concreto que mostrar, o solo dice la acción? */
export function tieneDetalle(a: Pick<ActividadEvento, 'detalle'>): boolean {
  return (a.detalle ?? '').trim() !== '';
}

/** Versión corta para la tabla; el texto completo queda en el detalle del evento. */
export function queHizoCorto(a: Pick<ActividadEvento, 'detalle'>, max = 70): string {
  const t = queHizo(a);
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Actividad del período (opcionalmente filtrada por un actor/email). */
export async function listActividad(desde: string, hasta: string, actor?: string | null): Promise<ActividadEvento[]> {
  const { data, error } = await supabase.rpc('auditoria_actividad', {
    p_desde: `${desde}T00:00:00`,
    p_hasta: `${hasta}T23:59:59.999`,
    p_actor: actor && actor.trim() ? actor.trim() : null,
    p_limit: 8000,
  });
  if (error) throw error;
  return (data ?? []) as ActividadEvento[];
}

/* ───────────── Mapeo tabla → módulo (etiqueta + icono) ───────────── */
interface ModuloInfo { modulo: string; icon: string; }
const MAP: Record<string, ModuloInfo> = {
  movimientos: { modulo: 'Inventario', icon: '📦' },
  existencias: { modulo: 'Inventario', icon: '📦' },
  productos: { modulo: 'Inventario', icon: '📦' },
  almacenes: { modulo: 'Inventario', icon: '🏬' },
  casiterita_detalle: { modulo: 'Inventario · Casiterita', icon: '⛏' },
  solicitudes_salida: { modulo: 'Salidas / Traslados', icon: '↘' },
  ordenes: { modulo: 'Pedidos / Compras', icon: '🧾' },
  compras_directas: { modulo: 'Compras directas', icon: '🛒' },
  servicios_directos: { modulo: 'Servicios directos', icon: '🔧' },
  movimientos_caja: { modulo: 'Tesorería · Caja', icon: '💵' },
  caja_saldos: { modulo: 'Tesorería · Caja', icon: '💵' },
  caja_lotes: { modulo: 'Tesorería · Caja', icon: '💵' },
  cajas: { modulo: 'Tesorería · Caja', icon: '💵' },
  cuentas_por_pagar: { modulo: 'Cuentas por pagar', icon: '📤' },
  cuentas_por_pagar_abonos: { modulo: 'Cuentas por pagar', icon: '📤' },
  cuentas_por_pagar_ingresos: { modulo: 'Cuentas por pagar', icon: '📤' },
  cuentas_por_cobrar: { modulo: 'Cuentas por cobrar', icon: '📥' },
  cuentas_por_cobrar_abonos: { modulo: 'Cuentas por cobrar', icon: '📥' },
  abonos_credito: { modulo: 'Crédito', icon: '💳' },
  transferencias_inter: { modulo: 'Puente inter-sistema', icon: '🔁' },
  transferencias_combustible_inter: { modulo: 'Puente · Combustible', icon: '🔁' },
  transferencias_casiterita_inter: { modulo: 'Puente · Casiterita', icon: '🔁' },
  combustible_movimientos: { modulo: 'Combustible', icon: '⛽' },
  combustible_solicitudes: { modulo: 'Combustible', icon: '⛽' },
  combustible_planta_movimientos: { modulo: 'Combustible · Planta', icon: '⚡' },
  combustible_tanque_movimientos: { modulo: 'Combustible · Tanque', icon: '⛽' },
  cocina_comidas: { modulo: 'Cocina', icon: '🍽' },
  ventas: { modulo: 'Ventas', icon: '🏷' },
  cierres_caja: { modulo: 'Cierres de caja', icon: '🔒' },
  recepciones: { modulo: 'Recepciones', icon: '📥' },
  recepcion_pesajes: { modulo: 'Recepciones · Pesos', icon: '⚖' },
  recepcion_analisis: { modulo: 'Recepciones · Laboratorio', icon: '🧪' },
  recepcion_totales: { modulo: 'Recepciones · Totales', icon: 'Σ' },
  recepcion_conciliaciones: { modulo: 'Recepciones · Conciliación', icon: '🧮' },
  recepcion_cierres: { modulo: 'Recepciones · Cierre', icon: '🔒' },
  acopio_caja_movimientos: { modulo: 'C. Acopio · Caja', icon: '⛏' },
  acopio_aliado_movimientos: { modulo: 'C. Acopio · Aliados', icon: '🤝' },
  acopio_martillos_movimientos: { modulo: 'C. Acopio · Martillos', icon: '🔨' },
  acopio_cajas: { modulo: 'C. Acopio · Cajas', icon: '⛏' },
  nomina_periodos: { modulo: 'RRHH · Nómina', icon: '👥' },
  nomina_renglones: { modulo: 'RRHH · Nómina', icon: '👥' },
  rrhh_eventos: { modulo: 'RRHH', icon: '👥' },
  personal: { modulo: 'RRHH · Personal', icon: '👤' },
  categorias_gasto: { modulo: 'Configuración · Categorías', icon: '⚙' },
};

export function moduloDeTabla(tabla: string): ModuloInfo {
  if (MAP[tabla]) return MAP[tabla];
  // Fallback: prefijo antes del "_" como pista, nombre prettificado.
  const pretty = tabla.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { modulo: pretty, icon: '•' };
}

const ACCION_ICON: Record<string, string> = {
  'creó': '➕', 'aprobó': '✔', 'ejecutó': '⚙', 'confirmó': '✅', 'cerró': '🔒',
};
export function iconoAccion(accion: string): string { return ACCION_ICON[accion] ?? '•'; }

/* ───────────── Tiempo conectado por usuario (desde user_sessions) ───────────── */
export interface ResumenUsuario {
  email: string;
  nombre: string | null;
  msConectado: number;   // milisegundos conectado en el período
  nSesiones: number;
  ultima: string | null; // last_seen_at más reciente
}

/** Duración de una sesión (ms): (ended_at || last_seen_at) − started_at, nunca negativa. */
export function duracionSesionMs(s: UserSession): number {
  const ini = new Date(s.started_at).getTime();
  const fin = new Date(s.ended_at ?? s.last_seen_at).getTime();
  return Math.max(0, fin - ini);
}

/** Agrega las sesiones por usuario (email) con su tiempo total conectado. */
export function resumenPorUsuario(sesiones: UserSession[]): ResumenUsuario[] {
  const m = new Map<string, ResumenUsuario>();
  for (const s of sesiones) {
    const email = (s.email ?? '—').toLowerCase();
    const r = m.get(email) ?? { email, nombre: s.nombre ?? null, msConectado: 0, nSesiones: 0, ultima: null };
    r.msConectado += duracionSesionMs(s);
    r.nSesiones += 1;
    if (!r.nombre && s.nombre) r.nombre = s.nombre;
    if (!r.ultima || new Date(s.last_seen_at) > new Date(r.ultima)) r.ultima = s.last_seen_at;
    m.set(email, r);
  }
  return Array.from(m.values()).sort((a, b) => b.msConectado - a.msConectado);
}

/** Formatea milisegundos como "Xh Ym" (o "Ym" si <1h, o "—"). */
export function fmtDuracion(ms: number): string {
  if (!ms || ms <= 0) return '0m';
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Clave de día local (YYYY-MM-DD) de un ISO. */
export function diaLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
