/* ============================================================
   MGG · Retenciones v8 · Leer y guardar el perfil fiscal del proveedor

   Con los nombres de BD (14:23): la vista retencion_perfil_proveedor_v (v2.2
   05 y v8p-05), retencion_proveedor_actividades (v8p-04),
   retencion_licencia_tipos y retencion_proveedor_licencias (v8p-03),
   retencion_licencia_historial y la función retencion_proveedor_licencia
   (v2.2 05). Nada de esto existe hoy en producción: la puerta lo ofrece
   detrás de capacidades.perfilProveedor, que sigue en false hasta que la
   base lo tenga.
   Guardar son varios pasos (perfil, actividades, licencia, número). Si uno
   falla, se detiene ahí y se avisa; lo anterior queda guardado.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import type { ActividadProveedor, TipoLicencia } from '../perfil/actividadesLicencia';
import { actividadDeFila, cambioDeFila, perfilDeFila, planActividades, tipoDeFila, type LicenciaProveedor } from '../perfil/perfilDatos';
import { filaPerfil, type BorradorPerfil, type CambioLicencia, type PerfilProveedor } from '../perfil/perfilProveedor';
import { fechaHoraRelacion } from '../impresion/numeros';

type Fila = Record<string, unknown>;

export interface DatosPerfil {
  perfil: PerfilProveedor | null;
  licencia: LicenciaProveedor | null;
  actividades: ActividadProveedor[];
  historial: CambioLicencia[];
}

export interface CambiosPerfil {
  borrador: BorradorPerfil;
  actividadesAntes: ActividadProveedor[];
  actividades: ActividadProveedor[];
  licenciaAntes: LicenciaProveedor | null;
  licencia: LicenciaProveedor;
  /** El número de licencia que se leyó al abrir (control de cambios de retencion_proveedor_licencia). */
  numeroLeido: string | null;
}

const falla = (paso: string, e: { message: string } | null) => {
  if (e) throw new Error(`No se pudo guardar ${paso}: ${e.message}`);
};

export async function leerPerfilProveedor(proveedorId: string): Promise<DatosPerfil> {
  const [p, a, h] = await Promise.all([
    supabase.from('retencion_perfil_proveedor_v').select('*').eq('proveedor_id', proveedorId).maybeSingle(),
    supabase.from('retencion_proveedor_actividades').select('id, actividad_codigo, principal, desde, hasta')
      .eq('proveedor_id', proveedorId).eq('activo', true).order('created_at'),
    supabase.from('retencion_licencia_historial').select('antes, despues, origen, actor, actor_name, created_at')
      .eq('proveedor_id', proveedorId).order('created_at', { ascending: false }).limit(20),
  ]);
  for (const r of [p, a, h]) if (r.error) throw new Error(r.error.message);
  const fila = p.data ? perfilDeFila(p.data as Fila) : null;
  return {
    perfil: fila?.perfil ?? null,
    licencia: fila?.licencia ?? null,
    actividades: ((a.data ?? []) as Fila[]).map(actividadDeFila),
    historial: ((h.data ?? []) as Fila[]).map((x) => cambioDeFila(x, (iso) => fechaHoraRelacion(new Date(iso)))),
  };
}

export async function listTiposLicencia(): Promise<TipoLicencia[]> {
  const { data, error } = await supabase.from('retencion_licencia_tipos').select('id, nombre, activo, vigencia_meses').order('orden').order('nombre');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Fila[]).map(tipoDeFila);
}

export async function guardarPerfilProveedor(proveedorId: string, c: CambiosPerfil): Promise<void> {
  // 1. El perfil (sin la actividad: la pone la base desde la principal)
  falla('el perfil', (await supabase.from('retencion_perfil_proveedor').upsert(filaPerfil(proveedorId, c.borrador), { onConflict: 'proveedor_id' })).error);

  // 2. Las actividades: sin DELETE; la cerrada que vuelve a entrar se desactiva antes
  const plan = planActividades(c.actividadesAntes, c.actividades);
  for (const id of plan.desactivar) {
    falla('las actividades', (await supabase.from('retencion_proveedor_actividades').update({ activo: false }).eq('id', id)).error);
  }
  for (const x of plan.actualizar) {
    falla('las actividades', (await supabase.from('retencion_proveedor_actividades').update({ principal: x.principal, hasta: x.hasta }).eq('id', x.id)).error);
  }
  if (plan.insertar.length) {
    falla('las actividades', (await supabase.from('retencion_proveedor_actividades').insert(plan.insertar.map((x) => ({ ...x, proveedor_id: proveedorId })))).error);
  }

  // 3. Tipo, emisión y vigencia de la licencia (cada cambio deja su línea en el historial)
  const l = c.licencia, a = c.licenciaAntes;
  if (!a || a.tipoId !== l.tipoId || a.emision !== l.emision || a.vence !== l.vence) {
    falla('la licencia', (await supabase.from('retencion_proveedor_licencias')
      .upsert({ proveedor_id: proveedorId, tipo_id: l.tipoId, emision: l.emision, vence: l.vence }, { onConflict: 'proveedor_id' })).error);
  }

  // 4. El número de la licencia: en la ficha del proveedor, por su función (con control de cambios)
  const numero = c.borrador.licenciaActividad.trim();
  if (numero && numero !== (c.numeroLeido ?? '')) {
    falla('el número de licencia', (await supabase.rpc('retencion_proveedor_licencia', { p_proveedor: proveedorId, p_numero: numero, p_numero_leido: c.numeroLeido })).error);
  }
}
