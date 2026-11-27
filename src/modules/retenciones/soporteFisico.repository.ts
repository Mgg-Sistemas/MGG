/* ============================================================
   Golden Touch · Retenciones · Soporte Físico de Facturas (Cola Por Hacer)
   Permite al usuario de retenciones indicar mediante un check si
   tiene en mano el soporte físico de una factura y registrar quién
   se la entregó (persona, chofer, usuario o externo).
   Se persiste en config (key = 'retenciones.parametros') bajo
   soportes_fisicos para sincronización multiusuario sin requerir
   migraciones DDL de base de datos.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';

const CLAVE_CONFIG = 'retenciones.parametros';

export type TipoSoporteFisico = 'original' | 'copia';

export interface RegistroSoporteFisico {
  recibido: boolean;
  tipo?: TipoSoporteFisico | null;
  entregadoPor?: string;
  recibidoEn?: string;
  recibidoPor?: string | null;
  actualizadoEn?: string;
}

export type SoportesFisicosMap = Record<string, RegistroSoporteFisico>;

/**
 * Lee el mapa de soportes físicos guardados desde config.
 */
export async function cargarSoportesFisicos(): Promise<SoportesFisicosMap> {
  const { data, error } = await supabase
    .from('config')
    .select('value')
    .eq('key', CLAVE_CONFIG)
    .maybeSingle();
  if (error || !data?.value) return {};
  const val = data.value as Record<string, unknown>;
  return (val.soportes_fisicos as SoportesFisicosMap) || {};
}

/**
 * Guarda o actualiza el registro de soporte físico para un documento de la cola.
 */
export async function guardarSoporteFisico(
  clave: string,
  registro: {
    recibido: boolean;
    tipo?: TipoSoporteFisico | null;
    entregadoPor?: string;
    usuarioEmail?: string | null;
  },
): Promise<SoportesFisicosMap> {
  const { data } = await supabase
    .from('config')
    .select('value')
    .eq('key', CLAVE_CONFIG)
    .maybeSingle();
  const value = (data?.value as Record<string, unknown>) || {};
  const previos = (value.soportes_fisicos as SoportesFisicosMap) || {};

  const previo = previos[clave] || { recibido: false };
  const entregadoTexto = registro.entregadoPor !== undefined ? registro.entregadoPor.trim() : (previo.entregadoPor || '');
  const tipoFinal = registro.tipo !== undefined
    ? registro.tipo
    : (previo.tipo ?? (registro.recibido ? 'original' : null));

  const actualizado: RegistroSoporteFisico = {
    recibido: registro.recibido,
    tipo: registro.recibido ? tipoFinal : null,
    entregadoPor: entregadoTexto,
    recibidoEn: registro.recibido
      ? (previo.recibido && previo.recibidoEn ? previo.recibidoEn : new Date().toISOString())
      : undefined,
    recibidoPor: registro.recibido
      ? (previo.recibido && previo.recibidoPor ? previo.recibidoPor : (registro.usuarioEmail || null))
      : undefined,
    actualizadoEn: new Date().toISOString(),
  };

  const nuevoMapa: SoportesFisicosMap = {
    ...previos,
    [clave]: actualizado,
  };

  const { error } = await supabase.from('config').upsert(
    {
      key: CLAVE_CONFIG,
      value: {
        ...value,
        soportes_fisicos: nuevoMapa,
      },
    },
    { onConflict: 'key' },
  );

  if (error) {
    throw new Error(`No se pudo guardar el soporte físico: ${error.message}`);
  }

  return nuevoMapa;
}

/**
 * Resuelve el soporte físico a partir de su ID principal o ID de orden asociada.
 */
export function resolverSoporteFisicoClave(
  id: string,
  ordenId?: string | null,
  mapa?: SoportesFisicosMap | null,
): RegistroSoporteFisico | undefined {
  if (!mapa) return undefined;
  if (mapa[id]) return mapa[id];
  if (ordenId) {
    if (mapa[`orden-${ordenId}`]) return mapa[`orden-${ordenId}`];
    if (mapa[ordenId]) return mapa[ordenId];
  }
  return undefined;
}
