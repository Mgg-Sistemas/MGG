/* ============================================================
   MGG · Control de Maquinaria · Sincronización desde Compras
   Cuando el analista de compras en Pedidos edita y pone el nombre
   real/comercial a un repuesto solicitado desde Maquinaria:
   1. Se actualiza la orden de servicio vinculada con el nombre real.
   2. Se guarda/sincroniza en la ficha del equipo (maquinaria_repuestos_equipo)
      para que quede disponible permanentemente para el próximo servicio.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { norm } from '@/shared/lib/texto';
import type { ItemOrden } from '@/shared/lib/types';
import type { RepuestoOrden } from './flota';

/** Deduce el sistema del repuesto a partir de palabras clave en el nombre comercial. */
export function deducirSistemaRepuesto(nombre: string): string {
  const t = norm(nombre);
  if (/filtro.*aire|filtro.*cabina|\baire\b/.test(t)) return 'aire';
  if (/filtro.*combust|combust|inyector|bomba.*gasoil|separador.*agua|cebador/.test(t)) return 'combustible';
  if (/filtro.*aceite|aceite.*motor|\bmotor\b|bujia|empacadura|piston|biela|valvula/.test(t)) return 'motor';
  if (/filtro.*hidraul|hidraul|gato|cilindro|manguera|bomba.*hidraul/.test(t)) return 'hidraulico';
  if (/freno|pastilla|banda|disco.*freno|caliper|liga.*freno/.test(t)) return 'frenos';
  if (/bateria|alternador|arranque|electric|fusible|rele|bombillo|faro/.test(t)) return 'electrico';
  if (/correa|banda.*tiempo|tensor/.test(t)) return 'correas';
  if (/refriger|radiador|termostat|tapa.*radiador|manguera.*radiador/.test(t)) return 'refrigeracion';
  if (/caucho|neumatic|tripa|llanta|rin\b/.test(t)) return 'cauchos';
  if (/caja|transmis|diferencial|corona|grasa|cruceta|cardan/.test(t)) return 'transmision';
  if (/parabrisa|plumilla|vidrio|espejo|asiento|cabina/.test(t)) return 'cabina';
  return 'otros';
}

export interface SincronizarComprasInput {
  ordenId: string;
  spCodigo: string;
  items: ItemOrden[];
  itemsAnteriores?: ItemOrden[];
  actor: { email: string; nombre: string | null };
}

/**
 * Sincroniza los repuestos editados en Pedidos hacia la orden de servicio de Maquinaria
 * y hacia la ficha permanente del equipo (para el próximo servicio).
 */
export async function sincronizarRepuestosMaquinariaDesdeCompras(input: SincronizarComprasInput): Promise<void> {
  const { ordenId, spCodigo, items, itemsAnteriores = [], actor } = input;
  if (!items.length) return;

  // Mapa de nombres anteriores por SKU o índice para detectar qué cambió
  const anterioresMap = new Map<string, string>();
  itemsAnteriores.forEach((it, idx) => {
    const k = it.sku || `idx-${idx}`;
    anterioresMap.set(k, it.nombre);
  });

  // 1. Buscar si hay orden(es) de servicio de Maquinaria vinculadas a esta solicitud de pedido
  const { data: ordenesServicio } = await supabase
    .from('maquinaria_ordenes_servicio')
    .select('id, codigo, equipo_id, repuestos')
    .eq('orden_compra_id', ordenId);

  if (ordenesServicio && ordenesServicio.length > 0) {
    for (const os of ordenesServicio) {
      const repuestos = Array.isArray(os.repuestos) ? ([...os.repuestos] as RepuestoOrden[]) : [];
      let huboCambiosOS = false;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const nombreReal = (item.nombre ?? '').trim().toUpperCase();
        if (!nombreReal) continue;

        const k = item.sku || `idx-${i}`;
        const nombreAnterior = (anterioresMap.get(k) ?? '').trim().toUpperCase();

        // Buscar el repuesto en la orden de servicio
        const rep = repuestos.find((r) => {
          const rNombre = (r.nombre ?? '').trim().toUpperCase();
          const rOriginal = (r.pieza_nueva ?? '').trim().toUpperCase();
          return rNombre === nombreReal || (nombreAnterior && (rNombre === nombreAnterior || rOriginal === nombreAnterior));
        }) || (repuestos.length === 1 ? repuestos[0] : null);

        if (rep && (rep.nombre !== nombreReal || (item.productoId && rep.producto_id !== item.productoId))) {
          rep.nombre = nombreReal;
          if (item.productoId) rep.producto_id = item.productoId;
          huboCambiosOS = true;
        }
      }

      if (huboCambiosOS) {
        await supabase
          .from('maquinaria_ordenes_servicio')
          .update({ repuestos })
          .eq('id', os.id)
          .catch(() => {});
      }
    }
  }

  // 2. Sincronizar en la ficha permanente del equipo (maquinaria_repuestos_equipo)
  // Para que el próximo servicio de la máquina ya tenga registrado el nombre real
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const equipoId = item.equipo_id;
    const nombreReal = (item.nombre ?? '').trim().toUpperCase();
    if (!equipoId || !nombreReal) continue;

    const k = item.sku || `idx-${i}`;
    const nombreAnterior = (anterioresMap.get(k) ?? '').trim().toUpperCase();

    // Ver si ya existe este repuesto en la ficha del equipo
    const { data: existentes } = await supabase
      .from('maquinaria_repuestos_equipo')
      .select('id, tipo, producto_id')
      .eq('equipo_id', equipoId);

    const normReal = norm(nombreReal);
    const normAnt = norm(nombreAnterior);

    const coincidente = (existentes ?? []).find((e) => {
      const eNorm = norm(e.tipo);
      return eNorm === normReal || (normAnt && eNorm === normAnt);
    });

    if (coincidente) {
      // Actualizar con el nombre real y el producto_id si aplica
      await supabase
        .from('maquinaria_repuestos_equipo')
        .update({
          tipo: nombreReal,
          producto_id: item.productoId ?? coincidente.producto_id,
          cantidad: Math.max(1, Number(item.cantidad) || 1),
          unidad: item.unidad?.trim() || 'und',
          nota: `Sincronizado desde compra ${spCodigo}`,
          actor: actor.email,
          actor_name: actor.nombre,
          updated_at: new Date().toISOString(),
        })
        .eq('id', coincidente.id)
        .catch(() => {});
    } else {
      // Registrar nuevo repuesto permanente en la ficha del equipo
      const sistema = deducirSistemaRepuesto(nombreReal);
      await supabase
        .from('maquinaria_repuestos_equipo')
        .insert({
          equipo_id: equipoId,
          sistema,
          tipo: nombreReal,
          cantidad: Math.max(1, Number(item.cantidad) || 1),
          unidad: item.unidad?.trim() || 'und',
          producto_id: item.productoId ?? null,
          nota: `Sincronizado desde compra ${spCodigo}`,
          actor: actor.email,
          actor_name: actor.nombre,
        })
        .catch(() => {});
    }
  }
}
