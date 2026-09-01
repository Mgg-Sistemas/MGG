/* ============================================================
   MGG · Cocina · Mercado (ciclo de 21 días)
   Un "mercado" es un período de 21 días por cocina. Durante el período:
     disponible por víver = saldo_inicial + entradas − consumos.
   - Entradas: movimientos de inventario (delta > 0) de víveres de cocina en
     los almacenes de la sede, EXCLUYENDO los reversos de cocina (ref_tipo='cocina').
   - Consumos: los ítems de las comidas (cocina_comidas) del período.
   Al CERRAR (día 22): se guarda un snapshot (consumos + entradas + remanente),
   el mercado queda 'cerrado' y se abre el siguiente con saldo_inicial = remanente.
   El cierre NO mueve inventario real: es contable del mercado.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { CocinaComida, Producto } from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listAlmacenes } from '@/modules/inventario/almacenes.repository';
import { listComidas, listViveresGlobal, esCategoriaCocina } from './cocina.repository';

const TABLE = 'mercados_cocina';
/** Duración del ciclo de mercado, en días (ventana inclusiva). */
export const DURACION_MERCADO_DIAS = 21;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/* ───────── Tipos ───────── */

export interface SaldoItem {
  producto_id: string; sku: string; nombre: string; unidad: string; cantidad: number;
}
export interface ItemAgg extends SaldoItem { valor: number; }

export interface DisponibleItem {
  producto_id: string; sku: string; nombre: string; unidad: string; precio: number;
  saldoInicial: number;   // lo que quedó del mercado anterior
  entradas: number;       // víveres que entraron en el período
  consumos: number;       // consumido por las comidas
  disponible: number;     // saldoInicial + entradas
  queda: number;          // disponible − consumos
}

export interface KardexEntrada {
  kind: 'entrada'; at: string; producto_id: string; nombre: string; unidad: string;
  cantidad: number; valor: number; detalle: string | null; almacen: string | null;
}
export interface KardexConsumo {
  kind: 'consumo'; at: string; comida: CocinaComida; items: number; cantidad: number;
}
export type KardexRow = KardexEntrada | KardexConsumo;

export interface CierreSnapshot {
  generado_en: string; desde: string; hasta: string;
  totales: { platos: number; valor: number; entradasValor: number; };
  consumos: ItemAgg[]; entradas: ItemAgg[]; remanente: SaldoItem[];
}

export interface MercadoCocina {
  id: string; cocina_id: string; numero: number;
  fecha_inicio: string; fecha_fin: string; estado: 'abierto' | 'cerrado';
  saldo_inicial: SaldoItem[]; cierre: CierreSnapshot | null;
  cerrado_por: string | null; cerrado_por_nombre: string | null; cerrado_en: string | null;
  created_at: string;
}

/** Resumen en vivo del mercado abierto: KPIs + disponible por víver + kardex. */
export interface ResumenMercado {
  mercado: MercadoCocina;
  dia: number;                 // día actual del ciclo (1..)
  dias: number;                // total del ciclo (21)
  puedeCerrar: boolean;        // ya pasó el día 21 (día 22+)
  kpis: { platos: number; consumoValor: number; entradasValor: number; disponibleValor: number; };
  disponible: DisponibleItem[];
  kardex: KardexRow[];
}

/* ───────── Fechas ───────── */

function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function hoyStr(): string { return new Date().toISOString().slice(0, 10); }

/** Ventana ISO [inicio 00:00 local, min(ahora, fin 23:59 local)] de un mercado. */
function ventana(m: { fecha_inicio: string; fecha_fin: string }): { desde: string; hasta: string } {
  const desde = new Date(`${m.fecha_inicio}T00:00:00`);
  const finDia = new Date(`${m.fecha_fin}T23:59:59`);
  const ahora = new Date();
  const hasta = ahora < finDia ? ahora : finDia;
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/** Día actual del ciclo (1 = fecha_inicio). */
function diaDe(m: { fecha_inicio: string }): number {
  const ini = new Date(`${m.fecha_inicio}T00:00:00`);
  const hoy = new Date(`${hoyStr()}T00:00:00`);
  return Math.max(1, Math.floor((hoy.getTime() - ini.getTime()) / 86400000) + 1);
}

/* ───────── Alcance por sede (mismos almacenes que la lista de víveres) ───────── */

async function almacenesScope(almacenNombre: string | null): Promise<Set<string> | null> {
  if (!almacenNombre) return null;
  const almacenes = await listAlmacenes();
  const sede = almacenes.find((a) => a.nombre === almacenNombre)?.sede ?? null;
  if (!sede) return new Set([almacenNombre]);
  return new Set(almacenes.filter((a) => (a.sede ?? null) === sede).map((a) => a.nombre));
}

/* ───────── Lectura ───────── */

function normalizar(row: Record<string, unknown>): MercadoCocina {
  return {
    id: String(row.id),
    cocina_id: String(row.cocina_id),
    numero: Number(row.numero) || 1,
    fecha_inicio: String(row.fecha_inicio),
    fecha_fin: String(row.fecha_fin),
    estado: (row.estado === 'cerrado' ? 'cerrado' : 'abierto'),
    saldo_inicial: Array.isArray(row.saldo_inicial) ? (row.saldo_inicial as SaldoItem[]) : [],
    cierre: (row.cierre as CierreSnapshot) ?? null,
    cerrado_por: (row.cerrado_por as string) ?? null,
    cerrado_por_nombre: (row.cerrado_por_nombre as string) ?? null,
    cerrado_en: (row.cerrado_en as string) ?? null,
    created_at: String(row.created_at ?? ''),
  };
}

/** Mercado abierto de una cocina (o null si no hay ninguno activo). */
export async function mercadoActivo(cocinaId: string): Promise<MercadoCocina | null> {
  const { data, error } = await supabase.from(TABLE)
    .select('*').eq('cocina_id', cocinaId).eq('estado', 'abierto')
    .order('numero', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? normalizar(data as Record<string, unknown>) : null;
}

/** Todos los mercados de una cocina (histórico, más reciente primero). */
export async function listMercados(cocinaId: string): Promise<MercadoCocina[]> {
  const { data, error } = await supabase.from(TABLE)
    .select('*').eq('cocina_id', cocinaId).order('numero', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => normalizar(r as Record<string, unknown>));
}

/* ───────── Entradas del período (kardex + agregado) ───────── */

interface EntradasResult { rows: KardexEntrada[]; agg: Map<string, ItemAgg>; valorTotal: number; }

async function entradasDe(
  m: { fecha_inicio: string; fecha_fin: string },
  almacen: string | null,
  prodById: Map<string, Producto>,
): Promise<EntradasResult> {
  const { desde, hasta } = ventana(m);
  const scope = await almacenesScope(almacen);
  let q = supabase.from('movimientos').select('*').gt('delta', 0).gte('at', desde).lte('at', hasta);
  if (scope) q = q.in('almacen', Array.from(scope));
  const { data, error } = await q.order('at', { ascending: false });
  if (error) throw error;

  const rows: KardexEntrada[] = [];
  const agg = new Map<string, ItemAgg>();
  let valorTotal = 0;
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    if (raw.ref_tipo === 'cocina') continue; // reverso de cocina, no es entrada de mercado
    const p = prodById.get(String(raw.producto_id));
    if (!p || !esCategoriaCocina(p.categoria)) continue;
    const cantidad = r2(Number(raw.delta) || 0);
    if (cantidad <= 0) continue;
    const precio = Number(raw.precio_unitario) || Number(p.precio) || 0;
    const valor = r2(cantidad * precio);
    valorTotal = r2(valorTotal + valor);
    rows.push({
      kind: 'entrada', at: String(raw.at), producto_id: p.id, nombre: p.nombre, unidad: p.unidad ?? '',
      cantidad, valor, detalle: (raw.detalle as string) ?? null, almacen: (raw.almacen as string) ?? null,
    });
    const a = agg.get(p.id) ?? { producto_id: p.id, sku: p.sku, nombre: p.nombre, unidad: p.unidad ?? '', cantidad: 0, valor: 0 };
    a.cantidad = r2(a.cantidad + cantidad); a.valor = r2(a.valor + valor);
    agg.set(p.id, a);
  }
  return { rows, agg, valorTotal };
}

/* ───────── Consumos del período (kardex + agregado) ───────── */

interface ConsumosResult { comidas: CocinaComida[]; agg: Map<string, ItemAgg>; platos: number; valor: number; }

async function consumosDe(
  m: { fecha_inicio: string; fecha_fin: string },
  cocinaId: string,
): Promise<ConsumosResult> {
  const { desde, hasta } = ventana(m);
  const comidas = await listComidas({ cocinaId, desde, hasta });
  const agg = new Map<string, ItemAgg>();
  let platos = 0, valor = 0;
  for (const c of comidas) {
    platos += Number(c.platos) || 0;
    valor = r2(valor + (Number(c.valor_total) || 0));
    for (const it of c.items ?? []) {
      const a = agg.get(it.producto_id) ?? { producto_id: it.producto_id, sku: it.sku, nombre: it.nombre, unidad: it.unidad, cantidad: 0, valor: 0 };
      a.cantidad = r2(a.cantidad + (Number(it.cantidad) || 0));
      a.valor = r2(a.valor + (Number(it.subtotal) || (Number(it.cantidad) || 0) * (Number(it.precio) || 0)));
      agg.set(it.producto_id, a);
    }
  }
  return { comidas, agg, platos, valor };
}

/* ───────── Disponible por víver (saldo + entradas − consumos) ───────── */

function armarDisponible(
  saldo: SaldoItem[], entradas: Map<string, ItemAgg>, consumos: Map<string, ItemAgg>,
  prodById: Map<string, Producto>,
): DisponibleItem[] {
  const saldoMap = new Map(saldo.map((s) => [s.producto_id, s] as const));
  const ids = new Set<string>([...saldoMap.keys(), ...entradas.keys(), ...consumos.keys()]);
  const out: DisponibleItem[] = [];
  for (const id of ids) {
    const s = saldoMap.get(id); const e = entradas.get(id); const c = consumos.get(id);
    const p = prodById.get(id);
    const nombre = s?.nombre ?? e?.nombre ?? c?.nombre ?? p?.nombre ?? id;
    const sku = s?.sku ?? e?.sku ?? c?.sku ?? p?.sku ?? '';
    const unidad = s?.unidad ?? e?.unidad ?? c?.unidad ?? p?.unidad ?? '';
    const saldoInicial = r2(s?.cantidad ?? 0);
    const entradasN = r2(e?.cantidad ?? 0);
    const consumosN = r2(c?.cantidad ?? 0);
    const disponible = r2(saldoInicial + entradasN);
    const queda = r2(disponible - consumosN);
    out.push({ producto_id: id, sku, nombre, unidad, precio: Number(p?.precio) || 0, saldoInicial, entradas: entradasN, consumos: consumosN, disponible, queda });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/* ───────── Resumen en vivo del mercado abierto ───────── */

export async function resumenMercado(mercado: MercadoCocina, almacen: string | null): Promise<ResumenMercado> {
  const productos = await listProductos();
  const prodById = new Map(productos.map((p) => [p.id, p] as const));
  const [ent, con] = await Promise.all([
    entradasDe(mercado, almacen, prodById),
    consumosDe(mercado, mercado.cocina_id),
  ]);
  const disponible = armarDisponible(mercado.saldo_inicial, ent.agg, con.agg, prodById);
  const disponibleValor = r2(disponible.reduce((a, d) => a + d.queda * d.precio, 0));

  const kardex: KardexRow[] = [
    ...ent.rows,
    ...con.comidas.map((c): KardexConsumo => ({
      kind: 'consumo', at: c.at, comida: c,
      items: (c.items ?? []).length,
      cantidad: r2((c.items ?? []).reduce((a, it) => a + (Number(it.cantidad) || 0), 0)),
    })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  return {
    mercado, dia: diaDe(mercado), dias: DURACION_MERCADO_DIAS,
    puedeCerrar: hoyStr() > mercado.fecha_fin,
    kpis: { platos: con.platos, consumoValor: con.valor, entradasValor: ent.valorTotal, disponibleValor },
    disponible, kardex,
  };
}

/* ───────── Iniciar / cerrar ───────── */

/**
 * Reconstruye el saldo inicial (stock A LA FECHA DE INICIO) usando EXACTAMENTE las mismas
 * entradas y consumos que cuenta el panel:  saldo = stock ACTUAL − entradas + consumos.
 * Así, si el mercado se inicia con fecha PASADA (ej. 22/08), lo que ya entró/consumió entre
 * esa fecha y hoy no se cuenta dos veces, y la identidad se mantiene: queda = saldo + entradas
 * − consumos = stock real. Con fecha = hoy y sin movimientos en la ventana, saldo = stock actual.
 */
function reconstruirSaldo(
  viveres: Awaited<ReturnType<typeof listViveresGlobal>>,
  entAgg: Map<string, ItemAgg>, conAgg: Map<string, ItemAgg>,
): SaldoItem[] {
  const out: SaldoItem[] = [];
  for (const v of viveres) {
    const e = entAgg.get(v.producto.id)?.cantidad ?? 0;
    const c = conAgg.get(v.producto.id)?.cantidad ?? 0;
    const inicial = r2(v.stock - e + c);
    if (inicial <= 0) continue;
    out.push({ producto_id: v.producto.id, sku: v.producto.sku, nombre: v.producto.nombre, unidad: v.producto.unidad ?? '', cantidad: inicial });
  }
  return out;
}

/**
 * Inicia el mercado #N de una cocina. El saldo inicial es el stock actual de víveres
 * (lo que ya hay disponible cuenta como arranque del mercado).
 */
export async function iniciarMercado(input: {
  cocinaId: string; almacen: string | null; fechaInicio?: string | null; actor: string; actorName?: string | null;
}): Promise<MercadoCocina> {
  const activo = await mercadoActivo(input.cocinaId);
  if (activo) throw new Error('Esta cocina ya tiene un mercado abierto.');
  const inicio = input.fechaInicio && /^\d{4}-\d{2}-\d{2}$/.test(input.fechaInicio) ? input.fechaInicio : hoyStr();
  const fin = addDaysStr(inicio, DURACION_MERCADO_DIAS - 1);
  const previos = await listMercados(input.cocinaId);
  const numero = (previos[0]?.numero ?? 0) + 1;
  // Saldo inicial reconstruido a la fecha de inicio, consistente con el panel (queda = stock real).
  const productos = await listProductos();
  const prodById = new Map(productos.map((p) => [p.id, p] as const));
  const ventanaObj = { fecha_inicio: inicio, fecha_fin: fin };
  const [viveres, ent, con] = await Promise.all([
    listViveresGlobal(input.almacen),
    entradasDe(ventanaObj, input.almacen, prodById),
    consumosDe(ventanaObj, input.cocinaId),
  ]);
  const saldo = reconstruirSaldo(viveres, ent.agg, con.agg);
  const { data, error } = await supabase.from(TABLE).insert({
    cocina_id: input.cocinaId, numero, fecha_inicio: inicio, fecha_fin: fin,
    estado: 'abierto', saldo_inicial: saldo,
  }).select('*').single();
  if (error) throw error;
  return normalizar(data as Record<string, unknown>);
}

export interface CerrarResult { cerrado: MercadoCocina; siguiente: MercadoCocina; snapshot: CierreSnapshot; }

/**
 * Cierra el mercado: arma el snapshot (consumos + entradas + remanente), lo marca
 * 'cerrado' y abre el siguiente con saldo_inicial = remanente. No mueve inventario.
 */
export async function cerrarMercado(mercado: MercadoCocina, almacen: string | null, actor: string, actorName?: string | null): Promise<CerrarResult> {
  const productos = await listProductos();
  const prodById = new Map(productos.map((p) => [p.id, p] as const));
  const { desde, hasta } = ventana(mercado);
  const [ent, con] = await Promise.all([
    entradasDe(mercado, almacen, prodById),
    consumosDe(mercado, mercado.cocina_id),
  ]);
  const disponible = armarDisponible(mercado.saldo_inicial, ent.agg, con.agg, prodById);
  const remanente: SaldoItem[] = disponible
    .filter((d) => d.queda > 0)
    .map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.queda }));

  const snapshot: CierreSnapshot = {
    generado_en: new Date().toISOString(), desde, hasta,
    totales: { platos: con.platos, valor: con.valor, entradasValor: ent.valorTotal },
    consumos: Array.from(con.agg.values()).sort((a, b) => b.valor - a.valor),
    entradas: Array.from(ent.agg.values()).sort((a, b) => b.valor - a.valor),
    remanente,
  };

  const { data: upd, error: e1 } = await supabase.from(TABLE).update({
    estado: 'cerrado', cierre: snapshot, cerrado_por: actor, cerrado_por_nombre: actorName ?? null,
    cerrado_en: new Date().toISOString(),
  }).eq('id', mercado.id).eq('estado', 'abierto').select('*').single();
  if (e1) throw e1;

  const inicioSig = addDaysStr(mercado.fecha_fin, 1);
  const finSig = addDaysStr(inicioSig, DURACION_MERCADO_DIAS - 1);
  const { data: sig, error: e2 } = await supabase.from(TABLE).insert({
    cocina_id: mercado.cocina_id, numero: mercado.numero + 1, fecha_inicio: inicioSig, fecha_fin: finSig,
    estado: 'abierto', saldo_inicial: remanente,
  }).select('*').single();
  if (e2) throw e2;

  return { cerrado: normalizar(upd as Record<string, unknown>), siguiente: normalizar(sig as Record<string, unknown>), snapshot };
}
