/* ============================================================
   MGG · Reporte formal de fundición Matanzas · datos

   Junta, para cada colada FINALIZADA, todo lo que el reporte necesita:
   lo que vive en la orden (`produccion`), lo que vive en el reporte de
   colada (`produccion_colada.datos`) y los fundentes de la receta
   (`produccion_materiales`, por si la colada no los cargó a mano).

   Las cuentas no se hacen acá: eso es `reporteFundicionMatanzas.ts`.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ColadaDatos, ProduccionColada } from '@/shared/lib/types';
import type { ColadaReporte } from './reporteFundicionMatanzas';

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nn = (v: unknown): number | null => { const x = Number(v); return Number.isFinite(x) && v !== null && v !== '' ? x : null; };

/**
 * Todas las coladas finalizadas, listas para el reporte, de la más vieja a la
 * más nueva (que es el orden en el que se leen los ciclos de escoria).
 */
export async function listColadasParaReporte(): Promise<ColadaReporte[]> {
  const { data: prods, error } = await supabase
    .from('produccion')
    .select('id, cantidad, horno, almacen_destino')
    .eq('tipo', 'fundicion')
    .eq('estado', 'finalizado');
  if (error) throw error;
  const rows = prods ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id as string);
  const [{ data: coladas }, { data: mats }] = await Promise.all([
    supabase.from('produccion_colada').select('produccion_id, colada_num, fecha, datos').in('produccion_id', ids),
    supabase.from('produccion_materiales').select('produccion_id, material_nombre, cantidad').in('produccion_id', ids),
  ]);

  const cMap = new Map<string, ProduccionColada>();
  (coladas ?? []).forEach((c) => cMap.set((c as ProduccionColada).produccion_id, c as ProduccionColada));

  // Respaldo de fundentes: si la colada no los declaró en su reporte, se toman
  // de la receta, que es de donde salieron del inventario.
  const fund = new Map<string, { coque: number; caliza: number }>();
  (mats ?? []).forEach((m) => {
    const pid = m.produccion_id as string;
    const nombre = String(m.material_nombre ?? '');
    const cant = n(m.cantidad);
    const acc = fund.get(pid) ?? { coque: 0, caliza: 0 };
    if (/coque/i.test(nombre)) acc.coque += cant;
    else if (/caco3|caco₃|caliza|calc[aá]reo|carbonato/i.test(nombre)) acc.caliza += cant;
    fund.set(pid, acc);
  });

  return rows
    .map((r) => {
      const id = r.id as string;
      const c = cMap.get(id);
      const d: ColadaDatos = c?.datos ?? {};
      const f = fund.get(id) ?? { coque: 0, caliza: 0 };
      // La casiterita del reporte manda; si no está, se suman los big bags.
      const bags = (d.big_bags ?? []).reduce((a, b) => a + n(b?.kg), 0);
      return {
        produccion_id: id,
        colada_num: c ? n(c.colada_num) : 0,
        fecha: c?.fecha ?? '',
        turno: (d.turno ?? '').trim(),
        casiterita_kg: n(d.total_casiterita) || bags,
        coque_kg: n(d.coque_kg) || f.coque,
        caliza_kg: n(d.caco3_kg) || f.caliza,
        estano_kg: n(d.estano_kg) || n(r.cantidad),
        n_lingotes: nn(d.n_lingotes),
        escoria_kg: n(d.escoria_kg),
        temp_colada: nn(d.temp_colada),
        duracion_horas: nn(d.duracion_horas) ?? nn(d.jornada_horas),
        ley_sn_real: nn(d.ley_sn),
        responsable: (d.responsable ?? '').trim(),
        horno: ((r.horno as string | null) ?? '').trim(),
        observaciones: (d.observaciones ?? '').trim(),
      } satisfies ColadaReporte;
    })
    .sort((a, b) => (a.fecha === b.fecha ? a.colada_num - b.colada_num : a.fecha.localeCompare(b.fecha)));
}
