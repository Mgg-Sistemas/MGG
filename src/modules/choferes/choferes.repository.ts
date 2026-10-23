/* ============================================================
   MGG · Choferes / Conductores · Datos (Supabase)

   choferes_conductores → expediente (1 por ficha de `personal`)
   choferes_viajes      → orden de ruta VJ-AAAA-NNNN
   choferes_viaticos    → anticipos, gastos en ruta, devoluciones
   choferes_pagos       → recibo de viaje RV-AAAA-NNNN
   vehiculos_catalogo   → la flota (compartida con Asignaciones)

   El dinero sale y entra por Tesorería cuando quien carga lo pide (casilla
   «Registrar en caja»): anticipos y pagos son gastos de la caja elegida,
   las devoluciones son ingresos. El movimiento queda enlazado por id.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { textoDeError } from '@/shared/lib/errores';
import type { Personal } from '@/shared/lib/types';
import { registrarGasto, registrarIngresoCaja } from '@/modules/tesoreria/tesoreria.repository';
import type { CuentaCaja } from '@/shared/lib/types';
import type { Vehiculo } from '@/modules/asignaciones/vehiculos.repository';
import {
  tipoViajeDe, cantidadViajes, tasasDeConductor, codificarObservacionesConTasas,
  type Liquidacion, type LineaRecibo, type Parada, type ReciboCalculado, type TipoViaje, type TasasChofer,
} from './choferes';
import { mensajeErrorDocumento, nombreSeguro, validarArchivoDocumento } from '@/modules/rrhh/documentosPersonal';

const T_CONDUCTORES = 'choferes_conductores';
const T_VIAJES = 'choferes_viajes';
const T_VIATICOS = 'choferes_viaticos';
const T_PAGOS = 'choferes_pagos';
const T_FLOTA = 'vehiculos_catalogo';
const T_DOCS = 'choferes_documentos';
/** Los archivos van al bucket privado de RRHH (sus políticas ya cubren a todo usuario registrado). */
const BUCKET_DOCS = 'personal-docs';

export const TABLAS_CHOFERES = [T_CONDUCTORES, T_VIAJES, T_VIATICOS, T_PAGOS, T_DOCS, T_FLOTA, 'personal', 'rrhh_descansos'];

/* ───────────── Tipos ───────────── */

export interface Conductor {
  id: string;
  /** Ficha de RRHH. null si es un chofer EXTERNO (14-10-2026). */
  personal_id: string | null;
  /** No está en nómina: se le paga por viaje fuera de RRHH; sus datos van abajo. */
  externo: boolean;
  nombre: string | null;
  apellido: string | null;
  cedula: string | null;
  telefono: string | null;
  empresa_externa: string | null;
  licencia_grado: string | null;
  licencia_numero: string | null;
  licencia_vence: string | null;
  certificado_medico_vence: string | null;
  seguro_vence: string | null;
  tarifa_viaje_usd: number;
  tarifa_corto_usd?: number | null;
  tarifa_largo_usd?: number | null;
  tarifa_interno_usd?: number | null;
  observaciones: string | null;
  activo: boolean;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
  updated_at: string | null;
  /** Se pega en el cliente desde `personal`. */
  personal?: Personal | null;
}

export interface Viaje {
  id: string;
  numero: string;
  chofer_id: string;
  vehiculo_id: string | null;
  origen: string;
  destino: string;
  paradas: Parada[];
  carga: string | null;
  fecha_salida: string;
  llegada_prevista: string | null;
  salida_real_at: string | null;
  llegada_real_at: string | null;
  km_salida: number | null;
  km_llegada: number | null;
  estado: 'programado' | 'en_ruta' | 'finalizado' | 'cancelado';
  /** Tarifa POR VIAJE (el recibo paga tarifa × viajes). */
  tarifa_usd: number;
  /** Camión (ruta con paradas, horas y km) o volqueta (por día: material, origen, destino y viajes). 14-10-2026. */
  tipo_viaje: TipoViaje;
  /** Cuántos viajes trae la orden (la hoja de volqueta: «25 viajes escombros»). 1 en los de camión. */
  viajes: number;
  /** Categoría del viaje: 'VIAJE CORTO', 'VIAJE LARGO', 'VIAJE INTERNO' */
  categoria_viaje?: string | null;
  /** Si fue pagado directamente o por fecha, la fecha de pago registrada */
  pagado_at?: string | null;
  nota: string | null;
  liquidado_at: string | null;
  liquidado_por: string | null;
  liquidacion: Liquidacion | null;
  pago_id: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Viatico {
  id: string;
  chofer_id: string;
  viaje_id: string | null;
  tipo: 'anticipo' | 'gasto' | 'devolucion';
  concepto: string;
  monto_usd: number;
  moneda: 'USD' | 'Bs';
  monto_moneda: number | null;
  tasa: number | null;
  fecha: string;
  comprobante: string | null;
  nota: string | null;
  movimiento_caja_id: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface PagoViaje {
  id: string;
  numero: string;
  chofer_id: string;
  detalle: LineaRecibo[];
  tarifas_usd: number;
  reembolsos_usd: number;
  deducciones_usd: number;
  bonos_usd: number;
  otras_deducciones_usd: number;
  otras_deducciones_motivo: string | null;
  neto_usd: number;
  tasa: number | null;
  neto_bs: number | null;
  estado: 'pendiente' | 'pagado' | 'anulado';
  pagado_at: string | null;
  pagado_por: string | null;
  metodo: string | null;
  movimiento_caja_id: string | null;
  nota: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export type VehiculoFlota = Vehiculo;

/** Dónde sale (o entra) la plata en Tesorería. */
export interface CajaDestino {
  cajaId: string;
  cuenta: CuentaCaja;
  moneda: string;
  /** Monto en la moneda de la cuenta (si la cuenta es en Bs, ya convertido). */
  monto: number;
}

/* ───────────── Errores ───────────── */

/** La base todavía no tiene las tablas del módulo (falta correr `supabase/sql/choferes-modulo.sql`). */
export function esTablaFaltante(e: unknown): boolean {
  const o = (e ?? {}) as { code?: string; message?: string };
  const m = String(o.message ?? '');
  return o.code === '42P01' || o.code === 'PGRST205' || /does not exist|Could not find the table|schema cache/i.test(m);
}

function err(e: unknown, respaldo: string): Error {
  if (esTablaFaltante(e)) return new Error('El módulo de Choferes todavía no está instalado en la base: hay que ejecutar supabase/sql/choferes-modulo.sql.');
  return new Error(textoDeError(e, respaldo));
}

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const limpio = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim() || null;

/* ───────────── Conductores ───────────── */

export async function listConductores(): Promise<Conductor[]> {
  const { data, error } = await supabase.from(T_CONDUCTORES).select('*').order('created_at');
  if (error) throw err(error, 'No se pudieron cargar los conductores.');
  return (data ?? []).map((c) => {
    const tasas = tasasDeConductor(c as Record<string, unknown>);
    return {
      ...c,
      externo: !!c.externo,
      tarifa_viaje_usd: Number(c.tarifa_viaje_usd) || tasas.corto,
      tarifa_corto_usd: tasas.corto,
      tarifa_largo_usd: tasas.largo,
      tarifa_interno_usd: tasas.interno,
    };
  }) as Conductor[];
}

export interface ConductorInput {
  /** Ficha de RRHH; va vacío si es externo. */
  personal_id?: string | null;
  externo?: boolean;
  nombre?: string | null;
  apellido?: string | null;
  cedula?: string | null;
  telefono?: string | null;
  empresa_externa?: string | null;
  licencia_grado?: string | null;
  licencia_numero?: string | null;
  licencia_vence?: string | null;
  certificado_medico_vence?: string | null;
  seguro_vence?: string | null;
  tarifa_viaje_usd?: number | null;
  tarifa_corto_usd?: number | null;
  tarifa_largo_usd?: number | null;
  tarifa_interno_usd?: number | null;
  observaciones?: string | null;
}

function filaConductor(i: Omit<ConductorInput, 'personal_id'>) {
  const externo = !!i.externo;
  if (externo && !limpio(i.nombre)) throw new Error('Escribe el nombre del chofer externo.');

  const tasaCorto = Math.max(0, r2(i.tarifa_corto_usd ?? i.tarifa_viaje_usd ?? 25));
  const tasaLargo = Math.max(0, r2(i.tarifa_largo_usd ?? (tasaCorto >= 50 ? tasaCorto : tasaCorto * 2)));
  const tasaInterno = Math.max(0, r2(i.tarifa_interno_usd ?? 1));
  const tasas: TasasChofer = { corto: tasaCorto, largo: tasaLargo, interno: tasaInterno };
  const obsFinal = codificarObservacionesConTasas(i.observaciones, tasas);

  return {
    externo,
    nombre: externo ? limpio(i.nombre)?.toUpperCase() ?? null : null,
    apellido: externo ? limpio(i.apellido)?.toUpperCase() ?? null : null,
    cedula: externo ? limpio(i.cedula) : null,
    telefono: externo ? limpio(i.telefono) : null,
    empresa_externa: externo ? limpio(i.empresa_externa) : null,
    licencia_grado: limpio(i.licencia_grado)?.toUpperCase() ?? null,
    licencia_numero: limpio(i.licencia_numero),
    licencia_vence: i.licencia_vence || null,
    certificado_medico_vence: i.certificado_medico_vence || null,
    seguro_vence: i.seguro_vence || null,
    tarifa_viaje_usd: tasaCorto,
    observaciones: limpio(obsFinal),
  };
}

export async function crearConductor(i: ConductorInput, actor: string, actorName: string | null): Promise<Conductor> {
  if (!i.externo && !i.personal_id) throw new Error('Elige la ficha del trabajador o marca «Chofer externo».');
  const { data, error } = await supabase.from(T_CONDUCTORES)
    .insert({ personal_id: i.externo ? null : i.personal_id, ...filaConductor(i), created_by: actor, actor_name: actorName })
    .select('*').single();
  if (error) throw err(error, error.code === '23505' ? 'Esa persona ya tiene expediente de conductor.' : 'No se pudo guardar el conductor.');
  return data as Conductor;
}

export async function editarConductor(id: string, i: Omit<ConductorInput, 'personal_id'>): Promise<void> {
  const { error } = await supabase.from(T_CONDUCTORES).update(filaConductor(i)).eq('id', id);
  if (error) throw err(error, 'No se pudo guardar el expediente.');
}

export async function setConductorActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(T_CONDUCTORES).update({ activo }).eq('id', id);
  if (error) throw err(error, 'No se pudo cambiar el estado del conductor.');
}

/** ¿La ficha de RRHH dice que maneja? (cargo CONDUCTOR, CHOFER, AYUDANTE GENERAL CONDUCTOR…) */
export function esCargoDeChofer(p: Pick<Personal, 'cargo' | 'departamento'>): boolean {
  const t = `${p.cargo ?? ''} ${p.departamento ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /chofer|conductor|transport/.test(t);
}

/** Crea el expediente (vacío) de todo el personal activo con cargo de chofer que todavía no lo tiene. */
export async function importarConductoresDesdeRrhh(personal: Personal[], existentes: Conductor[], actor: string, actorName: string | null): Promise<number> {
  const ya = new Set(existentes.map((c) => c.personal_id));
  const nuevos = personal.filter((p) => p.activo && esCargoDeChofer(p) && !ya.has(p.id));
  if (!nuevos.length) return 0;
  const { error } = await supabase.from(T_CONDUCTORES).insert(nuevos.map((p) => ({
    personal_id: p.id, tarifa_viaje_usd: 0, created_by: actor, actor_name: actorName,
    observaciones: 'Expediente creado desde la ficha de RRHH; completar licencia, certificado médico y seguro.',
  })));
  if (error) throw err(error, 'No se pudieron traer los conductores de RRHH.');
  return nuevos.length;
}

/* ───────────── Flota ───────────── */

export async function listFlota(): Promise<VehiculoFlota[]> {
  const { data, error } = await supabase.from(T_FLOTA).select('*').order('marca').order('modelo').order('placa');
  if (error) throw err(error, 'No se pudo leer la flota.');
  return (data ?? []) as VehiculoFlota[];
}

/* ───────────── Viajes ───────────── */

function normViaje(v: Record<string, unknown>): Viaje {
  const nota = v.nota as string | null;
  const matchCat = (nota ?? '').match(/\[CAT:\s*([^\]]+)\]/i);
  const matchPag = (nota ?? '').match(/\[PAGADO:\s*([^\]]+)\]/i);
  return {
    ...(v as unknown as Viaje),
    categoria_viaje: (v.categoria_viaje as string | null) || (matchCat ? matchCat[1].trim().toUpperCase() : null),
    pagado_at: (v.pagado_at as string | null) || (matchPag ? matchPag[1].trim() : null),
    paradas: Array.isArray(v.paradas) ? (v.paradas as Parada[]) : [],
    tarifa_usd: Number(v.tarifa_usd) || 0,
    tipo_viaje: tipoViajeDe(v.tipo_viaje),
    viajes: cantidadViajes(v.viajes),
    km_salida: v.km_salida == null ? null : Number(v.km_salida),
    km_llegada: v.km_llegada == null ? null : Number(v.km_llegada),
  };
}

/** Todos los viajes, del más reciente al más viejo (por páginas: la tabla crece todos los días). */
export async function listViajes(): Promise<Viaje[]> {
  try {
    const filas = await todasLasFilas<Record<string, unknown>>((d, h) =>
      supabase.from(T_VIAJES).select('*').order('fecha_salida', { ascending: false }).order('id').range(d, h));
    return filas.map(normViaje);
  } catch (e) { throw err(e, 'No se pudieron cargar los viajes.'); }
}

export interface ViajeInput {
  chofer_id: string;
  vehiculo_id?: string | null;
  origen: string;
  destino: string;
  paradas?: Parada[];
  carga?: string | null;
  fecha_salida: string;
  llegada_prevista?: string | null;
  tarifa_usd?: number | null;
  nota?: string | null;
  /** Categoría del viaje: 'VIAJE CORTO', 'VIAJE LARGO', 'VIAJE INTERNO' */
  categoria_viaje?: string | null;
  /** Si entra como pagado o fecha de pago */
  pagado_at?: string | null;
  /** Viaje ya realizado (12-10-2026): entra directo como finalizado con sus horas y km reales. */
  realizado?: ViajeRealizado | null;
  tipo_viaje?: TipoViaje;
  /** Cuántos viajes (entero ≥ 1). */
  viajes?: number | null;
}

export interface ViajeRealizado {
  salida_real_at: string;
  llegada_real_at: string;
  km_salida?: number | null;
  km_llegada?: number | null;
}

function filaViaje(i: ViajeInput) {
  if (!i.chofer_id) throw new Error('Elige el chofer.');
  if (!limpio(i.origen) || !limpio(i.destino)) throw new Error('Indica el origen y el destino de la ruta.');
  if (!i.fecha_salida) throw new Error('Indica la fecha y hora de salida.');
  if (i.viajes != null && (!Number.isInteger(Number(i.viajes)) || Number(i.viajes) < 1)) throw new Error('Los viajes tienen que ser un número entero, al menos 1.');
  const r = i.realizado ?? null;
  if (r) {
    if (!r.llegada_real_at) throw new Error('Indica la fecha y hora de llegada del viaje.');
    if (new Date(r.llegada_real_at) < new Date(r.salida_real_at || i.fecha_salida)) throw new Error('La llegada no puede ser antes de la salida.');
    if (new Date(r.llegada_real_at) > new Date()) throw new Error('Un viaje ya realizado no puede terminar en el futuro.');
    if (r.km_salida != null && r.km_llegada != null && r.km_llegada < r.km_salida) throw new Error('El kilometraje de llegada no puede ser menor que el de salida.');
  }
  const llegadaReal = r ? new Date(r.llegada_real_at).toISOString() : null;
  // En un viaje ya realizado las paradas quedan cumplidas (a la hora de llegada) salvo que traigan su propia hora.
  const paradas = (i.paradas ?? []).map((p) => ({ lugar: limpio(p.lugar) ?? '', nota: limpio(p.nota), hecha_at: p.hecha_at ?? llegadaReal })).filter((p) => p.lugar);
  const realizado = r ? {
    estado: 'finalizado' as const,
    salida_real_at: new Date(r.salida_real_at || i.fecha_salida).toISOString(),
    llegada_real_at: llegadaReal,
    km_salida: r.km_salida ?? null,
    km_llegada: r.km_llegada ?? null,
  } : {};

  const notaOriginal = limpio(i.nota) || '';
  let notaFinal = notaOriginal;
  if (i.categoria_viaje && !notaFinal.includes('[CAT:')) {
    notaFinal = `${notaFinal ? notaFinal + ' ' : ''}[CAT: ${i.categoria_viaje.trim().toUpperCase()}]`;
  }
  if (i.pagado_at && !notaFinal.includes('[PAGADO:')) {
    notaFinal = `${notaFinal ? notaFinal + ' ' : ''}[PAGADO: ${i.pagado_at.slice(0, 10)}]`;
  }

  const base: Record<string, unknown> = {
    ...realizado,
    chofer_id: i.chofer_id,
    vehiculo_id: i.vehiculo_id || null,
    origen: limpio(i.origen),
    destino: limpio(i.destino),
    paradas,
    carga: limpio(i.carga),
    fecha_salida: new Date(i.fecha_salida).toISOString(),
    llegada_prevista: i.llegada_prevista ? new Date(i.llegada_prevista).toISOString() : null,
    tarifa_usd: Math.max(0, r2(i.tarifa_usd)),
    tipo_viaje: tipoViajeDe(i.tipo_viaje),
    viajes: cantidadViajes(i.viajes),
    nota: limpio(notaFinal),
  };
  if (i.categoria_viaje) base.categoria_viaje = i.categoria_viaje.trim().toUpperCase();
  if (i.pagado_at) base.pagado_at = new Date(i.pagado_at).toISOString();
  return base;
}

export async function crearViaje(i: ViajeInput, actor: string, actorName: string | null): Promise<Viaje> {
  const f = filaViaje(i);
  try {
    const { data, error } = await supabase.from(T_VIAJES).insert({ ...f, created_by: actor, actor_name: actorName }).select('*').single();
    if (error) throw error;
    return normViaje(data as Record<string, unknown>);
  } catch (primero) {
    // Si falla porque no existen aún las columnas categoria_viaje o pagado_at, reintenta sin ellas (quedan en nota)
    const sinCols = { ...f };
    delete sinCols.categoria_viaje;
    delete sinCols.pagado_at;
    const { data, error } = await supabase.from(T_VIAJES).insert({ ...sinCols, created_by: actor, actor_name: actorName }).select('*').single();
    if (error) throw err(error, 'No se pudo crear la orden de ruta.');
    return normViaje(data as Record<string, unknown>);
  }
}

/** Programado o en ruta se editan libremente; un finalizado solo se corrige mientras no esté liquidado ni en un recibo. */
export async function editarViaje(id: string, i: ViajeInput): Promise<void> {
  const f = filaViaje(i);
  try {
    const { data, error } = await supabase.from(T_VIAJES).update(f).eq('id', id)
      .in('estado', ['programado', 'en_ruta', 'finalizado']).is('liquidado_at', null).is('pago_id', null).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Ese viaje ya está liquidado o tiene recibo; reabre la liquidación antes de corregirlo.');
  } catch (primero) {
    const sinCols = { ...f };
    delete sinCols.categoria_viaje;
    delete sinCols.pagado_at;
    const { data, error } = await supabase.from(T_VIAJES).update(sinCols).eq('id', id)
      .in('estado', ['programado', 'en_ruta', 'finalizado']).is('liquidado_at', null).is('pago_id', null).select('id');
    if (error) throw err(error, 'No se pudo guardar la orden de ruta.');
    if (!data?.length) throw new Error('Ese viaje ya está liquidado o tiene recibo; reabre la liquidación antes de corregirlo.');
  }
}

/**
 * Marca como pagados todos los viajes finalizados hasta la fecha de corte indicada.
 */
export async function marcarViajesPagadosHastaFecha(opts: {
  choferId?: string;
  fechaDesde?: string; // YYYY-MM-DD (opcional)
  fechaHasta: string; // YYYY-MM-DD
  fechaPago?: string; // YYYY-MM-DD
  actor?: string;
}): Promise<{ actualizados: number }> {
  const fHasta = opts.fechaHasta.slice(0, 10);
  const fPago = (opts.fechaPago || new Date().toISOString()).slice(0, 10);

  let q = supabase.from(T_VIAJES).select('id, nota, fecha_salida, llegada_real_at, pago_id, pagado_at')
    .eq('estado', 'finalizado')
    .is('pago_id', null)
    .is('pagado_at', null)
    .lte('fecha_salida', `${fHasta}T23:59:59`);
  if (opts.fechaDesde) {
    const fDesde = opts.fechaDesde.slice(0, 10);
    q = q.gte('fecha_salida', `${fDesde}T00:00:00`);
  }
  if (opts.choferId) q = q.eq('chofer_id', opts.choferId);

  const { data: viajes, error } = await q;
  if (error) throw err(error, 'No se pudieron consultar los viajes para marcar pago.');
  if (!viajes || !viajes.length) return { actualizados: 0 };

  let count = 0;
  for (const v of viajes) {
    const nota = v.nota as string | null;
    const matchPag = (nota ?? '').match(/\[PAGADO:\s*([^\]]+)\]/i);
    if (!v.pagado_at && !matchPag) {
      const nuevaNota = `${nota ? nota.trim() + ' ' : ''}[PAGADO: ${fPago}]`;
      const updateData: Record<string, unknown> = { nota: nuevaNota };
      try {
        await supabase.from(T_VIAJES).update({ ...updateData, pagado_at: new Date(fPago).toISOString() }).eq('id', v.id);
      } catch {
        await supabase.from(T_VIAJES).update(updateData).eq('id', v.id);
      }
      count++;
    }
  }
  return { actualizados: count };
}

/**
 * Desmarca el estado de pagado de viajes específicos para que vuelvan a quedar pendientes.
 */
export async function desmarcarViajesPagados(viajeIds: string[]): Promise<void> {
  if (!viajeIds.length) return;
  for (const id of viajeIds) {
    const { data: v } = await supabase.from(T_VIAJES).select('nota').eq('id', id).single();
    if (v) {
      const notaLimpiada = (v.nota || '').replace(/\[PAGADO:\s*[^\]]+\]/gi, '').trim() || null;
      try {
        await supabase.from(T_VIAJES).update({ pagado_at: null, nota: notaLimpiada }).eq('id', id);
      } catch {
        await supabase.from(T_VIAJES).update({ nota: notaLimpiada }).eq('id', id);
      }
    }
  }
}


function errorEnRuta(e: { code?: string; message?: string }, respaldo: string): Error {
  if (e.code === '23505' && /chofer_en_ruta/.test(e.message ?? '')) return new Error('Ese chofer ya está en ruta en otro viaje. Finaliza ese viaje primero.');
  if (e.code === '23505' && /vehiculo_en_ruta/.test(e.message ?? '')) return new Error('Ese vehículo ya está en ruta en otro viaje.');
  return err(e, respaldo);
}

/** Programado → en ruta. */
export async function iniciarViaje(id: string, o: { km_salida?: number | null; salida_real_at?: string | null }): Promise<void> {
  const { error } = await supabase.from(T_VIAJES).update({
    estado: 'en_ruta', km_salida: o.km_salida ?? null,
    salida_real_at: o.salida_real_at ? new Date(o.salida_real_at).toISOString() : new Date().toISOString(),
  }).eq('id', id).eq('estado', 'programado');
  if (error) throw errorEnRuta(error, 'No se pudo iniciar la ruta.');
}

/** Marca o desmarca una parada como cumplida. */
export async function guardarParadas(id: string, paradas: Parada[]): Promise<void> {
  const { error } = await supabase.from(T_VIAJES).update({ paradas }).eq('id', id);
  if (error) throw err(error, 'No se pudo guardar la parada.');
}

/** En ruta → finalizado. */
export async function finalizarViaje(id: string, o: { km_llegada?: number | null; llegada_real_at?: string | null; nota?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {
    estado: 'finalizado', km_llegada: o.km_llegada ?? null,
    llegada_real_at: o.llegada_real_at ? new Date(o.llegada_real_at).toISOString() : new Date().toISOString(),
  };
  if (o.nota !== undefined) patch.nota = limpio(o.nota);
  const { error } = await supabase.from(T_VIAJES).update(patch).eq('id', id).in('estado', ['programado', 'en_ruta']);
  if (error) throw err(error, error.code === '23514' ? 'El kilometraje de llegada no puede ser menor que el de salida.' : 'No se pudo finalizar la ruta.');
}

export async function cancelarViaje(id: string, motivo: string): Promise<void> {
  const m = limpio(motivo);
  if (!m) throw new Error('Indica el motivo de la cancelación.');
  const { data: v } = await supabase.from(T_VIAJES).select('nota').eq('id', id).maybeSingle();
  const nota = [v?.nota, `Cancelado: ${m}`].filter(Boolean).join(' · ');
  const { error } = await supabase.from(T_VIAJES).update({ estado: 'cancelado', nota }).eq('id', id).in('estado', ['programado', 'en_ruta']);
  if (error) throw err(error, 'No se pudo cancelar la ruta.');
}

/** Congela la liquidación de viáticos del viaje. */
export async function liquidarViaje(id: string, liq: Liquidacion, actor: string): Promise<void> {
  const { error } = await supabase.from(T_VIAJES).update({ liquidado_at: new Date().toISOString(), liquidado_por: actor, liquidacion: liq })
    .eq('id', id).eq('estado', 'finalizado').is('pago_id', null);
  if (error) throw err(error, 'No se pudo liquidar el viaje.');
}

/** Deshace la liquidación (solo si el viaje no entró en un recibo). */
export async function reabrirLiquidacion(id: string): Promise<void> {
  const { error } = await supabase.from(T_VIAJES).update({ liquidado_at: null, liquidado_por: null, liquidacion: null }).eq('id', id).is('pago_id', null);
  if (error) throw err(error, 'No se pudo reabrir la liquidación.');
}

/* ───────────── Viáticos ───────────── */

export async function listViaticos(): Promise<Viatico[]> {
  try {
    const filas = await todasLasFilas<Viatico>((d, h) =>
      supabase.from(T_VIATICOS).select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).order('id').range(d, h));
    return filas.map((v) => ({ ...v, monto_usd: Number(v.monto_usd) || 0, monto_moneda: v.monto_moneda == null ? null : Number(v.monto_moneda), tasa: v.tasa == null ? null : Number(v.tasa) }));
  } catch (e) { throw err(e, 'No se pudieron cargar los viáticos.'); }
}

export interface ViaticoInput {
  chofer_id: string;
  viaje_id?: string | null;
  tipo: 'anticipo' | 'gasto' | 'devolucion';
  concepto: string;
  monto_usd: number;
  moneda?: 'USD' | 'Bs';
  monto_moneda?: number | null;
  tasa?: number | null;
  fecha?: string | null;
  comprobante?: string | null;
  nota?: string | null;
  /** Si viene, además mueve la caja en Tesorería (gasto para anticipo/gasto, ingreso para devolución). */
  caja?: CajaDestino | null;
  /** Texto que se ve en el libro de la caja. */
  chofer_nombre?: string;
  viaje_numero?: string | null;
}

export async function crearViatico(i: ViaticoInput, actor: string, actorName: string | null): Promise<Viatico> {
  if (!i.chofer_id) throw new Error('Elige el chofer.');
  const monto = r2(i.monto_usd);
  if (monto <= 0) throw new Error('El monto debe ser mayor que 0.');
  const concepto = limpio(i.concepto);
  if (!concepto) throw new Error('Indica el concepto.');

  // Primero la caja: si no hay fondos, no se registra nada en el módulo.
  let movimientoId: string | null = null;
  if (i.caja) {
    const quien = i.chofer_nombre ? ` · ${i.chofer_nombre}` : '';
    const ref = i.viaje_numero ? ` · ${i.viaje_numero}` : '';
    const texto = `${i.tipo === 'anticipo' ? 'Anticipo de viáticos' : i.tipo === 'gasto' ? 'Gasto en ruta' : 'Devolución de viáticos'}${quien}${ref}: ${concepto}`;
    const mov = i.tipo === 'devolucion'
      ? await registrarIngresoCaja({ cajaId: i.caja.cajaId, cuenta: i.caja.cuenta, moneda: i.caja.moneda, monto: i.caja.monto, concepto: texto, categoria: 'viatico_chofer', actor, actorName })
      : await registrarGasto({ cajaId: i.caja.cajaId, cuenta: i.caja.cuenta, moneda: i.caja.moneda, monto: i.caja.monto, concepto: texto, categoria: 'viatico_chofer', actor, actorName });
    movimientoId = mov.id;
  }

  const { data, error } = await supabase.from(T_VIATICOS).insert({
    chofer_id: i.chofer_id, viaje_id: i.viaje_id || null, tipo: i.tipo, concepto,
    monto_usd: monto, moneda: i.moneda ?? 'USD',
    monto_moneda: i.monto_moneda != null ? r2(i.monto_moneda) : null,
    tasa: i.tasa != null && i.tasa > 0 ? i.tasa : null,
    fecha: (i.fecha ?? '').slice(0, 10) || undefined,
    comprobante: limpio(i.comprobante), nota: limpio(i.nota),
    movimiento_caja_id: movimientoId, created_by: actor, actor_name: actorName,
  }).select('*').single();
  if (error) {
    throw err(error, movimientoId
      ? 'La caja ya se movió pero el viático no se guardó: revisa el libro de Tesorería y vuelve a cargarlo sin la casilla de caja.'
      : 'No se pudo guardar el viático.');
  }
  return data as Viatico;
}

/** Solo se borra lo que no movió caja: lo que salió de Tesorería se corrige allá. */
export async function eliminarViatico(v: Pick<Viatico, 'id' | 'movimiento_caja_id'>): Promise<void> {
  if (v.movimiento_caja_id) throw new Error('Este viático movió una caja de Tesorería. Corrígelo desde el libro de la caja, no desde aquí.');
  const { data, error } = await supabase.from(T_VIATICOS).delete().eq('id', v.id).select('id');
  if (error) throw err(error, 'No se pudo eliminar.');
  if (!data?.length) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}

/* ───────────── Pagos por viaje ───────────── */

export async function listPagos(): Promise<PagoViaje[]> {
  try {
    const filas = await todasLasFilas<PagoViaje>((d, h) =>
      supabase.from(T_PAGOS).select('*').order('created_at', { ascending: false }).order('id').range(d, h));
    return filas.map((p) => ({
      ...p, detalle: Array.isArray(p.detalle) ? p.detalle : [],
      tarifas_usd: Number(p.tarifas_usd) || 0, reembolsos_usd: Number(p.reembolsos_usd) || 0, deducciones_usd: Number(p.deducciones_usd) || 0,
      bonos_usd: Number(p.bonos_usd) || 0, otras_deducciones_usd: Number(p.otras_deducciones_usd) || 0, neto_usd: Number(p.neto_usd) || 0,
      tasa: p.tasa == null ? null : Number(p.tasa), neto_bs: p.neto_bs == null ? null : Number(p.neto_bs),
    }));
  } catch (e) { throw err(e, 'No se pudieron cargar los pagos.'); }
}

export interface PagoInput {
  chofer_id: string;
  lineas: LineaRecibo[];
  calculo: ReciboCalculado;
  otras_deducciones_motivo?: string | null;
  nota?: string | null;
}

/** Crea el recibo y marca sus viajes como pagados (una sola transacción en la base). */
export async function crearPago(i: PagoInput, actor: string, actorName: string | null): Promise<string> {
  if (!i.lineas.length) throw new Error('Marca al menos un viaje.');
  const { data, error } = await supabase.rpc('choferes_pago_crear', {
    p_pago: {
      chofer_id: i.chofer_id, detalle: i.lineas,
      tarifas_usd: i.calculo.tarifas_usd, reembolsos_usd: i.calculo.reembolsos_usd, deducciones_usd: i.calculo.deducciones_usd,
      bonos_usd: i.calculo.bonos_usd, otras_deducciones_usd: i.calculo.otras_deducciones_usd,
      otras_deducciones_motivo: limpio(i.otras_deducciones_motivo), neto_usd: i.calculo.neto_usd,
      tasa: i.calculo.neto_bs != null && i.calculo.neto_usd > 0 ? r2(i.calculo.neto_bs / i.calculo.neto_usd) : null,
      neto_bs: i.calculo.neto_bs, nota: limpio(i.nota), created_by: actor, actor_name: actorName,
    },
    p_viaje_ids: i.lineas.map((l) => l.viaje_id),
  });
  if (error) throw err(error, 'No se pudo registrar el pago.');
  return data as string;
}

/** Marca el recibo como pagado; si viene caja, registra el gasto en Tesorería. */
export async function marcarPagado(p: PagoViaje, o: { metodo: string; caja?: CajaDestino | null; chofer_nombre: string }, actor: string, actorName: string | null): Promise<void> {
  let movimientoId: string | null = null;
  if (o.caja) {
    const mov = await registrarGasto({
      cajaId: o.caja.cajaId, cuenta: o.caja.cuenta, moneda: o.caja.moneda, monto: o.caja.monto,
      concepto: `Pago de viajes ${p.numero} · ${o.chofer_nombre} (${p.detalle.length} viaje${p.detalle.length === 1 ? '' : 's'})`,
      categoria: 'pago_viaje_chofer', actor, actorName,
    });
    movimientoId = mov.id;
  }
  const { error } = await supabase.from(T_PAGOS).update({
    estado: 'pagado', pagado_at: new Date().toISOString(), pagado_por: actorName || actor,
    metodo: limpio(o.metodo), movimiento_caja_id: movimientoId,
  }).eq('id', p.id).eq('estado', 'pendiente');
  if (error) throw err(error, movimientoId ? 'La caja ya se movió pero el recibo no quedó marcado: revisa el libro de Tesorería.' : 'No se pudo marcar el pago.');
}

export async function anularPago(id: string, actor: string): Promise<void> {
  const { error } = await supabase.rpc('choferes_pago_anular', { p_id: id, p_actor: actor });
  if (error) throw err(error, 'No se pudo anular el recibo.');
}

/* ───────────── Documentos del conductor (con histórico) ─────────────
   Cada subida es una fila nueva; la anterior del mismo tipo queda como versión
   vieja (vigente = false) y no se borra sola: así se sabe cuándo fue la última
   vez que se subió cada papel y quién lo subió. */

export type TipoDocumentoChofer = 'licencia' | 'certificado_medico' | 'seguro' | 'otro';

export const TIPOS_DOCUMENTO_CHOFER: { key: TipoDocumentoChofer; label: string; icon: string; campoVence: 'licencia_vence' | 'certificado_medico_vence' | 'seguro_vence' | null }[] = [
  { key: 'licencia', label: 'Licencia de conducir', icon: '🪪', campoVence: 'licencia_vence' },
  { key: 'certificado_medico', label: 'Certificado médico', icon: '🩺', campoVence: 'certificado_medico_vence' },
  { key: 'seguro', label: 'Seguro', icon: '🛡', campoVence: 'seguro_vence' },
  { key: 'otro', label: 'Otros documentos', icon: '📄', campoVence: null },
];

export interface DocumentoChofer {
  id: string;
  chofer_id: string;
  tipo: TipoDocumentoChofer;
  etiqueta: string | null;
  path: string;
  nombre: string;
  mime: string | null;
  tamano: number | null;
  vence: string | null;
  vigente: boolean;
  subido_por: string | null;
  subido_por_nombre: string | null;
  created_at: string;
}

/** Todos los documentos (vigentes e históricos), del más nuevo al más viejo. */
export async function listDocumentosChofer(): Promise<DocumentoChofer[]> {
  try {
    return await todasLasFilas<DocumentoChofer>((d, h) =>
      supabase.from(T_DOCS).select('*').order('created_at', { ascending: false }).order('id').range(d, h));
  } catch (e) {
    if (esTablaFaltante(e)) throw e; // la página decide qué mostrar
    throw err(e, 'No se pudieron cargar los documentos.');
  }
}

/**
 * Sube un documento y lo deja como el vigente de su tipo (los anteriores quedan
 * como histórico). Si trae fecha de vencimiento, actualiza también la del
 * expediente (licencia / certificado médico / seguro).
 */
export async function subirDocumentoChofer(
  c: Pick<Conductor, 'id' | 'personal_id'>,
  tipo: TipoDocumentoChofer,
  file: File,
  o: { etiqueta?: string | null; vence?: string | null; actor: string; actorName: string | null },
): Promise<DocumentoChofer> {
  const falla = validarArchivoDocumento(file);
  if (falla) throw new Error(falla);
  const etiqueta = limpio(o.etiqueta);
  if (tipo === 'otro' && !etiqueta) throw new Error('Ponle un nombre al documento (ej.: Certificado de antecedentes).');

  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const path = `choferes/${tipo}/${c.personal_id ?? c.id}/${rand}_${nombreSeguro(file.name)}`;
  const { error: errSubir } = await supabase.storage.from(BUCKET_DOCS)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (errSubir) throw new Error(mensajeErrorDocumento(errSubir));

  const { data, error } = await supabase.from(T_DOCS).insert({
    chofer_id: c.id, tipo, etiqueta, path, nombre: file.name, mime: file.type || null, tamano: file.size ?? null,
    vence: o.vence || null, vigente: true, subido_por: o.actor, subido_por_nombre: o.actorName,
  }).select('*').single();
  if (error) {
    await supabase.storage.from(BUCKET_DOCS).remove([path]).catch(() => undefined);
    throw err(error, mensajeErrorDocumento(error));
  }
  const nuevo = data as DocumentoChofer;

  // Los anteriores del mismo tipo (y, en «otros», de la misma etiqueta) pasan al histórico.
  let q = supabase.from(T_DOCS).update({ vigente: false }).eq('chofer_id', c.id).eq('tipo', tipo).neq('id', nuevo.id);
  if (tipo === 'otro') q = q.eq('etiqueta', etiqueta as string);
  await q;

  // El vencimiento del documento es el del expediente.
  const def = TIPOS_DOCUMENTO_CHOFER.find((t) => t.key === tipo);
  if (o.vence && def?.campoVence) await supabase.from(T_CONDUCTORES).update({ [def.campoVence]: o.vence }).eq('id', c.id);
  return nuevo;
}

export async function urlDocumentoChofer(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).createSignedUrl(path, 60 * 10);
  if (error) throw err(error, 'No se pudo abrir el documento.');
  return data.signedUrl;
}

/** Quita un documento (fila y archivo). Si era el vigente, el anterior del mismo tipo vuelve a serlo. */
export async function eliminarDocumentoChofer(d: DocumentoChofer): Promise<void> {
  const { data, error } = await supabase.from(T_DOCS).delete().eq('id', d.id).select('id');
  if (error) throw err(error, 'No se pudo eliminar el documento.');
  if (!data?.length) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
  if (d.vigente) {
    let q = supabase.from(T_DOCS).select('id').eq('chofer_id', d.chofer_id).eq('tipo', d.tipo).order('created_at', { ascending: false }).limit(1);
    if (d.tipo === 'otro') q = q.eq('etiqueta', d.etiqueta ?? '');
    const { data: ant } = await q;
    if (ant?.[0]) await supabase.from(T_DOCS).update({ vigente: true }).eq('id', ant[0].id);
  }
  await supabase.storage.from(BUCKET_DOCS).remove([d.path]).catch(() => undefined);
}

/* ───────────── Borrar (14-10-2026): cada pestaña permite eliminar ───────────── */

/** Borra la orden de ruta con sus paradas y su liquidación. Permite eliminar viajes aunque estén pagados. */
export async function eliminarViaje(v: Pick<Viaje, 'id' | 'numero' | 'pago_id'>): Promise<void> {
  const { data, error } = await supabase.from(T_VIAJES).delete().eq('id', v.id).select('id');
  if (error) throw err(error, 'No se pudo eliminar el viaje.');
  if (!data?.length) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}

/** Borra el recibo. Pendiente → primero se anula (sus viajes vuelven a estar por pagar); pagado → no se borra: anúlalo. */
export async function eliminarPago(p: Pick<PagoViaje, 'id' | 'numero' | 'estado'>, actor: string): Promise<void> {
  if (p.estado === 'pagado') throw new Error(`${p.numero} ya está pagado: anúlalo (queda el rastro y sus viajes vuelven a estar por pagar) y después bórralo si hace falta.`);
  if (p.estado === 'pendiente') await anularPago(p.id, actor);
  const { data, error } = await supabase.from(T_PAGOS).delete().eq('id', p.id).select('id');
  if (error) throw err(error, 'No se pudo eliminar el recibo.');
  if (!data?.length) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}

/** Borra el expediente del conductor (la ficha de RRHH no se toca). Con viajes, viáticos o recibos no deja: desactívalo. */
export async function eliminarConductor(c: Pick<Conductor, 'id'>): Promise<void> {
  const { data, error } = await supabase.from(T_CONDUCTORES).delete().eq('id', c.id).select('id');
  if (error) {
    if ((error as { code?: string }).code === '23503') throw new Error('Este conductor tiene viajes, viáticos o recibos registrados: no se puede borrar. Desactívalo (⛔) para que no salga en las listas.');
    throw err(error, 'No se pudo eliminar el conductor.');
  }
  if (!data?.length) throw new Error('No se pudo eliminar: sin permiso o ya no existía.');
}
