/* ============================================================
   Centro de Acopio · Sub-ledgers (Supabase)
   Dos libros que cuelgan del acopio, réplica de las hojas del Excel:
     1) POR ALIADO  («CENTRO ACOPIO - {ALIADO}»):
        tipo 'cierre' = entrega $ + compromete Kg ; tipo 'abono' = entrega Kg.
        Facturado H = F·G ; Saldo $ I = Iprev + E − H ; Saldo Kg L = Lprev + F − K.
     2) CUENTAS POR COBRAR («CUENTA POR COBRAR {CLIENTE}»):
        deuda en $ que se paga con mineral. Total USD G = E·F ;
        Deuda H = Hprev + D − G ; Saldo Kg J = E + Jprev (entra a casiterita si se marca).

   Integración:
   · Cada CIERRE de aliado genera un TRASLADO en la caja general
     (acopio_caja_movimientos) y entra como USD ENTREGADO en el ledger del aliado.
   · Los Kg de un abono (aliado o cobrar) entran a stock real de CASITERITA
     SOLO si se marca el opt-in (reflejo_casiterita).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { AliadoAcopio, AliadoMovimiento, AliadoCierre, CuentaCobrarAcopio, CobrarAbono } from '@/shared/lib/types';
import { registrarMovimiento } from '@/modules/inventario/movimientos.repository';
import { crearMovimientoCaja, eliminarMovimientoCaja, almacenCasiteritaDeCentro, CENTRO_ACOPIO_DEFECTO } from './caja.repository';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
/** Sub-almacén destino del mineral que entra por un abono. */
const ALMACEN_CASITERITA = 'CASITERITA';

/** Centro cuyo material es ORO en gramos (no casiterita). */
function esCentroOro(centro: string): boolean {
  return (centro || '').trim().toUpperCase() === 'PERAMANAL ENDER MEJIAS';
}

/**
 * Todo «$ ENTREGADO» a un ALIADO se vuelve una CUENTA POR COBRAR incremental en
 * Tesorería (el aliado debe rendir lo entregado, en dinero o producto al cambio),
 * con el aliado como contraparte. Best-effort: si falla, no bloquea el movimiento.
 */
async function anclarUsdAliadoACuentaPorCobrar(
  aliadoNombre: string, montoUsd: number, nota: string | null, actor: string, actorName?: string | null,
): Promise<void> {
  try {
    const nombre = (aliadoNombre ?? '').trim();
    const usd = r2(montoUsd);
    if (!nombre || usd <= 0) return;
    const { registrarCobrarPorTraspaso } = await import('@/modules/tesoreria/cuentasPorCobrar.repository');
    await registrarCobrarPorTraspaso({ centro: nombre, monto: usd, moneda: 'USD', nota, actor, actorName });
  } catch { /* la cuenta por cobrar es best-effort: no bloquea el movimiento */ }
}

/* ───────────── Aliados (catálogo) ───────────── */

export async function listAliados(centroNombre = CENTRO_ACOPIO_DEFECTO): Promise<AliadoAcopio[]> {
  const { data, error } = await supabase
    .from('acopio_aliados').select('*')
    .eq('centro_nombre', centroNombre)
    .order('activo', { ascending: false })
    .order('nombre', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AliadoAcopio[];
}

export async function crearAliado(nombre: string, actor: string, centroNombre = CENTRO_ACOPIO_DEFECTO): Promise<AliadoAcopio> {
  const n = nombre.trim();
  if (!n) throw new Error('Indicá el nombre del aliado.');
  const { data, error } = await supabase
    .from('acopio_aliados').insert({ nombre: n, centro_nombre: centroNombre, created_by: actor })
    .select('*').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ese aliado ya existe.');
    throw error;
  }
  return data as AliadoAcopio;
}

export async function setAliadoActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('acopio_aliados').update({ activo }).eq('id', id);
  if (error) throw error;
}

/** Edita un aliado (nombre y/o activo). */
export async function actualizarAliado(id: string, patch: { nombre?: string; activo?: boolean }): Promise<void> {
  const upd: Record<string, unknown> = {};
  if (patch.nombre != null) {
    const n = patch.nombre.trim();
    if (!n) throw new Error('El nombre no puede quedar vacío.');
    upd.nombre = n;
  }
  if (patch.activo != null) upd.activo = patch.activo;
  if (!Object.keys(upd).length) return;
  const { error } = await supabase.from('acopio_aliados').update(upd).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Ya existe un aliado con ese nombre.');
    throw error;
  }
}

/* ───────────── Movimientos por aliado (con saldos corridos) ───────────── */

/** Una fila del ledger del aliado con los cálculos del Excel resueltos. */
export interface AliadoFila extends AliadoMovimiento {
  facturado: number;   // H = F·G
  saldoUsd: number;    // I corrido
  saldoKg: number;     // L corrido
}

/** Resumen del aliado (cabecera = totales del Excel). */
export interface AliadoResumen {
  totalEntregado: number;
  totalFacturado: number;
  totalGastos: number;
  totalKgCerrados: number;
  totalKgRecibidos: number;
  saldoUsd: number;     // último I
  saldoKg: number;      // último L = Kg que el aliado aún debe
  precioProm: number;   // facturado/kg
}

/** Lista los movimientos del aliado en orden cronológico con I y L corridos.
 *  Si se pasa `periodo`, acota a ese periodo de caja (la vista viva usa el abierto). */
export async function listAliadoMovimientos(aliadoId: string, periodo?: number): Promise<AliadoFila[]> {
  let q = supabase
    .from('acopio_aliado_movimientos').select('*')
    .eq('aliado_id', aliadoId)
    .order('fecha', { ascending: true })
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (periodo != null) q = q.eq('periodo', periodo);
  const { data, error } = await q;
  if (error) throw error;
  let saldoUsd = 0, saldoKg = 0;
  return (data ?? []).map((row) => {
    const m = row as AliadoMovimiento;
    const facturado = r2(num(m.kg_cerrados) * num(m.precio_usd_kg));
    // Saldo $ = anterior + entregado − facturado − gastos. (gastos solo en la plantilla Entrada/Salida/Gastos)
    saldoUsd = r2(saldoUsd + num(m.usd_entregado) - facturado - num(m.gastos));
    saldoKg = r2(saldoKg + num(m.kg_cerrados) - num(m.kg_recibidos));
    return { ...m, facturado, saldoUsd, saldoKg };
  });
}

export function resumirAliado(filas: AliadoFila[]): AliadoResumen {
  const totalEntregado = filas.reduce((a, f) => a + num(f.usd_entregado), 0);
  const totalFacturado = filas.reduce((a, f) => a + num(f.facturado), 0);
  const totalGastos = filas.reduce((a, f) => a + num(f.gastos), 0);
  const totalKgCerrados = filas.reduce((a, f) => a + num(f.kg_cerrados), 0);
  const totalKgRecibidos = filas.reduce((a, f) => a + num(f.kg_recibidos), 0);
  return {
    totalEntregado: r2(totalEntregado),
    totalFacturado: r2(totalFacturado),
    totalGastos: r2(totalGastos),
    totalKgCerrados: r2(totalKgCerrados),
    totalKgRecibidos: r2(totalKgRecibidos),
    saldoUsd: filas.length ? filas[filas.length - 1].saldoUsd : 0,
    saldoKg: filas.length ? filas[filas.length - 1].saldoKg : 0,
    precioProm: totalKgCerrados > 0 ? r2(totalFacturado / totalKgCerrados) : 0,
  };
}

/** Aliado + su resumen (para las tarjetas). */
export interface AliadoConResumen { aliado: AliadoAcopio; resumen: AliadoResumen }

/** Lista los aliados con su resumen (saldo $ y Kg, totales) para mostrarlos como tarjetas. */
export async function listAliadosConResumen(centroNombre = CENTRO_ACOPIO_DEFECTO): Promise<AliadoConResumen[]> {
  const aliados = await listAliados(centroNombre);
  // En paralelo: el resumen de cada aliado se calcula a la vez (no en cascada).
  return Promise.all(
    aliados.map(async (a) => ({ aliado: a, resumen: resumirAliado(await listAliadoMovimientos(a.id)) })),
  );
}

/** Caja general ABIERTA del centro (para reflejar el traslado del cierre). null si no hay. */
async function cajaAbiertaDeCentro(centroNombre: string): Promise<string | null> {
  const { data } = await supabase
    .from('acopio_cajas').select('id').eq('centro_nombre', centroNombre).eq('estado', 'abierta')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Próximo `orden` dentro del ledger del aliado. */
async function nextOrdenAliado(aliadoId: string): Promise<number> {
  const { data } = await supabase
    .from('acopio_aliado_movimientos').select('orden').eq('aliado_id', aliadoId)
    .order('orden', { ascending: false }).limit(1).maybeSingle();
  return ((data as { orden?: number } | null)?.orden ?? 0) + 1;
}

/** Periodo de caja ABIERTO del aliado = último cierre + 1 (1 si nunca cerró). */
export async function openPeriodoAliado(aliadoId: string): Promise<number> {
  const { data } = await supabase
    .from('acopio_aliado_cierres').select('periodo').eq('aliado_id', aliadoId)
    .order('periodo', { ascending: false }).limit(1).maybeSingle();
  return ((data as { periodo?: number } | null)?.periodo ?? 0) + 1;
}

/**
 * Entrada a stock real de CASITERITA por unos Kg de abono (opt-in). Devuelve el id
 * del movimiento de inventario, o null si no aplica. Resuelve el producto «Casiterita»
 * por SKU para no acoplar un id fijo.
 */
async function sumarCasiterita(kg: number, detalle: string, actor: string, actorName?: string | null): Promise<string | null> {
  const cantidad = num(kg);
  if (cantidad <= 0) return null;
  const { data: prod, error } = await supabase
    .from('productos').select('id').eq('sku', 'CASITERITA').maybeSingle();
  if (error) throw error;
  if (!prod) throw new Error('No existe el producto «Casiterita» (SKU CASITERITA). Crealo en Inventario para sumar Kg a casiterita.');
  const mov = await registrarMovimiento({
    producto_id: (prod as { id: string }).id,
    tipo: 'entrada', delta: cantidad, almacen: ALMACEN_CASITERITA,
    actor, actor_name: actorName ?? null,
    ref_tipo: 'acopio_subledger', ref_codigo: detalle, detalle,
  });
  return mov.id;
}

export interface CierreAliadoInput {
  aliadoId: string;
  aliadoNombre: string;       // para la descripción del traslado en la caja general
  fecha: string;
  corte?: number | null;
  descripcion?: string | null;
  usdEntregado: number;       // E
  kgCerrados: number;         // F
  precioUsdKg: number;        // G
  gastos?: number;            // salida de gasto (opcional)
  /** Refleja la entrega de $ como TRASLADO en la caja general (por defecto sí). */
  reflejarCajaGeneral?: boolean;
  centroNombre?: string;
}

/**
 * Registra un CIERRE en el ledger del aliado y, si corresponde, refleja la entrega
 * de dinero como un TRASLADO en la caja general (acopio_caja_movimientos) con la
 * descripción «CIERRE {corte} · {ALIADO}». El traslado baja el saldo $ de la caja
 * general; en el ledger del aliado el monto entra como USD ENTREGADO.
 */
export async function crearCierreAliado(input: CierreAliadoInput, actor: string, actorName?: string | null): Promise<AliadoMovimiento> {
  if (!input.fecha) throw new Error('Indicá la fecha del cierre.');
  const usd = r2(input.usdEntregado);
  const kg = r2(input.kgCerrados);
  const precio = r2(input.precioUsdKg);
  if (usd <= 0 && kg <= 0) throw new Error('Indicá el dinero entregado y/o los Kg del cierre.');
  const centro = input.centroNombre || CENTRO_ACOPIO_DEFECTO;
  const reflejar = input.reflejarCajaGeneral !== false;

  // 1) Traslado en la caja general (opcional, por defecto sí).
  let cajaMovId: string | null = null;
  if (reflejar && usd > 0) {
    const desc = `CIERRE${input.corte ? ` ${input.corte}` : ''} · ${input.aliadoNombre}`;
    const cajaId = await cajaAbiertaDeCentro(centro);
    const mov = await crearMovimientoCaja(
      { fecha: input.fecha, descripcion: desc, traslado: usd, clasif_grupo: 'traslado', clasif_valor: desc, caja_id: cajaId },
      actor, actorName,
    );
    cajaMovId = mov.id;
  }

  // 2) Cierre en el ledger del aliado.
  const orden = await nextOrdenAliado(input.aliadoId);
  const periodo = await openPeriodoAliado(input.aliadoId);
  const { data, error } = await supabase.from('acopio_aliado_movimientos').insert({
    aliado_id: input.aliadoId, fecha: input.fecha, corte: input.corte ?? null, tipo: 'cierre',
    descripcion: input.descripcion?.trim() || `CENTRO DE ACOPIO ${input.aliadoNombre}`,
    usd_entregado: usd, kg_cerrados: kg, precio_usd_kg: precio, kg_recibidos: 0, gastos: r2(input.gastos ?? 0),
    caja_mov_id: cajaMovId, orden, periodo, created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) {
    if (cajaMovId) await eliminarMovimientoCaja(cajaMovId).catch(() => {});
    throw error;
  }
  // $ entregado al aliado → cuenta por cobrar incremental del aliado (best-effort).
  if (usd > 0) await anclarUsdAliadoACuentaPorCobrar(input.aliadoNombre, usd, input.descripcion ?? null, actor, actorName);
  return data as AliadoMovimiento;
}

/* ───────────── Movimiento unificado (estructura de acopio, una sola fila) ───────────── */

export interface MovimientoAliadoInput {
  aliadoId: string;
  aliadoNombre: string;
  fecha: string;
  corte?: number | null;
  descripcion?: string | null;
  usdEntregado?: number;      // E
  kgCerrados?: number;        // F
  precioUsdKg?: number;       // G  (facturado H = F·G)
  kgRecibidos?: number;       // K  (Kg recibidos por MGG)
  gastos?: number;
  /** Refleja la entrega de $ como TRASLADO en la caja general (por defecto sí si hay $). */
  reflejarCajaGeneral?: boolean;
  /** Suma los Kg recibidos al stock real de CASITERITA. */
  sumarCasiterita?: boolean;
  centroNombre?: string;
}

/**
 * Registra UN movimiento del aliado con la estructura completa de acopio (entregado,
 * Kg cerrados, $/Kg, Kg recibidos, gastos) en una sola fila. Refleja el traslado en
 * la caja general si hay $ entregado (opt-in) y suma a casiterita si se marca.
 */
export async function crearMovimientoAliado(input: MovimientoAliadoInput, actor: string, actorName?: string | null): Promise<AliadoMovimiento> {
  if (!input.fecha) throw new Error('Indicá la fecha del movimiento.');
  const usd = r2(input.usdEntregado ?? 0);
  const kgC = r2(input.kgCerrados ?? 0);
  const precio = r2(input.precioUsdKg ?? 0);
  const kgR = r2(input.kgRecibidos ?? 0);
  const gastos = r2(input.gastos ?? 0);
  if (usd <= 0 && kgC <= 0 && kgR <= 0 && gastos <= 0) throw new Error('Cargá al menos un valor (entregado, Kg cerrados, Kg recibidos o gastos).');
  const centro = input.centroNombre || CENTRO_ACOPIO_DEFECTO;
  const reflejar = input.reflejarCajaGeneral !== false;

  // 1) Traslado en la caja general (si hay $ entregado y se pidió reflejar).
  let cajaMovId: string | null = null;
  if (reflejar && usd > 0) {
    const desc = `CIERRE${input.corte ? ` ${input.corte}` : ''} · ${input.aliadoNombre}`;
    const cajaId = await cajaAbiertaDeCentro(centro);
    const mov = await crearMovimientoCaja(
      { fecha: input.fecha, descripcion: desc, traslado: usd, clasif_grupo: 'traslado', clasif_valor: desc, caja_id: cajaId },
      actor, actorName,
    );
    cajaMovId = mov.id;
  }

  // 2) Kg recibidos a stock real de CASITERITA (si se marcó).
  let recepcionMovId: string | null = null;
  if (input.sumarCasiterita && kgR > 0) {
    try { recepcionMovId = await sumarCasiterita(kgR, `Aliado ${input.aliadoNombre} · ${input.descripcion?.trim() || 'Kg recibidos'}`, actor, actorName); }
    catch (e) { if (cajaMovId) await eliminarMovimientoCaja(cajaMovId).catch(() => {}); throw e; }
  }

  // 3) La fila del ledger.
  const tipo: AliadoMovimiento['tipo'] = (usd > 0 || kgC > 0) ? 'cierre' : 'abono';
  const orden = await nextOrdenAliado(input.aliadoId);
  const periodo = await openPeriodoAliado(input.aliadoId);
  const { data, error } = await supabase.from('acopio_aliado_movimientos').insert({
    aliado_id: input.aliadoId, fecha: input.fecha, corte: input.corte ?? null, tipo,
    descripcion: input.descripcion?.trim() || `CENTRO DE ACOPIO ${input.aliadoNombre}`,
    usd_entregado: usd, kg_cerrados: kgC, precio_usd_kg: precio, kg_recibidos: kgR, gastos,
    caja_mov_id: cajaMovId, reflejo_casiterita: !!recepcionMovId, recepcion_mov_id: recepcionMovId,
    orden, periodo, created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) {
    if (cajaMovId) await eliminarMovimientoCaja(cajaMovId).catch(() => {});
    throw error;
  }
  // $ entregado al aliado → cuenta por cobrar incremental del aliado (best-effort).
  if (usd > 0) await anclarUsdAliadoACuentaPorCobrar(input.aliadoNombre, usd, input.descripcion ?? null, actor, actorName);
  return data as AliadoMovimiento;
}

export interface AbonoAliadoInput {
  aliadoId: string;
  fecha: string;
  corte?: number | null;
  descripcion?: string | null;
  kgRecibidos: number;        // K
  /** Suma esos Kg al stock real de CASITERITA. */
  sumarCasiterita?: boolean;
}

/** Registra un ABONO (entrega de Kg) en el ledger del aliado. Opcional: stock a casiterita. */
export async function crearAbonoAliado(input: AbonoAliadoInput, actor: string, actorName?: string | null): Promise<AliadoMovimiento> {
  if (!input.fecha) throw new Error('Indicá la fecha del abono.');
  const kg = r2(input.kgRecibidos);
  if (kg <= 0) throw new Error('Indicá los Kg entregados en el abono.');

  let recepcionMovId: string | null = null;
  if (input.sumarCasiterita) {
    recepcionMovId = await sumarCasiterita(kg, `Abono aliado · ${input.descripcion?.trim() || 'ABONO DE CIERRES'}`, actor, actorName);
  }

  const orden = await nextOrdenAliado(input.aliadoId);
  const periodo = await openPeriodoAliado(input.aliadoId);
  const { data, error } = await supabase.from('acopio_aliado_movimientos').insert({
    aliado_id: input.aliadoId, fecha: input.fecha, corte: input.corte ?? null, tipo: 'abono',
    descripcion: input.descripcion?.trim() || 'ABONO DE CIERRES',
    usd_entregado: 0, kg_cerrados: 0, precio_usd_kg: 0, kg_recibidos: kg,
    reflejo_casiterita: !!input.sumarCasiterita, recepcion_mov_id: recepcionMovId,
    orden, periodo, created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as AliadoMovimiento;
}

/** Elimina un movimiento del ledger del aliado y revierte su reflejo (traslado/casiterita). */
export async function eliminarAliadoMovimiento(m: AliadoMovimiento): Promise<void> {
  if (m.caja_mov_id) await eliminarMovimientoCaja(m.caja_mov_id).catch(() => {});
  if (m.recepcion_mov_id && num(m.kg_recibidos) > 0) {
    // Revierte la entrada de casiterita con una salida por la misma cantidad.
    await registrarMovimiento({
      producto_id: await casiteritaProductoId(),
      tipo: 'salida', delta: -num(m.kg_recibidos), almacen: ALMACEN_CASITERITA,
      actor: m.created_by || 'sistema', actor_name: m.actor_name ?? null,
      ref_tipo: 'acopio_subledger_rev', ref_codigo: 'Reversa abono aliado',
      detalle: 'Reversa de abono (eliminado)',
    }).catch(() => {});
  }
  const { error } = await supabase.from('acopio_aliado_movimientos').delete().eq('id', m.id);
  if (error) throw error;
}

async function casiteritaProductoId(): Promise<string> {
  const { data } = await supabase.from('productos').select('id').eq('sku', 'CASITERITA').maybeSingle();
  if (!data) throw new Error('No existe el producto «Casiterita» (SKU CASITERITA).');
  return (data as { id: string }).id;
}

/* ───────────── Cierre de caja del aliado (cierre + apertura automática) ─────────────
   Réplica del cierre de los centros, por aliado:
     · el SALDO EN KG/GRAMOS pasa al INVENTARIO (casiterita, u ORO en los aliados de
       oro) a la TASA del aliado (precio promedio $/Kg);
     · se guarda el cierre en el historial (acopio_aliado_cierres);
     · el periodo se incrementa y el SALDO EN $ arranca el periodo nuevo como un
       movimiento de apertura en «$ entregado» (sin reflejar traslado en la caja
       general; solo continúa el saldo del aliado). El resto se reinicia. */

/** Producto + almacén de inventario donde entra el saldo del aliado al cerrar:
 *  ORO (AU) en los centros de oro, CASITERITA en el resto. Crea lo que falte. */
async function destinoInventarioAliado(centro: string): Promise<{ productoId: string; almacen: string; material: string }> {
  const { findBySku, createProducto, listProductos } = await import('@/modules/inventario/inventario.repository');
  const { listAlmacenes, crearAlmacen } = await import('@/modules/inventario/almacenes.repository');
  const ensureAlmacen = async (nombre: string) => {
    const todos = await listAlmacenes().catch(() => []);
    if (!todos.some((a) => a.nombre === nombre)) await crearAlmacen({ nombre, sede: centro }).catch(() => { /* ya existe */ });
    return nombre;
  };
  if (esCentroOro(centro)) {
    let oro = await findBySku('AU').catch(() => null);
    if (!oro) {
      const todos = await listProductos().catch(() => []);
      oro = todos.find((p) => (p.nombre || '').trim().toUpperCase() === 'ORO') ?? null;
    }
    if (!oro) {
      oro = await createProducto({
        sku: 'AU', nombre: 'ORO', categoria: 'Mineral', unidad: 'g',
        stock: 0, stock_min: 0, precio: 0, almacen: `ORO · ${centro}`, estado: 'activo',
      });
    }
    return { productoId: oro.id, almacen: await ensureAlmacen(`ORO · ${centro}`), material: 'oro (AU)' };
  }
  let cas = await findBySku('SNO2').catch(() => null);
  if (!cas) {
    const todos = await listProductos().catch(() => []);
    cas = todos.find((p) => (p.nombre || '').trim().toUpperCase() === 'CASITERITA') ?? null;
  }
  if (!cas) throw new Error('No se encontró el producto CASITERITA en inventario. Creálo antes de cerrar.');
  return { productoId: cas.id, almacen: await ensureAlmacen(almacenCasiteritaDeCentro(centro)), material: 'casiterita' };
}

export interface CierreAliadoResultado {
  saldoUsd: number;
  saldoKg: number;
  tasa: number;
  almacen: string;
  material: string;
  unidad: string;
  periodoCerrado: number;
  periodoNuevo: number;
  kgAInventario: boolean;
}

export async function cerrarYAbrirCajaAliado(input: {
  aliadoId: string; centro: string; actor: string; actorName?: string | null;
  gastos?: number | null;   // gastos del aliado que se arrastran a la Recepción (opcional)
}): Promise<CierreAliadoResultado> {
  const centro = (input.centro || CENTRO_ACOPIO_DEFECTO).trim();
  const oro = esCentroOro(centro);
  const unidad = oro ? 'g' : 'Kg';
  const periodo = await openPeriodoAliado(input.aliadoId);
  const movs = await listAliadoMovimientos(input.aliadoId, periodo);
  if (!movs.length) throw new Error('No hay movimientos en el periodo actual para cerrar.');
  const r = resumirAliado(movs);
  const saldoUsd = r2(r.saldoUsd);
  const saldoKg = r2(r.saldoKg);
  const tasa = r2(r.precioProm);
  const hoy = new Date().toISOString().slice(0, 10);
  const fechaInicio = movs[0]?.fecha ?? hoy;

  // 1) Saldo en Kg/gramos al cerrar:
  //    · CASITERITA (no-oro) → RECEPCIONES (paso intermedio). YA NO entra directo
  //      al inventario; se crea una recepción con el peso y la procedencia (aliado).
  //    · ORO (gramos) → sigue entrando al inventario como antes (no aplica a Recepciones).
  // Lo que ENTRA a la recepción es lo RECIBIDO por MGG (casiterita física), no el
  // saldo (el saldo queda en la caja del aliado, arrastrado al periodo nuevo).
  const recibidos = r2(r.totalKgRecibidos);
  let invMovId: string | null = null;
  let almacenDest = oro ? `ORO · ${centro}` : almacenCasiteritaDeCentro(centro);
  let material = oro ? 'oro (AU)' : 'casiterita';
  if (oro) {
    // Oro: el saldo en gramos entra directo al inventario (no pasa por Recepciones).
    if (saldoKg > 0) {
      const d = await destinoInventarioAliado(centro);
      almacenDest = d.almacen; material = d.material;
      const mov = await registrarMovimiento({
        producto_id: d.productoId, tipo: 'entrada', delta: saldoKg, almacen: d.almacen,
        precio_unitario: tasa > 0 ? tasa : null,
        actor: input.actor, actor_name: input.actorName ?? null,
        ref_tipo: 'acopio_aliado_cierre', ref_codigo: `Cierre #${periodo}`,
        detalle: `Cierre #${periodo} aliado · ${centro} · ${num(saldoKg)} ${unidad}${tasa > 0 ? ` a ${tasa}` : ''}`,
      });
      invMovId = mov.id;
    }
  } else if (recibidos > 0) {
    // Casiterita: los Kg RECIBIDOS por MGG pasan a RECEPCIONES a la tasa del cierre.
    // Procedencia = nombre del aliado, sin el prefijo "CENTRO ACOPIO -".
    const { data: ali } = await supabase.from('acopio_aliados').select('nombre').eq('id', input.aliadoId).maybeSingle();
    const nombreAliado = String((ali as { nombre?: string } | null)?.nombre ?? centro).replace(/^\s*centro\s+de\s+acopio\s*[-·]?\s*/i, '').replace(/^\s*centro\s+acopio\s*[-·]?\s*/i, '').trim() || centro;
    const { crearRecepcionDesdeCierre } = await import('@/modules/recepciones/recepciones.repository');
    await crearRecepcionDesdeCierre({
      pesoKg: recibidos, tasa: tasa > 0 ? tasa : null, procedencia: nombreAliado, centroNombre: centro,
      origen: 'cierre_aliado', refAliadoId: input.aliadoId, gastos: r2(num(input.gastos)),
      actor: input.actor, actorName: input.actorName ?? null,
    });
    invMovId = null; // no hubo movimiento de inventario: pasó a Recepciones
  }

  // 2) Registrar el cierre (historial).
  const { error: cErr } = await supabase.from('acopio_aliado_cierres').insert({
    aliado_id: input.aliadoId, periodo, fecha_inicio: fechaInicio, fecha_fin: hoy,
    saldo_usd: saldoUsd, saldo_kg: saldoKg, tasa, almacen: almacenDest, inv_mov_id: invMovId,
    created_by: input.actor, actor_name: input.actorName ?? null,
  });
  if (cErr) throw cErr;

  // 3) Apertura del periodo nuevo: el saldo se ARRASTRA para que el aliado no
  //    arranque en 0. Se trae el saldo en Kg (como «kg cerrados») a la tasa del
  //    aliado (precio $usd por kg), y el saldo $ neto se conserva:
  //    usd_entregado = saldoUsd + saldoKg × tasa (compensa el facturado del arrastre).
  //    Así el periodo nuevo muestra Saldo en Kg, tasa y saldo $ igual que al cerrar.
  const periodoNuevo = periodo + 1;
  if (saldoUsd !== 0 || saldoKg !== 0) {
    const orden = await nextOrdenAliado(input.aliadoId);
    const entregadoInicial = r2(saldoUsd + saldoKg * tasa);
    const { error } = await supabase.from('acopio_aliado_movimientos').insert({
      aliado_id: input.aliadoId, fecha: hoy, corte: null, tipo: 'cierre',
      descripcion: `SALDO INICIAL · viene del cierre #${periodo}`,
      usd_entregado: entregadoInicial, kg_cerrados: saldoKg, precio_usd_kg: tasa, kg_recibidos: 0, gastos: 0,
      orden, periodo: periodoNuevo, created_by: input.actor, actor_name: input.actorName ?? null,
    });
    if (error) throw error;
  }

  return { saldoUsd, saldoKg, tasa, almacen: almacenDest, material, unidad, periodoCerrado: periodo, periodoNuevo, kgAInventario: invMovId != null };
}

/** Historial de cierres del aliado (más reciente primero). */
export async function listAliadoCierres(aliadoId: string): Promise<AliadoCierre[]> {
  const { data, error } = await supabase
    .from('acopio_aliado_cierres').select('*').eq('aliado_id', aliadoId)
    .order('periodo', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AliadoCierre[];
}

/* ───────────── Histórico de vaciados del aliado (snapshot + reset a 0) ───────────── */

/** Un archivo histórico de un aliado que se vació: totales + snapshot de sus movimientos. */
export interface AliadoHistorico {
  id: string;
  aliado_id: string;
  aliado_nombre: string;
  centro_nombre: string | null;
  fecha_archivado: string;
  motivo: string | null;
  total_entregado: number;
  total_facturado: number;
  total_gastos: number;
  total_kg_cerrados: number;
  total_kg_recibidos: number;
  saldo_usd: number;
  saldo_kg: number;
  n_movimientos: number;
  movimientos: AliadoMovimiento[];
  archivado_por: string | null;
  actor_name: string | null;
  created_at: string;
}

/** Lista los archivos históricos del aliado (más reciente primero). */
export async function listAliadoHistorico(aliadoId: string): Promise<AliadoHistorico[]> {
  const { data, error } = await supabase
    .from('acopio_aliado_historico').select('*').eq('aliado_id', aliadoId)
    .order('fecha_archivado', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AliadoHistorico[];
}

/**
 * VACÍA el libro de un aliado dejándolo en 0, guardando ANTES un snapshot completo de
 * sus movimientos + totales en el histórico (acopio_aliado_historico). Además SALDA su
 * cuenta por cobrar en Tesorería (Σ usd_entregado restante = 0). Todo atómico vía RPC.
 * Devuelve el id del histórico creado. NO revierte los reflejos ya hechos en la caja
 * general ni en el inventario (esos movimientos realmente ocurrieron).
 */
export async function archivarYVaciarAliado(aliadoId: string, actor: string, actorName?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('archivar_y_vaciar_aliado', {
    p_aliado_id: aliadoId, p_actor: actor, p_actor_name: actorName ?? null,
  });
  if (error) throw new Error(error.message ?? 'No se pudo vaciar el aliado.');
  return String(data);
}

/* ───────────── Cuentas por cobrar ───────────── */

export async function listCuentasCobrar(centroNombre = CENTRO_ACOPIO_DEFECTO): Promise<CuentaCobrarAcopio[]> {
  const { data, error } = await supabase
    .from('acopio_cuentas_cobrar').select('*')
    .eq('centro_nombre', centroNombre)
    .order('estado', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CuentaCobrarAcopio[];
}

export async function crearCuentaCobrar(input: {
  cliente: string; descripcion?: string | null; montoFactura: number; precioUsdKg?: number; centroNombre?: string;
}, actor: string, actorName?: string | null): Promise<CuentaCobrarAcopio> {
  const cliente = input.cliente.trim();
  if (!cliente) throw new Error('Indicá el cliente.');
  const monto = r2(input.montoFactura);
  if (monto <= 0) throw new Error('La factura debe ser mayor que 0.');
  const { data, error } = await supabase.from('acopio_cuentas_cobrar').insert({
    centro_nombre: input.centroNombre || CENTRO_ACOPIO_DEFECTO,
    cliente, descripcion: input.descripcion?.trim() || null,
    monto_factura: monto, precio_usd_kg: r2(input.precioUsdKg ?? 0),
    created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;
  return data as CuentaCobrarAcopio;
}

/** Una fila de abono con deuda y saldo Kg corridos (incluye la factura inicial como fila 0). */
export interface CobrarFila {
  id: string;
  fecha: string;
  descripcion: string;
  montoFactura: number;   // D
  kgEntregados: number;   // E
  precioUsdKg: number;    // F
  totalUsd: number;       // G = E·F (o D para la factura)
  deuda: number;          // H corrido
  saldoKg: number;        // J corrido
  esFactura?: boolean;
  reflejoCasiterita?: boolean;
}

export interface CobrarLedger {
  cuenta: CuentaCobrarAcopio;
  filas: CobrarFila[];
  deuda: number;          // saldo actual
  totalAbonado: number;
  totalKg: number;
}

/** Construye el libro de la cuenta por cobrar: factura inicial + abonos, con deuda corrida. */
export async function getCobrarLedger(cuenta: CuentaCobrarAcopio): Promise<CobrarLedger> {
  const { data, error } = await supabase
    .from('acopio_cobrar_abonos').select('*')
    .eq('cuenta_id', cuenta.id)
    .order('fecha', { ascending: true }).order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  const abonos = (data ?? []) as CobrarAbono[];

  const filas: CobrarFila[] = [];
  let deuda = 0, saldoKg = 0;
  // Fila 0: la factura (deuda inicial).
  deuda = r2(deuda + num(cuenta.monto_factura));
  filas.push({
    id: `f-${cuenta.id}`, fecha: cuenta.created_at?.slice(0, 10) ?? '', descripcion: cuenta.descripcion || 'Factura',
    montoFactura: r2(num(cuenta.monto_factura)), kgEntregados: 0, precioUsdKg: r2(num(cuenta.precio_usd_kg)),
    totalUsd: r2(num(cuenta.monto_factura)), deuda, saldoKg, esFactura: true,
  });
  for (const a of abonos) {
    const totalUsd = r2(num(a.kg_entregados) * num(a.precio_usd_kg));
    deuda = r2(deuda + num(a.monto_factura) - totalUsd);
    saldoKg = r2(saldoKg + num(a.kg_entregados));
    filas.push({
      id: a.id, fecha: a.fecha, descripcion: a.descripcion || 'ABONO',
      montoFactura: r2(num(a.monto_factura)), kgEntregados: r2(num(a.kg_entregados)), precioUsdKg: r2(num(a.precio_usd_kg)),
      totalUsd, deuda, saldoKg, reflejoCasiterita: a.reflejo_casiterita,
    });
  }
  const totalAbonado = abonos.reduce((s, a) => s + num(a.kg_entregados) * num(a.precio_usd_kg), 0);
  const totalKg = abonos.reduce((s, a) => s + num(a.kg_entregados), 0);
  return { cuenta, filas, deuda, totalAbonado: r2(totalAbonado), totalKg: r2(totalKg) };
}

export interface AbonoCobrarInput {
  cuentaId: string;
  fecha: string;
  descripcion?: string | null;
  kgEntregados: number;      // E
  precioUsdKg: number;       // F
  montoFacturaExtra?: number; // D (cargo adicional opcional)
  sumarCasiterita?: boolean;
}

/** Registra un abono (en Kg) a una cuenta por cobrar. Opcional: stock a casiterita.
 *  Si la deuda queda en 0 o menos, marca la cuenta como saldada. */
export async function crearAbonoCobrar(input: AbonoCobrarInput, actor: string, actorName?: string | null): Promise<CobrarAbono> {
  if (!input.fecha) throw new Error('Indicá la fecha del abono.');
  const kg = r2(input.kgEntregados);
  const precio = r2(input.precioUsdKg);
  if (kg <= 0) throw new Error('Indicá los Kg entregados.');

  let recepcionMovId: string | null = null;
  if (input.sumarCasiterita) {
    recepcionMovId = await sumarCasiterita(kg, `Abono cuenta por cobrar · ${input.descripcion?.trim() || 'ABONO'}`, actor, actorName);
  }

  const { data: maxRow } = await supabase
    .from('acopio_cobrar_abonos').select('orden').eq('cuenta_id', input.cuentaId)
    .order('orden', { ascending: false }).limit(1).maybeSingle();
  const orden = ((maxRow as { orden?: number } | null)?.orden ?? 0) + 1;

  const { data, error } = await supabase.from('acopio_cobrar_abonos').insert({
    cuenta_id: input.cuentaId, fecha: input.fecha, descripcion: input.descripcion?.trim() || 'ABONO',
    monto_factura: r2(input.montoFacturaExtra ?? 0), kg_entregados: kg, precio_usd_kg: precio,
    reflejo_casiterita: !!input.sumarCasiterita, recepcion_mov_id: recepcionMovId,
    orden, created_by: actor, actor_name: actorName ?? null,
  }).select('*').single();
  if (error) throw error;

  // ¿Saldada? Recalcula la deuda y actualiza el estado.
  const cuenta = (await supabase.from('acopio_cuentas_cobrar').select('*').eq('id', input.cuentaId).single()).data as CuentaCobrarAcopio;
  if (cuenta) {
    const led = await getCobrarLedger(cuenta);
    const nuevoEstado = led.deuda <= 0.009 ? 'saldada' : 'abierta';
    if (nuevoEstado !== cuenta.estado) {
      await supabase.from('acopio_cuentas_cobrar').update({ estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('id', cuenta.id);
    }
  }
  return data as CobrarAbono;
}

export async function eliminarAbonoCobrar(a: CobrarAbono): Promise<void> {
  if (a.recepcion_mov_id && num(a.kg_entregados) > 0) {
    await registrarMovimiento({
      producto_id: await casiteritaProductoId(),
      tipo: 'salida', delta: -num(a.kg_entregados), almacen: ALMACEN_CASITERITA,
      actor: a.created_by || 'sistema', actor_name: a.actor_name ?? null,
      ref_tipo: 'acopio_subledger_rev', ref_codigo: 'Reversa abono cobrar', detalle: 'Reversa de abono (eliminado)',
    }).catch(() => {});
  }
  const { error } = await supabase.from('acopio_cobrar_abonos').delete().eq('id', a.id);
  if (error) throw error;
}

export async function eliminarCuentaCobrar(id: string): Promise<void> {
  const { error } = await supabase.from('acopio_cuentas_cobrar').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Resumen «Cuentas por cobrar» (réplica de la hoja RESUMEN) ───────────── */

export interface ResumenCobrarItem {
  cuenta: CuentaCobrarAcopio;
  deuda: number;       // $ que aún se debe
  saldoKg: number;     // Kg ya recibidos por esa cuenta
}
export interface ResumenCobrar {
  items: ResumenCobrarItem[];
  totalDeuda: number;
  totalKg: number;
  abiertas: number;
}

/** Suma los saldos por cobrar de todas las cuentas del centro (deuda $ y Kg recibidos). */
export async function resumenPorCobrar(centroNombre = CENTRO_ACOPIO_DEFECTO): Promise<ResumenCobrar> {
  const cuentas = await listCuentasCobrar(centroNombre);
  const items: ResumenCobrarItem[] = [];
  for (const c of cuentas) {
    const led = await getCobrarLedger(c);
    items.push({ cuenta: c, deuda: led.deuda, saldoKg: led.totalKg });
  }
  return {
    items,
    totalDeuda: r2(items.reduce((a, i) => a + i.deuda, 0)),
    totalKg: r2(items.reduce((a, i) => a + i.saldoKg, 0)),
    abiertas: cuentas.filter((c) => c.estado === 'abierta').length,
  };
}
