/* ============================================================
   MGG · Inventario · Casiterita — Inventario Detallado (SnO₂)
   Ledger del almacén de casiterita (Los Pinos): desglose por precinto /
   # de análisis + valorización por tasa.

   SÍ mueve stock, por diferencia: cada fila lleva escrito cuántos kg suyos
   ya están contados (`stock_kg`), así una fila nueva entra, una editada
   ajusta solo el cambio y una borrada devuelve lo que aportó. Las filas
   anteriores a esta regla nacieron ya contadas (entraron por la recepción
   de julio), así que no se suman de nuevo. Ver `casiteritaStock.ts`.

   Peso Casiterita Kgs = Peso Neto Kgs (de la recepción) − factor(categoría)×cant
     · big bag 1,5 · saco 0,06 · tobo 1 · bolsa de hielo 0,03
   Peso Puro SN       = Prom (%) × Peso Casiterita Kgs ÷ 100
   Valor              = Peso Casiterita Kgs × Tasa (por centro/aliado)
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { registrarMovimiento } from './movimientos.repository';
import { findBySku } from './inventario.repository';
import { ajustePorFila, ajusteAlBorrar, detalleMovimiento } from './casiteritaStock';
import {
  listPesajes, listAnalisis, listMinerales, listRecepciones,
  catLado, PESO_FACTOR,
  type PesoModo, type RecepcionMineral, type RecepcionPesaje, type RecepcionAnalisis, type Recepcion, type ValorMineral,
} from '@/modules/recepciones/recepciones.repository';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const CASITERITA_ALMACEN = 'SNO₂ CASITERITA ALMACEN';
export type CasiteritaCategoria = PesoModo; // bigbag · saco · tobo · hielo

/** Peso Casiterita Kgs = Peso Neto − factor de la categoría × cantidad. */
export function calcPesoCasiterita(pesoNeto: number, categoria: CasiteritaCategoria, cant = 1): number {
  const c = num(cant) > 0 ? num(cant) : 1;
  return round2(num(pesoNeto) - (PESO_FACTOR[categoria] ?? PESO_FACTOR.bigbag) * c);
}
/** Peso Puro SN = Prom (%) × Peso Casiterita ÷ 100. */
export function calcPesoPuroSn(prom: number | null | undefined, pesoCasiterita: number): number | null {
  return prom == null ? null : round2((num(prom) * num(pesoCasiterita)) / 100);
}

export interface CasiteritaDetalle {
  id: string;
  grupo_id: string | null;
  cierre_id: string | null;
  procedencia: string;
  precinto: string | null;
  n_analisis: string | null;
  categoria: CasiteritaCategoria;
  cant: number;
  peso_neto_kgs: number;
  peso_casiterita_kgs: number;
  prom_sn: number | null;
  peso_puro_sn: number | null;
  tasa: number | null;
  almacen: string;
  nota: string | null;
  actor: string | null;
  actor_name: string | null;
  /** Kg de esta fila que YA están contados en el stock. Lo maneja el repositorio. */
  stock_kg: number;
  created_at: string;
  updated_at: string | null;
}

export interface CasiteritaDetalleInput {
  grupo_id?: string | null;
  cierre_id?: string | null;
  procedencia: string;
  precinto?: string | null;
  n_analisis?: string | null;
  categoria: CasiteritaCategoria;
  cant?: number | null;
  peso_neto_kgs: number;
  prom_sn?: number | null;
  tasa?: number | null;
  almacen?: string | null;
  nota?: string | null;
}

function normalizar(input: CasiteritaDetalleInput) {
  const cant = num(input.cant) > 0 ? Math.floor(num(input.cant)) : 1;
  const categoria = input.categoria;
  const pesoNeto = round2(num(input.peso_neto_kgs));
  const casiterita = calcPesoCasiterita(pesoNeto, categoria, cant);
  const prom = input.prom_sn == null || !Number.isFinite(Number(input.prom_sn)) ? null : round2(Number(input.prom_sn));
  return {
    grupo_id: input.grupo_id ?? null,
    cierre_id: input.cierre_id ?? null,
    procedencia: (input.procedencia ?? '').trim().toUpperCase(),
    precinto: input.precinto?.toString().trim() || null,
    n_analisis: input.n_analisis?.toString().trim() || null,
    categoria,
    cant,
    peso_neto_kgs: pesoNeto,
    peso_casiterita_kgs: casiterita,
    prom_sn: prom,
    peso_puro_sn: calcPesoPuroSn(prom, casiterita),
    tasa: input.tasa == null || !Number.isFinite(Number(input.tasa)) ? null : round2(Number(input.tasa)),
    almacen: (input.almacen ?? '').toString().trim() || CASITERITA_ALMACEN,
    nota: input.nota?.toString().trim() || null,
  };
}

export async function listCasiteritaDetalle(): Promise<CasiteritaDetalle[]> {
  const { data, error } = await supabase
    .from('casiterita_detalle').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CasiteritaDetalle[];
}

/** El producto único donde vive la casiterita del inventario real. */
const SKU_CASITERITA = 'MIN-CASITERITA';

/**
 * Mueve el stock de casiterita y deja anotado en la fila cuánto lleva aportado.
 *
 * Best effort NO: si el movimiento falla hay que enterarse, porque el detalle y
 * el stock quedarían diciendo cosas distintas. Lo que sí se tolera es que no
 * exista la ficha del producto (base recién montada): ahí no hay stock que mover.
 */
async function sincronizarStock(
  fila: { id: string; procedencia: string; categoria: CasiteritaCategoria; almacen: string },
  ajuste: { delta: number; tipo: 'entrada' | 'salida' },
  esAjuste: boolean,
  actor: string,
  actorName: string | null,
): Promise<void> {
  const prod = await findBySku(SKU_CASITERITA);
  if (!prod) return;
  await registrarMovimiento({
    producto_id: prod.id,
    tipo: ajuste.tipo,
    delta: ajuste.delta,
    almacen: fila.almacen || CASITERITA_ALMACEN,
    actor,
    actor_name: actorName,
    ref_tipo: 'casiterita_detalle',
    ref_id: fila.id,
    detalle: detalleMovimiento(fila.procedencia, CAT_NOMBRE[fila.categoria], esAjuste),
    // El costo de este almacén es la tasa MEZCLADA de todas las recepciones, puesta
    // a mano. Una fila del detalle desglosa ese mismo material: no es una compra
    // nueva a otro precio, así que no puede correr el promedio.
    precio_unitario: null,
  });
}

/** Nombre legible de la categoría, para el texto del kardex. */
const CAT_NOMBRE: Record<CasiteritaCategoria, string> = {
  bigbag: 'BIG BAG', saco: 'SACO', tobo: 'TOBO', hielo: 'BOLSA DE HIELO',
};

export async function crearCasiteritaDetalle(input: CasiteritaDetalleInput, actor: string, actorName?: string | null): Promise<CasiteritaDetalle> {
  const row = { ...normalizar(input), actor, actor_name: actorName ?? null, stock_kg: 0 };
  const { data, error } = await supabase.from('casiterita_detalle').insert(row).select('*').single();
  if (error) throw error;
  const fila = data as CasiteritaDetalle;

  // La fila nace en cero y recién acá suma: si el movimiento falla, queda en el
  // detalle sin stock y el próximo guardado la completa, en vez de duplicarla.
  const ajuste = ajustePorFila(fila.peso_casiterita_kgs, 0);
  if (ajuste) {
    await sincronizarStock(fila, ajuste, false, actor, actorName ?? null);
    await supabase.from('casiterita_detalle')
      .update({ stock_kg: fila.peso_casiterita_kgs }).eq('id', fila.id);
    fila.stock_kg = fila.peso_casiterita_kgs;
  }
  return fila;
}

export async function actualizarCasiteritaDetalle(id: string, input: CasiteritaDetalleInput, actor?: string, actorName?: string | null): Promise<void> {
  const { data: antes } = await supabase.from('casiterita_detalle')
    .select('stock_kg').eq('id', id).maybeSingle();
  const yaContado = Number((antes as { stock_kg?: number } | null)?.stock_kg) || 0;

  const campos = normalizar(input);
  const { error } = await supabase.from('casiterita_detalle')
    .update({ ...campos, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;

  // Corregir la tasa o el # de análisis no mueve un kilo: solo el peso.
  const ajuste = ajustePorFila(campos.peso_casiterita_kgs, yaContado);
  if (!ajuste) return;
  await sincronizarStock(
    { id, procedencia: campos.procedencia, categoria: campos.categoria, almacen: campos.almacen },
    ajuste, true, actor ?? 'sistema', actorName ?? null,
  );
  await supabase.from('casiterita_detalle')
    .update({ stock_kg: campos.peso_casiterita_kgs }).eq('id', id);
}

export async function eliminarCasiteritaDetalle(id: string, actor?: string, actorName?: string | null): Promise<void> {
  const { data: fila } = await supabase.from('casiterita_detalle')
    .select('id, procedencia, categoria, almacen, stock_kg').eq('id', id).maybeSingle();

  // Primero se devuelve el stock y después se borra la fila: al revés, un fallo
  // al borrar dejaría el kardex con una salida por una fila que sigue viva.
  const ajuste = ajusteAlBorrar((fila as { stock_kg?: number } | null)?.stock_kg);
  if (fila && ajuste) {
    await sincronizarStock(fila as unknown as { id: string; procedencia: string; categoria: CasiteritaCategoria; almacen: string },
      ajuste, true, actor ?? 'sistema', actorName ?? null);
  }
  const { error } = await supabase.from('casiterita_detalle').delete().eq('id', id);
  if (error) throw error;
}

/** Total RECEPCIONADO de casiterita = Σ existencia del almacén SnO₂ (lo que realmente entró
 *  al inventario por las recepciones). Es el TOPE que el inventario detallado (Σ Peso
 *  Casiterita del ledger) no debería superar: si lo supera, hay un descuadre a verificar. */
export async function totalRecepcionadoCasiterita(almacen: string = CASITERITA_ALMACEN): Promise<number> {
  const { data, error } = await supabase.from('existencias').select('stock').eq('almacen', almacen);
  if (error) throw error;
  return round2((data ?? []).reduce((a, r) => a + num((r as { stock: number }).stock), 0));
}

/* ───────────── Traer desde recepción ─────────────
   Por cada procedencia (centro/aliado) de una recepción arma una sugerencia con:
   Peso Neto (seco de los bigbags, o el peso del cierre de caja si no hay bigbags),
   Prom SN (%), los # de análisis y la tasa del cierre. */
export interface CasiteritaSugerencia {
  procedencia: string;
  peso_neto_kgs: number;    // peso (seco) de ESE bigbag — sin restar el factor todavía
  prom_sn: number | null;
  n_analisis: string | null;
  tasa: number | null;
  categoria_sug: CasiteritaCategoria;  // categoría del bigbag (lado seco), como default de la fila
}

function mineralSnDe(minerales: RecepcionMineral[]): RecepcionMineral | null {
  return minerales.find((m) => /sn/i.test(m.clave) || /sn/i.test(m.nombre) || /esta[ñn]o/i.test(m.nombre)) ?? minerales[0] ?? null;
}
/** Lee la lectura de SN de un análisis priorizando `prom` (así se guarda una sola lectura),
 *  con respaldo al promedio de a/b/c. Igual criterio que la grilla del laboratorio. */
function leerSn(v: ValorMineral | undefined | null): number | null {
  if (!v) return null;
  if (v.prom != null && Number.isFinite(Number(v.prom))) return Number(v.prom);
  const xs = [v.a, v.b, v.c].filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Núcleo: arma las sugerencias por procedencia desde los arrays (sirve para una recepción
 *  ABIERTA o para el snapshot `datos` de una recepción CERRADA — misma forma). */
function sugerenciasDesde(pesajes: RecepcionPesaje[], analisis: RecepcionAnalisis[], minerales: RecepcionMineral[], receps: Recepcion[], tasaFallback?: number | null): CasiteritaSugerencia[] {
  const sn = mineralSnDe(minerales ?? []);

  // Peso (saldo) y tasa desde las filas de recepción (cierre de caja) por procedencia.
  const pesoRec = new Map<string, number>();
  const tasaRec = new Map<string, number>();
  for (const r of receps ?? []) {
    const proc = (r.procedencia ?? '').trim().toUpperCase();
    if (!proc) continue;
    pesoRec.set(proc, (pesoRec.get(proc) ?? 0) + (num(r.peso_kg) || 0));
    if (r.tasa != null && Number.isFinite(Number(r.tasa))) tasaRec.set(proc, Number(r.tasa));
  }

  // Prom SN y # de análisis por procedencia.
  const promAcc = new Map<string, number[]>();
  const numsAcc = new Map<string, string[]>();
  for (const a of analisis ?? []) {
    const proc = (a.procedencia ?? '').trim().toUpperCase();
    if (!proc) continue;
    if (sn) {
      const p = leerSn(a.valores?.[sn.clave]);
      if (p != null) { if (!promAcc.has(proc)) promAcc.set(proc, []); promAcc.get(proc)!.push(p); }
    }
    const etiqueta = (a.numeros?.trim() || String(a.n_analisis)).trim();
    if (etiqueta) { if (!numsAcc.has(proc)) numsAcc.set(proc, []); numsAcc.get(proc)!.push(etiqueta); }
  }
  const fbTasa = tasaFallback != null && Number.isFinite(Number(tasaFallback)) && Number(tasaFallback) > 0 ? round2(Number(tasaFallback)) : null;
  const promDe = (proc: string): number | null => { const xs = promAcc.get(proc) ?? []; return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
  const numsDe = (proc: string): string | null => (numsAcc.get(proc) ?? []).join(', ') || null;
  const tasaDe = (proc: string): number | null => (tasaRec.has(proc) ? round2(tasaRec.get(proc)!) : fbTasa);

  // UNA FILA POR BIGBAG recepcionado (peso seco de ese bigbag, sin restar el factor: eso se
  // hace después con Peso Casiterita = peso − factor×cant). Cada bigbag lleva su categoría.
  const rows: CasiteritaSugerencia[] = [];
  const procsConBigbag = new Set<string>();
  for (const p of pesajes ?? []) {
    for (const b of p.bigbags ?? []) {
      const proc = ((b.proc_s || b.proc_h) ?? '').toString().trim().toUpperCase();
      const peso = num(b.peso_s) > 0 ? num(b.peso_s) : num(b.peso_h);
      if (peso <= 0) continue;
      if (proc) procsConBigbag.add(proc);
      rows.push({
        procedencia: proc, peso_neto_kgs: round2(peso),
        prom_sn: promDe(proc), n_analisis: numsDe(proc), tasa: tasaDe(proc),
        categoria_sug: catLado(b, 's'),
      });
    }
  }
  // Procedencias que solo vienen del cierre de caja (sin bigbags): una fila agregada.
  for (const [proc, peso] of pesoRec) {
    if (!proc || procsConBigbag.has(proc) || peso <= 0) continue;
    rows.push({
      procedencia: proc, peso_neto_kgs: round2(peso),
      prom_sn: promDe(proc), n_analisis: numsDe(proc), tasa: tasaDe(proc), categoria_sug: 'bigbag',
    });
  }
  return rows.sort((a, b) => a.procedencia.localeCompare(b.procedencia));
}

/** Recepción ABIERTA (tarjeta con datos en vivo). */
export async function sugerenciasCasiteritaDesdeGrupo(grupoId: string): Promise<CasiteritaSugerencia[]> {
  const [pesajes, analisis, minerales, receps] = await Promise.all([
    listPesajes(grupoId), listAnalisis(grupoId), listMinerales(false), listRecepciones(grupoId),
  ]);
  return sugerenciasDesde(pesajes, analisis, minerales, receps);
}

/** Recepción CERRADA: lee el snapshot `datos` guardado en recepcion_cierres. */
export async function sugerenciasCasiteritaDesdeCierre(cierreId: string): Promise<CasiteritaSugerencia[]> {
  const { data, error } = await supabase.from('recepcion_cierres').select('datos, tasa_final').eq('id', cierreId).maybeSingle();
  if (error) throw error;
  const row = data as { datos?: Record<string, unknown>; tasa_final?: number | null } | null;
  const d = (row?.datos ?? {}) as Record<string, unknown>;
  return sugerenciasDesde(
    (d.pesajes as RecepcionPesaje[]) ?? [],
    (d.analisis as RecepcionAnalisis[]) ?? [],
    (d.minerales as RecepcionMineral[]) ?? [],
    (d.recepciones as Recepcion[]) ?? [],
    row?.tasa_final ?? null,
  );
}

/** Opciones de recepciones CERRADAS para el selector «Traer desde recepción».
 *  Se EXCLUYEN las que ya fueron traídas al detallado (tienen filas con ese cierre_id),
 *  para que el usuario no vuelva a cargar una recepción ya usada. */
export interface CierreOpcion { id: string; numero: number; grupo_nombre: string; grupo_id: string | null; fecha: string; }
export async function listCierresParaTraer(): Promise<CierreOpcion[]> {
  const [cierresRes, usadosRes] = await Promise.all([
    supabase.from('recepcion_cierres').select('id, numero, grupo_nombre, grupo_id, fecha').order('numero', { ascending: false }),
    supabase.from('casiterita_detalle').select('cierre_id').not('cierre_id', 'is', null),
  ]);
  if (cierresRes.error) throw cierresRes.error;
  if (usadosRes.error) throw usadosRes.error;
  const usados = new Set((usadosRes.data ?? []).map((r) => (r as { cierre_id: string | null }).cierre_id).filter(Boolean) as string[]);
  return (cierresRes.data ?? [])
    .map((r) => {
      const c = r as CierreOpcion;
      return { id: c.id, numero: Number(c.numero) || 0, grupo_nombre: c.grupo_nombre ?? '', grupo_id: c.grupo_id ?? null, fecha: c.fecha ?? '' };
    })
    .filter((c) => !usados.has(c.id));
}
