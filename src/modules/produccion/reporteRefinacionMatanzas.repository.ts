/* ============================================================
   MGG · Reporte formal de refinación Matanzas · datos

   Junta, para cada refinación FINALIZADA, lo que vive en la orden
   (`produccion`: horno, costos), en el reporte MGG-FR-002
   (`produccion_refinacion.datos`) y los reactivos de la receta
   (`produccion_materiales`, todo lo que no es el estaño crudo).

   Las cuentas no se hacen acá: eso es `reporteRefinacionMatanzas.ts`.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ProduccionRefinacion, RefinacionDatos } from '@/shared/lib/types';
import type { RefinacionReporte } from './reporteRefinacionMatanzas';

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nn = (v: unknown): number | null => { const x = Number(v); return Number.isFinite(x) && v !== null && v !== '' ? x : null; };

/** El renglón de receta que ES el estaño crudo (no un reactivo). */
const esCrudo = (nombre: string) => /^estañ?o crudo|^estano crudo|colada #|refinaci[oó]n #/i.test(nombre.trim());

/** Todas las refinaciones finalizadas, de la más vieja a la más nueva. */
export async function listRefinacionesParaReporte(): Promise<RefinacionReporte[]> {
  const { data: prods, error } = await supabase
    .from('produccion')
    .select('id, cantidad, horno, costo_material, mano_obra, costos_indirectos')
    .eq('tipo', 'refinacion')
    .eq('estado', 'finalizado');
  if (error) throw error;
  const rows = prods ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id as string);
  const [{ data: refs, error: e1 }, { data: mats, error: e2 }] = await Promise.all([
    supabase.from('produccion_refinacion').select('produccion_id, refinacion_num, fecha, datos').in('produccion_id', ids),
    supabase.from('produccion_materiales').select('produccion_id, material_nombre, cantidad').in('produccion_id', ids),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const rMap = new Map<string, ProduccionRefinacion>();
  (refs ?? []).forEach((r) => rMap.set((r as ProduccionRefinacion).produccion_id, r as ProduccionRefinacion));

  const reactivos = new Map<string, Array<{ nombre: string; kg: number }>>();
  (mats ?? []).forEach((m) => {
    const nombre = String(m.material_nombre ?? '').trim();
    if (!nombre || esCrudo(nombre)) return;
    const pid = m.produccion_id as string;
    const lista = reactivos.get(pid) ?? [];
    lista.push({ nombre: nombre.toUpperCase(), kg: n(m.cantidad) });
    reactivos.set(pid, lista);
  });

  return rows
    .map((p) => {
      const id = p.id as string;
      const r = rMap.get(id);
      const d: RefinacionDatos = r?.datos ?? {};
      const origenes = (d.coladas ?? []).map((c) => ({
        produccion_id: c.produccion_id,
        origen: (c.origen ?? 'colada') as 'colada' | 'refinacion' | 'manual',
        etiqueta: c.etiqueta || (c.colada_num ? `Colada #${c.colada_num}` : 'Material'),
        colada_num: c.colada_num ? n(c.colada_num) : null,
        estano_kg: n(c.estano_kg),
      }));
      const crudo = n(d.estano_crudo_kg) || origenes.reduce((a, o) => a + o.estano_kg, 0);
      return {
        produccion_id: id,
        refinacion_num: r ? n(r.refinacion_num) : 0,
        fecha: r?.fecha ?? '',
        turno: (d.turno ?? '').trim(),
        responsable: (d.responsable ?? '').trim(),
        horno: [((p.horno as string | null) ?? '').trim(), (d.n_horno_olla ?? '').trim()].filter(Boolean).join(' · '),
        origenes,
        crudo_kg: crudo,
        pureza_inicial: nn(d.pureza_inicial),
        reactivos: reactivos.get(id) ?? [],
        refinado_kg: n(d.estano_refinado_kg) || n(p.cantidad),
        n_lingotes: nn(d.n_lingotes),
        dross_kg: n(d.dross_kg),
        pureza_final: nn(d.pureza_final),
        temp_colada: nn(d.temp_colada),
        duracion_horas: nn(d.tiempo_total_horas) ?? nn(d.jornada_horas),
        precinto: (d.n_precinto ?? '').trim(),
        costo_total: n(p.costo_material) + n(p.mano_obra) + n(p.costos_indirectos),
        observaciones: (d.observaciones ?? '').trim(),
      } satisfies RefinacionReporte;
    })
    .sort((a, b) => (a.fecha === b.fecha ? a.refinacion_num - b.refinacion_num : a.fecha.localeCompare(b.fecha)));
}
