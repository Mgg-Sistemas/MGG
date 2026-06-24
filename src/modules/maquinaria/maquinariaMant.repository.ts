/* ============================================================
   MGG · Control de Maquinaria · bitácora de horómetro
   Registro cronológico de mantenimientos por equipo. Las HRS
   trabajadas y el consumo (Lts/h) NO se guardan: se calculan en
   la app, replicando las fórmulas del Excel:
     HRS         = horómetro de este registro − el del registro anterior
     Consumo L/h = gasoil de este registro ÷ HRS
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export interface MantenimientoMaquinaria {
  id: string;
  equipo_id: string;
  fecha: string;
  horometro: number | null;
  tipo: string | null;
  pieza: string | null;
  aceite_lts: number | null;
  refrigerante_lts: number | null;
  gasoil_lts: number | null;
  filtros_cant: number | null;
  filtros_tipo: string | null;
  trabajo: string | null;
  consumibles: string | null;
  mecanico: string | null;
  ubicacion: string | null;
  observacion: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
}

/** Registro con los campos derivados (horas trabajadas + consumo Lts/h). */
export interface MantenimientoCalc extends MantenimientoMaquinaria {
  horas: number | null;       // horómetro − lectura anterior (más antigua)
  consumoLh: number | null;   // gasoil ÷ horas
}

export type MantenimientoInput = Partial<Omit<MantenimientoMaquinaria, 'id' | 'created_at'>> & { equipo_id: string };

const TABLE = 'maquinaria_mantenimientos';

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Lista la bitácora de un equipo (más reciente primero) y calcula HRS y consumo Lts/h.
 * HRS = lectura de este registro − lectura del registro inmediatamente anterior en el
 * tiempo (el de fecha más vieja contiguo). El más antiguo no tiene HRS (no hay base).
 */
export async function listMantenimientos(equipoId: string): Promise<MantenimientoCalc[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .eq('equipo_id', equipoId)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as MantenimientoMaquinaria[];
  // rows está en orden descendente (nuevo→viejo). El "anterior" de la fila i es la fila i+1.
  return rows.map((r, i) => {
    const actual = num(r.horometro);
    const prev = num(rows[i + 1]?.horometro);
    const horas = actual != null && prev != null ? Math.round((actual - prev) * 100) / 100 : null;
    const gasoil = num(r.gasoil_lts);
    const consumoLh = gasoil != null && horas != null && horas > 0 ? Math.round((gasoil / horas) * 10000) / 10000 : null;
    return { ...r, horas, consumoLh };
  });
}

function sanitize(input: MantenimientoInput): Record<string, unknown> {
  const v = (s?: string | null) => (s == null ? null : String(s).trim() || null);
  return {
    equipo_id: input.equipo_id,
    fecha: input.fecha || new Date().toISOString().slice(0, 10),
    horometro: num(input.horometro),
    tipo: v(input.tipo), pieza: v(input.pieza),
    aceite_lts: num(input.aceite_lts),
    refrigerante_lts: num(input.refrigerante_lts),
    gasoil_lts: num(input.gasoil_lts),
    filtros_cant: num(input.filtros_cant),
    filtros_tipo: v(input.filtros_tipo),
    trabajo: v(input.trabajo), consumibles: v(input.consumibles),
    mecanico: v(input.mecanico), ubicacion: v(input.ubicacion), observacion: v(input.observacion),
  };
}

export async function addMantenimiento(input: MantenimientoInput, actor: string, actorName?: string | null): Promise<MantenimientoMaquinaria> {
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...sanitize(input), created_by: actor, actor_name: actorName ?? null })
    .select('*').single();
  if (error) throw error;
  return data as MantenimientoMaquinaria;
}

export async function updateMantenimiento(id: string, input: MantenimientoInput): Promise<void> {
  const { error } = await supabase.from(TABLE).update(sanitize(input)).eq('id', id);
  if (error) throw error;
}

export async function eliminarMantenimiento(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/** Consumos acumulados de la bitácora (en un rango opcional de fechas). */
export interface ConsumoMant {
  aceite: number;        // Σ aceite_lts
  refrigerante: number;  // Σ refrigerante_lts
  gasoil: number;        // Σ gasoil_lts
  filtros: number;       // Σ filtros_cant
  registros: number;     // cantidad de registros de mantenimiento
}

const cero = (): ConsumoMant => ({ aceite: 0, refrigerante: 0, gasoil: 0, filtros: 0, registros: 0 });

/**
 * Suma por equipo el aceite, refrigerante, gasoil y filtros registrados en la bitácora,
 * acotado por fechas (inclusive). Una sola consulta; se agrupa en memoria por equipo_id.
 */
export async function consumosPorEquipo(desde?: string, hasta?: string): Promise<Map<string, ConsumoMant>> {
  let q = supabase.from(TABLE).select('equipo_id, aceite_lts, refrigerante_lts, gasoil_lts, filtros_cant, fecha');
  if (desde) q = q.gte('fecha', desde);
  if (hasta) q = q.lte('fecha', hasta);
  const { data, error } = await q;
  if (error) throw error;
  const out = new Map<string, ConsumoMant>();
  for (const r of (data ?? []) as Array<{ equipo_id: string; aceite_lts: number | null; refrigerante_lts: number | null; gasoil_lts: number | null; filtros_cant: number | null }>) {
    const c = out.get(r.equipo_id) ?? cero();
    c.aceite += num(r.aceite_lts) ?? 0;
    c.refrigerante += num(r.refrigerante_lts) ?? 0;
    c.gasoil += num(r.gasoil_lts) ?? 0;
    c.filtros += num(r.filtros_cant) ?? 0;
    c.registros += 1;
    out.set(r.equipo_id, c);
  }
  return out;
}

/** Suma los consumos de una lista de registros ya cargados (para el detalle filtrado en memoria). */
export function sumarConsumos(rows: MantenimientoMaquinaria[]): ConsumoMant {
  const c = cero();
  for (const r of rows) {
    c.aceite += num(r.aceite_lts) ?? 0;
    c.refrigerante += num(r.refrigerante_lts) ?? 0;
    c.gasoil += num(r.gasoil_lts) ?? 0;
    c.filtros += num(r.filtros_cant) ?? 0;
    c.registros += 1;
  }
  return c;
}

/** Resumen del estado de horómetro de un equipo a partir de su bitácora. */
export interface ResumenHorometro {
  ultimoHorometro: number | null;   // lectura más reciente
  horasUltimo: number | null;       // HRS del último período
  horasDesdeUltimoServicio: number | null; // acumulado desde el último mantenimiento con trabajo
}

export function resumenHorometro(rows: MantenimientoCalc[]): ResumenHorometro {
  const conLectura = rows.filter((r) => r.horometro != null);
  const ultimoHorometro = conLectura[0]?.horometro ?? null;
  const horasUltimo = rows[0]?.horas ?? null;
  return { ultimoHorometro, horasUltimo, horasDesdeUltimoServicio: horasUltimo };
}

/**
 * Para el resumen general: por cada equipo, las horas del último período (la
 * diferencia entre sus dos lecturas más recientes) y su último horómetro. Una
 * sola consulta a toda la bitácora; se agrupa en memoria.
 */
export async function horasUltimoPorEquipo(): Promise<Map<string, { horasUltimo: number | null; ultimoHorometro: number | null }>> {
  const { data, error } = await supabase.from(TABLE)
    .select('equipo_id, horometro, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const byEq = new Map<string, number[]>();
  for (const r of (data ?? []) as { equipo_id: string; horometro: number | null }[]) {
    const arr = byEq.get(r.equipo_id) ?? [];
    if (r.horometro != null) arr.push(Number(r.horometro));
    byEq.set(r.equipo_id, arr);
  }
  const out = new Map<string, { horasUltimo: number | null; ultimoHorometro: number | null }>();
  for (const [eq, lect] of byEq) {
    const ultimoHorometro = lect[0] ?? null;
    const horasUltimo = lect.length >= 2 ? Math.round((lect[0] - lect[1]) * 100) / 100 : null;
    out.set(eq, { horasUltimo, ultimoHorometro });
  }
  return out;
}
