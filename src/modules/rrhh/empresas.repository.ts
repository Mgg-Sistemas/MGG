/* ============================================================
   MGG · RRHH · Empresas / nóminas (tabla rrhh_empresas)

   Lo que hay que preguntarle a la base SOBRE las nóminas en sí, no sobre una
   persona: cuáles existen, cuánta gente activa tiene cada una, crear o editar
   una, y pasar a alguien de una nómina a otra (RPC rrhh_transferir_empresa).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import {
  MGG, datosEmpresaLimpios, monedaPagoValida, ordenarEmpresas, registrarEmpresas,
  type DatosEmpresa, type DefinicionEmpresa, type Empresa,
} from './empresa';

const TABLA = 'rrhh_empresas';

interface FilaEmpresa {
  codigo: string; nombre: string; razon_social: string; rif: string | null;
  icono: string | null; color: string | null; orden: number | null; activa: boolean | null;
  moneda_pago?: string | null;
}

function deFila(r: FilaEmpresa): DefinicionEmpresa {
  return {
    key: r.codigo, label: r.nombre, razonSocial: r.razon_social, rif: r.rif || null,
    icono: r.icono || '🏢', color: r.color || '#ff8a00', orden: Number(r.orden) || 0, activa: r.activa !== false,
    monedaPago: monedaPagoValida(r.moneda_pago),
  };
}

/**
 * Todas las empresas (activas y deshabilitadas), ordenadas, y de paso deja el
 * registro en memoria al día para los PDF y las pantallas. Si la tabla todavía
 * no existe (el SQL no se corrió), devuelve solo MGG: el módulo no se cae.
 */
export async function listEmpresas(): Promise<DefinicionEmpresa[]> {
  const { data, error } = await supabase.from(TABLA).select('*').order('orden').order('nombre');
  if (error) {
    if (/rrhh_empresas/.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
      registrarEmpresas([MGG]);
      return [MGG];
    }
    throw error;
  }
  const lista = ordenarEmpresas(((data ?? []) as FilaEmpresa[]).map(deFila));
  registrarEmpresas(lista);
  return lista;
}

let cargaPendiente: Promise<DefinicionEmpresa[]> | null = null;
/** Carga el registro una vez por sesión (los PDF fuera de RRHH lo necesitan). */
export function asegurarEmpresas(): Promise<DefinicionEmpresa[]> {
  if (!cargaPendiente) {
    cargaPendiente = listEmpresas().catch((e) => { cargaPendiente = null; throw e; });
  }
  return cargaPendiente;
}

/** Cuánta gente ACTIVA tiene cada nómina: { MGG: 48, MTO: 11 }. */
export async function contarPersonalPorEmpresa(): Promise<Record<string, number>> {
  const filas = await todasLasFilas<{ empresa: string | null }>((d, h) =>
    supabase.from('personal').select('empresa').eq('activo', true).order('id').range(d, h));
  const conteo: Record<string, number> = {};
  for (const f of filas) {
    const k = (f.empresa || MGG.key).toUpperCase();
    conteo[k] = (conteo[k] ?? 0) + 1;
  }
  return conteo;
}

export async function crearEmpresa(d: DatosEmpresa, actor: string, actorName: string | null, orden = 0): Promise<void> {
  const x = datosEmpresaLimpios(d);
  const { error } = await supabase.from(TABLA).insert({
    codigo: x.codigo, nombre: x.nombre, razon_social: x.razonSocial, rif: x.rif || null,
    icono: x.icono, color: x.color, moneda_pago: x.monedaPago, orden, activa: true, actor, actor_name: actorName,
  });
  if (error) {
    if (error.code === '23505') throw new Error(`Ya existe una empresa con el código ${x.codigo}.`);
    throw error;
  }
}

export async function actualizarEmpresa(codigo: Empresa, d: DatosEmpresa, actor: string, actorName: string | null): Promise<void> {
  const x = datosEmpresaLimpios(d);
  const { data, error } = await supabase.from(TABLA).update({
    nombre: x.nombre, razon_social: x.razonSocial, rif: x.rif || null, icono: x.icono, color: x.color, moneda_pago: x.monedaPago,
    actor, actor_name: actorName,
  }).eq('codigo', codigo).select('codigo');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo guardar: sin permiso o la empresa ya no existe.');
}

export async function cambiarEstadoEmpresa(codigo: Empresa, activa: boolean, actor: string, actorName: string | null): Promise<void> {
  const { data, error } = await supabase.from(TABLA).update({ activa, actor, actor_name: actorName }).eq('codigo', codigo).select('codigo');
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo cambiar: sin permiso o la empresa ya no existe.');
}

/**
 * Pasa a una persona a otra nómina. En la base (una sola transacción) se mueve
 * la ficha, sus anticipos activos y sus eventos, y queda una nota en el
 * expediente. Los recibos ya cargados o pagados se quedan en la nómina vieja.
 */
export async function transferirPersonal(personalId: string, empresa: Empresa, motivo: string, actor: string, actorName: string | null): Promise<void> {
  const { error } = await supabase.rpc('rrhh_transferir_empresa', {
    p_personal: personalId, p_empresa: empresa, p_motivo: motivo.trim() || null, p_actor: actor, p_actor_name: actorName,
  });
  if (error) throw new Error(error.message);
}
