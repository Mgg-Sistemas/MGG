/* ============================================================
   Golden Touch · Centro de Acopio · CONSUMO DE MARTILLOS (Molino H66)
   Réplica de la hoja «CONSUMO MAZOS MARTILLOS GT».
   Libro tipo caja, pero de martillos: dinero (entregados/facturados → saldo $)
   y unidades (entregados − entregados a GT → restantes), ambos corrientes.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface MartilloMovimiento {
  id: string;
  fecha: string;
  descripcion: string | null;
  usd_entregados: number;
  cantidad_entregados: number;
  usd_facturados: number;
  martillos_a_gt: number;
  consumidos: number;            // martillos consumidos/usados (uso) → genera gasto en Acopio
  orden: number;
  created_by?: string | null;
  actor_name?: string | null;
  created_at?: string;
  // Calculados al listar (no se persisten):
  precio_usd_martillo: number;   // usd_facturados / cantidad_entregados (igual que el Excel)
  saldo_usd: number;             // corrido: + entregados − facturados
  martillos_restantes: number;   // corrido: + entregados − a GT − consumidos
}

export interface MartilloInput {
  fecha: string;
  descripcion?: string | null;
  usd_entregados?: number;
  cantidad_entregados?: number;
  usd_facturados?: number;
  martillos_a_gt?: number;
  consumidos?: number;
}

/** Lista en orden cronológico y calcula saldo $ y martillos restantes corridos. */
export async function listMovimientosMartillos(): Promise<MartilloMovimiento[]> {
  const { data, error } = await supabase
    .from('acopio_martillos_movimientos')
    .select('*')
    .order('fecha', { ascending: true })
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  let saldo = 0;
  let restantes = 0;
  return (data ?? []).map((row) => {
    const m = row as MartilloMovimiento;
    const cant = num(m.cantidad_entregados);
    saldo += num(m.usd_entregados) - num(m.usd_facturados);
    restantes += cant - num(m.martillos_a_gt) - num(m.consumidos);
    return {
      ...m,
      consumidos: num(m.consumidos),
      // El Excel calcula el «Precio $Usd por Martillo» sobre lo FACTURADO, no lo entregado.
      precio_usd_martillo: cant > 0 ? num(m.usd_facturados) / cant : 0,
      saldo_usd: saldo,
      martillos_restantes: restantes,
    };
  });
}

/** Precio vigente del martillo = Σ facturados / Σ cantidad entregados (lo que muestra la
 *  columna «Precio $/Martillo»). Es la tasa con la que se valora el consumo (gasto). */
export function precioVigenteMartillo(movs: MartilloMovimiento[]): number {
  const cant = movs.reduce((a, m) => a + num(m.cantidad_entregados), 0);
  const fac = movs.reduce((a, m) => a + num(m.usd_facturados), 0);
  return cant > 0 ? fac / cant : 0;
}

function payloadMartillo(input: MartilloInput): Record<string, unknown> {
  return {
    fecha: input.fecha,
    descripcion: input.descripcion?.trim() || null,
    usd_entregados: num(input.usd_entregados),
    cantidad_entregados: num(input.cantidad_entregados),
    usd_facturados: num(input.usd_facturados),
    martillos_a_gt: num(input.martillos_a_gt),
    consumidos: num(input.consumidos),
  };
}

export async function crearMovimientoMartillo(input: MartilloInput, actor: string, actorName?: string | null): Promise<void> {
  if (!input.fecha) throw new Error('Indicá la fecha del movimiento.');
  // Si lleva consumo, un trigger de la BD crea el gasto «USO DE MARTILLOS» en la caja de
  // Acopio y descuenta el inventario; acá solo guardamos el movimiento.
  const { error } = await supabase.from('acopio_martillos_movimientos').insert({
    ...payloadMartillo(input),
    created_by: actor,
    actor_name: actorName ?? null,
  });
  if (error) throw error;
}

/** Edita un movimiento de martillos. El trigger de la BD re-crea/actualiza el gasto
 *  ligado (si cambió el consumo) y re-sincroniza el inventario. */
export async function actualizarMovimientoMartillo(id: string, input: MartilloInput): Promise<void> {
  if (!input.fecha) throw new Error('Indicá la fecha del movimiento.');
  const { error } = await supabase.from('acopio_martillos_movimientos')
    .update({ ...payloadMartillo(input), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function eliminarMovimientoMartillo(id: string): Promise<void> {
  // El gasto ligado (ref_martillo_id) se borra en cascada por FK; el inventario se
  // re-sincroniza por trigger.
  const { error } = await supabase.from('acopio_martillos_movimientos').delete().eq('id', id);
  if (error) throw error;
}

export interface ResumenMartillos {
  saldoUsd: number;
  restantes: number;
  totalEntregadoUsd: number;
  totalFacturadoUsd: number;
  totalEntregados: number;   // martillos que entraron
  totalAGt: number;          // martillos entregados a GT
  totalConsumidos: number;   // martillos consumidos/usados (uso)
  gastoConsumoUsd: number;   // consumidos × precio vigente → gasto en Acopio
  precioVigente: number;     // Σ facturados / Σ entregados
}

/** Agregados de cabecera (a partir de la lista ya calculada). */
export function resumirMartillos(movs: MartilloMovimiento[]): ResumenMartillos {
  const totalEntregadoUsd = movs.reduce((a, m) => a + num(m.usd_entregados), 0);
  const totalFacturadoUsd = movs.reduce((a, m) => a + num(m.usd_facturados), 0);
  const totalEntregados = movs.reduce((a, m) => a + num(m.cantidad_entregados), 0);
  const totalAGt = movs.reduce((a, m) => a + num(m.martillos_a_gt), 0);
  const totalConsumidos = movs.reduce((a, m) => a + num(m.consumidos), 0);
  const precioVigente = precioVigenteMartillo(movs);
  return {
    saldoUsd: totalEntregadoUsd - totalFacturadoUsd,
    restantes: totalEntregados - totalAGt - totalConsumidos,
    totalEntregadoUsd, totalFacturadoUsd, totalEntregados, totalAGt,
    totalConsumidos, gastoConsumoUsd: totalConsumidos * precioVigente, precioVigente,
  };
}
