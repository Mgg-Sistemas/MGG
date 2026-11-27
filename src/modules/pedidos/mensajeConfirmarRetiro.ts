/* ============================================================
   MGG · Compras · WhatsApp al confirmar el retiro de una OC (27-11-2026)
   La OC está en «Pendiente por recibir». Cuando el analista toca
   «✓ Confirmar retiro» y elige Delivery o Carga pesada, se arma un aviso
   listo para copiar o enviar por WhatsApp. Igual formato que los demás
   mensajes de Compras: renglones `🔹 *Rótulo:* dato`, las líneas sin dato
   se omiten y el pie de la empresa. El encabezado va en mayúsculas y
   entre `*` (negrita de WhatsApp) para que se vea grande; WhatsApp no
   tiene tamaño de letra. Con entrega a domicilio no hay aviso a la flota.
   El mismo texto se puede volver a abrir desde el detalle de la OC cuando el
   retiro ya estaba confirmado (incluidas las órdenes anteriores al aviso).
   No lleva la lista de productos: dice que para verlos se revise el sistema.

   ⚠ Emojis de color por sí mismos, sin el selector U+FE0F (ver
   combustible/mensajeMovimiento.ts). Solo por botón: nunca se envía solo.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';
import { dateTime } from '@/shared/lib/format';
import { entregaDe } from './entregaModalidad';

type Confirmacion = Pick<Orden, 'codigo' | 'oc_codigo' | 'entrega_modalidad' | 'retiro_confirmado_en' | 'retiro_confirmado_por'>;

/** Texto del aviso, o null si la orden no va a Delivery ni a Carga pesada. */
export function mensajeConfirmarRetiro(
  o: Confirmacion,
  proveedorNombre?: string | null,
  confirmadoPor?: string | null,
): string | null {
  const modalidad = entregaDe(o);
  if (modalidad !== 'delivery' && modalidad !== 'carga_pesada') return null;
  if (!o.retiro_confirmado_en) return null;

  const cargaPesada = modalidad === 'carga_pesada';
  const L: string[] = [
    `*CONFIRMAR RETIRO POR SISTEMAS - ${cargaPesada ? 'CARGA PESADA' : 'DELIVERY'}*`,
    '',
    `🔹 *Orden:* ${o.oc_codigo ?? o.codigo}`,
    '📦 *Productos:* Para ver los productos, revise el sistema.',
  ];
  const proveedor = (proveedorNombre ?? '').trim();
  if (proveedor) L.push(`🏭 *Proveedor:* ${proveedor}`);
  L.push(`🚚 *Entrega:* ${cargaPesada ? 'Carga pesada' : 'Delivery'}`);
  const quien = (confirmadoPor ?? o.retiro_confirmado_por ?? '').trim();
  if (quien) L.push(`👤 *Confirmó:* ${quien}`);
  L.push(`🕒 *Fecha:* ${dateTime(o.retiro_confirmado_en)}`);
  L.push('', '🏢 *MINERAL GROUP GUAYANA C.A.*');
  return L.join('\n');
}
