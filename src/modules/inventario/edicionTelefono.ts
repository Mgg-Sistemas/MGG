import type { Producto, SolicitudSalida } from '@/shared/lib/types';
import { ajustesStockEdicionEjecutada, type AjusteStockEdicionEjecutada } from '@/modules/salidas/edicionEjecutada';
import type { SalidaTelefono } from './inventarioTelefono';
import type { TrasladoTelefono } from './historicosTelefono';

export interface LineaEdicionTelefono {
  producto: Producto;
  cantidad: number;
}

function solAjustes(
  scope: 'salida' | 'traslado',
  almacenOrigen: string,
  almacenDestino: string | null,
  lineas: LineaEdicionTelefono[],
): SolicitudSalida {
  return {
    id: 'edicion-telefono', codigo: 'EDICION', scope, tipo: 'material', estado: 'ejecutada',
    solicitante: '', historial: [], created_at: '', almacen_origen: almacenOrigen, almacen_destino: almacenDestino,
    items: lineas.map((l) => ({
      producto_id: l.producto.id, producto_nombre: l.producto.nombre, cantidad: l.cantidad,
      precio_unit: null, unidad: l.producto.unidad ?? null, almacen: almacenOrigen,
    })),
  };
}

export function validarEdicionSalidaTelefono(
  anteriores: SalidaTelefono[],
  nuevas: LineaEdicionTelefono[],
  retorna: boolean,
): string | null {
  if (anteriores.length !== nuevas.length || !nuevas.length) return 'La edición conserva los materiales del lote; no se agregan ni se quitan.';
  for (let i = 0; i < anteriores.length; i++) {
    const vieja = anteriores[i];
    const nueva = nuevas[i];
    if (!(nueva.cantidad > 0)) return `Escribe una cantidad mayor que 0 para ${nueva.producto.nombre}.`;
    if (nueva.cantidad < vieja.retornado) return `${vieja.producto_nombre}: ya retornaron ${vieja.retornado}; la cantidad no puede quedar por debajo.`;
    if (vieja.retornado > 0 && !retorna) return `${vieja.producto_nombre}: ya tiene retornos, no se puede marcar «No retorna».`;
    if (vieja.retornado > 0 && vieja.producto_id !== nueva.producto.id) return `${vieja.producto_nombre}: no se puede cambiar el material después de un retorno.`;
  }
  return null;
}

export function validarEdicionTrasladoTelefono(
  anteriores: TrasladoTelefono[],
  nuevas: LineaEdicionTelefono[],
  origen: string,
  destino: string,
): string | null {
  if (anteriores.length !== nuevas.length || !nuevas.length) return 'La edición conserva los materiales del lote; no se agregan ni se quitan.';
  if (anteriores.some((t) => !t.codigo)) return 'Este traslado viejo no tiene N° TRA y no se puede editar desde el teléfono.';
  if (new Set(anteriores.map((t) => t.producto_id)).size !== anteriores.length) return 'Este lote repite un material y debe corregirse desde Inventario.';
  if (!destino || origen === destino) return 'El almacén origen y destino deben ser distintos.';
  for (const l of nuevas) if (!(l.cantidad > 0)) return `Escribe una cantidad mayor que 0 para ${l.producto.nombre}.`;
  return null;
}

export function ajustesSalidaTelefono(
  anteriores: SalidaTelefono[],
  nuevas: LineaEdicionTelefono[],
): AjusteStockEdicionEjecutada[] {
  const almacen = anteriores[0]?.almacen ?? '';
  const viejas = anteriores.map((s) => ({ producto: { id: s.producto_id, nombre: s.producto_nombre, unidad: s.unidad } as Producto, cantidad: s.cantidad }));
  return ajustesStockEdicionEjecutada(solAjustes('salida', almacen, null, viejas), solAjustes('salida', almacen, null, nuevas).items ?? [], null);
}

export function ajustesTrasladoTelefono(
  anteriores: TrasladoTelefono[],
  nuevas: LineaEdicionTelefono[],
  nuevoDestino: string,
): AjusteStockEdicionEjecutada[] {
  const origen = anteriores[0]?.origen ?? '';
  const destinoViejo = anteriores[0]?.destino ?? null;
  const viejas = anteriores.map((t) => ({ producto: { id: t.producto_id, nombre: t.producto_nombre, unidad: t.unidad } as Producto, cantidad: t.cantidad }));
  return ajustesStockEdicionEjecutada(solAjustes('traslado', origen, destinoViejo, viejas), solAjustes('traslado', origen, nuevoDestino, nuevas).items ?? [], nuevoDestino);
}
