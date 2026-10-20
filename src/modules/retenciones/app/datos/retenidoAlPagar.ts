/* ============================================================
   MGG · Retenciones v8 · Leer lo retenido al pagar y cruzarlo con el libro (C1)

   Solo lectura: OC (`ordenes.retencion_*`), compras y servicios directos
   (`ret_pago_*`) con algo retenido al pagar, y las retenciones del libro que
   apuntan a esos documentos. Es la lectura de la rama
   fix/retenciones-retenido-al-pagar, sin cambios. No toca el contrato con
   Tesorería (`retenciones.repository.ts`).
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { retenidoSinRegistrar, type RegistroDelLibro, type RetenidoAlPagar } from '../pantalla/porRealizarExtras';

type Fila = Record<string, unknown>;
const n = (v: unknown) => Number(v) || 0;
const nulo = (v: unknown) => (v == null || !Number(v) ? null : Number(v));
const txt = (v: unknown) => (v == null || v === '' ? null : String(v));

const COLS_PAGO_DIRECTO = 'id, codigo, proveedor_id, proveedor_nombre, moneda, gasto, ret_pago_monto, ret_pago_bs, ret_pago_usd, ret_pago_tasa';

async function listRetenidoAlPagar(): Promise<RetenidoAlPagar[]> {
  const [ocs, compras, servicios, provs] = await Promise.all([
    todasLasFilas<Fila>((d, h) => supabase.from('ordenes')
      .select('id, oc_codigo, codigo, proveedor_id, moneda, total, retencion_monto, retencion_bs, retencion_usd, retencion_tasa')
      .gt('retencion_monto', 0).order('id').range(d, h)),
    todasLasFilas<Fila>((d, h) => supabase.from('compras_directas').select(COLS_PAGO_DIRECTO).gt('ret_pago_monto', 0).order('id').range(d, h)),
    todasLasFilas<Fila>((d, h) => supabase.from('servicios_directos').select(COLS_PAGO_DIRECTO).gt('ret_pago_monto', 0).order('id').range(d, h)),
    todasLasFilas<Fila>((d, h) => supabase.from('proveedores').select('id, razon_social, rif').order('id').range(d, h)),
  ]);
  const pm = new Map(provs.map((p) => [String(p.id), { nombre: txt(p.razon_social), rif: txt(p.rif) }]));
  const prov = (id: unknown) => (id ? pm.get(String(id)) : undefined);

  const deOc = ocs.map((o): RetenidoAlPagar => ({
    kind: 'oc', id: String(o.id), codigo: txt(o.oc_codigo) ?? txt(o.codigo),
    proveedorId: txt(o.proveedor_id), proveedorNombre: prov(o.proveedor_id)?.nombre ?? null, proveedorRif: prov(o.proveedor_id)?.rif ?? null,
    moneda: txt(o.moneda) ?? 'USD', total: n(o.total),
    retenido: n(o.retencion_monto), retenidoBs: nulo(o.retencion_bs), retenidoUsd: nulo(o.retencion_usd), tasa: nulo(o.retencion_tasa),
  }));
  const directo = (kind: 'compra_directa' | 'servicio_directo') => (c: Fila): RetenidoAlPagar => ({
    kind, id: String(c.id), codigo: txt(c.codigo),
    proveedorId: txt(c.proveedor_id), proveedorNombre: txt(c.proveedor_nombre) ?? prov(c.proveedor_id)?.nombre ?? null, proveedorRif: prov(c.proveedor_id)?.rif ?? null,
    moneda: txt(c.moneda) ?? 'Bs', total: n(c.gasto),
    retenido: n(c.ret_pago_monto), retenidoBs: nulo(c.ret_pago_bs), retenidoUsd: nulo(c.ret_pago_usd), tasa: nulo(c.ret_pago_tasa),
  });
  return [...deOc, ...compras.map(directo('compra_directa')), ...servicios.map(directo('servicio_directo'))];
}

async function listRegistrosDeDocumentos(): Promise<RegistroDelLibro[]> {
  const filas = await todasLasFilas<Fila>((d, h) => supabase.from('retenciones')
    .select('id, doc_kind, doc_id, direccion, anulada')
    .in('doc_kind', ['oc', 'compra_directa', 'servicio_directo']).not('doc_id', 'is', null)
    .order('id').range(d, h));
  return filas.map((r) => ({ docKind: String(r.doc_kind), docId: txt(r.doc_id), direccion: String(r.direccion ?? 'recibida'), anulada: !!r.anulada }));
}

/** Lo retenido al pagar que todavía no está en el libro. */
export async function listRetenidoSinRegistrar(): Promise<RetenidoAlPagar[]> {
  const [docs, libro] = await Promise.all([listRetenidoAlPagar(), listRegistrosDeDocumentos()]);
  return retenidoSinRegistrar(docs, libro);
}
