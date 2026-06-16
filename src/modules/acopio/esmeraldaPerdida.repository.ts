/* ============================================================
   Centro de Acopio LA ESMERALDA ALI · Reportes de pérdida
   Snapshot fiel de las hojas del Excel:
     · «CUENTA DE PERDIDA CON ALI»  (seccion = 'cuenta')
     · «CUADRO RESUMEN DEL VALOR DE LA PERDIDA TOTAL» (seccion = 'cuadro')
   Datos congelados (período de pérdida cerrado). Se leen de Supabase
   y se muestran en dos vistas con botón «Volver».
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

export type SeccionPerdida = 'cuenta' | 'cuadro';
export type EstiloPerdida = 'normal' | 'total' | 'header' | 'destacado';

export interface FilaPerdida {
  id: string;
  seccion: SeccionPerdida;
  orden: number;
  etiqueta: string;
  descripcion: string | null;
  v1: number | null;
  v2: number | null;
  v3: number | null;
  v4: number | null;
  v5: number | null;
  estilo: EstiloPerdida;
}

/** Lee las filas de una hoja de pérdida (ordenadas). */
export async function listPerdidaEsmeralda(seccion: SeccionPerdida): Promise<FilaPerdida[]> {
  const { data, error } = await supabase
    .from('acopio_esmeralda_perdida')
    .select('*')
    .eq('seccion', seccion)
    .order('orden', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FilaPerdida[];
}

export interface NuevaFilaPerdida {
  seccion: SeccionPerdida;
  etiqueta: string;
  descripcion?: string | null;
  v1?: number | null;
  v2?: number | null;
  v3?: number | null;
  v4?: number | null;
  v5?: number | null;
  estilo?: EstiloPerdida;
}

/** Agrega una fila a una hoja de pérdida (orden = última + 1 dentro de la sección). */
export async function crearFilaPerdida(input: NuevaFilaPerdida): Promise<FilaPerdida> {
  const { data: ult } = await supabase
    .from('acopio_esmeralda_perdida')
    .select('orden')
    .eq('seccion', input.seccion)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  const orden = ((ult?.orden as number | undefined) ?? 0) + 1;
  const { data, error } = await supabase
    .from('acopio_esmeralda_perdida')
    .insert({
      seccion: input.seccion,
      orden,
      etiqueta: input.etiqueta,
      descripcion: input.descripcion ?? null,
      v1: input.v1 ?? null,
      v2: input.v2 ?? null,
      v3: input.v3 ?? null,
      v4: input.v4 ?? null,
      v5: input.v5 ?? null,
      estilo: input.estilo ?? 'normal',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as FilaPerdida;
}

/** Elimina una fila de una hoja de pérdida. */
export async function eliminarFilaPerdida(id: string): Promise<void> {
  const { error } = await supabase.from('acopio_esmeralda_perdida').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
