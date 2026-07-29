/* ============================================================
   Golden Touch · Centro de Acopio · CAJA PERAMANAL (Supabase)
   Libro de caja (réplica de la hoja "CAJA PERAMANAL - GOLDEN TOUCH").
   · Cada movimiento se clasifica en uno de los 5 grupos (CLASIFICACIONES).
   · La TASA del material se deriva de los agregados:
       tasa = (Σ facturados + Σ gastos + Σ nominas) / Σ kg_cerrados
   · Los saldos corrientes (K y M del Excel) se calculan acá al listar.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CajaCierre, CajaMovimiento, CajaResumen, ClasificacionAcopio, CostoClase, GrupoClasificacion, TransferenciaInter } from '@/shared/lib/types';

export const GRUPOS: { key: GrupoClasificacion; label: string; color: string }[] = [
  { key: 'movimientos_caja', label: 'Movimientos de Caja', color: '#3b82f6' },
  { key: 'contratos',        label: 'Contratos',           color: '#22c55e' },
  { key: 'gastos_caja',      label: 'Gastos Caja',         color: '#ef4444' },
  { key: 'nomina',           label: 'Nómina',              color: '#a855f7' },
  { key: 'traslado',         label: 'Traslado',            color: '#f59e0b' },
];
export const grupoLabel = (g?: string | null) => GRUPOS.find((x) => x.key === g)?.label ?? '—';
export const grupoColor = (g?: string | null) => GRUPOS.find((x) => x.key === g)?.color ?? 'var(--border-strong)';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Centro de acopio por defecto del módulo (hoy solo LA ESPERANZA tiene vista). */
export const CENTRO_ACOPIO_DEFECTO = 'LA ESPERANZA';

/** Centro de acopio (de ESTE sistema) que recibe el dinero que llega del sistema externo socio.
 *  Configurable por build con VITE_ACOPIO_CENTRO_EXTERNO; por defecto GT PERAMANAL (coherente con
 *  DESC_ENTRADA_EXTERNA). Es el «centro de acopio del mismo socio» de un traslado entrante. */
export const CENTRO_ACOPIO_EXTERNO = ((import.meta.env.VITE_ACOPIO_CENTRO_EXTERNO as string | undefined)?.trim()) || 'GT PERAMANAL';

/** Nombre del centro al que pertenece una caja de acopio (para anclar la cuenta por cobrar). */
async function centroDeCajaAcopio(cajaId: string | null): Promise<string | null> {
  if (!cajaId) return null;
  const { data } = await supabase.from('acopio_cajas').select('centro_nombre').eq('id', cajaId).maybeSingle();
  return (data as { centro_nombre?: string } | null)?.centro_nombre ?? null;
}

/**
 * Todo «USD ENTREGADOS» a un centro de costo se vuelve una CUENTA POR COBRAR
 * incremental en Tesorería (el centro debe rendir lo entregado, en dinero o en
 * producto al cambio). Best-effort: si fallara, NO bloquea el movimiento del acopio.
 */
async function anclarUsdEntregadoACuentaPorCobrar(
  centro: string | null, montoUsd: number, descripcion: string | null, actor: string, actorName?: string | null,
): Promise<void> {
  try {
    const c = (centro ?? '').trim();
    const usd = num(montoUsd);
    if (!c || usd <= 0) return;
    const { registrarCobrarPorTraspaso } = await import('@/modules/tesoreria/cuentasPorCobrar.repository');
    await registrarCobrarPorTraspaso({ centro: c, monto: usd, moneda: 'USD', nota: descripcion ?? null, actor, actorName });
  } catch { /* la cuenta por cobrar es best-effort: no bloquea el movimiento */ }
}

/** "Centro de Acopio LA ESPERANZA" → "LA ESPERANZA" (nombre corto del centro). */
export function centroAcopioShort(nombreTesoreria: string): string {
  return (nombreTesoreria || '').replace(/^centro de acopio\s*/i, '').trim() || nombreTesoreria;
}

/* ───────────── Clasificaciones ───────────── */

export async function listClasificaciones(): Promise<ClasificacionAcopio[]> {
  const { data, error } = await supabase
    .from('acopio_clasificaciones')
    .select('*')
    .eq('activo', true)
    .order('grupo', { ascending: true })
    .order('orden', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClasificacionAcopio[];
}

export async function addClasificacion(grupo: GrupoClasificacion, valor: string): Promise<ClasificacionAcopio> {
  const v = valor.trim();
  if (!v) throw new Error('Indicá el valor de la clasificación.');
  const { data, error } = await supabase
    .from('acopio_clasificaciones')
    .insert({ grupo, valor: v, orden: 999 })
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Esa clasificación ya existe en el grupo.');
    throw error;
  }
  return data as ClasificacionAcopio;
}

/** Lista TODAS las clasificaciones (incluidas las inactivas), opcionalmente filtradas por grupo.
 *  Para los gestores de categorías, donde se debe ver y reactivar lo desactivado. */
export async function listClasificacionesAll(grupo?: GrupoClasificacion): Promise<ClasificacionAcopio[]> {
  let q = supabase.from('acopio_clasificaciones').select('*')
    .order('grupo', { ascending: true }).order('orden', { ascending: true }).order('valor', { ascending: true });
  if (grupo) q = q.eq('grupo', grupo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ClasificacionAcopio[];
}

export async function updateClasificacion(id: string, valor: string): Promise<void> {
  const v = valor.trim();
  if (!v) throw new Error('Indicá el valor de la categoría.');
  const { error } = await supabase.from('acopio_clasificaciones').update({ valor: v }).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Esa categoría ya existe en el grupo.');
    throw error;
  }
}

export async function setClasificacionActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('acopio_clasificaciones').update({ activo }).eq('id', id);
  if (error) throw error;
}

/* ───────────── Movimientos ───────────── */

export interface CajaMovimientoInput {
  fecha: string;
  descripcion?: string | null;
  usd_entregado?: number;
  kg_cerrados?: number;
  facturados?: number;
  gastos?: number;
  nominas?: number;
  traslado?: number;
  compra_material?: number;
  kg_recibidos?: number;
  clasif_grupo?: GrupoClasificacion | null;
  clasif_valor?: string | null;
  costo_clasificacion?: string | null;
  costo_subclasificacion?: string | null;
  /** Vehículo/maquinaria imputado (catálogo de Combustible). Opcional. */
  vehiculo?: string | null;
  caja_id?: string | null;
}

/**
 * Clasificaciones de gasto (grupo «gastos_caja») que van ancladas a un VEHÍCULO /
 * MAQUINARIA. Cuando el gasto cae en una de ellas, el formulario ofrece el
 * buscador de equipos del módulo de Combustible y el Resumen permite ver el
 * consumo en $ por vehículo. El anclaje es opcional («no a juro»).
 */
export const CLASIF_VEHICULO = [
  'MAQUINARIA PESADA: REPUESTOS - REPARACIONES - SERVICIOS',
  'VEHICULO: REPUESTOS - REPARACIONES - SERVICIOS',
  'MAQUINARIA LIVIANA: REPUESTOS - REPARACIONES - SERVICIOS',
];
/** ¿La categoría de gasto va anclada a un vehículo? (comparación tolerante a mayúsculas/espacios). */
export function esClasifVehiculo(valor?: string | null): boolean {
  const v = (valor ?? '').trim().toUpperCase();
  return CLASIF_VEHICULO.some((c) => c.toUpperCase() === v);
}

/**
 * Lista los movimientos en orden cronológico y calcula los saldos corrientes
 * (K = saldo $ y M = saldo Kg) acumulando fila a fila, como en el Excel.
 * Si se pasa `cajaId`, filtra a ese cierre.
 */
export async function listCajaMovimientos(cajaId?: string, centroNombre: string | null = CENTRO_ACOPIO_DEFECTO): Promise<CajaMovimiento[]> {
  let q = supabase
    .from('acopio_caja_movimientos')
    .select('*')
    .order('fecha', { ascending: true })
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (cajaId) {
    q = q.eq('caja_id', cajaId);
  } else if (centroNombre) {
    // Acota a las cajas del centro (multi-centro): así cada centro de acopio ve solo lo suyo.
    const { data: cs } = await supabase.from('acopio_cajas').select('id').eq('centro_nombre', centroNombre);
    const ids = (cs ?? []).map((c) => (c as { id: string }).id);
    if (!ids.length) return [];
    q = q.in('caja_id', ids);
  }
  const { data, error } = await q;
  if (error) throw error;
  let saldoUsd = 0;
  let saldoKg = 0;
  return (data ?? []).map((row) => {
    const m = row as CajaMovimiento;
    saldoUsd += num(m.usd_entregado) - num(m.facturados) - num(m.gastos) - num(m.nominas) - num(m.traslado) - num(m.compra_material);
    saldoKg += num(m.kg_cerrados) - num(m.kg_recibidos);
    return { ...m, saldo_usd: saldoUsd, saldo_kg: saldoKg };
  });
}

/**
 * TASA actual del material en acopio = (Σ facturados + Σ gastos + Σ nóminas) / Σ kg_cerrados.
 * Es la que usa la casiterita como costo al cerrarse un contrato desde Producción.
 */
export async function tasaActualAcopio(): Promise<number> {
  const movs = await listCajaMovimientos();
  const kg = movs.reduce((a, m) => a + num(m.kg_cerrados), 0);
  if (kg <= 0) return 0;
  const base = movs.reduce((a, m) => a + num(m.facturados) + num(m.gastos) + num(m.nominas), 0);
  return base / kg;
}

/* ───────────── Resumen de caja (réplica de la hoja «RESUMEN CAJA PERAMANAL GT») ───────────── */

export interface CategoriaResumen { valor: string; monto: number; pct: number }
/** Fila del desglose de CASITERITA (contratos) por categoría: cantidad, facturado y precio. */
export interface CategoriaCasiterita { valor: string; cantidad: number; facturado: number; precio: number; pct: number }
export interface ResumenCajaAcopio {
  centro: string;
  fechaInicio: string | null;     // primera fecha de movimiento
  fechaActualizacion: string;     // hoy (fecha del sistema)
  dias: number;                   // días transcurridos desde el inicio
  movimientos: number;
  totalEntregado: number;
  totalFacturado: number;
  totalGastos: number;
  totalNominas: number;
  totalTraslado: number;
  totalCompraMaterial: number;    // $ Compra de material (egreso)
  totalGastado: number;           // gastos + nóminas
  saldoUsd: number;               // entregado − facturados − gastos − nóminas − traslado − compra material
  pctGastos: number;              // gastos / total gastado
  pctNomina: number;              // nóminas / total gastado
  gastosPorCategoria: CategoriaResumen[];   // gastos + nómina (la nómina va metida en los gastos)
  casiteritaPorCategoria: CategoriaCasiterita[]; // contratos: cantidad + facturado + precio por categoría
  movimientosPorCategoria: CategoriaResumen[];   // movimientos de caja: dinero entregado por categoría
  kgProduccion: number;           // Σ kg_cerrados (casiterita que entra)
  kgEnviados: number;             // Σ kg_recibidos (enviado a MGG)
  diferenciaKg: number;           // enviados − producción
  tasaMaterial: number;           // (facturados + gastos + nóminas) / kg producción
}

/** Hoy en zona Venezuela (YYYY-MM-DD). */
function hoyVE(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10);
}

/**
 * Resumen financiero de la caja del Centro de Acopio (como la hoja del Excel):
 * período + días, saldo actual, total entregado/gastado, % gastos vs % nómina,
 * distribución de gastos y nómina por categoría, y bloque de Kg de casiterita.
 */
export async function resumenCajaAcopio(
  cajaId?: string,
  rango?: { desde?: string | null; hasta?: string | null },
  centroNombre: string | null = CENTRO_ACOPIO_DEFECTO,
): Promise<ResumenCajaAcopio> {
  const todos = await listCajaMovimientos(cajaId, centroNombre);
  // Filtro opcional por rango de fechas (inclusive). Las fechas son 'YYYY-MM-DD',
  // así que la comparación lexicográfica equivale a la cronológica.
  const movs = todos.filter((m) => {
    const f = m.fecha ?? '';
    if (rango?.desde && f < rango.desde) return false;
    if (rango?.hasta && f > rango.hasta) return false;
    return true;
  });
  const sum = (f: (m: CajaMovimiento) => unknown) => movs.reduce((a, m) => a + num(f(m)), 0);
  const totalEntregado = sum((m) => m.usd_entregado);
  const totalFacturado = sum((m) => m.facturados);
  const totalGastos = sum((m) => m.gastos);
  const totalNominas = sum((m) => m.nominas);
  const totalTraslado = sum((m) => m.traslado);
  const totalCompraMaterial = sum((m) => m.compra_material);
  const totalGastado = totalGastos + totalNominas;
  // Redondeo a centavos y normalización del «-0» (evita mostrar «$ -0,00»).
  const round2 = (n: number) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
  const saldoUsd = round2(totalEntregado - totalFacturado - totalGastos - totalNominas - totalTraslado - totalCompraMaterial);
  const kgProduccion = sum((m) => m.kg_cerrados);
  const kgEnviados = sum((m) => m.kg_recibidos);

  // Gastos por categoría INCLUYENDO la nómina (la nómina se mete en los gastos).
  // Cada renglón usa el monto de su grupo (gastos→m.gastos, nómina→m.nominas) y el
  // % se calcula sobre el TOTAL GASTADO (gastos + nómina), por lo que suman 100%.
  const gastosConNomina = (): CategoriaResumen[] => {
    const map = new Map<string, number>();
    for (const m of movs) {
      let monto = 0;
      if (m.clasif_grupo === 'gastos_caja') monto = num(m.gastos);
      else if (m.clasif_grupo === 'nomina') monto = num(m.nominas);
      else continue;
      const k = (m.clasif_valor ?? '').trim() || 'Sin categoría';
      map.set(k, (map.get(k) ?? 0) + monto);
    }
    return Array.from(map.entries())
      .map(([valor, monto]) => ({ valor, monto, pct: totalGastado > 0 ? monto / totalGastado : 0 }))
      .sort((a, b) => b.monto - a.monto);
  };

  // Desglose de CASITERITA (contratos) por categoría: cantidad (Kg), facturado ($) y precio = facturado/cantidad.
  const casiteritaPorCategoria: CategoriaCasiterita[] = (() => {
    const map = new Map<string, { cantidad: number; facturado: number }>();
    for (const m of movs) {
      if (m.clasif_grupo !== 'contratos') continue;
      const k = (m.clasif_valor ?? '').trim() || 'Sin categoría';
      const cur = map.get(k) ?? { cantidad: 0, facturado: 0 };
      cur.cantidad += num(m.kg_cerrados);
      cur.facturado += num(m.facturados);
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([valor, v]) => ({ valor, cantidad: v.cantidad, facturado: v.facturado, precio: v.cantidad > 0 ? v.facturado / v.cantidad : 0, pct: totalFacturado > 0 ? v.facturado / totalFacturado : 0 }))
      .sort((a, b) => b.facturado - a.facturado);
  })();
  // Desglose de MOVIMIENTOS DE CAJA por categoría: dinero entregado ($) que entra a la caja.
  const movimientosPorCategoria: CategoriaResumen[] = (() => {
    const map = new Map<string, number>();
    for (const m of movs) {
      if (m.clasif_grupo !== 'movimientos_caja') continue;
      const k = (m.clasif_valor ?? '').trim() || 'Sin categoría';
      map.set(k, (map.get(k) ?? 0) + num(m.usd_entregado));
    }
    return Array.from(map.entries())
      .map(([valor, monto]) => ({ valor, monto, pct: totalEntregado > 0 ? monto / totalEntregado : 0 }))
      .sort((a, b) => b.monto - a.monto);
  })();

  const fechas = movs.map((m) => m.fecha).filter(Boolean).sort();
  const fechaInicio = fechas[0] ?? null;
  const fechaActualizacion = hoyVE();
  const dias = fechaInicio ? Math.max(0, Math.round((Date.parse(fechaActualizacion) - Date.parse(fechaInicio)) / 86400000)) : 0;

  return {
    centro: centroNombre || CENTRO_ACOPIO_DEFECTO,
    fechaInicio, fechaActualizacion, dias, movimientos: movs.length,
    totalEntregado, totalFacturado, totalGastos, totalNominas, totalTraslado, totalCompraMaterial, totalGastado, saldoUsd,
    pctGastos: totalGastado > 0 ? totalGastos / totalGastado : 0,
    pctNomina: totalGastado > 0 ? totalNominas / totalGastado : 0,
    gastosPorCategoria: gastosConNomina(),
    casiteritaPorCategoria, movimientosPorCategoria,
    kgProduccion, kgEnviados, diferenciaKg: kgEnviados - kgProduccion,
    tasaMaterial: kgProduccion > 0 ? (totalFacturado + totalGastos + totalNominas) / kgProduccion : 0,
  };
}

/** Un movimiento dentro de una categoría (para el detalle al tocar una categoría del resumen). */
export interface MovimientoCategoria {
  id: string;
  fecha: string;
  descripcion: string | null;
  monto: number;
  vehiculo: string | null;
}

/**
 * Lista los movimientos de UNA categoría (grupo + valor) dentro de un rango opcional,
 * con el monto del campo correspondiente (gastos o nóminas). El valor 'Sin categoría'
 * agrupa los movimientos sin clasif_valor. Pensado para el detalle del Resumen de Caja.
 */
export async function listMovimientosCategoria(
  grupo: GrupoClasificacion,
  valor: string,
  rango?: { desde?: string | null; hasta?: string | null },
  cajaId?: string,
  centroNombre: string | null = CENTRO_ACOPIO_DEFECTO,
): Promise<MovimientoCategoria[]> {
  const todos = await listCajaMovimientos(cajaId, centroNombre);
  const campo = (m: CajaMovimiento) =>
    grupo === 'nomina' ? m.nominas
    : grupo === 'movimientos_caja' ? m.usd_entregado
    : grupo === 'contratos' ? m.facturados
    : grupo === 'traslado' ? m.traslado
    : m.gastos;
  return todos
    .filter((m) => {
      if (m.clasif_grupo !== grupo) return false;
      const k = (m.clasif_valor ?? '').trim() || 'Sin categoría';
      if (k !== valor) return false;
      const f = m.fecha ?? '';
      if (rango?.desde && f < rango.desde) return false;
      if (rango?.hasta && f > rango.hasta) return false;
      return num(campo(m)) > 0;
    })
    .map((m) => ({ id: m.id, fecha: m.fecha, descripcion: m.descripcion ?? null, monto: num(campo(m)), vehiculo: m.vehiculo ?? null }));
}

/** Una fila de consumo por vehículo (gasto en $). */
export interface ConsumoVehiculoItem {
  id: string;
  nombre: string;   // vehículo / maquinaria
  compras: number;  // cantidad de movimientos imputados
  valor: number;    // total gastado en $ (repuestos/reparaciones/servicios)
}

/**
 * Consumo (gasto en $) POR VEHÍCULO en un rango de fechas: suma los movimientos de
 * gasto del acopio imputados a un vehículo. Si `clasifValor` se indica, limita a esa
 * categoría; si no, abarca todas las categorías ancladas a vehículo (CLASIF_VEHICULO).
 */
export async function consumoPorVehiculoAcopio(
  desde: Date,
  hasta: Date,
  clasifValor?: string | null,
  centroNombre: string | null = CENTRO_ACOPIO_DEFECTO,
): Promise<ConsumoVehiculoItem[]> {
  const movs = await listCajaMovimientos(undefined, centroNombre);
  const d = isoDay(desde);
  const h = isoDay(hasta);
  const objetivo = clasifValor ? [clasifValor.trim().toUpperCase()] : CLASIF_VEHICULO.map((c) => c.toUpperCase());
  const acc = new Map<string, ConsumoVehiculoItem>();
  for (const m of movs) {
    const f = m.fecha ?? '';
    if (f < d || f > h) continue;
    const cat = (m.clasif_valor ?? '').trim().toUpperCase();
    if (!objetivo.includes(cat)) continue;
    const veh = (m.vehiculo ?? '').trim();
    if (!veh) continue;
    const monto = num(m.gastos);
    if (monto <= 0) continue;
    const cur = acc.get(veh) ?? { id: veh, nombre: veh, compras: 0, valor: 0 };
    cur.compras += 1;
    cur.valor += monto;
    acc.set(veh, cur);
  }
  return Array.from(acc.values())
    .map((x) => ({ ...x, valor: Math.round(x.valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);
}

/** YYYY-MM-DD (zona Venezuela) de una fecha. */
function isoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
}

/** Agregados de cabecera + tasa del material. */
export function resumirCaja(movs: CajaMovimiento[]): CajaResumen {
  const r = movs.reduce(
    (a, m) => ({
      usdEntregado: a.usdEntregado + num(m.usd_entregado),
      kgCerrados: a.kgCerrados + num(m.kg_cerrados),
      facturados: a.facturados + num(m.facturados),
      gastos: a.gastos + num(m.gastos),
      nominas: a.nominas + num(m.nominas),
      traslado: a.traslado + num(m.traslado),
      compraMaterial: a.compraMaterial + num(m.compra_material),
      kgRecibidos: a.kgRecibidos + num(m.kg_recibidos),
    }),
    { usdEntregado: 0, kgCerrados: 0, facturados: 0, gastos: 0, nominas: 0, traslado: 0, compraMaterial: 0, kgRecibidos: 0 },
  );
  const saldoUsd = r.usdEntregado - r.facturados - r.gastos - r.nominas - r.traslado - r.compraMaterial;
  const saldoKg = r.kgCerrados - r.kgRecibidos;
  // F3 = (G3 + H3 + I3) / E3
  const tasa = r.kgCerrados > 0 ? (r.facturados + r.gastos + r.nominas) / r.kgCerrados : 0;
  return { ...r, saldoUsd, saldoKg, tasa };
}

export async function crearMovimientoCaja(input: CajaMovimientoInput, actor: string, actorName?: string | null): Promise<CajaMovimiento> {
  if (!input.fecha) throw new Error('Indicá la fecha del movimiento.');
  const payload = {
    fecha: input.fecha,
    descripcion: input.descripcion?.trim() || null,
    usd_entregado: num(input.usd_entregado),
    kg_cerrados: num(input.kg_cerrados),
    facturados: num(input.facturados),
    gastos: num(input.gastos),
    nominas: num(input.nominas),
    traslado: num(input.traslado),
    compra_material: num(input.compra_material),
    kg_recibidos: num(input.kg_recibidos),
    clasif_grupo: input.clasif_grupo ?? null,
    clasif_valor: input.clasif_valor?.trim() || null,
    costo_clasificacion: input.costo_clasificacion?.trim() || null,
    costo_subclasificacion: input.costo_subclasificacion?.trim() || null,
    vehiculo: input.vehiculo?.trim() || null,
    caja_id: input.caja_id ?? null,
    created_by: actor,
    actor_name: actorName ?? null,
  };
  const { data, error } = await supabase.from('acopio_caja_movimientos').insert(payload).select('*').single();
  if (error) throw error;
  const mov = data as CajaMovimiento;
  // USD ENTREGADOS → cuenta por cobrar incremental del centro (best-effort).
  if (num(input.usd_entregado) > 0) {
    const centro = await centroDeCajaAcopio(input.caja_id ?? mov.caja_id ?? null);
    await anclarUsdEntregadoACuentaPorCobrar(centro, num(input.usd_entregado), input.descripcion ?? null, actor, actorName);
  }
  return mov;
}

export async function actualizarMovimientoCaja(id: string, input: CajaMovimientoInput): Promise<CajaMovimiento> {
  const { data, error } = await supabase
    .from('acopio_caja_movimientos')
    .update({
      fecha: input.fecha,
      descripcion: input.descripcion?.trim() || null,
      usd_entregado: num(input.usd_entregado),
      kg_cerrados: num(input.kg_cerrados),
      facturados: num(input.facturados),
      gastos: num(input.gastos),
      nominas: num(input.nominas),
      traslado: num(input.traslado),
      compra_material: num(input.compra_material),
      kg_recibidos: num(input.kg_recibidos),
      clasif_grupo: input.clasif_grupo ?? null,
      clasif_valor: input.clasif_valor?.trim() || null,
      costo_clasificacion: input.costo_clasificacion?.trim() || null,
      costo_subclasificacion: input.costo_subclasificacion?.trim() || null,
      vehiculo: input.vehiculo?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as CajaMovimiento;
}

/**
 * ENTRADA de dinero desde Tesorería a un centro de acopio interno (traspaso).
 * Se registra como un movimiento del acopio que SUMA en la columna USD ENTREGADOS
 * (grupo «movimientos_caja»), con la descripción/motivo que viene de Tesorería
 * (p. ej. "CAJA MULTIMONEDAS MGG / CAJA LA ESPERANZA"). Si el centro no tiene una
 * caja abierta, se crea una. La usa el traspaso de dinero de Tesorería.
 */
export async function entradaTesoreriaACentroAcopio(input: {
  centroNombre: string;        // nombre corto del centro, ej. "LA ESPERANZA"
  montoUsd: number;            // equivalente en USD del traspaso
  descripcion: string;         // motivo (editable desde Tesorería)
  fecha?: string | null;       // YYYY-MM-DD; por defecto hoy
  actor: string;
  actorName?: string | null;
}): Promise<void> {
  const usd = Math.round((Number(input.montoUsd) || 0) * 100) / 100;
  if (usd <= 0) return;
  const centro = input.centroNombre.trim();
  const fecha = (input.fecha?.trim()) || new Date().toISOString().slice(0, 10);

  // Caja abierta del centro (o se crea una).
  const { data: abierta } = await supabase
    .from('acopio_cajas').select('id').eq('centro_nombre', centro).eq('estado', 'abierta')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  let cajaId = (abierta as { id?: string } | null)?.id ?? null;
  if (!cajaId) {
    const caja = await crearCaja({ numero: centro, nombre: `CAJA ${centro}`, fecha_inicio: fecha, centroNombre: centro }, input.actor);
    cajaId = caja.id;
  }

  // Orden siguiente dentro de la caja.
  const { data: maxRow } = await supabase
    .from('acopio_caja_movimientos').select('orden').eq('caja_id', cajaId)
    .order('orden', { ascending: false }).limit(1).maybeSingle();
  const orden = ((maxRow as { orden?: number } | null)?.orden ?? 0) + 1;

  const desc = input.descripcion.trim() || `CAJA MULTIMONEDAS MGG / CAJA ${centro}`;
  const { error } = await supabase.from('acopio_caja_movimientos').insert({
    caja_id: cajaId, fecha, descripcion: desc, usd_entregado: usd,
    clasif_grupo: 'movimientos_caja', clasif_valor: desc, orden,
    created_by: input.actor, actor_name: input.actorName ?? null,
  });
  if (error) throw error;
  // USD ENTREGADOS → cuenta por cobrar incremental del centro (best-effort).
  await anclarUsdEntregadoACuentaPorCobrar(centro, usd, desc, input.actor, input.actorName);
}

/* ───────────── Cierres (cajas) + taxonomía de costos + resumen ───────────── */

export async function listCajas(centroNombre: string | null = CENTRO_ACOPIO_DEFECTO): Promise<CajaCierre[]> {
  let q = supabase
    .from('acopio_cajas')
    .select('*')
    .order('fecha_inicio', { ascending: false })
    .order('created_at', { ascending: false });
  if (centroNombre) q = q.eq('centro_nombre', centroNombre);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CajaCierre[];
}

export async function crearCaja(input: { numero: string; nombre?: string | null; recepcion?: string | null; fecha_inicio: string; centroNombre?: string }, actor: string): Promise<CajaCierre> {
  const { data, error } = await supabase
    .from('acopio_cajas')
    .insert({
      numero: input.numero.trim() || 'Caja',
      nombre: input.nombre?.trim() || null,
      recepcion: input.recepcion?.trim() || null,
      fecha_inicio: input.fecha_inicio,
      estado: 'abierta',
      centro_nombre: input.centroNombre?.trim() || CENTRO_ACOPIO_DEFECTO,
      created_by: actor,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CajaCierre;
}

/**
 * Descripción FIJA con la que se registra todo dinero que llega del sistema
 * externo (Mineral Group). Aparece en la columna «Descripción» de los
 * Movimientos del Centro de Acopio y suma en la tarjeta «$Usd entregados».
 */
export const DESC_ENTRADA_EXTERNA = 'CAJA MULTIMONEDAS MGG / CAJA GT PERAMANAL';

/**
 * Acepta una transferencia ENTRANTE del otro sistema acreditándola en los
 * MOVIMIENTOS del Centro de Acopio: registra un movimiento (usd_entregado ↑
 * saldo, clasificado en "Movimientos de Caja", descripción fija de entrada
 * externa), marca la transferencia como recibida y avisa al origen (ACK). El id
 * global de la transferencia evita doble acreditación. No exige caja abierta;
 * si hay una, se asocia, y si no, el movimiento entra igual (caja_id null).
 */
/** Entrantes pendientes de aceptar EN EL CENTRO DE ACOPIO (aún no sumaron sus USD entregados).
 *  Tesorería las acepta por separado, con su propia bandera. */
export async function listEntrantesAcopioPorConfirmar(): Promise<TransferenciaInter[]> {
  const { data, error } = await supabase.from('transferencias_inter').select('*')
    .eq('direccion', 'entrante').eq('recibida_acopio', false).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransferenciaInter[];
}

export async function aceptarEntradaEnCajaAcopio(input: {
  row: TransferenciaInter;
  actor: string;
  actorName?: string | null;
}): Promise<void> {
  const { row } = input;
  if (row.recibida_acopio) throw new Error('Esta transferencia ya fue aceptada en el Centro de Acopio.');
  const legs = (row.legs ?? []).filter((l) => Number(l.monto) > 0);
  if (!legs.length) throw new Error('La transferencia no tiene montos.');
  const montoUsd = legs.reduce((a, l) => a + num(l.monto), 0);

  // 1) Entra como «USD entregados» al centro de acopio del SOCIO (crea/usa su caja abierta),
  //    grupo Movimientos de Caja, con la descripción fija de entrada externa. Ancla la CxC.
  await entradaTesoreriaACentroAcopio({
    centroNombre: CENTRO_ACOPIO_EXTERNO,
    montoUsd,
    descripcion: DESC_ENTRADA_EXTERNA,
    actor: input.actor,
    actorName: input.actorName ?? null,
  });

  // 2) Marca la bandera de Acopio; la transferencia pasa a 'recibida' (+ACK) en la PRIMERA aceptación.
  const primera = row.estado === 'por_confirmar';
  const { error } = await supabase.from('transferencias_inter').update({
    recibida_acopio: true,
    confirmada_at: new Date().toISOString(),
    ...(primera ? { estado: 'recibida' } : {}),
  }).eq('id', row.id);
  if (error) throw error;

  // 3) ACK al origen solo en la primera aceptación (best-effort).
  if (primera && row.callback_base) {
    await supabase.functions.invoke('transfer-enviar', {
      body: { tipo: 'ack', transf_id: row.transf_id, callback_base: row.callback_base },
    }).catch(() => { /* el ACK no bloquea */ });
  }
}

/** Cierra una caja: fija fecha de cierre, saldo final y estado. */
export async function cerrarCaja(id: string, saldoFinal: number, actor: string, fechaFin?: string): Promise<void> {
  const { error } = await supabase
    .from('acopio_cajas')
    .update({
      estado: 'cerrada',
      fecha_fin: fechaFin || new Date().toISOString().slice(0, 10),
      saldo_final: saldoFinal,
      cerrada_por: actor,
      cerrada_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function reabrirCaja(id: string): Promise<void> {
  const { error } = await supabase
    .from('acopio_cajas')
    .update({ estado: 'abierta', fecha_fin: null, cerrada_por: null, cerrada_en: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/* ───────────── Cerrar caja (checkpoint) + apertura automática ─────────────
   Cada centro de costo trabaja una caja a la vez (como las hojas del Excel).
   Al CERRAR la caja actual:
     · el SALDO EN KG pasa al INVENTARIO como una entrada de CASITERITA en el
       almacén de casiterita del centro, valorizada a la TASA del material;
     · la caja queda cerrada (con su saldo final) y se ABRE una nueva;
     · el SALDO EN $ se trae a la caja nueva como un movimiento de apertura en
       «$ entregados» (NO genera cuenta por cobrar: ya estaba contabilizado).
   El resto arranca en cero: la caja nueva es el «libro» en vivo del centro. */

/** Nombre del almacén de casiterita ligado a un centro de costo (uno por centro,
 *  con nombre único porque el stock se indexa por nombre de almacén). */
export function almacenCasiteritaDeCentro(centro: string): string {
  const c = (centro || CENTRO_ACOPIO_DEFECTO).trim();
  return c === 'LA ESPERANZA' ? 'CASITERITA' : `CASITERITA · ${c}`;
}

/** Siguiente «Caja #N» del centro (correlativo por el mayor número ya usado). */
/** Sugerencia del número de la próxima caja: toma el mayor número usado en el
 *  centro y le suma 1. Si aún no hay ninguna con número, arranca en «Caja #1».
 *  El usuario puede sobreescribirlo al cerrar (la primera vez); de ahí en más
 *  el incremental sigue solo. */
export async function siguienteNumeroCaja(centro: string): Promise<string> {
  const cajas = await listCajas(centro);
  let max = 0;
  for (const c of cajas) {
    const m = String(c.numero || '').match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Caja #${max + 1}`;
}

export interface CierreCajaResultado {
  cajaCerrada: CajaCierre;
  cajaNueva: CajaCierre;
  saldoUsd: number;
  saldoKg: number;
  tasa: number;
  almacenCasiterita: string;
  kgAInventario: boolean;
  aliadosCerrados: number;   // cuántos aliados del centro se cerraron junto con la caja
}

export async function cerrarYAbrirCaja(input: {
  centro: string; actor: string; actorName?: string | null; numeroNueva?: string | null;
  cerrarAliados?: boolean;   // además del centro, cierra cada aliado con saldo_kg > 0
  arrastrarGastos?: boolean; // arrastra los gastos de cada aliado a los Totales de la recepción
  traerAliadosAlCentro?: boolean; // trae los Kg recibidos de cada aliado como fila en el centro (Kg × tasa)
}): Promise<CierreCajaResultado> {
  const centro = (input.centro || CENTRO_ACOPIO_DEFECTO).trim();
  const cajas = await listCajas(centro);
  const abierta = cajas.find((c) => c.estado === 'abierta');
  if (!abierta) throw new Error('No hay una caja abierta para cerrar en este centro.');
  const hoy = new Date().toISOString().slice(0, 10);

  // 0) (opcional) TRAER LOS ALIADOS AL CENTRO: por cada aliado con Kg recibidos por MGG
  //    en su PERIODO ABIERTO, se inserta una fila «CENTRO DE ACOPIO <aliado> PARA LA
  //    RECEPCION» = Kg × tasa del aliado (entrada+salida, neto $0; suma los Kg a la
  //    casiterita del centro). Se hace ANTES de calcular el saldo, para que entre al cierre.
  if (input.traerAliadosAlCentro) {
    const { listAliados, openPeriodoAliado, listAliadoMovimientos, resumirAliado } = await import('./subledgers.repository');
    const aliados = await listAliados(centro).catch(() => []);
    for (const a of aliados) {
      try {
        const periodo = await openPeriodoAliado(a.id);
        const res = resumirAliado(await listAliadoMovimientos(a.id, periodo));
        const kg = Math.round((Number(res.totalKgRecibidos) || 0) * 100) / 100;
        const tasa2 = Math.round((Number(res.precioProm) || 0) * 10000) / 10000;
        if (kg <= 0 || tasa2 <= 0) continue;
        const val = Math.round(kg * tasa2 * 100) / 100;
        const corto = (a.nombre.split(' - ').pop() || a.nombre).trim();
        await supabase.from('acopio_caja_movimientos').insert({
          caja_id: abierta.id, fecha: hoy,
          descripcion: `CENTRO DE ACOPIO ${corto} PARA LA RECEPCION`,
          usd_entregado: val, kg_cerrados: kg, facturados: val,
          clasif_grupo: 'movimientos_caja', clasif_valor: `2. CAJA MULTIMONEDAS MGG / CAJA ${centro}`,
          created_by: input.actor, actor_name: input.actorName ?? null,
        });
      } catch { /* un aliado que falle no bloquea el cierre */ }
    }
  }

  // Saldos de ESTA caja (no acumulados de cierres previos). Se leen DESPUÉS de traer los
  // aliados (paso 0), para que esos Kg entren en el saldo que va a la recepción del centro.
  const movs = await listCajaMovimientos(abierta.id, centro);
  const r = resumirCaja(movs);
  const saldoUsd = Math.round(r.saldoUsd * 100) / 100;
  const saldoKg = Math.round(r.saldoKg * 100) / 100;
  const tasa = Math.round(r.tasa * 10000) / 10000;

  // 1) SALDO EN KG → RECEPCIONES (paso intermedio). YA NO entra directo al inventario:
  //    se crea una recepción con el peso y la procedencia (centro). El ingreso al
  //    inventario se hará luego desde el módulo Recepciones. Solo si hay Kg positivos.
  let kgAInventario = false;
  if (saldoKg > 0) {
    const { crearRecepcionDesdeCierre } = await import('@/modules/recepciones/recepciones.repository');
    await crearRecepcionDesdeCierre({
      pesoKg: saldoKg, tasa: tasa > 0 ? tasa : null, procedencia: centro, centroNombre: centro,
      origen: 'cierre_caja', refCajaId: abierta.id,
      actor: input.actor, actorName: input.actorName ?? null,
    });
    kgAInventario = true; // (se mantiene el flag para el resumen del cierre: hubo Kg que pasaron a Recepciones)
  }

  // 2) Cerrar la caja actual con su saldo final.
  await cerrarCaja(abierta.id, saldoUsd, input.actor, hoy);

  // 3) Abrir la caja nueva. Si el usuario indicó un número (la primera vez),
  //    se respeta; si no, sigue el incremental automático.
  const numero = input.numeroNueva?.trim() || (await siguienteNumeroCaja(centro));
  const nueva = await crearCaja({ numero, nombre: `CAJA ${centro}`, fecha_inicio: hoy, centroNombre: centro }, input.actor);

  // 4) Traer el SALDO EN $ como movimiento de apertura («$ entregados») en la
  //    caja nueva. Inserción directa: NO debe generar cuenta por cobrar.
  if (saldoUsd !== 0) {
    const desc = `SALDO INICIAL · viene del cierre ${abierta.numero}`;
    const { error } = await supabase.from('acopio_caja_movimientos').insert({
      caja_id: nueva.id, fecha: hoy, descripcion: desc,
      usd_entregado: saldoUsd, clasif_grupo: 'movimientos_caja', clasif_valor: 'SALDO INICIAL', orden: 1,
      created_by: input.actor, actor_name: input.actorName ?? null,
    });
    if (error) throw error;
  }

  // 5) Cierre de ALIADOS del centro (opcional): cada aliado con saldo de casiterita > 0
  //    se cierra también, trayendo su saldo_kg a SU propia tasa como una fila más en la
  //    MISMA Recepción del centro. Los gastos de cada aliado se arrastran si se pidió.
  //    Un aliado que falle no bloquea el resto del cierre.
  let aliadosCerrados = 0;
  if (input.cerrarAliados) {
    const { listAliadosConResumen, cerrarYAbrirCajaAliado } = await import('./subledgers.repository');
    const conResumen = await listAliadosConResumen(centro).catch(() => []);
    for (const { aliado, resumen } of conResumen) {
      if ((Number(resumen.saldoKg) || 0) > 0) {
        try {
          await cerrarYAbrirCajaAliado({
            aliadoId: aliado.id, centro, actor: input.actor, actorName: input.actorName ?? null,
            gastos: input.arrastrarGastos ? (Number(resumen.totalGastos) || 0) : 0,
          });
          aliadosCerrados++;
        } catch { /* seguir con los demás aliados */ }
      }
    }
  }

  return { cajaCerrada: abierta, cajaNueva: nueva, saldoUsd, saldoKg, tasa, almacenCasiterita: almacenCasiteritaDeCentro(centro), kgAInventario, aliadosCerrados };
}

export async function listCostoClases(): Promise<CostoClase[]> {
  const { data, error } = await supabase
    .from('acopio_costo_clases')
    .select('*')
    .eq('activo', true)
    .order('clasificacion', { ascending: true })
    .order('orden', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CostoClase[];
}

export async function addCostoClase(clasificacion: string, subclasificacion: string): Promise<CostoClase> {
  const cl = clasificacion.trim(), sub = subclasificacion.trim();
  if (!cl || !sub) throw new Error('Indicá clasificación y sub-clasificación.');
  const { data, error } = await supabase
    .from('acopio_costo_clases')
    .insert({ clasificacion: cl, subclasificacion: sub, orden: 999 })
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Esa sub-clasificación ya existe.');
    throw error;
  }
  return data as CostoClase;
}

/** Reporte de cierre calculado (réplica del RESUMEN del Excel). */
export interface CierreResumen extends CajaResumen {
  dias: number;
  totalGastado: number;
  /** Distribución del gasto por categoría (los 5 grupos), en % del total gastado. */
  porGrupo: { grupo: GrupoClasificacion; label: string; color: string; monto: number; pct: number }[];
  /** Distribución del gasto por clasificación de costo (2 niveles). */
  porCosto: { clasificacion: string; subclasificacion: string; monto: number; pct: number }[];
}

export function resumirCierre(caja: CajaCierre | null, movs: CajaMovimiento[]): CierreResumen {
  const base = resumirCaja(movs);
  const totalGastado = base.facturados + base.gastos + base.nominas + base.traslado + base.compraMaterial;
  // Salidas por grupo de clasificación (suma de gastos+nominas+traslado+facturados+compra material de cada fila).
  const salida = (m: CajaMovimiento) => num(m.gastos) + num(m.nominas) + num(m.traslado) + num(m.facturados) + num(m.compra_material);
  const grupAcc = new Map<string, number>();
  const costoAcc = new Map<string, number>();
  for (const m of movs) {
    const s = salida(m);
    if (s > 0 && m.clasif_grupo) grupAcc.set(m.clasif_grupo, (grupAcc.get(m.clasif_grupo) ?? 0) + s);
    if (s > 0 && m.costo_clasificacion) {
      const k = `${m.costo_clasificacion}||${m.costo_subclasificacion ?? ''}`;
      costoAcc.set(k, (costoAcc.get(k) ?? 0) + s);
    }
  }
  const porGrupo = GRUPOS.map((g) => ({
    grupo: g.key, label: g.label, color: g.color,
    monto: grupAcc.get(g.key) ?? 0,
    pct: totalGastado > 0 ? ((grupAcc.get(g.key) ?? 0) / totalGastado) * 100 : 0,
  })).filter((x) => x.monto > 0).sort((a, b) => b.monto - a.monto);
  const porCosto = [...costoAcc.entries()].map(([k, monto]) => {
    const [clasificacion, subclasificacion] = k.split('||');
    return { clasificacion, subclasificacion, monto, pct: totalGastado > 0 ? (monto / totalGastado) * 100 : 0 };
  }).sort((a, b) => b.monto - a.monto);
  // Días transcurridos del cierre.
  let dias = 0;
  if (caja?.fecha_inicio) {
    const fin = caja.fecha_fin || new Date().toISOString().slice(0, 10);
    dias = Math.max(0, Math.round((Date.parse(fin) - Date.parse(caja.fecha_inicio)) / 86400000));
  }
  return { ...base, dias, totalGastado, porGrupo, porCosto };
}

export async function eliminarMovimientoCaja(id: string): Promise<void> {
  const { error } = await supabase.from('acopio_caja_movimientos').delete().eq('id', id);
  if (error) throw error;
}
