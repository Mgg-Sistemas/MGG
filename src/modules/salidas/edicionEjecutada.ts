/* ============================================================
   MGG · Salidas / Traslados · edición después de ejecutar

   Una solicitud ejecutada ya movió stock. Al corregirla no se borra ni se
   repite ese movimiento: se calcula la DIFERENCIA entre lo que decía antes y
   lo que debe decir ahora. El delta es de STOCK: positivo reingresa al
   almacén; negativo vuelve a salir.
   ============================================================ */
import type { ItemSolicitudSalida, SolicitudSalida } from '@/shared/lib/types';

export interface AjusteStockEdicionEjecutada {
  producto_id: string;
  producto_nombre: string;
  almacen: string;
  /** Positivo: entra al almacén. Negativo: sale del almacén. */
  delta: number;
}

export function lineasSolicitudSalida(s: SolicitudSalida): ItemSolicitudSalida[] {
  if (s.items?.length) return s.items;
  return [{
    producto_id: s.producto_id ?? '', producto_nombre: s.producto_nombre,
    cantidad: Number(s.cantidad) || 0, precio_unit: s.precio_unit,
    unidad: null, almacen: s.almacen_origen,
  }];
}

/**
 * Solo las ejecutadas de material sin efectos por fuera del kardex. Cocina,
 * Maquinaria y cuentas por cobrar necesitan actualizar sus propios registros;
 * hasta que eso se haga, en esos casos se mantiene disponible «Editar nota».
 */
export function puedeEditarSolicitudEjecutada(s: SolicitudSalida): boolean {
  if (s.estado !== 'ejecutada' || s.tipo !== 'material') return false;
  if (s.cxc_id || s.cliente_id || s.cliente_nombre || s.equipo_mant_id) return false;
  if (lineasSolicitudSalida(s).some((it) => it.descuenta_cocina || it.traslado_cocina || it.equipo_id)) return false;
  if (s.mov_ref === 'manual_externo') return true;
  const refEsperada = s.scope === 'traslado' ? 'traslado_modulo' : 'salida_modulo';
  // Las viejas anteriores a mov_ref sí eran del módulo si conservan su mov_id.
  return s.mov_ref === refEsperada || (!s.mov_ref && !!s.mov_id);
}

/** Diferencia neta de stock entre la solicitud guardada y la corrección. */
export function ajustesStockEdicionEjecutada(
  antes: SolicitudSalida,
  nuevasLineas: ItemSolicitudSalida[],
  nuevoAlmacenDestino?: string | null,
): AjusteStockEdicionEjecutada[] {
  const totales = new Map<string, AjusteStockEdicionEjecutada>();
  const sumar = (it: ItemSolicitudSalida, almacen: string | null | undefined, signo: 1 | -1) => {
    const cantidad = Number(it.cantidad) || 0;
    const destino = (almacen ?? '').trim();
    if (!it.producto_id || !destino || cantidad <= 0) return;
    const key = `${it.producto_id}|${destino}`;
    const actual = totales.get(key) ?? {
      producto_id: it.producto_id,
      producto_nombre: it.producto_nombre || 'Material',
      almacen: destino,
      delta: 0,
    };
    actual.delta += signo * cantidad;
    totales.set(key, actual);
  };

  const viejas = lineasSolicitudSalida(antes);
  for (const it of viejas) {
    // Revertir lo que impactó la versión anterior.
    sumar(it, it.almacen ?? antes.almacen_origen, 1);
    if (antes.scope === 'traslado') sumar(it, antes.almacen_destino, -1);
  }
  for (const it of nuevasLineas) {
    // Aplicar lo que debe quedar según la versión corregida.
    sumar(it, it.almacen ?? antes.almacen_origen, -1);
    if (antes.scope === 'traslado') sumar(it, nuevoAlmacenDestino ?? antes.almacen_destino, 1);
  }

  return [...totales.values()]
    .map((a) => ({ ...a, delta: Math.round(a.delta * 1e6) / 1e6 }))
    .filter((a) => a.delta !== 0);
}
