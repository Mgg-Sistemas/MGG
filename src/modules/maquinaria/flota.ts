/* ============================================================
   Golden Touch · Control de Maquinaria · Flota y Servicio
   Reglas puras (sin Supabase) del catálogo y del expediente del equipo:
   estados operativos, franja de flota, tipos de servicio, la decisión
   inventario / parcial / compra de cada repuesto, el tablero de compras
   del equipo y qué acciones ve cada usuario según sus permisos.
   La base aplica las mismas reglas (maquinaria_estado_efectivo,
   maquinaria_crear_orden_servicio); aquí se usan para pintar y avisar.
   ============================================================ */
import { norm } from '@/shared/lib/texto';

/* ───────── Estados del equipo ───────── */

export type EstadoEquipo = 'operativa' | 'averiada' | 'parada' | 'taller' | 'repuestos' | 'espera' | 'retirada';
export type BucketFlota = 'operativas' | 'averiadas' | 'taller' | 'espera' | 'retiradas';
export type TonoFlota = 'success' | 'danger' | 'warning' | 'primary' | 'wait' | 'retired' | 'info';

export const ESTADOS_EQUIPO: Record<EstadoEquipo, { label: string; icon: string; tono: TonoFlota; bucket: BucketFlota }> = {
  operativa: { label: 'Operativa', icon: '✅', tono: 'success', bucket: 'operativas' },
  averiada: { label: 'Averiada', icon: '🔴', tono: 'danger', bucket: 'averiadas' },
  parada: { label: 'Parada', icon: '🟡', tono: 'warning', bucket: 'averiadas' },
  taller: { label: 'En taller', icon: '🔧', tono: 'primary', bucket: 'taller' },
  repuestos: { label: 'Esperando repuestos', icon: '⏸️', tono: 'warning', bucket: 'taller' },
  espera: { label: 'Esperando instrucciones', icon: '⏳', tono: 'wait', bucket: 'espera' },
  retirada: { label: 'Retirada', icon: '⬛', tono: 'retired', bucket: 'retiradas' },
};

export const BUCKETS_FLOTA: { id: BucketFlota; label: string; icon: string; tono: TonoFlota }[] = [
  { id: 'operativas', label: 'Operativas', icon: '✅', tono: 'success' },
  { id: 'averiadas', label: 'Averiadas', icon: '🔴', tono: 'danger' },
  { id: 'taller', label: 'En taller', icon: '🔧', tono: 'primary' },
  { id: 'espera', label: 'En espera', icon: '⏳', tono: 'wait' },
  { id: 'retiradas', label: 'Retiradas', icon: '⬛', tono: 'retired' },
];

const ESTADOS_VALIDOS = new Set(Object.keys(ESTADOS_EQUIPO));

/**
 * Estado efectivo de un equipo. Los equipos anteriores al 09/10/2026 no tienen
 * `estado_operativo`: se deduce del status de siempre, sin tocar el dato guardado.
 * Inactivo (activo = false) siempre cuenta como retirada.
 */
export function estadoEfectivo(e: { estado_operativo?: string | null; status?: string | null; activo?: boolean | null }): EstadoEquipo {
  if (e.activo === false) return 'retirada';
  if (e.estado_operativo && ESTADOS_VALIDOS.has(e.estado_operativo)) return e.estado_operativo as EstadoEquipo;
  switch ((e.status ?? '').trim().toUpperCase()) {
    case 'MANTENIMIENTO': return 'taller';
    case 'FUERA DE SERVICIO': return 'averiada';
    case 'INACTIVO': return 'retirada';
    default: return 'operativa';
  }
}

/** Status clásico que corresponde a un estado (el mismo mapeo que la base). */
export function statusDeEstado(estado: EstadoEquipo): string {
  if (estado === 'averiada' || estado === 'parada') return 'FUERA DE SERVICIO';
  if (estado === 'taller' || estado === 'repuestos') return 'MANTENIMIENTO';
  if (estado === 'retirada') return 'INACTIVO';
  return 'ACTIVO';
}

/** ¿El cambio de estado exige motivo? (la base pide al menos 3 letras). */
export function estadoExigeMotivo(estado: EstadoEquipo): boolean {
  return estado === 'averiada' || estado === 'parada' || estado === 'espera' || estado === 'retirada';
}

/* ───────── Clase del equipo (para el filtro Maquinaria y Equipos / Vehículos / Motos / Lanchas) ───────── */

export type ClaseEquipo = 'maquinaria' | 'vehiculo' | 'moto' | 'lancha' | 'equipo';

export const CLASES_EQUIPO: { id: ClaseEquipo; label: string; icon: string }[] = [
  { id: 'maquinaria', label: 'Maquinaria y Equipos', icon: '🚜' },
  { id: 'vehiculo', label: 'Vehículos', icon: '🚚' },
  { id: 'moto', label: 'Motos', icon: '🏍️' },
  { id: 'lancha', label: 'Lanchas', icon: '🚤' },
];

/** Deduce la clase del grupo de mantenimiento (si lo tiene) o del tipo del equipo. */
export function claseEquipo(e: { tipo?: string | null; grupo_mantenimiento?: string | null }): ClaseEquipo {
  const g = norm(e.grupo_mantenimiento);
  const t = norm(e.tipo);

  // 1. Lanchas y embarcaciones
  if (/lancha|bote|embarca|penero|penyero|yate|canoa|flotante|marino|maritimo|fuera de borda/.test(t) ||
      /lancha|bote|embarca/.test(g)) {
    return 'lancha';
  }

  // 2. Motos y motocicletas (excluye maquinaria pesada con prefijo moto como motoniveladora, motobomba, motosierra)
  const esEquipoConPrefijoMoto = /motoniveladora|motobomba|motosierra/.test(t);
  if (!esEquipoConPrefijoMoto && (/\bmoto\b|\bmotos\b|motocicleta|cuatrimoto|fourtrack|trimoto/.test(t) || /\bmoto\b|\bmotos\b|motocicleta/.test(g))) {
    return 'moto';
  }

  // 3. Vehículos terrestres (carros, camiones, camionetas, gandolas, buses, etc.)
  if (g.includes('vehiculo')) return 'vehiculo';
  if (/vehiculo|carro|camion|gandola|camioneta|pickup|\bauto\b|\bautos\b|van\b|autobus|\bbus\b|encava|jeep|chuto|remolque|volteo|cisterna/.test(t)) {
    return 'vehiculo';
  }

  // 4. Maquinaria y Equipos unificados (excavadoras, plantas eléctricas, generadores, compresores, bombas, soldadores, tractores, etc.)
  return 'maquinaria';
}

/* ───────── Mantenimiento por horas / km (misma regla que la tabla de siempre) ───────── */

/** % del intervalo con el que se avisa «servicio próximo» (cada 250 h → avisa con ≤ 25 h). */
export const MARGEN_ALERTA_PCT = 0.1;

/**
 * Frecuencia de servicio por defecto (26/10/2026): regla de la empresa, todo equipo recibe
 * mantenimiento cada 250 horas y la alerta salta al superarlas. Es también el `default`
 * de la columna `maquinaria_equipos.mantenimiento_cada_hrs`.
 */
export const FRECUENCIA_HRS_DEFAULT = 250;

/** Frecuencia de servicio por horas del equipo; si no tiene una cargada (o es 0), la de la empresa (250 h). */
export function frecuenciaHrs(e: { mantenimiento_cada_hrs?: number | null }): number {
  return Number(e.mantenimiento_cada_hrs) > 0 ? Number(e.mantenimiento_cada_hrs) : FRECUENCIA_HRS_DEFAULT;
}

/** Unidades restantes hasta el próximo servicio. Con base: N − (lectura − base); sin base: siguiente múltiplo de N. */
export function restantesServicio(frecuencia: number | null | undefined, lectura: number | null | undefined, base: number | null | undefined): number | null {
  if (!frecuencia || frecuencia <= 0 || lectura == null) return null;
  if (base != null) return Math.round((frecuencia - (lectura - base)) * 100) / 100;
  return (frecuencia - (lectura % frecuencia)) % frecuencia;
}

export interface AvisoServicio {
  nivel: 'ok' | 'proximo' | 'vencido';
  restante: number;
  unidad: 'h' | 'km';
  /** % del intervalo ya consumido (0–100), para la barrita. */
  pct: number;
  /** Fracción consumida SIN tope (1,2 = pasado un 20 %): sirve para ordenar por urgencia. */
  ratio: number;
}

/** Aviso de servicio de una dimensión (horas o km). null si falta el intervalo o la lectura. */
export function avisoServicio(frecuencia: number | null | undefined, lectura: number | null | undefined, base: number | null | undefined, unidad: 'h' | 'km'): AvisoServicio | null {
  const restante = restantesServicio(frecuencia, lectura, base);
  if (restante == null || !frecuencia) return null;
  const pct = Math.min(100, Math.max(0, ((frecuencia - restante) / frecuencia) * 100));
  const nivel = restante <= 0 ? 'vencido' : restante <= frecuencia * MARGEN_ALERTA_PCT ? 'proximo' : 'ok';
  return { nivel, restante, unidad, pct, ratio: (frecuencia - restante) / frecuencia };
}

/** El aviso más urgente entre horas y km (vencido > próximo > ok; a igual nivel, el de menor % restante). */
export function avisoMasUrgente(a: AvisoServicio | null, b: AvisoServicio | null): AvisoServicio | null {
  if (!a) return b;
  if (!b) return a;
  const peso = { vencido: 2, proximo: 1, ok: 0 } as const;
  if (peso[a.nivel] !== peso[b.nivel]) return peso[a.nivel] > peso[b.nivel] ? a : b;
  return a.pct >= b.pct ? a : b;
}

/* ───────── Órdenes de servicio ───────── */

export const SERVICIOS: { id: string; label: string; icon: string; hint: string; bitacora: string }[] = [
  { id: 'preventivo', label: 'Mantenimiento preventivo', icon: '🧰', hint: 'Según horas / km', bitacora: 'servicio' },
  { id: 'reparacion', label: 'Reparación', icon: '🛠️', hint: 'Corrige una avería', bitacora: 'reparacion' },
  { id: 'cambio_pieza', label: 'Cambio de piezas', icon: '⚙️', hint: 'Repuestos y componentes', bitacora: 'cambio_pieza' },
  { id: 'cauchos', label: 'Cauchos / neumáticos', icon: '🛞', hint: 'Cambio o reparación', bitacora: 'cambio_caucho' },
  { id: 'aceite', label: 'Aceite y filtros', icon: '🛢️', hint: 'Cambio de aceite y filtros', bitacora: 'cambio_aceite' },
  { id: 'frenos', label: 'Frenos', icon: '🛑', hint: 'Pastillas, bandas, líquido', bitacora: 'frenos' },
  { id: 'electrico', label: 'Sistema eléctrico', icon: '💡', hint: 'Batería, arranque, luces', bitacora: 'sistema_electrico' },
  { id: 'hidraulico', label: 'Sistema hidráulico', icon: '💧', hint: 'Mangueras, gatos, bombas', bitacora: 'sistema_hidraulico' },
  { id: 'soldadura', label: 'Soldadura', icon: '🔥', hint: 'Estructura, balde, tolva', bitacora: 'soldadura' },
  { id: 'pintura', label: 'Pintura / latonería', icon: '🎨', hint: 'Carrocería y cabina', bitacora: 'pintura' },
  { id: 'inspeccion', label: 'Inspección', icon: '🔍', hint: 'Revisión técnica', bitacora: 'inspeccion' },
  { id: 'otro', label: 'Otro', icon: '✏️', hint: 'Describe el trabajo', bitacora: 'otro' },
];

export function servicioPorId(id: string | null | undefined) {
  return SERVICIOS.find((s) => s.id === id) ?? null;
}

/**
 * Qué se hace dentro de cada tipo de servicio (12/10/2026): al elegir el tipo, el asistente
 * muestra estas opciones y se marcan una o varias. «Otro» no trae: se describe a mano.
 */
export const TRABAJOS_SERVICIO: Record<string, string[]> = {
  preventivo: ['Servicio por horas / km', 'Engrase general', 'Revisión de niveles', 'Limpieza de filtro de aire', 'Ajuste general'],
  reparacion: ['Motor', 'Transmisión', 'Tren de rodaje', 'Diferencial', 'Sistema de enfriamiento', 'Aire acondicionado', 'Cabina'],
  cambio_pieza: ['Cambio de pieza', 'Reparación de pieza', 'Instalación de componente nuevo'],
  cauchos: ['Cambio de caucho', 'Reparación de caucho', 'Caucho espichado', 'Cambio de tripa', 'Rotación', 'Alineación y balanceo'],
  aceite: ['Cambio de aceite de motor', 'Cambio de filtro de aceite', 'Cambio de filtro de combustible', 'Cambio de filtro de aire', 'Cambio de aceite hidráulico', 'Cambio de aceite de transmisión'],
  frenos: ['Cambio de pastillas', 'Cambio de bandas', 'Cambio / purga de líquido', 'Ajuste de frenos', 'Freno de mano'],
  electrico: ['Batería', 'Motor de arranque', 'Alternador', 'Luces', 'Cableado / cortocircuito', 'Tablero'],
  hidraulico: ['Cambio de manguera', 'Fuga hidráulica', 'Gato / cilindro', 'Bomba hidráulica', 'Cambio de aceite hidráulico'],
  soldadura: ['Estructura / chasis', 'Balde / cucharón', 'Tolva', 'Dientes del balde', 'Refuerzo'],
  pintura: ['Pintura general', 'Retoque', 'Latonería', 'Cabina', 'Parabrisas / vidrios'],
  inspeccion: ['Inspección general', 'Revisión antes de operar', 'Diagnóstico de falla', 'Informe técnico'],
};

/** Opciones de «¿Qué se hace?» del tipo de servicio (vacío si no tiene). */
export function trabajosDe(tipo: string | null | undefined): string[] {
  return (tipo && TRABAJOS_SERVICIO[tipo]) || [];
}

/** «Cauchos / neumáticos: Cambio de caucho, Caucho espichado» (o solo el tipo si no se marcó nada). */
export function etiquetaServicio(tipo: string | null | undefined, trabajos?: string[] | null): string {
  const base = servicioPorId(tipo)?.label ?? tipo ?? 'Servicio';
  return trabajos?.length ? `${base}: ${trabajos.join(', ')}` : base;
}

/** Sugiere el tipo de servicio a partir del motivo de la avería o del aviso de horas. */
export function sugerirServicio(nota: string | null | undefined, aviso: AvisoServicio | null): string | null {
  const t = norm(nota);
  if (t) {
    if (/caucho|neumatic|llanta|rueda/.test(t)) return 'cauchos';
    if (/gato|hidraul|manguera|bomba/.test(t)) return 'hidraulico';
    if (/freno|banda|pastilla/.test(t)) return 'frenos';
    if (/bateria|arranque|electric|luces|alternador/.test(t)) return 'electrico';
    if (/aceite|filtro/.test(t)) return 'aceite';
    if (/soldad|fisura|balde|tolva/.test(t)) return 'soldadura';
    return 'reparacion';
  }
  if (aviso && aviso.nivel !== 'ok') return 'preventivo';
  return null;
}

export const URGENCIAS: { id: 'normal' | 'alta' | 'urgente'; label: string; tono: TonoFlota }[] = [
  { id: 'normal', label: 'Normal', tono: 'info' },
  { id: 'alta', label: 'Alta', tono: 'warning' },
  { id: 'urgente', label: 'Urgente', tono: 'danger' },
];

export const INTERVENCIONES = ['Mecánica', 'Electricidad', 'Mangueras / hidráulica', 'Servicio'];

/**
 * Tipo de intervención según el servicio elegido (12/10/2026): cada servicio muestra solo
 * las que le corresponden y la primera viene marcada. «Otro» muestra las generales.
 */
export const INTERVENCIONES_SERVICIO: Record<string, string[]> = {
  preventivo: ['Servicio', 'Lubricación', 'Mecánica', 'Electricidad'],
  reparacion: ['Mecánica', 'Electricidad', 'Mangueras / hidráulica', 'Soldadura'],
  cambio_pieza: ['Mecánica', 'Electricidad', 'Mangueras / hidráulica'],
  cauchos: ['Cauchera / vulcanización', 'Mecánica'],
  aceite: ['Lubricación', 'Servicio'],
  frenos: ['Mecánica', 'Mangueras / hidráulica'],
  electrico: ['Electricidad', 'Electrónica / diagnóstico'],
  hidraulico: ['Mangueras / hidráulica', 'Mecánica'],
  soldadura: ['Soldadura', 'Mecánica'],
  pintura: ['Pintura', 'Latonería'],
  inspeccion: ['Mecánica', 'Electricidad', 'Mangueras / hidráulica', 'Servicio'],
};

/** Opciones de «Tipo de intervención» del servicio (las generales si no tiene propias). */
export function intervencionesDe(tipo: string | null | undefined): string[] {
  return (tipo && INTERVENCIONES_SERVICIO[tipo]) || INTERVENCIONES;
}

/** Al cambiar de servicio: se quedan las marcadas que siguen aplicando; si no queda ninguna, la primera del nuevo. */
export function ajustarIntervenciones(tipo: string | null | undefined, actuales: string[]): string[] {
  const opciones = intervencionesDe(tipo);
  const quedan = actuales.filter((i) => opciones.includes(i));
  return quedan.length ? quedan : opciones.slice(0, 1);
}

export type EstadoOrdenServicio = 'abierta' | 'repuestos' | 'en_proceso' | 'realizada' | 'anulada' | 'cancelada';

export const ORDEN_ESTADOS: Record<EstadoOrdenServicio, { label: string; icon: string; tono: TonoFlota }> = {
  abierta: { label: 'Abierta', icon: '🟠', tono: 'primary' },
  repuestos: { label: 'Esperando repuestos', icon: '⏸️', tono: 'warning' },
  en_proceso: { label: 'En proceso', icon: '🔧', tono: 'info' },
  realizada: { label: 'Realizada', icon: '✅', tono: 'success' },
  anulada: { label: 'Anulada', icon: '⛔', tono: 'retired' },
  cancelada: { label: 'Cancelada en compras', icon: '❌', tono: 'retired' },
};

export const ORDEN_FLUJO: EstadoOrdenServicio[] = ['abierta', 'repuestos', 'en_proceso', 'realizada'];

export function ordenAbierta(estado: string): boolean {
  return estado === 'abierta' || estado === 'repuestos' || estado === 'en_proceso';
}

/** Pasos que puede dar una orden desde su estado (mismas transiciones que la base). */
export function siguientesEstadosOrden(estado: string): EstadoOrdenServicio[] {
  if (estado === 'abierta') return ['en_proceso', 'realizada', 'anulada'];
  if (estado === 'repuestos') return ['en_proceso', 'anulada'];
  if (estado === 'en_proceso') return ['realizada', 'anulada'];
  return [];
}

/* ───────── Regla central: ¿de dónde sale cada repuesto? ───────── */

export type OrigenRepuesto = 'stock' | 'parcial' | 'compra';

/**
 *  - stock suficiente  → sale del inventario
 *  - stock parcial     → lo disponible sale del inventario y el resto va a compra
 *  - sin stock / nuevo → todo va a compra
 */
export function decidirRepuesto(cantidad: number, existencia: number | null | undefined): { desdeInventario: number; aComprar: number; tipo: OrigenRepuesto } {
  const qty = Math.max(0, Number(cantidad) || 0);
  const stock = Math.max(0, Number(existencia) || 0);
  const desdeInventario = Math.min(qty, stock);
  const aComprar = Math.round((qty - desdeInventario) * 10000) / 10000;
  const tipo: OrigenRepuesto = aComprar === 0 ? 'stock' : desdeInventario > 0 ? 'parcial' : 'compra';
  return { desdeInventario, aComprar, tipo };
}

/** Un repuesto ya decidido (así lo guarda la base en la orden). */
export interface RepuestoOrden {
  producto_id: string | null;
  nombre: string;
  unidad: string;
  almacen: string | null;
  cantidad: number;
  stock_al_crear: number;
  desde_inventario: number;
  a_comprar: number;
  origen: OrigenRepuesto;
  /** Nombre con que se pidió cuando era una pieza nueva (antes de cambiarla por el producto). */
  pieza_nueva?: string | null;
}

/** Resumen de lo que va a pasar al confirmar la orden. */
export function efectoOrden(repuestos: Pick<RepuestoOrden, 'producto_id' | 'desde_inventario' | 'a_comprar'>[]): {
  salen: number; compran: number; nuevos: number; estadoOrden: EstadoOrdenServicio; estadoEquipo: EstadoEquipo;
} {
  const salen = repuestos.filter((r) => r.producto_id && r.desde_inventario > 0).length;
  const compran = repuestos.filter((r) => r.a_comprar > 0).length;
  const nuevos = repuestos.filter((r) => !r.producto_id).length;
  const estadoOrden: EstadoOrdenServicio = compran > 0 ? 'repuestos' : 'abierta';
  return { salen, compran, nuevos, estadoOrden, estadoEquipo: compran > 0 ? 'repuestos' : 'taller' };
}

/** ¿Falta pedir la salida de inventario de esta orden? */
export function faltaSalida(o: { estado: string; solicitud_salida_id: string | null; repuestos: Pick<RepuestoOrden, 'producto_id' | 'desde_inventario' | 'a_comprar'>[] }): boolean {
  return !o.solicitud_salida_id && o.estado !== 'anulada' && o.estado !== 'realizada'
    && o.repuestos.some((r) => r.producto_id && r.desde_inventario > 0);
}

/** ¿Falta pedir la compra de esta orden? (solo los productos del inventario entran a una SP) */
export function faltaCompra(o: { estado: string; orden_compra_id: string | null; repuestos: Pick<RepuestoOrden, 'producto_id' | 'desde_inventario' | 'a_comprar'>[] }): boolean {
  return !o.orden_compra_id && o.estado !== 'anulada' && o.estado !== 'realizada'
    && o.repuestos.some((r) => r.a_comprar > 0);
}

/* ───────── Piezas que no existen en el inventario ───────── */

/** Repuestos de la orden que todavía no existen en el inventario (los da de alta Compras). */
export function piezasNuevas<T extends Pick<RepuestoOrden, 'producto_id'>>(repuestos: T[]): T[] {
  return repuestos.filter((r) => !r.producto_id);
}

/**
 * ¿Se puede cambiar esta pieza nueva por el producto que Compras dio de alta? Solo una
 * pieza nueva, con la orden abierta y sin solicitud de pedido vinculada (si ya hay SP, la
 * pieza se corrige allí, en Pedidos). Es la misma regla de `maquinaria_reemplazar_pieza_orden`.
 */
export function puedeReemplazarPieza(o: { estado: string; orden_compra_id: string | null; repuestos: Pick<RepuestoOrden, 'producto_id'>[] }, indice: number): boolean {
  const r = o.repuestos[indice];
  return !!r && !r.producto_id && ordenAbierta(o.estado) && !o.orden_compra_id;
}

/**
 * Los repuestos de una orden se pueden editar mientras no empezó el trabajo (abierta o
 * esperando repuestos) y no tiene salida ni pedido vinculados: después se corrigen allá.
 * Es la misma regla de `maquinaria_editar_orden_servicio`.
 */
export function repuestosEditables(o: { estado: string; solicitud_salida_id: string | null; orden_compra_id: string | null }): boolean {
  return (o.estado === 'abierta' || o.estado === 'repuestos') && !o.solicitud_salida_id && !o.orden_compra_id;
}

/**
 * Quién puede borrar una orden: con permiso de Maquinaria, salvo que el servicio ya esté
 * realizado (traza completa): esa solo la borra un administrador. Igual que el trigger.
 */
export function puedeBorrarOrden(o: { estado: string }, perm: { maquinaria: boolean; admin: boolean }): boolean {
  if (perm.admin) return true;
  return perm.maquinaria && o.estado !== 'realizada';
}

/** Solo hay piezas nuevas por comprar: no se puede armar la SP (Pedidos necesita el producto). */
/** Categoría del inventario de las piezas nuevas que da de alta Maquinaria (12/10/2026). */
export const CATEGORIA_REPUESTOS = 'REPUESTOS';

/** En el teléfono la categoría de una pieza nueva es fija (REPUESTOS): sin selector, sin errores. */
export function categoriaFijaEnTelefono(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches;
}

export function soloPiezasNuevasPorComprar(repuestos: Pick<RepuestoOrden, 'producto_id' | 'a_comprar'>[]): boolean {
  const porComprar = repuestos.filter((r) => r.a_comprar > 0);
  return porComprar.length > 0 && porComprar.every((r) => !r.producto_id);
}

/* ───────── Lavados ───────── */

export const TIPOS_LAVADO: { id: string; label: string; icon: string; hint: string }[] = [
  { id: 'Completo', label: 'Completo', icon: '✨', hint: 'Exterior, interior y motor' },
  { id: 'Exterior', label: 'Exterior', icon: '🚿', hint: 'Carrocería y tren de rodaje' },
  { id: 'Interior', label: 'Interior', icon: '🪑', hint: 'Cabina' },
  { id: 'Motor', label: 'Motor', icon: '🛢️', hint: 'Desengrase del compartimiento' },
  { id: 'Chasis', label: 'Chasis', icon: '🔩', hint: 'Bajos y estructura' },
];

/** Días de calendario (hora local) entre una fecha y hoy. Nunca negativo; null si no hay fecha. */
export function diasDesde(fecha: string | Date | null | undefined, hoy: Date = new Date()): number | null {
  if (!fecha) return null;
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return null;
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** «hoy», «ayer», «hace 5 días». */
export function textoHace(dias: number | null): string {
  if (dias == null) return 'sin registro';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/** El lavado más reciente de una lista (por fecha). */
export function ultimoLavado<T extends { fecha: string }>(lavados: T[]): T | null {
  return lavados.reduce<T | null>((m, l) => (!m || l.fecha > m.fecha ? l : m), null);
}

/** Tipo de lavado escrito: uno de la lista o el que la persona escribió (mín. 3 letras). */
export function tipoLavadoValido(tipo: string | null | undefined): boolean {
  return (tipo ?? '').trim().length >= 3;
}

/* ───────── Compras del equipo (tablero de solo lectura) ───────── */

export type ColumnaCompra = 'solicitada' | 'aprobada' | 'ordenada' | 'pagada' | 'recibida' | 'finalizada' | 'cancelada';

export const COLUMNAS_COMPRA: { id: ColumnaCompra; label: string; icon: string; tono: TonoFlota }[] = [
  { id: 'solicitada', label: 'Solicitada', icon: '📝', tono: 'info' },
  { id: 'aprobada', label: 'Aprobada', icon: '✅', tono: 'wait' },
  { id: 'ordenada', label: 'Orden de compra', icon: '🧾', tono: 'primary' },
  { id: 'pagada', label: 'Pagada', icon: '💳', tono: 'warning' },
  { id: 'recibida', label: 'Recibida', icon: '📦', tono: 'success' },
  { id: 'finalizada', label: 'Finalizada', icon: '🏁', tono: 'success' },
  { id: 'cancelada', label: 'Cancelada', icon: '⛔', tono: 'retired' },
];

/** Agrupa los 15 estados de Pedidos en las 7 columnas del tablero del equipo. */
export function columnaCompra(estado: string | null | undefined): ColumnaCompra {
  switch (estado) {
    case 'pendiente': return 'solicitada';
    case 'aprobada': return 'aprobada';
    case 'oc_creada': case 'confirmada_metodo': case 'oc_aprobada': case 'cuenta_abierta': case 'oc_emitida': case 'por_recibir':
    case 'asignada': // MGG: la OP repartida entre proveedores (sus sub-OC siguen su curso)
      return 'ordenada';
    case 'pagada': return 'pagada';
    case 'recibida': return 'recibida';
    case 'finalizada': return 'finalizada';
    default: return 'cancelada'; // cancelada, rechazada, desistida_proveedor, reasignada, anulada
  }
}

export function compraAbierta(estado: string | null | undefined): boolean {
  const c = columnaCompra(estado);
  return c !== 'finalizada' && c !== 'cancelada' && c !== 'recibida';
}

/* ───────── Opciones del equipo (según permisos) ───────── */

export type AccionEquipo =
  | 'servicio' | 'averia' | 'lectura' | 'bitacora' | 'documentos' | 'editar'
  | 'ficha' | 'mantt_hecho' | 'espera' | 'quitar_espera' | 'retirar' | 'reactivar' | 'eliminar' | 'lavado';

export interface PermisosFlota {
  maquinaria: boolean;   // escritura en Maquinaria
  /** Escritura en Combustible. Ya no da acciones en Maquinaria (el surtido se hace solo en
   *  Combustible, 09/10/2026); se conserva para no romper a quien lo pase. */
  combustible?: boolean;
}

/**
 * Acciones que aparecen en el expediente. Solo las que el usuario PUEDE usar:
 * quien solo lee ve la ficha y nada más. Un equipo retirado solo se reactiva.
 */
export function accionesEquipo(p: PermisosFlota, estado: EstadoEquipo, opts?: { avisoServicio?: boolean }): AccionEquipo[] {
  const out: AccionEquipo[] = [];
  const retirada = estado === 'retirada';
  if (p.maquinaria && !retirada) {
    out.push('servicio');
    if (estado !== 'averiada' && estado !== 'parada') out.push('averia');
    out.push('lavado');
  }
  // Registrar horómetro / km: con escritura en Maquinaria (se sincroniza con Combustible).
  if (p.maquinaria && !retirada) out.push('lectura');
  out.push('bitacora', 'documentos', 'ficha');
  if (p.maquinaria) {
    out.push('editar');
    if (!retirada && opts?.avisoServicio) out.push('mantt_hecho');
    if (!retirada) out.push(estado === 'espera' ? 'quitar_espera' : 'espera');
    out.push(retirada ? 'reactivar' : 'retirar');
    out.push('eliminar');
  }
  return out;
}

/* ───────── Búsqueda del catálogo ───────── */

/** ¿El equipo coincide con lo buscado? Sin acentos ni mayúsculas, en todos sus datos de identificación. */
export function coincideEquipo(
  e: { equipo?: string | null; tipo?: string | null; propietario?: string | null; ubicacion?: string | null; serial?: string | null; placa?: string | null; marca?: string | null; modelo?: string | null; status?: string | null; estado_nota?: string | null },
  q: string,
): boolean {
  const t = norm(q);
  if (!t) return true;
  const texto = norm([e.equipo, e.tipo, e.propietario, e.ubicacion, e.serial, e.placa, e.marca, e.modelo, e.status, e.estado_nota].filter(Boolean).join(' '));
  return t.split(/\s+/).every((p) => texto.includes(p));
}

/* ───────── Contador (horómetro / km) ───────── */

export const ORIGENES_LECTURA: Record<string, { label: string; icon: string }> = {
  maquinaria: { label: 'Maquinaria', icon: '🚜' },
  combustible: { label: 'Combustible (surtido)', icon: '⛽' },
  bitacora: { label: 'Bitácora', icon: '📒' },
};

export function etiquetaOrigenLectura(o: string | null | undefined): string {
  return o ? (ORIGENES_LECTURA[o]?.label ?? o) : '—';
}

/**
 * Revisa una lectura nueva contra la vigente (misma regla que maquinaria_registrar_lectura):
 * hace falta horómetro o km; no puede bajar, salvo CORRECCIÓN de un admin con motivo.
 * Devuelve el problema o null.
 */
export function validarLectura(
  nueva: { horometro: number | null; kilometraje: number | null },
  vigente: { horometro: number | null; kilometraje: number | null },
  opts: { correccion?: boolean; admin?: boolean; motivo?: string | null } = {},
): string | null {
  const { horometro: h, kilometraje: k } = nueva;
  if (h == null && k == null) return 'Indica el horómetro o el kilometraje.';
  if ((h != null && (!Number.isFinite(h) || h < 0)) || (k != null && (!Number.isFinite(k) || k < 0))) return 'La lectura tiene que ser un número positivo.';
  if (opts.correccion) {
    if (!opts.admin) return 'Solo un administrador puede corregir una lectura hacia abajo.';
    if ((opts.motivo ?? '').trim().length < 3) return 'Escribe el motivo de la corrección.';
    return null;
  }
  if (h != null && vigente.horometro != null && h < vigente.horometro) return `El horómetro no puede ser menor que el vigente (${vigente.horometro} h).`;
  if (k != null && vigente.kilometraje != null && k < vigente.kilometraje) return `El kilometraje no puede ser menor que el vigente (${vigente.kilometraje} km).`;
  return null;
}
