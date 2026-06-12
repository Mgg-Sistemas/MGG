/* ============================================================
   Golden Touch · Centro de Acopio · CUADRE DE CAJA (EFECTIVO)
   Optimiza la hoja "Recepcion Caja GT Peramanal" (cuadre Sr. Cheli):
   entrada con conteo de billetes, movimientos categorizados, saldo
   corriente y control de vales/deudas pendientes.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type {
  CategoriaCuadre, ConteoBillete, Cuadre, CuadreMovimiento, TipoMovCuadre,
} from '@/shared/lib/types';

export const CATEGORIAS_CUADRE: { key: CategoriaCuadre; label: string; tipo: TipoMovCuadre }[] = [
  { key: 'nomina',           label: 'Nómina',            tipo: 'salida' },
  { key: 'adelanto_vale',    label: 'Adelanto / Vale',   tipo: 'salida' },
  { key: 'compra_casiterita',label: 'Compra casiterita', tipo: 'salida' },
  { key: 'compra_comida',    label: 'Compra comida / mercado', tipo: 'salida' },
  { key: 'refuerzo',         label: 'Refuerzo',          tipo: 'salida' },
  { key: 'traslado',         label: 'Traslado / Entrega', tipo: 'salida' },
  { key: 'otro',             label: 'Otro',              tipo: 'salida' },
];
export const catLabel = (c?: string | null) => CATEGORIAS_CUADRE.find((x) => x.key === c)?.label ?? '—';

/** Denominaciones de billetes para el conteo (USD). */
export const DENOMINACIONES = [100, 50, 20, 10, 5, 2, 1];

const numv = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const totalBilletes = (billetes: ConteoBillete[] = []) =>
  billetes.reduce((a, b) => a + numv(b.denom) * numv(b.cantidad), 0);

/* ───────────── Lecturas ───────────── */

export async function listCuadres(): Promise<Cuadre[]> {
  const { data, error } = await supabase
    .from('acopio_cuadres')
    .select('*, movimientos:acopio_cuadre_movimientos(*)')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const c = r as Cuadre;
    const movs = [...(c.movimientos ?? [])].sort((a, b) => a.orden - b.orden);
    return { ...c, billetes: (c.billetes ?? []) as ConteoBillete[], movimientos: movs };
  });
}

export async function getCuadre(id: string): Promise<Cuadre | null> {
  const { data, error } = await supabase
    .from('acopio_cuadres')
    .select('*, movimientos:acopio_cuadre_movimientos(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const c = data as Cuadre;
  return { ...c, billetes: (c.billetes ?? []) as ConteoBillete[], movimientos: [...(c.movimientos ?? [])].sort((a, b) => a.orden - b.orden) };
}

/* ───────────── Cálculos (saldo corriente + totales) ───────────── */

export interface CuadreTotales {
  entradas: number;
  salidas: number;
  saldo: number;          // monto_recibido + entradas − salidas
  valesPendientes: number; // Σ vales no pagados
  conteo: number;         // total del conteo de billetes
  difConteo: number;      // conteo − monto_recibido (debería ser 0)
}

/** Devuelve los movimientos con su saldo corriente y los totales del cuadre. */
export function calcularCuadre(cuadre: Cuadre): { movs: CuadreMovimiento[]; totales: CuadreTotales } {
  let saldo = numv(cuadre.monto_recibido);
  let entradas = 0, salidas = 0, valesPendientes = 0;
  const movs = (cuadre.movimientos ?? []).map((m) => {
    const monto = numv(m.monto);
    if (m.tipo === 'entrada') { saldo += monto; entradas += monto; }
    else { saldo -= monto; salidas += monto; }
    if (m.es_vale && !m.pagado) valesPendientes += monto;
    return { ...m, saldo };
  });
  const conteo = totalBilletes(cuadre.billetes);
  return {
    movs,
    totales: {
      entradas, salidas,
      saldo: numv(cuadre.monto_recibido) + entradas - salidas,
      valesPendientes,
      conteo,
      difConteo: conteo - numv(cuadre.monto_recibido),
    },
  };
}

/* ───────────── Escrituras ───────────── */

export interface CuadreInput {
  fecha: string;
  fuente?: string | null;
  responsable?: string | null;
  monto_recibido?: number;
  billetes?: ConteoBillete[];
  verificado?: boolean;
  observaciones?: string | null;
}

async function nextNumero(fecha: string): Promise<string> {
  const year = (fecha || '').slice(0, 4) || String(new Date().getFullYear());
  const { data, error } = await supabase.from('acopio_cuadres').select('numero').like('numero', `CUA-${year}-%`);
  if (error) throw error;
  let max = 0;
  (data ?? []).forEach((r) => { const m = String((r as { numero: string }).numero).match(/-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `CUA-${year}-${String(max + 1).padStart(4, '0')}`;
}

export async function crearCuadre(input: CuadreInput, actor: string, actorName?: string | null): Promise<Cuadre> {
  if (!input.fecha) throw new Error('Indicá la fecha del cuadre.');
  const numero = await nextNumero(input.fecha);
  const billetes = (input.billetes ?? []).filter((b) => numv(b.cantidad) > 0);
  const { data, error } = await supabase
    .from('acopio_cuadres')
    .insert({
      numero,
      fecha: input.fecha,
      fuente: input.fuente?.trim() || null,
      responsable: input.responsable?.trim() || null,
      monto_recibido: numv(input.monto_recibido),
      billetes,
      verificado: !!input.verificado,
      observaciones: input.observaciones?.trim() || null,
      created_by: actor,
      actor_name: actorName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return { ...(data as Cuadre), movimientos: [] };
}

export async function actualizarCuadre(id: string, input: CuadreInput): Promise<void> {
  const billetes = (input.billetes ?? []).filter((b) => numv(b.cantidad) > 0);
  const { error } = await supabase
    .from('acopio_cuadres')
    .update({
      fecha: input.fecha,
      fuente: input.fuente?.trim() || null,
      responsable: input.responsable?.trim() || null,
      monto_recibido: numv(input.monto_recibido),
      billetes,
      verificado: !!input.verificado,
      observaciones: input.observaciones?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function setEstadoCuadre(id: string, estado: 'abierto' | 'cerrado', actor: string): Promise<void> {
  const patch: Record<string, unknown> = { estado, updated_at: new Date().toISOString() };
  if (estado === 'cerrado') { patch.cerrado_por = actor; patch.cerrado_en = new Date().toISOString(); }
  const { error } = await supabase.from('acopio_cuadres').update(patch).eq('id', id);
  if (error) throw error;
}

export async function eliminarCuadre(id: string): Promise<void> {
  const { error } = await supabase.from('acopio_cuadres').delete().eq('id', id);
  if (error) throw error;
}

/* ───────────── Movimientos ───────────── */

export interface MovCuadreInput {
  fecha?: string | null;
  tipo: TipoMovCuadre;
  categoria?: CategoriaCuadre | null;
  descripcion?: string | null;
  beneficiario?: string | null;
  monto?: number;
  monto_bs?: number;
  es_vale?: boolean;
  pagado?: boolean;
  nota?: string | null;
}

export async function agregarMovimiento(cuadreId: string, input: MovCuadreInput, orden: number): Promise<CuadreMovimiento> {
  const { data, error } = await supabase
    .from('acopio_cuadre_movimientos')
    .insert({
      cuadre_id: cuadreId,
      fecha: input.fecha || null,
      tipo: input.tipo,
      categoria: input.categoria ?? null,
      descripcion: input.descripcion?.trim() || null,
      beneficiario: input.beneficiario?.trim() || null,
      monto: numv(input.monto),
      monto_bs: numv(input.monto_bs),
      es_vale: !!input.es_vale,
      pagado: input.pagado ?? true,
      nota: input.nota?.trim() || null,
      orden,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CuadreMovimiento;
}

export async function actualizarMovimiento(id: string, input: MovCuadreInput): Promise<void> {
  const { error } = await supabase
    .from('acopio_cuadre_movimientos')
    .update({
      fecha: input.fecha || null,
      tipo: input.tipo,
      categoria: input.categoria ?? null,
      descripcion: input.descripcion?.trim() || null,
      beneficiario: input.beneficiario?.trim() || null,
      monto: numv(input.monto),
      monto_bs: numv(input.monto_bs),
      es_vale: !!input.es_vale,
      pagado: input.pagado ?? true,
      nota: input.nota?.trim() || null,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function toggleValePagado(id: string, pagado: boolean): Promise<void> {
  const { error } = await supabase.from('acopio_cuadre_movimientos').update({ pagado }).eq('id', id);
  if (error) throw error;
}

export async function eliminarMovimiento(id: string): Promise<void> {
  const { error } = await supabase.from('acopio_cuadre_movimientos').delete().eq('id', id);
  if (error) throw error;
}
