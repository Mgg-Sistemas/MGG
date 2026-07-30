/* ============================================================
   MGG · Inventario · Casiterita — Inventario Detallado (SnO₂)
   Ledger PARALELO del almacén de casiterita (Los Pinos): desglose por
   precinto / # de análisis + valorización por tasa. NO mueve stock (la
   casiterita ya entra por la recepción); esta vista es el detalle SnO₂.

   Peso Casiterita Kgs = Peso Neto Kgs (de la recepción) − factor(categoría)×cant
     · big bag 1,5 · saco 0,06 · tobo 1 · bolsa de hielo 0,03
   Peso Puro SN       = Prom (%) × Peso Casiterita Kgs ÷ 100
   Valor              = Peso Casiterita Kgs × Tasa (por centro/aliado)
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import {
  listPesajes, listAnalisis, listMinerales,
  netoPorProcedenciaGrupo, promMineral, PESO_FACTOR,
  type PesoModo, type RecepcionMineral,
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
  created_at: string;
  updated_at: string | null;
}

export interface CasiteritaDetalleInput {
  grupo_id?: string | null;
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

export async function crearCasiteritaDetalle(input: CasiteritaDetalleInput, actor: string, actorName?: string | null): Promise<CasiteritaDetalle> {
  const row = { ...normalizar(input), actor, actor_name: actorName ?? null };
  const { data, error } = await supabase.from('casiterita_detalle').insert(row).select('*').single();
  if (error) throw error;
  return data as CasiteritaDetalle;
}

export async function actualizarCasiteritaDetalle(id: string, input: CasiteritaDetalleInput): Promise<void> {
  const { error } = await supabase.from('casiterita_detalle')
    .update({ ...normalizar(input), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function eliminarCasiteritaDetalle(id: string): Promise<void> {
  const { error } = await supabase.from('casiterita_detalle').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Traer desde recepción ─────────────
   Por cada procedencia (centro/aliado) de una recepción arma una sugerencia con:
   Peso Neto (seco final de esa procedencia), Prom SN (%) y los # de análisis. */
export interface CasiteritaSugerencia {
  procedencia: string;
  peso_neto_kgs: number;
  prom_sn: number | null;
  n_analisis: string | null;
}

function mineralSnDe(minerales: RecepcionMineral[]): RecepcionMineral | null {
  return minerales.find((m) => /sn/i.test(m.clave) || /sn/i.test(m.nombre) || /esta[ñn]o/i.test(m.nombre)) ?? minerales[0] ?? null;
}

export async function sugerenciasCasiteritaDesdeGrupo(grupoId: string): Promise<CasiteritaSugerencia[]> {
  const [pesajes, analisis, minerales] = await Promise.all([
    listPesajes(grupoId), listAnalisis(grupoId), listMinerales(false),
  ]);
  const netoS = netoPorProcedenciaGrupo(pesajes, 's'); // Map<PROC, neto seco>
  const sn = mineralSnDe(minerales);

  // Prom SN y # de análisis por procedencia.
  const promAcc = new Map<string, number[]>();
  const numsAcc = new Map<string, string[]>();
  for (const a of analisis) {
    const proc = (a.procedencia ?? '').trim().toUpperCase();
    if (!proc) continue;
    if (sn) {
      const p = promMineral(sn.modo, a.valores?.[sn.clave]);
      if (p != null) { if (!promAcc.has(proc)) promAcc.set(proc, []); promAcc.get(proc)!.push(p); }
    }
    const etiqueta = (a.numeros?.trim() || String(a.n_analisis)).trim();
    if (etiqueta) { if (!numsAcc.has(proc)) numsAcc.set(proc, []); numsAcc.get(proc)!.push(etiqueta); }
  }

  const procs = Array.from(new Set([...netoS.keys(), ...promAcc.keys()])).sort((a, b) => a.localeCompare(b));
  return procs.map((proc) => {
    const proms = promAcc.get(proc) ?? [];
    const prom = proms.length ? round2(proms.reduce((a, b) => a + b, 0) / proms.length) : null;
    return {
      procedencia: proc,
      peso_neto_kgs: round2(num(netoS.get(proc))),
      prom_sn: prom,
      n_analisis: (numsAcc.get(proc) ?? []).join(', ') || null,
    };
  });
}
