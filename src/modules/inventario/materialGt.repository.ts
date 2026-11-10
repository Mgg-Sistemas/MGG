/* ============================================================
   MGG · Inventario · Mercancía que llega de GT por el puente (10/11/2026)
   Golden Touch envía productos de su Almacén Los Pinos (recurso 'material'
   del puente inter-sistema). Llegan aquí «por confirmar»: el almacenista
   empareja cada renglón con un producto de MGG (los códigos no coinciden
   entre sistemas: MASCARILLA 3M 8210 es EPP-012 en GT y EPP-022 aquí) o lo
   crea, y al ACEPTAR entra al Almacén Los Pinos con el costo de GT (PMP).
   Al aceptar o rechazar se avisa a GT por ACK (resultado + motivo).
   Idempotente: cada entrada lleva ref_tipo 'material_inter' + ref_id =
   transf_id, y no se repite si ya existe para ese producto.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { Producto } from '@/shared/lib/types';
import { registrarMovimiento } from './movimientos.repository';
import { createProducto, siguienteSkuGlobal } from './inventario.repository';

export const ALMACEN_DESTINO_GT = 'Los Pinos';
const TABLA = 'transferencias_material_inter';

export interface ItemMaterialGt {
  sku: string | null;
  nombre: string;
  unidad: string | null;
  categoria?: string | null;
  cantidad: number;
  costo_unitario: number | null;
  destino_producto_id?: string | null;
  destino_sku?: string | null;
  destino_nombre?: string | null;
}

export interface EntranteMaterialGt {
  id: string;
  transf_id: string;
  estado: 'por_confirmar' | 'recibida' | 'rechazada' | 'enviada' | 'error' | 'devuelta';
  empresa_origen: string | null;
  almacen_origen: string | null;
  almacen_destino: string | null;
  items: ItemMaterialGt[];
  total_usd: number | null;
  resumen: string | null;
  motivo: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
  confirmada_at: string | null;
  confirmada_por: string | null;
  rechazo_motivo: string | null;
}

/** Nombre comparable: sin tildes, mayúsculas, sin signos y con espacios simples. */
export function normNombre(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** El producto de MGG que corresponde al renglón de GT: el activo con el mismo nombre
 *  (normalizado). Los códigos NO sirven: cada sistema numera distinto. null = no hay
 *  (el almacenista elige uno o se crea al aceptar). */
export function sugerirProducto(item: Pick<ItemMaterialGt, 'nombre'>, productos: Pick<Producto, 'id' | 'nombre' | 'estado'>[]): string | null {
  const n = normNombre(item.nombre);
  if (!n) return null;
  return productos.find((p) => (!p.estado || p.estado === 'activo') && normNombre(p.nombre) === n)?.id ?? null;
}

export async function listEntrantesMaterialGt(): Promise<EntranteMaterialGt[]> {
  const { data, error } = await supabase.from(TABLA).select('*')
    .eq('direccion', 'entrante').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as EntranteMaterialGt[];
}

async function avisarGt(transfId: string, resultado: 'recibida' | 'rechazada', motivo: string | null, actorName: string | null): Promise<void> {
  try {
    await supabase.functions.invoke('transfer-enviar', {
      body: { tipo: 'ack', recurso: 'material', transf_id: transfId, resultado, motivo, actor_name: actorName },
    });
  } catch { /* best-effort: GT lo verá «por confirmar» hasta el próximo aviso */ }
}

/**
 * Acepta la mercancía. `destinos[i]` = id del producto de MGG para el renglón i, o
 * null para crearlo (con el nombre, unidad y categoría de GT) en Los Pinos.
 */
export async function aceptarMaterialGt(input: {
  entrante: EntranteMaterialGt;
  destinos: Array<string | null>;
  actor: string;
  actorName: string | null;
}): Promise<void> {
  const t = input.entrante;
  // Reserva: solo una persona la acepta (si otra se adelantó, se corta aquí).
  const { data: res, error: rErr } = await supabase.from(TABLA)
    .update({ estado: 'recibida', confirmada_at: new Date().toISOString(), confirmada_por: input.actorName || input.actor })
    .eq('id', t.id).eq('estado', 'por_confirmar').select('id, items');
  if (rErr) throw rErr;
  const fila = (res ?? [])[0] as { id: string; items: ItemMaterialGt[] } | undefined;
  if (!fila) throw new Error('Esta mercancía ya la recibió o rechazó otra persona.');

  const items: ItemMaterialGt[] = (fila.items ?? []).map((i) => ({ ...i }));
  try {
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      let productoId = it.destino_producto_id ?? input.destinos[k] ?? null;
      let sku = it.destino_sku ?? null;
      let nombre = it.destino_nombre ?? null;
      if (!productoId) {
        const categoria = (it.categoria ?? '').trim() || 'GENERAL';
        const nuevo = await createProducto({
          sku: await siguienteSkuGlobal(categoria), nombre: it.nombre.trim().toUpperCase(), categoria,
          unidad: (it.unidad ?? '').trim() || 'UND', stock: 0, stock_min: 0, precio: Number(it.costo_unitario) || 0,
          almacen: ALMACEN_DESTINO_GT, estado: 'activo',
        });
        productoId = nuevo.id; sku = nuevo.sku; nombre = nuevo.nombre;
      } else if (!sku || !nombre) {
        const { data: p } = await supabase.from('productos').select('sku, nombre').eq('id', productoId).maybeSingle();
        sku = (p as { sku?: string } | null)?.sku ?? null; nombre = (p as { nombre?: string } | null)?.nombre ?? null;
      }
      // ¿Ya entró este renglón (reintento)? Entonces no se repite.
      const { data: ya } = await supabase.from('movimientos').select('id')
        .eq('ref_tipo', 'material_inter').eq('ref_id', t.transf_id).eq('producto_id', productoId).limit(1);
      if (!(ya ?? []).length) {
        const costo = it.costo_unitario != null && Number(it.costo_unitario) >= 0 ? Number(it.costo_unitario) : null;
        await registrarMovimiento({
          producto_id: productoId, tipo: 'entrada', delta: Number(it.cantidad), almacen: ALMACEN_DESTINO_GT,
          actor: input.actor, actor_name: input.actorName, ref_tipo: 'material_inter', ref_id: t.transf_id,
          ref_codigo: it.sku ?? null,
          detalle: `Recibido de Golden Touch (Almacén Los Pinos)${it.sku ? ` · código GT ${it.sku}` : ''}${t.motivo ? ` · ${t.motivo}` : ''}`,
          precio_unitario: costo,
        });
      }
      items[k] = { ...it, destino_producto_id: productoId, destino_sku: sku, destino_nombre: nombre };
      // Se guarda a cada paso: si se corta, el reintento no crea el producto dos veces.
      await supabase.from(TABLA).update({ items }).eq('id', t.id);
    }
  } catch (e) {
    // Vuelve a «por confirmar» (lo que ya entró queda marcado y no se repite).
    await supabase.from(TABLA).update({ estado: 'por_confirmar', confirmada_at: null, confirmada_por: null, items }).eq('id', t.id);
    throw e;
  }
  await avisarGt(t.transf_id, 'recibida', null, input.actorName || input.actor);
}

export async function rechazarMaterialGt(input: { entrante: EntranteMaterialGt; motivo: string; actor: string; actorName: string | null }): Promise<void> {
  const motivo = input.motivo.trim();
  if (!motivo) throw new Error('Escribe por qué se rechaza.');
  const { data, error } = await supabase.from(TABLA)
    .update({ estado: 'rechazada', rechazo_motivo: motivo, confirmada_at: new Date().toISOString(), confirmada_por: input.actorName || input.actor })
    .eq('id', input.entrante.id).eq('estado', 'por_confirmar').select('id');
  if (error) throw error;
  if (!(data ?? []).length) throw new Error('Esta mercancía ya la recibió o rechazó otra persona.');
  await avisarGt(input.entrante.transf_id, 'rechazada', motivo, input.actorName || input.actor);
}
