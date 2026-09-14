/* ============================================================
   MGG · Salidas · reintentar un traslado sin moverlo dos veces

   Una solicitud de traslado se ejecuta por tandas de 8 productos. Si
   una tanda falla a mitad, las anteriores ya movieron stock y la
   solicitud queda «aprobada», no «ejecutada». Reintentarla volvía a
   mover TODO: lo que ya había llegado salía por segunda vez del
   origen. Un reparto de mercado de 23 líneas (TRA-2026-0007) son tres
   tandas, y basta un corte de red en la segunda.

   Desde el 14/09/2026 las dos patas llevan la solicitud en `ref_id`,
   así que antes de ejecutar se sabe qué líneas ya se hicieron. Las
   ejecuciones anteriores a esa fecha no lo traen y se comportan como
   siempre.
   ============================================================ */
import type { ItemSolicitudSalida } from '@/shared/lib/types';

/** Una pata ya escrita de ESTA solicitud. */
export interface PataDeSolicitud {
  producto_id: string;
  almacen: string;
  delta: number;
}

export interface LineaAMedias {
  producto_id: string;
  producto_nombre: string | null;
  almacen: string;
  cantidad: number;
}

export interface PlanReintento {
  /** Lo que falta mover. */
  pendientes: ItemSolicitudSalida[];
  /** Lo que ya salió del origen y llegó al destino en un intento anterior. */
  hechas: ItemSolicitudSalida[];
  /** Salió del origen, no llegó y tampoco se devolvió: hay que mirarlo a mano. */
  aMedias: LineaAMedias[];
}

const EPS = 1e-6;

/**
 * Separa las líneas de un traslado según lo que ya dejó escrito un intento anterior.
 *
 * Una línea está HECHA si del origen salió su cantidad (neto de reversos) y al
 * destino llegó esa cantidad. Si salió y no llegó, está A MEDIAS: reintentarla
 * sacaría el material del origen por segunda vez, y darla por hecha la daría por
 * entregada sin haber llegado. Ninguna de las dos cosas se puede decidir sola.
 */
export function planReintentoTraslado(
  lineas: ItemSolicitudSalida[],
  patas: PataDeSolicitud[],
  destino: string,
  origenPorDefecto?: string | null,
): PlanReintento {
  const clave = (producto: string, almacen: string) => `${producto}|${almacen}`;
  // Lo que salió de cada origen y no volvió: el reverso suma en el mismo almacén.
  const salio = new Map<string, number>();
  // Lo que entró al destino, por producto.
  const llego = new Map<string, number>();
  for (const p of patas) {
    const d = Number(p.delta) || 0;
    if (p.almacen === destino) {
      if (d > 0) llego.set(p.producto_id, (llego.get(p.producto_id) ?? 0) + d);
      continue;
    }
    const k = clave(p.producto_id, p.almacen);
    salio.set(k, (salio.get(k) ?? 0) - d);
  }

  const plan: PlanReintento = { pendientes: [], hechas: [], aMedias: [] };
  for (const it of lineas) {
    const cantidad = Number(it.cantidad) || 0;
    const almacen = it.almacen ?? origenPorDefecto ?? '';
    const k = clave(it.producto_id, almacen);
    const salido = salio.get(k) ?? 0;
    if (cantidad <= 0 || salido < cantidad - EPS) {
      plan.pendientes.push(it);
      continue;
    }
    salio.set(k, salido - cantidad);
    const llegado = llego.get(it.producto_id) ?? 0;
    if (llegado >= cantidad - EPS) {
      llego.set(it.producto_id, llegado - cantidad);
      plan.hechas.push(it);
    } else {
      llego.set(it.producto_id, 0);
      plan.aMedias.push({ producto_id: it.producto_id, producto_nombre: it.producto_nombre ?? null, almacen, cantidad });
    }
  }
  return plan;
}
