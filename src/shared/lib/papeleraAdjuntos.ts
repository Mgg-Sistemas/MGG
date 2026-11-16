import { supabase } from './supabase';

export function accionesAdjuntosPapelera(
  tabla: string,
  buckets: readonly string[],
  cerrar: (bucket: string, rutas: string[]) => Promise<void>,
) {
  return {
    async hayAdjuntosPendientes(): Promise<boolean> {
      const { data, error } = await supabase.from(tabla).select('ruta').limit(1);
      if (error) throw new Error(error.message);
      return !!data?.length;
    },
    async limpiarAdjuntos(): Promise<void> {
      const { data, error } = await supabase.from(tabla).select('*').limit(500);
      if (error) throw new Error(error.message);
      const archivos = (data ?? []) as Array<{ bucket?: string; ruta: string }>;
      for (const bucket of buckets) {
        const rutas = archivos.filter((a) => (a.bucket ?? buckets[0]) === bucket).map((a) => a.ruta);
        if (!rutas.length) continue;
        const { error: fallo } = await supabase.storage.from(bucket).remove(rutas);
        if (fallo) throw new Error(fallo.message);
        await cerrar(bucket, rutas);
      }
    },
  };
}
