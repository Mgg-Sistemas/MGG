/* ============================================================
   MGG · Choferes / Conductores · Lógica pura (12-10-2026)

   Sin pantalla ni base, para poder probarla:
   · vigencia de documentos (licencia, certificado médico, seguro) en tres
     estados: vigente, por vencer (≤ 30 días) y vencido;
   · estado operativo de un chofer hoy: en ruta, de descanso, disponible o
     inactivo;
   · liquidación de viáticos de un viaje: anticipos − gastos − devoluciones;
   · cálculo del recibo de viaje: tarifas + reembolsos + bonos − deducciones.
   ============================================================ */

import { TIPOS_VEHICULO } from '@/modules/asignaciones/vehiculos';

export type EstadoVence = 'vigente' | 'por_vencer' | 'vencido' | 'sin_dato';

export const DIAS_AVISO_VENCE = 30;

/** Vencido, por vencer (≤ 30 días) o vigente. `hoy` en AAAA-MM-DD. */
export function estadoVence(vence: string | null | undefined, hoy: string): EstadoVence {
  if (!vence) return 'sin_dato';
  const dias = diasHasta(vence, hoy);
  if (dias < 0) return 'vencido';
  if (dias <= DIAS_AVISO_VENCE) return 'por_vencer';
  return 'vigente';
}

/** Días de `hoy` a `fecha` (negativo si ya pasó). Fechas AAAA-MM-DD en UTC. */
export function diasHasta(fecha: string, hoy: string): number {
  return Math.round((aMs(fecha) - aMs(hoy)) / 86_400_000);
}

function aMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function textoEstadoVence(e: EstadoVence, vence?: string | null, hoy?: string): string {
  if (e === 'sin_dato') return 'Sin fecha';
  if (e === 'vigente') return 'Vigente';
  if (e === 'vencido') return vence && hoy ? `Vencido hace ${Math.abs(diasHasta(vence, hoy))} día(s)` : 'Vencido';
  return vence && hoy ? `Vence en ${diasHasta(vence, hoy)} día(s)` : 'Por vencer';
}

export const DOCUMENTOS_CHOFER = [
  { key: 'licencia_vence', label: 'Licencia' },
  { key: 'certificado_medico_vence', label: 'Certificado médico' },
  { key: 'seguro_vence', label: 'Seguro' },
] as const;
export type ClaveDocumentoChofer = (typeof DOCUMENTOS_CHOFER)[number]['key'];

export interface DocumentosChofer {
  licencia_vence?: string | null;
  certificado_medico_vence?: string | null;
  seguro_vence?: string | null;
}

/** Alertas de documentos de un chofer: los vencidos y los por vencer. */
export function alertasDocumentos(c: DocumentosChofer, hoy: string): { key: ClaveDocumentoChofer; label: string; estado: EstadoVence; vence: string | null }[] {
  const out: { key: ClaveDocumentoChofer; label: string; estado: EstadoVence; vence: string | null }[] = [];
  for (const d of DOCUMENTOS_CHOFER) {
    const vence = c[d.key] ?? null;
    const estado = estadoVence(vence, hoy);
    if (estado === 'vencido' || estado === 'por_vencer') out.push({ key: d.key, label: d.label, estado, vence });
  }
  return out;
}

/** El peor estado entre los tres documentos (vencido > por vencer > sin dato > vigente). */
export function peorEstadoDocumentos(c: DocumentosChofer, hoy: string): EstadoVence {
  const estados = DOCUMENTOS_CHOFER.map((d) => estadoVence(c[d.key] ?? null, hoy));
  if (estados.includes('vencido')) return 'vencido';
  if (estados.includes('por_vencer')) return 'por_vencer';
  if (estados.includes('sin_dato')) return 'sin_dato';
  return 'vigente';
}

/* ───────────── Estado operativo ───────────── */

export type EstadoChofer = 'en_ruta' | 'descanso' | 'disponible' | 'inactivo';

export const ESTADO_CHOFER: Record<EstadoChofer, { label: string; icon: string; clase: string }> = {
  en_ruta: { label: 'En ruta', icon: '🚛', clase: 'info' },
  descanso: { label: 'De descanso', icon: '🏠', clase: 'warning' },
  disponible: { label: 'Disponible', icon: '✅', clase: 'success' },
  inactivo: { label: 'Inactivo', icon: '⛔', clase: 'danger' },
};

/**
 * Qué está haciendo hoy un chofer. En ruta manda sobre el descanso: si salió
 * a manejar estando de descanso, lo que importa es que está en la vía.
 */
export function estadoChofer(o: { activo: boolean; enRuta: boolean; deDescanso: boolean }): EstadoChofer {
  if (!o.activo) return 'inactivo';
  if (o.enRuta) return 'en_ruta';
  if (o.deDescanso) return 'descanso';
  return 'disponible';
}

/* ───────────── Viajes ───────────── */

export type EstadoViaje = 'programado' | 'en_ruta' | 'finalizado' | 'cancelado';

export const ESTADO_VIAJE: Record<EstadoViaje, { label: string; icon: string; clase: string }> = {
  programado: { label: 'Programado', icon: '📅', clase: 'primary' },
  en_ruta: { label: 'En ruta', icon: '🚛', clase: 'info' },
  finalizado: { label: 'Finalizado', icon: '🏁', clase: 'success' },
  cancelado: { label: 'Cancelado', icon: '✖', clase: 'danger' },
};

export interface Parada {
  lugar: string;
  nota?: string | null;
  /** Cuándo se marcó como cumplida (ISO) o null si falta. */
  hecha_at?: string | null;
}

/** «3 de 5 paradas»: cuántas se cumplieron. */
export function progresoParadas(paradas: Parada[] | null | undefined): { hechas: number; total: number } {
  const p = paradas ?? [];
  return { hechas: p.filter((x) => !!x.hecha_at).length, total: p.length };
}

/** Los tipos de vehículo son los del catálogo de Asignaciones (una sola lista). */
export const TIPOS_FLOTA = TIPOS_VEHICULO;

export function labelTipoFlota(tipo: string | null | undefined): string {
  return TIPOS_FLOTA.find((t) => t.key === tipo)?.label ?? 'Vehículo';
}
export function iconoFlota(tipo: string | null | undefined): string {
  return TIPOS_FLOTA.find((t) => t.key === tipo)?.icon ?? '🚗';
}

export type EstadoFlota = 'operativo' | 'taller' | 'inactivo';
export const ESTADO_FLOTA: Record<EstadoFlota, { label: string; icon: string; clase: string }> = {
  operativo: { label: 'Operativo', icon: '✅', clase: 'success' },
  taller: { label: 'En taller', icon: '🔧', clase: 'warning' },
  inactivo: { label: 'Inactivo', icon: '⛔', clase: 'danger' },
};

/* ───────────── Viáticos ───────────── */

export type TipoViatico = 'anticipo' | 'gasto' | 'devolucion';

export const TIPO_VIATICO: Record<TipoViatico, { label: string; icon: string }> = {
  anticipo: { label: 'Anticipo', icon: '💵' },
  gasto: { label: 'Gasto en ruta', icon: '🧾' },
  devolucion: { label: 'Devolución', icon: '↩' },
};

export const CONCEPTOS_GASTO = ['Combustible', 'Peaje', 'Viático / alimentación', 'Hospedaje', 'Reparación / caucho', 'Carga y descarga', 'Otro'] as const;

export interface ViaticoBase {
  tipo: TipoViatico;
  monto_usd: number;
}

export interface Liquidacion {
  anticipos: number;
  gastos: number;
  devoluciones: number;
  /** anticipos − gastos − devoluciones. > 0: el chofer debe devolver; < 0: se le reembolsa. */
  saldo: number;
  /** Lo que la empresa le debe al chofer (gastó de su bolsillo). */
  reembolso: number;
  /** Lo que el chofer no justificó ni devolvió (se le descuenta en el recibo). */
  deduccion: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Liquidación de los viáticos de un viaje. Lo que se le dio (anticipos) menos
 * lo que gastó de verdad (gastos) menos lo que devolvió en efectivo:
 *   saldo > 0 → le sobró plata y no la devolvió → deducción en el recibo;
 *   saldo < 0 → gastó más de lo que le dieron → reembolso en el recibo.
 */
export function liquidarViaticos(movs: ViaticoBase[]): Liquidacion {
  const suma = (t: TipoViatico) => r2(movs.filter((m) => m.tipo === t).reduce((a, m) => a + (Number(m.monto_usd) || 0), 0));
  const anticipos = suma('anticipo');
  const gastos = suma('gasto');
  const devoluciones = suma('devolucion');
  const saldo = r2(anticipos - gastos - devoluciones);
  return { anticipos, gastos, devoluciones, saldo, reembolso: saldo < 0 ? r2(-saldo) : 0, deduccion: saldo > 0 ? saldo : 0 };
}

/** Texto para la persona: qué pasa con ese saldo. */
export function textoLiquidacion(l: Liquidacion): string {
  if (l.saldo > 0) return `El chofer tiene ${usd(l.saldo)} sin justificar: se le descuenta en el recibo de viaje (o lo devuelve en efectivo).`;
  if (l.saldo < 0) return `El chofer puso ${usd(-l.saldo)} de su bolsillo: se le reembolsa en el recibo de viaje.`;
  return 'Los viáticos cuadran: no hay nada que reembolsar ni descontar.';
}

function usd(n: number): string {
  return `$ ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ───────────── Recibo de viaje ───────────── */

export interface LineaRecibo {
  viaje_id: string;
  numero: string;
  ruta: string;
  fecha: string;
  tarifa_usd: number;
  reembolso_usd: number;
  deduccion_usd: number;
}

export interface EntradaRecibo {
  lineas: LineaRecibo[];
  bonos_usd?: number;
  otras_deducciones_usd?: number;
  tasa?: number | null;
}

export interface ReciboCalculado {
  tarifas_usd: number;
  reembolsos_usd: number;
  deducciones_usd: number;
  bonos_usd: number;
  otras_deducciones_usd: number;
  /** tarifas + reembolsos + bonos. */
  devengado_usd: number;
  /** deducciones de viáticos + otras. */
  total_deducciones_usd: number;
  neto_usd: number;
  neto_bs: number | null;
}

/** Suma el recibo. El neto nunca baja de 0: si las deducciones superan lo devengado, queda en cero y el resto se cobra aparte. */
export function calcularRecibo(e: EntradaRecibo): ReciboCalculado {
  const tarifas_usd = r2(e.lineas.reduce((a, l) => a + (Number(l.tarifa_usd) || 0), 0));
  const reembolsos_usd = r2(e.lineas.reduce((a, l) => a + (Number(l.reembolso_usd) || 0), 0));
  const deducciones_usd = r2(e.lineas.reduce((a, l) => a + (Number(l.deduccion_usd) || 0), 0));
  const bonos_usd = r2(e.bonos_usd ?? 0);
  const otras_deducciones_usd = r2(e.otras_deducciones_usd ?? 0);
  const devengado_usd = r2(tarifas_usd + reembolsos_usd + bonos_usd);
  const total_deducciones_usd = r2(deducciones_usd + otras_deducciones_usd);
  const neto_usd = Math.max(0, r2(devengado_usd - total_deducciones_usd));
  const tasa = Number(e.tasa) || 0;
  return {
    tarifas_usd, reembolsos_usd, deducciones_usd, bonos_usd, otras_deducciones_usd,
    devengado_usd, total_deducciones_usd, neto_usd,
    neto_bs: tasa > 0 ? r2(neto_usd * tasa) : null,
  };
}

/** Texto de conformidad del recibo de viaje. */
export function textoConformidadViaje(c: ReciboCalculado, nViajes: number, nombre: string): string {
  const viajes = nViajes === 1 ? 'un (1) viaje' : `${nViajes} viajes`;
  const bs = c.neto_bs != null ? ` (Bs ${c.neto_bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '';
  return `Yo, ${nombre}, declaro que recibí conforme la cantidad de ${usd(c.neto_usd)}${bs} por concepto de pago de ${viajes} realizados para la empresa, incluidos los reembolsos de gastos en ruta y descontados los viáticos no justificados que se detallan en este recibo. Con este pago quedan saldados los viajes indicados.`;
}

/** «Origen → Destino» para listas y recibos. */
export function textoRuta(v: { origen: string; destino: string }): string {
  return `${v.origen.trim()} → ${v.destino.trim()}`;
}

/**
 * Validación de un «viaje ya realizado» (12-10-2026): se carga un viaje pasado directo como
 * finalizado, así que necesita salida y llegada reales, la llegada no puede ser antes de la
 * salida ni en el futuro, y el kilometraje de llegada no baja del de salida.
 * Las fechas vienen como datetime-local (AAAA-MM-DDTHH:mm): comparan bien como texto.
 */
export function errorViajeRealizado(o: { salida: string; llegada: string; kmSalida: number | null; kmLlegada: number | null; ahora: string }): string | null {
  if (!o.salida) return 'Indica la fecha y hora de salida.';
  if (!o.llegada) return 'Indica la fecha y hora de llegada del viaje.';
  if (o.llegada < o.salida) return 'La llegada no puede ser antes de la salida.';
  if (o.llegada > o.ahora) return 'Un viaje ya realizado no puede terminar en el futuro. Si todavía no llegó, prográmalo y usa ▶ Iniciar.';
  if (o.kmSalida != null && o.kmLlegada != null && o.kmLlegada < o.kmSalida) return 'El kilometraje de llegada no puede ser menor que el de salida.';
  return null;
}

/** Fecha AAAA-MM-DD de hoy en Venezuela. */
export function hoyVE(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/* ───────── Tipo de viaje y cantidad de viajes (14-10-2026) ─────────
   La hoja física se llena por día: «Jose Rondon · 25 viajes · escombros ·
   Playa Escondida → Interno». Camión = ruta con paradas, horas y km;
   volqueta = por día con material, origen, destino y cuántos viajes. */
export type TipoViaje = 'camion' | 'volqueta';
export const TIPO_VIAJE: Record<TipoViaje, { label: string; icon: string; hint: string }> = {
  camion: { label: 'Camión', icon: '🚛', hint: 'Ruta con paradas, horas y kilometraje' },
  volqueta: { label: 'Volqueta', icon: '🚜', hint: 'Por día: material, origen, destino y cuántos viajes se hicieron' },
};
export function tipoViajeDe(v: unknown): TipoViaje { return v === 'volqueta' ? 'volqueta' : 'camion'; }
/** Cuántos viajes trae la orden (entero, mínimo 1). */
export function cantidadViajes(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
/** Lo que se le paga por la orden: tarifa por viaje × viajes. */
export function tarifaTotalViaje(v: { tarifa_usd: number; viajes?: number | null }): number {
  return Math.round((Number(v.tarifa_usd) || 0) * cantidadViajes(v.viajes) * 100) / 100;
}
/** «RES CORAL → PARQUE × 25 viajes» (para el recibo y los listados). */
export function textoRutaViajes(v: { origen: string; destino: string; viajes?: number | null }): string {
  const n = cantidadViajes(v.viajes);
  return n > 1 ? `${textoRuta(v)} × ${n} viajes` : textoRuta(v);
}
/** Total de viajes de una lista (una orden de volqueta con 25 viajes cuenta 25). */
export function totalViajes(lista: { viajes?: number | null }[]): number {
  return lista.reduce((a, v) => a + cantidadViajes(v.viajes), 0);
}
/**
 * Horas de un día de volqueta (no se cargan hora por hora): sale 06:00 y llega 18:00.
 * Si el día es hoy y aún no son las 18:00, llega «ahora» para no terminar en el futuro.
 */
export function horasDiaVolqueta(fecha: string, ahoraLocal: string): { salida: string; llegada: string } {
  const salida = `${fecha}T06:00`;
  const llegada = `${fecha}T18:00`;
  return { salida, llegada: llegada > ahoraLocal ? (ahoraLocal > salida ? ahoraLocal : salida) : llegada };
}
export function errorViajesVolqueta(viajes: number | null | undefined, material: string): string | null {
  const n = Number(viajes);
  if (!(n >= 1) || !Number.isInteger(n)) return 'Indica cuántos viajes se hicieron (número entero, al menos 1).';
  if (!material.trim()) return 'Indica el material (escombros, cabilla, arena…).';
  return null;
}

/* ───────── Categorías de viaje y nómina de viajes (planilla) ───────── */
export const CATEGORIAS_VIAJE = [
  { key: 'VIAJE CORTO', label: 'Viaje corto', tarifaSugerida: 25 },
  { key: 'VIAJE LARGO', label: 'Viaje largo', tarifaSugerida: 50 },
  { key: 'VIAJE INTERNO', label: 'Viaje interno', tarifaSugerida: 1 },
] as const;

export type CategoriaViaje = (typeof CATEGORIAS_VIAJE)[number]['key'];

export interface TasasChofer {
  corto: number;
  largo: number;
  interno: number;
}

export const TASAS_DEFAULT: TasasChofer = {
  corto: 25,
  largo: 50,
  interno: 1,
};

export interface ConductorTasasRef {
  tarifa_viaje_usd?: number | null;
  tarifa_corto_usd?: number | null;
  tarifa_largo_usd?: number | null;
  tarifa_interno_usd?: number | null;
  observaciones?: string | null;
}

/**
 * Obtiene las tasas propias de pago por viaje de un conductor (corto, largo, interno).
 */
export function tasasDeConductor(c?: ConductorTasasRef | null): TasasChofer {
  if (!c) return { ...TASAS_DEFAULT };

  let corto = Number(c.tarifa_corto_usd);
  let largo = Number(c.tarifa_largo_usd);
  let interno = Number(c.tarifa_interno_usd);

  const obs = c.observaciones ?? '';
  const matchTasas = obs.match(/\[TASAS:\s*corto=([\d.]+),\s*largo=([\d.]+),\s*interno=([\d.]+)\]/i);
  if (matchTasas) {
    if (!corto || isNaN(corto)) corto = parseFloat(matchTasas[1]);
    if (!largo || isNaN(largo)) largo = parseFloat(matchTasas[2]);
    if (!interno || isNaN(interno)) interno = parseFloat(matchTasas[3]);
  } else {
    const mC = obs.match(/\[TASA_CORTO:\s*([\d.]+)\]/i);
    const mL = obs.match(/\[TASA_LARGO:\s*([\d.]+)\]/i);
    const mI = obs.match(/\[TASA_INTERNO:\s*([\d.]+)\]/i);
    if ((!corto || isNaN(corto)) && mC) corto = parseFloat(mC[1]);
    if ((!largo || isNaN(largo)) && mL) largo = parseFloat(mL[1]);
    if ((!interno || isNaN(interno)) && mI) interno = parseFloat(mI[1]);
  }

  const base = Number(c.tarifa_viaje_usd) || 0;
  if (!corto || isNaN(corto) || corto <= 0) {
    corto = base > 0 ? base : TASAS_DEFAULT.corto;
  }
  if (!largo || isNaN(largo) || largo <= 0) {
    largo = base >= 50 ? base : (corto ? (corto >= 50 ? corto : corto * 2) : TASAS_DEFAULT.largo);
    if (largo < corto) largo = corto * 2;
  }
  if (!interno || isNaN(interno) || interno <= 0) {
    interno = TASAS_DEFAULT.interno;
  }

  return { corto, largo, interno };
}

/**
 * Codifica las tasas en la cadena de observaciones sin borrar notas existentes.
 */
export function codificarObservacionesConTasas(observacionesLimpias: string | null | undefined, tasas: TasasChofer): string {
  const limpio = (observacionesLimpias ?? '').replace(/\[TASAS:[^\]]+\]/gi, '').replace(/\[TASA_[A-Z]+:[^\]]+\]/gi, '').trim();
  const tag = `[TASAS: corto=${tasas.corto}, largo=${tasas.largo}, interno=${tasas.interno}]`;
  return limpio ? `${limpio} ${tag}` : tag;
}

/**
 * Limpia los tags internos de tasas de las observaciones para mostrarlas al usuario.
 */
export function observacionesSinTagsTasas(obs: string | null | undefined): string {
  return (obs ?? '').replace(/\[TASAS:[^\]]+\]/gi, '').replace(/\[TASA_[A-Z]+:[^\]]+\]/gi, '').trim();
}

/**
 * Clasifica automáticamente una tarifa / tasa en:
 * VIAJE CORTO, VIAJE LARGO o VIAJE INTERNO, según la tasa ingresada y las tasas del chofer.
 */
export function clasificarCategoriaPorTasa(
  tarifa: number | null | undefined,
  chofer?: ConductorTasasRef | null,
): CategoriaViaje {
  const monto = Number(tarifa) || 0;
  if (monto <= 0) return 'VIAJE CORTO';

  const tasas = tasasDeConductor(chofer);

  // 1. Coincidencia exacta con las tasas del chofer
  if (Math.abs(monto - tasas.interno) < 0.01) return 'VIAJE INTERNO';
  if (Math.abs(monto - tasas.largo) < 0.01) return 'VIAJE LARGO';
  if (Math.abs(monto - tasas.corto) < 0.01) return 'VIAJE CORTO';

  // 2. Umbral de viaje interno (valores bajos típicos de cantera / planta)
  const umbralInterno = Math.max(tasas.interno * 1.5, 5);
  if (monto <= umbralInterno) return 'VIAJE INTERNO';

  // 3. Umbral de viaje largo: si es mayor o igual al punto medio o la tasa de viaje largo
  const puntoMedioLargo = tasas.largo > tasas.corto ? (tasas.corto + tasas.largo) / 2 : 50;
  if (monto >= puntoMedioLargo || monto >= 50) return 'VIAJE LARGO';

  return 'VIAJE CORTO';
}

export function tarifaSugeridaCategoria(cat: string, chofer?: ConductorTasasRef | null): number {
  const c = (cat || '').trim().toUpperCase();
  const tasas = tasasDeConductor(chofer);
  if (c.includes('INTERNO')) return tasas.interno;
  if (c.includes('LARGO')) return tasas.largo;
  if (c.includes('CORTO')) return tasas.corto;
  return 0;
}

/**
 * Obtiene la categoría de un viaje: la guardada explícitamente o inferida de origen/destino/nota/tarifa.
 */
export function categoriaDeViaje(
  v?: { categoria_viaje?: string | null; nota?: string | null; origen?: string | null; destino?: string | null; tarifa_usd?: number | null } | null,
  chofer?: ConductorTasasRef | null,
): CategoriaViaje {
  if (!v) return 'VIAJE CORTO';
  const cv = (v.categoria_viaje ?? '').trim().toUpperCase();
  if (cv === 'VIAJE CORTO' || cv === 'VIAJE LARGO' || cv === 'VIAJE INTERNO') return cv as CategoriaViaje;
  const match = (v.nota ?? '').match(/\[CAT:\s*([^\]]+)\]/i);
  if (match) {
    const m = match[1].trim().toUpperCase();
    if (m === 'VIAJE CORTO' || m === 'VIAJE LARGO' || m === 'VIAJE INTERNO') return m as CategoriaViaje;
  }
  const texto = `${v.origen ?? ''} ${v.destino ?? ''} ${v.nota ?? ''}`.toUpperCase();
  if (texto.includes('INTERNO')) return 'VIAJE INTERNO';
  return clasificarCategoriaPorTasa(v.tarifa_usd, chofer);
}

/**
 * Obtiene información detallada de pago de un viaje.
 */
export function infoPagoViaje(
  v: { pago_id?: string | null; pagado_at?: string | null; nota?: string | null },
  pagoMap?: Map<string, { pagado_at?: string | null; created_at: string }>,
): { pagado: boolean; fechaPago: string | null } {
  if (v.pago_id) {
    const p = pagoMap?.get(v.pago_id);
    return { pagado: true, fechaPago: p?.pagado_at ?? p?.created_at ?? null };
  }
  if (v.pagado_at) {
    return { pagado: true, fechaPago: v.pagado_at };
  }
  const match = (v.nota ?? '').match(/\[PAGADO:\s*([^\]]+)\]/i);
  if (match) {
    return { pagado: true, fechaPago: match[1].trim() };
  }
  return { pagado: false, fechaPago: null };
}

/**
 * Determina si un viaje está pagado.
 */
export function viajeEstaPagado(
  v: { pago_id?: string | null; pagado_at?: string | null; nota?: string | null },
  pagoMap?: Map<string, { pagado_at?: string | null; created_at: string }>,
): boolean {
  return infoPagoViaje(v, pagoMap).pagado;
}

/* ───────── Chofer externo (14-10-2026) ─────────
   Un conductor puede no estar en nómina (pago externo por viaje): su expediente
   lleva nombre, apellido, cédula y teléfono propios, sin ficha de RRHH. */
export interface DatosPersonaConductor {
  externo?: boolean;
  nombre?: string | null;
  apellido?: string | null;
  cedula?: string | null;
  telefono?: string | null;
  empresa_externa?: string | null;
  personal?: { nombre: string; apellido?: string | null; cedula?: string | null; telefono?: string | null; cargo?: string | null } | null;
}
export function nombreDeConductor(c: DatosPersonaConductor | null | undefined): string {
  if (!c) return '—';
  if (c.personal) return `${c.personal.nombre} ${c.personal.apellido ?? ''}`.trim();
  if (c.externo) return `${c.nombre ?? ''} ${c.apellido ?? ''}`.trim() || 'Chofer externo';
  return '(ficha eliminada)';
}
/** Cédula, teléfono y cargo: de la ficha de RRHH o, si es externo, del expediente. */
export function datosConductor(c: DatosPersonaConductor | null | undefined): { cedula: string | null; telefono: string | null; cargo: string | null } {
  if (!c) return { cedula: null, telefono: null, cargo: null };
  if (c.personal) return { cedula: c.personal.cedula ?? null, telefono: c.personal.telefono ?? null, cargo: c.personal.cargo ?? null };
  if (c.externo) return { cedula: c.cedula ?? null, telefono: c.telefono ?? null, cargo: `Chofer externo${c.empresa_externa ? ` · ${c.empresa_externa}` : ''}` };
  return { cedula: null, telefono: null, cargo: null };
}

/**
 * Calcula el siguiente rango de corte sugerido para cierre de nómina de viajes.
 * Si el último cierre cerró hasta el 14, el próximo inicia el 15 hasta fin de mes (30/31).
 * Si el último cierre cerró a fin de mes (28..31), el próximo inicia el 1 del mes siguiente hasta el 14/15.
 */
export function calcularSiguientePeriodoCierre(ultimoCorteIso?: string | null): { desde: string; hasta: string } {
  if (!ultimoCorteIso) {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const d = hoy.getDate();
    const mm = String(m + 1).padStart(2, '0');
    if (d <= 15) {
      return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-15` };
    }
    const ultimoDia = new Date(y, m + 1, 0).getDate();
    return { desde: `${y}-${mm}-16`, hasta: `${y}-${mm}-${ultimoDia}` };
  }

  const [yy, mm, dd] = ultimoCorteIso.slice(0, 10).split('-').map(Number);
  // Siguiente día calendario
  const fechaSig = new Date(yy, mm - 1, dd + 1);
  const sigY = fechaSig.getFullYear();
  const sigM = fechaSig.getMonth();
  const sigD = fechaSig.getDate();
  const sY = String(sigY);
  const sM = String(sigM + 1).padStart(2, '0');
  const sD = String(sigD).padStart(2, '0');
  const desde = `${sY}-${sM}-${sD}`;

  let hasta: string;
  if (sigD <= 5) {
    hasta = `${sY}-${sM}-15`;
  } else {
    const ultDiaMes = new Date(sigY, sigM + 1, 0).getDate();
    hasta = `${sY}-${sM}-${ultDiaMes}`;
  }

  return { desde, hasta };
}

