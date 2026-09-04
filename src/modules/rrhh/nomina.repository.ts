/* ============================================================
   MGG · RRHH · Nómina
   RRHH carga la nómina quincenal (en USD, con referencia a la tasa BCV
   del día) y Tesorería paga renglón por renglón (egreso real de caja,
   con seriales/comprobante como en el pago de OC).

   Cálculo por persona:
     salario_diario = sueldo_base_mensual / 30
     salario_bruto  = salario_diario × dias_trabajados   (15 por defecto)
     neto_usd       = salario_bruto + asignaciones(bonos)
                      − (anticipos + préstamos + ivss + faov)
   IVSS/FAOV/bonos están montados (campos) pero hoy en 0 (deshabilitados en UI).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { round2 } from '../tesoreria/tasas.repository';
import type { Caja, NominaPeriodo, NominaRenglon, DeduccionRef, Personal, CuentaCaja } from '@/shared/lib/types';

const BUCKET = 'nomina-comprobantes';
const CAJAS = 'cajas';

/** Etiqueta legible del motivo según el tipo de período de nómina. */
export function labelMotivoNomina(tipo?: string | null): string {
  switch (tipo) {
    case 'vacaciones': return 'Vacaciones';
    case 'liquidacion': return 'Liquidación';
    case 'quincena': return 'Sueldo (quincena)';
    default: return 'Sueldo';
  }
}

/* ───────────── Cálculo (también lo usa la UI para la vista previa) ───────────── */

export interface RenglonCalcInput {
  sueldo_base_mensual: number;
  dias_trabajados: number;
  asignaciones?: number;
  deducciones?: DeduccionRef[];
  deduc_ivss?: number;
  deduc_faov?: number;
}

export interface RenglonCalc {
  salario_bruto: number;
  deduc_anticipos: number;
  deduc_prestamos: number;
  deduc_ivss: number;
  deduc_faov: number;
  asignaciones: number;
  neto_usd: number;
}

export function calcularRenglon(input: RenglonCalcInput): RenglonCalc {
  const diario = (Number(input.sueldo_base_mensual) || 0) / 30;
  const salario_bruto = round2(diario * (Number(input.dias_trabajados) || 0));
  const deducs = input.deducciones ?? [];
  const deduc_anticipos = round2(deducs.filter((d) => d.tipo === 'anticipo').reduce((a, d) => a + (Number(d.monto) || 0), 0));
  const deduc_prestamos = round2(deducs.filter((d) => d.tipo === 'prestamo').reduce((a, d) => a + (Number(d.monto) || 0), 0));
  const deduc_ivss = round2(Number(input.deduc_ivss) || 0);
  const deduc_faov = round2(Number(input.deduc_faov) || 0);
  const asignaciones = round2(Number(input.asignaciones) || 0);
  const neto_usd = round2(salario_bruto + asignaciones - deduc_anticipos - deduc_prestamos - deduc_ivss - deduc_faov);
  return { salario_bruto, deduc_anticipos, deduc_prestamos, deduc_ivss, deduc_faov, asignaciones, neto_usd };
}

/* ───────────── Carga de la nómina ───────────── */

async function nextCodigoNomina(): Promise<string> {
  const year = new Date().getFullYear();
  const { count, error } = await supabase.from('nomina_periodos').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return `NOM-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

export interface RenglonInput {
  personal_id: string;
  nombre: string;
  cargo?: string | null;
  departamento?: string | null;
  sueldo_base_mensual: number;
  dias_trabajados: number;
  asignaciones?: number;
  deducciones?: DeduccionRef[];
  deduc_ivss?: number;
  deduc_faov?: number;
}

export interface CargarNominaInput {
  tipo?: string;                 // 'quincena'
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  dias_base?: number;            // 15
  tasa_bcv?: number | null;
  notas?: string | null;
  renglones: RenglonInput[];
  actorEmail: string;
  actorName?: string | null;
}

/** Crea el período + sus renglones (todos `por_pagar`). */
export async function cargarNomina(input: CargarNominaInput): Promise<NominaPeriodo> {
  const renglones = (input.renglones ?? []).filter((r) => r.personal_id);
  if (!renglones.length) throw new Error('No hay personal para cargar en la nómina.');

  const calculados = renglones.map((r) => ({ r, c: calcularRenglon(r) }));
  const total = round2(calculados.reduce((a, x) => a + x.c.neto_usd, 0));
  const codigo = await nextCodigoNomina();

  const { data: per, error: pErr } = await supabase.from('nomina_periodos').insert({
    codigo,
    tipo: input.tipo || 'quincena',
    periodo_desde: input.periodo_desde || null,
    periodo_hasta: input.periodo_hasta || null,
    dias_base: input.dias_base ?? 15,
    tasa_bcv: input.tasa_bcv ?? null,
    estado: 'cargada',
    total_usd: total,
    notas: input.notas?.trim() || null,
    creada_por: input.actorEmail,
    actor_name: input.actorName ?? null,
  }).select('*').single();
  if (pErr) throw pErr;
  const periodo = per as NominaPeriodo;

  const filas = calculados.map(({ r, c }) => ({
    periodo_id: periodo.id,
    personal_id: r.personal_id,
    nombre: r.nombre,
    cargo: r.cargo ?? null,
    departamento: r.departamento ?? null,
    sueldo_base_mensual: round2(Number(r.sueldo_base_mensual) || 0),
    dias_trabajados: Number(r.dias_trabajados) || 0,
    salario_bruto: c.salario_bruto,
    asignaciones: c.asignaciones,
    deduc_anticipos: c.deduc_anticipos,
    deduc_prestamos: c.deduc_prestamos,
    deduc_ivss: c.deduc_ivss,
    deduc_faov: c.deduc_faov,
    deducciones: r.deducciones ?? [],
    neto_usd: c.neto_usd,
    estado: 'por_pagar',
  }));
  const { error: rErr } = await supabase.from('nomina_renglones').insert(filas);
  if (rErr) { await supabase.from('nomina_periodos').delete().eq('id', periodo.id); throw rErr; }

  return periodo;
}

/* ───────────── Listados ───────────── */

export interface NominaPeriodoResumen extends NominaPeriodo {
  total_renglones: number;
  pagados: number;
  pendientes: number;
}

export async function listNominas(): Promise<NominaPeriodoResumen[]> {
  const { data: pers, error } = await supabase.from('nomina_periodos').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const periodos = (pers ?? []) as NominaPeriodo[];
  if (!periodos.length) return [];
  const { data: regs, error: rErr } = await supabase.from('nomina_renglones').select('periodo_id, estado');
  if (rErr) throw rErr;
  const rows = (regs ?? []) as Array<{ periodo_id: string; estado: string }>;
  return periodos.map((p) => {
    const mios = rows.filter((r) => r.periodo_id === p.id);
    const pagados = mios.filter((r) => r.estado === 'pagada').length;
    return { ...p, total_renglones: mios.length, pagados, pendientes: mios.length - pagados };
  });
}

export async function listRenglones(periodoId: string): Promise<NominaRenglon[]> {
  const { data, error } = await supabase.from('nomina_renglones').select('*').eq('periodo_id', periodoId).order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as NominaRenglon[];
}

/** Renglones pendientes de pago (cola de Tesorería), con datos de su período. */
export async function listRenglonesPorPagar(): Promise<NominaRenglon[]> {
  const { data, error } = await supabase
    .from('nomina_renglones')
    .select('*, periodo:nomina_periodos!nomina_renglones_periodo_id_fkey(codigo, tipo, periodo_desde, periodo_hasta, tasa_bcv)')
    .eq('estado', 'por_pagar')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as NominaRenglon[];
}

/** Un renglón con su período (para el detalle del movimiento en Tesorería). */
export async function getRenglonById(id: string): Promise<NominaRenglon | null> {
  const { data, error } = await supabase
    .from('nomina_renglones')
    .select('*, periodo:nomina_periodos!nomina_renglones_periodo_id_fkey(codigo, tipo, periodo_desde, periodo_hasta, tasa_bcv)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as NominaRenglon | null;
}

export async function countRenglonesPorPagar(): Promise<number> {
  const { count, error } = await supabase.from('nomina_renglones').select('id', { count: 'exact', head: true }).eq('estado', 'por_pagar');
  if (error) throw error;
  return count ?? 0;
}

/** Histórico de pagos individuales de una persona (renglones pagados). */
export async function listHistoricoPersona(personalId: string): Promise<NominaRenglon[]> {
  const { data, error } = await supabase
    .from('nomina_renglones')
    .select('*, periodo:nomina_periodos!nomina_renglones_periodo_id_fkey(codigo, tipo, periodo_desde, periodo_hasta, tasa_bcv)')
    .eq('personal_id', personalId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as NominaRenglon[];
}

/* ───────────── Comprobantes (storage) ───────────── */

export async function subirComprobanteNomina(renglonId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${renglonId}/${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/pdf' });
  if (error) throw error;
  return path;
}

export async function urlComprobanteNomina(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

/* ───────────── Pago de un renglón (desde Tesorería) ───────────── */

function limpiarSeriales(seriales?: string[] | null): string[] {
  const out: string[] = [];
  for (const s of seriales ?? []) { const v = String(s ?? '').trim(); if (v && !out.includes(v)) out.push(v); }
  return out;
}

export interface PagarRenglonInput {
  renglon: NominaRenglon;
  cajaId: string;
  monto: number;          // EN LA MONEDA en la que se paga (Bs ya convertido, o USD)
  tasa?: number | null;   // tasa BCV aplicada si se paga en Bs
  seriales?: string[] | null;
  comprobante?: File | null;
  /** Caja multimoneda: cuenta y moneda del saldo elegido (caja_saldos). */
  cuenta?: CuentaCaja | null;
  moneda?: string | null;
  actorEmail: string;
  actorName?: string | null;
}

/**
 * Paga un renglón: egreso real de la caja (categoría 'pago_nomina', casado con
 * el renglón), descuenta los anticipos/préstamos deducidos, marca el renglón
 * pagado y recalcula el estado del período. El comprobante es opcional.
 */
export async function pagarRenglon(input: PagarRenglonInput): Promise<void> {
  const r = input.renglon;
  if (r.estado === 'pagada') throw new Error('Este renglón ya fue pagado.');
  if (!input.cajaId) throw new Error('Elegí la caja con la que se paga.');

  const { data: cajaRow, error: cErr } = await supabase.from(CAJAS).select('*').eq('id', input.cajaId).maybeSingle();
  if (cErr) throw cErr;
  if (!cajaRow) throw new Error('Caja no encontrada.');
  const caja = cajaRow as Caja;

  const montoPago = round2(Number(input.monto) || 0);
  if (montoPago <= 0) throw new Error('Indicá el monto a pagar.');

  // Moneda/cuenta de pago (con default de la caja). Si la caja maneja saldos multimoneda
  // (caja_saldos) se descuenta del saldo elegido; si no, del saldo legado (cajas.saldo).
  const monedaPago = (input.moneda ?? caja.moneda) as string;
  const cuentaSel: CuentaCaja = (input.cuenta ?? 'general') as CuentaCaja;
  const seriales = limpiarSeriales(input.seriales);

  // Comprobante (opcional) — la subida del archivo va acá porque el RPC no maneja archivos.
  let comprobantePath: string | null = null, comprobanteNombre: string | null = null;
  if (input.comprobante) {
    comprobantePath = await subirComprobanteNomina(r.id, input.comprobante);
    comprobanteNombre = input.comprobante.name;
  }

  // Concepto para el libro (incluye el MOTIVO: Sueldo / Vacaciones / Liquidación).
  const concepto = [
    `Pago nómina ${r.periodo?.codigo ?? ''}`.trim(),
    labelMotivoNomina(r.periodo?.tipo),
    r.nombre,
    seriales.length ? `billetes: ${seriales.join(', ')}` : '',
  ].filter(Boolean).join(' · ');

  // Todo el pago —reserva del renglón con guard de estado, egreso de caja (con FOR UPDATE del
  // saldo), descuento de anticipos y recálculo del período— ocurre en UN RPC transaccional.
  // Dos clics o dos usuarios sobre el mismo renglón ya no pueden pagar dos veces: el segundo
  // recibe error y NO mueve la caja (antes el guard miraba la copia en memoria).
  const { error } = await supabase.rpc('nomina_pagar_renglon', {
    p_renglon_id: r.id,
    p_periodo_id: r.periodo_id,
    p_caja_id: input.cajaId,
    p_monto: montoPago,
    p_moneda: monedaPago,
    p_cuenta: cuentaSel,
    p_tasa: input.tasa ? round2(Number(input.tasa)) : null,
    p_concepto: concepto,
    p_beneficiario: r.nombre,
    p_beneficiario_id: r.personal_id ?? null,
    p_seriales: seriales,
    p_comprobante_path: comprobantePath,
    p_comprobante_nombre: comprobanteNombre,
    p_deducciones: (r.deducciones ?? [])
      .filter((d) => d.id && Number(d.monto) > 0)
      .map((d) => ({ id: d.id, monto: Number(d.monto) })),
    p_actor: input.actorEmail,
    p_actor_name: input.actorName ?? null,
  });
  if (error) throw error;
}

/** Elimina una nómina cargada (solo si ningún renglón fue pagado). */
export async function eliminarNomina(periodoId: string): Promise<void> {
  const { data: regs, error } = await supabase.from('nomina_renglones').select('estado').eq('periodo_id', periodoId);
  if (error) throw error;
  if ((regs ?? []).some((r) => (r as { estado: string }).estado === 'pagada')) {
    throw new Error('No se puede eliminar: ya tiene pagos realizados.');
  }
  const { error: dErr } = await supabase.from('nomina_periodos').delete().eq('id', periodoId);
  if (dErr) throw dErr;
}

/* ───────────── Vacaciones → pago (a Tesorería) ───────────── */

/** Monto de vacaciones = sueldo diario (mensual/30) × días. */
export function montoVacacion(sueldoMensual: number, dias: number): number {
  return round2(((Number(sueldoMensual) || 0) / 30) * (Number(dias) || 0));
}

/**
 * Procesa una vacación: crea una nómina tipo 'vacaciones' de una persona con el
 * monto correspondiente a sus días, lista para que Tesorería la pague. Devuelve
 * el id del renglón generado (para enlazarlo con el evento).
 */
export async function procesarVacacion(input: {
  persona: Personal; dias: number; desde?: string | null; hasta?: string | null;
  actorEmail: string; actorName?: string | null;
}): Promise<{ renglonId: string; periodoId: string; neto: number }> {
  const dias = Number(input.dias) || 0;
  if (dias <= 0) throw new Error('Indicá los días de vacaciones.');
  const sueldo = Number(input.persona.sueldo_base) || 0;
  if (sueldo <= 0) throw new Error('El trabajador no tiene sueldo base cargado.');
  const c = calcularRenglon({ sueldo_base_mensual: sueldo, dias_trabajados: dias });

  const codigo = await nextCodigoNomina();
  const notas = `Vacaciones ${input.persona.nombre} ${input.persona.apellido}`.trim() + (input.desde ? ` (${input.desde}${input.hasta ? ` → ${input.hasta}` : ''})` : '');
  const { data: per, error: pErr } = await supabase.from('nomina_periodos').insert({
    codigo, tipo: 'vacaciones', periodo_desde: input.desde || null, periodo_hasta: input.hasta || null,
    dias_base: dias, estado: 'cargada', total_usd: c.neto_usd, notas,
    creada_por: input.actorEmail, actor_name: input.actorName ?? null,
  }).select('id').single();
  if (pErr) throw pErr;
  const periodoId = (per as { id: string }).id;

  const { data: ren, error: rErr } = await supabase.from('nomina_renglones').insert({
    periodo_id: periodoId,
    personal_id: input.persona.id,
    nombre: `${input.persona.nombre} ${input.persona.apellido}`.trim(),
    cargo: input.persona.cargo ?? null, departamento: input.persona.departamento ?? null,
    sueldo_base_mensual: round2(sueldo), dias_trabajados: dias,
    salario_bruto: c.salario_bruto, neto_usd: c.neto_usd, estado: 'por_pagar',
  }).select('id').single();
  if (rErr) { await supabase.from('nomina_periodos').delete().eq('id', periodoId); throw rErr; }

  return { renglonId: (ren as { id: string }).id, periodoId, neto: c.neto_usd };
}
