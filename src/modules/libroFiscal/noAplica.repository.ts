/* ============================================================
   Golden Touch · Retenciones · «No aplica» por impuesto (D48)

   Marcar que a un impuesto de una compra no le corresponde retención NO es
   una retención en 0: no gasta número de comprobante ni pide N° de factura.
   Es una decisión «no_aplica» (R7) sobre el documento fiscal de la compra;
   si la compra aún no tiene documento, se registra solo el documento (R10,
   solo_documento) y sobre él la decisión. Sin R10, no se ofrece.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { tablaDisponible } from './disponibilidad';
import { errorRetencion } from './erroresRetencion';
import { pFacturaDe } from './retencionFacturas.repository';
import { tipoDeGt } from './retencionesFiscal.repository';
import type { TipoImpuesto } from './retencionesCalculo';

const V_POR_ORIGEN = 'retencion_documentos_por_origen';

/** R10 aplicado: factura sola y buscador (la vista de resumen solo existe desde R10). */
export const noAplicaDisponible = () => tablaDisponible('retencion_facturas_resumen');

/** Los impuestos marcados «no aplica», por id de la orden: se suman a lo ya cargado en «Por realizar». */
export async function noAplicaPorOrden(ordenIds: string[]): Promise<Map<string, Set<TipoImpuesto>>> {
  const out = new Map<string, Set<TipoImpuesto>>();
  if (!ordenIds.length || !(await noAplicaDisponible())) return out;
  const { data, error } = await supabase.from(V_POR_ORIGEN).select('origen_id, decisiones').eq('origen_tipo', 'oc').in('origen_id', ordenIds);
  if (error) throw errorRetencion(error, 'No se pudieron leer las decisiones de «no aplica».');
  for (const r of (data ?? []) as { origen_id: string; decisiones: Record<string, string> | null }[]) {
    for (const [clave, decision] of Object.entries(r.decisiones ?? {})) {
      if (decision !== 'no_aplica') continue;
      const s = out.get(r.origen_id) ?? new Set<TipoImpuesto>();
      s.add(tipoDeGt(clave));
      out.set(r.origen_id, s);
    }
  }
  return out;
}

/**
 * Los impuestos que la empresa practica a esa fecha, según su Régimen (R1, vía R10).
 * Sin R10 devuelve null: la pantalla sigue mostrando todos, como antes.
 */
export async function impuestosQuePractica(claves: string[], fecha: string): Promise<Set<string> | null> {
  if (!(await noAplicaDisponible())) return null;
  const res = await Promise.all(claves.map(async (c) => {
    const { data, error } = await supabase.rpc('retencion_empresa_practica', { p_impuesto: c, p_fecha: fecha });
    if (error) throw errorRetencion(error, 'No se pudo leer el régimen de la empresa.');
    return data === true ? c : null;
  }));
  return new Set(res.filter((c): c is string => !!c));
}

export interface NoAplicaNuevo {
  ordenId: string;
  proveedorId: string | null;
  proveedorNombre: string | null;
  moneda: string;
  total: number | null;
  /** Clave del impuesto en la base: IVA, ISLR, MUNICIPAL… */
  impuestoClave: string;
  /** Un motivo de la lista (Parámetros › Motivos) o, si no hay, el texto escrito. */
  motivoId: string | null;
  motivoTexto: string | null;
  detalle: string | null;
  actor: string;
  actorName?: string | null;
}

/** El documento fiscal practicado de la orden, si ya existe. */
async function documentoDeOrden(ordenId: string): Promise<string | null> {
  if (!(await tablaDisponible(V_POR_ORIGEN))) return null;
  const { data, error } = await supabase.from(V_POR_ORIGEN).select('documento_id')
    .eq('origen_tipo', 'oc').eq('origen_id', ordenId).eq('rol', 'practicada').limit(1);
  if (error) throw errorRetencion(error, 'No se pudo leer el documento de la compra.');
  return (data?.[0] as { documento_id?: string } | undefined)?.documento_id ?? null;
}

/** Marca «no aplica» un impuesto de una orden. Devuelve el id del documento. */
export async function marcarNoAplica(n: NoAplicaNuevo): Promise<string> {
  if (!n.motivoId && !n.motivoTexto?.trim()) throw new Error('Indica el motivo: por qué no corresponde retener.');
  if (!(await tablaDisponible('retencion_decisiones'))) {
    throw new Error('La función de registrar decisiones «no aplica» requiere la tabla retencion_decisiones.');
  }
  let documentoId = await documentoDeOrden(n.ordenId);
  if (!documentoId) {
    // Sin factura registrada: se registra solo el documento (sin número de comprobante ni N° de factura).
    const { data, error } = await supabase.rpc('retencion_factura_registrar', {
      p_factura: {
        ...pFacturaDe({
          direccion: 'practicada', docKind: 'oc', docId: n.ordenId,
          contraparteId: n.proveedorId, contraparteNombre: n.proveedorNombre,
          moneda: n.moneda, facturaTotal: n.total, actor: n.actor, actorName: n.actorName,
        }),
        solo_documento: true,
      },
      p_lineas: [],
    });
    if (error) throw errorRetencion(error, 'No se pudo registrar el documento de la compra.');
    documentoId = String((data as { factura?: { id?: string } } | null)?.factura?.id ?? '') || null;
    if (!documentoId) throw new Error('La base no devolvió el documento registrado.');
  }
  const { error } = await supabase.from('retencion_decisiones').insert({
    documento_id: documentoId, impuesto_clave: n.impuestoClave, decision: 'no_aplica',
    motivo_id: n.motivoId, motivo_texto: n.motivoId ? null : n.motivoTexto?.trim() || null,
    detalle: n.detalle?.trim() || null, actualizado_por: n.actor,
  });
  if (error) {
    if (error.code === '23505') throw new Error('Ese impuesto ya tiene una decisión en esta compra.');
    throw errorRetencion(error, 'No se pudo guardar el «no aplica».');
  }
  return documentoId;
}
