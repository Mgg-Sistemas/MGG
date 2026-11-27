/* ============================================================
   MGG · Compras · WhatsApp al confirmar el retiro de una OC (27-11-2026)
   La OC está en «Pendiente por recibir». Cuando el analista toca
   «✓ Confirmar retiro» y elige Delivery o Carga pesada, se arma un aviso
   listo para copiar o enviar por WhatsApp. Igual formato que los demás
   mensajes de Compras: renglones `🔹 *Rótulo:* dato`, las líneas sin dato
   se omiten. El encabezado va en mayúsculas y entre `*` (negrita de
   WhatsApp), y dice DELIVERY o CARGA PESADA según la modalidad elegida;
   lo mismo dice la línea de la flota. Con entrega a domicilio no hay aviso.
   El mismo texto se puede volver a abrir desde el detalle de la OC cuando el
   retiro ya estaba confirmado (incluidas las órdenes anteriores al aviso).
   No lleva la lista de productos: dice que para verlos se revise el sistema.

   ⚠ Emojis de color por sí mismos, sin el selector U+FE0F (ver
   combustible/mensajeMovimiento.ts). Solo por botón: nunca se envía solo.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';
import { entregaDe } from './entregaModalidad';
import { etiquetaSede } from './revisionAlmacen';

type Confirmacion = Partial<Pick<Orden,
  'codigo' | 'oc_codigo' | 'entrega_modalidad' | 'retiro_confirmado_en' | 'retiro_confirmado_por'
  | 'urgente' | 'notas' | 'total' | 'moneda' | 'total_moneda' | 'almacen_destino'
  | 'sede_destino' | 'unidad_solicitante'
>>;

/** Datos que no viven en la fila de la orden y los resuelve la página. */
export interface ExtraAvisoRetiro {
  /** Dirección del proveedor, del catálogo de proveedores. */
  proveedorDireccion?: string | null;
  /** Nombre de quien pide, ya resuelto según la clase de la orden. */
  solicita?: string | null;
  /** Nombre del analista que lleva la orden. */
  analista?: string | null;
}

const SEPARADOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━';
const PIE = '🏢 *GOLDEN TOUCH 1127 C.A.* · Delivery';

/** `27/11/2026, 10:41 a. m.` (hora de Venezuela, como el ejemplo aprobado). */
function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** `$5.423,60` (o `Bs 5.423,60`). El símbolo va pegado al monto. */
function monto(n: number | null | undefined, moneda: string | null | undefined): string {
  const v = (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(moneda ?? '').trim().toUpperCase() === 'BS' ? `Bs ${v}` : `$${v}`;
}

/** Texto del aviso, o null si la orden no va a Delivery ni a Carga pesada. */
export function mensajeConfirmarRetiro(
  o: Confirmacion,
  proveedorNombre?: string | null,
  confirmadoPor?: string | null,
  extra?: ExtraAvisoRetiro,
): string | null {
  const modalidad = entregaDe(o);
  if (modalidad !== 'delivery' && modalidad !== 'carga_pesada') return null;
  if (!o.retiro_confirmado_en) return null;

  const cargaPesada = modalidad === 'carga_pesada';
  const L: string[] = [
    `*CONFIRMAR RETIRO POR SISTEMAS - ${cargaPesada ? 'CARGA PESADA' : 'DELIVERY'}*`,
    SEPARADOR,
    '',
    `🔹 *ORDEN:* ${o.oc_codigo ?? o.codigo ?? '—'}`,
  ];
  const proveedor = (proveedorNombre ?? '').trim();
  if (proveedor) L.push(`🏭 *Proveedor:* ${proveedor}`);
  const direccion = (extra?.proveedorDireccion ?? '').trim();
  if (direccion) L.push(`📍 *Dirección:* ${direccion}`);
  L.push(o.urgente ? '🚨 *Requerimiento:* URGENTE' : '🟢 *Requerimiento:* Normal');
  L.push(`🚚 *Entrega:* ${cargaPesada ? 'Carga pesada' : 'Delivery'}`);
  L.push(cargaPesada ? '🚛 *CARGA PESADA*' : '🛵 *DELIVERY*');
  const solicita = [(extra?.solicita ?? '').trim(), (o.unidad_solicitante ?? '').trim()].filter(Boolean).join(' · ');
  if (solicita) L.push(`👤 *Solicita:* ${solicita}`);
  const analista = (extra?.analista ?? '').trim();
  if (analista) L.push(`🛒 *Analista encargado:* ${analista}`);
  const almacen = (o.almacen_destino ?? '').trim();
  if (almacen) L.push(`🏬 *Entregar en:* ${almacen}`);
  const sede = (o.sede_destino ?? '').trim();
  // «General» es Los Pinos en el sistema (ver almacenVisible en delivery.ts).
  const recepcion = sede ? `Almacén ${etiquetaSede(sede)}`
    : almacen.toLowerCase() === 'general' ? 'Almacén Los Pinos' : '';
  if (recepcion) L.push(`📍 *Dirección de recepción:* ${recepcion}`);
  const nota = (o.notas ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
  if (nota) L.push(`📌 *Nota:* ${nota}`);
  if (o.total != null) L.push(`💵 *Total:* ${monto(o.total, o.moneda ?? o.total_moneda)}`);
  L.push('', '📦 *Productos:* NO se muestran aquí · para verlos, *revise el sistema*.', '', SEPARADOR);
  const quien = (confirmadoPor ?? o.retiro_confirmado_por ?? '').trim();
  L.push(`✅ *Retiro confirmado:*${quien ? ` ${quien} ·` : ''} 🕒 ${fechaHora(o.retiro_confirmado_en)}`);
  L.push(PIE);
  return L.join('\n');
}
