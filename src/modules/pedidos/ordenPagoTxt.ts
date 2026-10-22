/* ============================================================
   MGG · Compras · Mensaje de WhatsApp de una orden para pagar
   Antes era un .txt que se bajaba y se pegaba a mano; desde el 20-10-2026
   sale directo por WhatsApp, como los movimientos de Combustible (el botón
   «💬 WhatsApp para pagar» del detalle). Formato corto: los `*` de los
   rótulos son las negritas de WhatsApp. Lleva lo justo para emitir
   el pago —qué orden, a quién, por qué, cuánto y cómo— sin el
   listado de renglones: quien paga no lo necesita.

   ⚠ TODOS los emojis son de COLOR POR SÍ MISMOS, sin el selector U+FE0F:
   WhatsApp normaliza el texto del enlace y se lleva ese selector puesto, y
   del otro lado llega un cuadrito (ver combustible/mensajeMovimiento.ts).
   Por eso la nota lleva 📌 y no 🗒️. La prueba lo verifica.
   Solo por botón: nunca se envía solo.
   ============================================================ */
import type { Orden, PagoMetodo } from '@/shared/lib/types';
import { labelMetodoPago } from './pedidos.repository';
import { BANCOS_VE } from '@/shared/lib/bancos';
import { labelCondicionPago } from './ofertas.repository';
// El enlace y el «compartir» son los MISMOS de Combustible/Alimentación: una sola implementación
// del «no wa.me» y de la hoja de compartir del teléfono.
export { enlaceWhatsapp, puedeCompartir, compartirMovimiento } from '@/modules/combustible/mensajeMovimiento';

/** `$79,00` · `Bs 4.500,00`. El símbolo va pegado; «Bs» necesita el espacio. */
export function montoTxt(n: number | null | undefined, moneda = '$'): string {
  const m = (moneda || '$').trim();
  const v = (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return m === '$' ? `$${v}` : `${m} ${v}`;
}

/** `Banco de Venezuela (0102)`: el nombre adelante, que es lo que se busca en la app del banco. */
export function bancoTxt(codigo: string | null | undefined): string {
  const c = (codigo ?? '').trim();
  if (!c) return '';
  const b = BANCOS_VE.find((x) => x.codigo === c);
  return b ? `${b.nombre} (${b.codigo})` : c;
}

/** El porqué de la compra: motivo y finalidad son campos distintos de la OP y
 *  no siempre están los dos; si dicen lo mismo no se repite. Todo en un renglón. */
export function detalleTxt(orden: Pick<Orden, 'motivo' | 'finalidad'>): string {
  const motivo = (orden.motivo ?? '').trim();
  const finalidad = (orden.finalidad ?? '').trim();
  return [motivo, finalidad === motivo ? '' : finalidad]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Los datos del beneficiario, uno por renglón: el archivo se lee para TIPEAR el pago. */
function datosPago(metodo: string, d: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const add = (k: string, v?: string | null) => { if (v && String(v).trim()) out.push(`* ${k}: ${String(v).trim()}`); };
  if (metodo === 'pago_movil') {
    add('Banco', bancoTxt(d.banco)); add('CI/RIF', d.ci_rif); add('Tlf', d.telefono);
  } else if (metodo === 'transferencia') {
    add('Titular', d.nombre); add('CI/RIF', d.ci); add('Banco', bancoTxt(d.banco)); add('Cuenta', d.cuenta);
  } else if (metodo === 'zelle') {
    add('Titular', d.nombre); add('Correo', d.email);
  } else if (metodo === 'binance_usdt') {
    add('Correo/ID', d.email_o_id);
  }
  return out;
}

function bloquePago(patas: PagoMetodo[] | null | undefined, total: number, monedaOrden: string): string[] {
  const list = patas ?? [];
  if (!list.length) return ['💳 *Pago:* (todavía sin método de pago indicado)'];
  const out: string[] = [];
  list.forEach((m) => {
    const moneda = (m.moneda || '$').trim();
    const importeNum = Number(m.monto) || 0;
    // El monto de la pata se muestra solo cuando aporta algo. No se muestra si:
    //  · está en CERO, porque el monto lo define Tesorería recién al pagar y un
    //    «Bs 0,00» en el papel se lee como si el pago fuera por nada;
    //  · o si es la única pata y repite el total, que ya se leyó arriba.
    const repiteElTotal = list.length === 1 && moneda === monedaOrden && importeNum === (Number(total) || 0);
    const importe = importeNum === 0 || repiteElTotal ? '' : ` ${montoTxt(m.monto, moneda)}`;
    out.push(`💳 *${labelMetodoPago(m.metodo)}:*${importe}`);
    out.push(...datosPago(m.metodo, (m.datos ?? {}) as Record<string, string>));
  });
  return out;
}

/**
 * Lo que resta pagar de una orden a crédito: total menos abonos, nunca negativo
 * (un abono de más es un tema de Tesorería, no algo que este papel deba mostrar
 * como un número en rojo).
 */
export function saldoPendiente(orden: Pick<Orden, 'total' | 'abonado_total'>): number {
  const resto = (Number(orden.total) || 0) - (Number(orden.abonado_total) || 0);
  return resto > 0 ? Math.round(resto * 100) / 100 : 0;
}

/**
 * Determina si la orden corresponde a una cuenta a crédito (abonos abiertos).
 * En estas órdenes no se muestra método de pago: se pagan mediante abonos en Tesorería.
 */
export function esCuentaCredito(orden: Partial<Pick<Orden, 'condiciones_pago' | 'estado' | 'abonado_total'>>): boolean {
  return orden.condiciones_pago === 'credito'
    || orden.estado === 'cuenta_abierta'
    || (Number(orden.abonado_total) || 0) > 0;
}

/**
 * Las personas de la orden, ya con su nombre (la página los saca del mapa de usuarios).
 * Quien paga —y quien aprueba— quiere saber a quién preguntarle: quién pidió, quién la
 * autorizó (el Gerente General o la Jefa de Administración) y qué analista de compras la llevó.
 * Lo que falte no sale: no se escribe un «—» donde no hay nadie.
 */
export interface PersonasOrden {
  solicita?: string | null;
  autorizo?: string | null;
  analista?: string | null;
}

/** Los renglones de las personas, en el orden de lectura: quién pide, quién lo lleva, quién autorizó. */
function lineasPersonas(p: PersonasOrden | undefined): string[] {
  const limpio = (v: string | null | undefined) => (v ?? '').trim();
  const L: string[] = [];
  if (limpio(p?.solicita)) L.push(`🙋 *Solicita:* ${limpio(p?.solicita)}`);
  if (limpio(p?.analista)) L.push(`🛒 *Analista de compras:* ${limpio(p?.analista)}`);
  if (limpio(p?.autorizo)) L.push(`👔 *Autorizó:* ${limpio(p?.autorizo)}`);
  return L;
}

/** El texto completo. Se exporta aparte para poder probarlo sin tocar el navegador. */
export function textoOrdenPago(orden: Orden, proveedorNombre: string, personas?: PersonasOrden): string {
  const mon = (orden.moneda ?? 'USD').toUpperCase() === 'BS' ? 'Bs' : '$';
  const detalle = detalleTxt(orden);
  const nota = (orden.notas ?? '').trim();

  const L: string[] = [];
  L.push(`🔹 *ORDEN:* ${orden.oc_codigo ?? orden.codigo}`);
  L.push(`🏭 *Proveedor:* ${proveedorNombre || '—'}`);
  if (detalle) L.push(`📝 *Detalle:* ${detalle}`);
  if (nota) L.push(`📌 *Nota:* ${nota.replace(/\s*\r?\n\s*/g, ' ')}`);
  L.push(...lineasPersonas(personas));
  L.push(`💵 *Total:* ${montoTxt(orden.total, mon)}`);
  // En una cuenta abierta lo que se va a pagar hoy NO es el total: es el saldo.
  // Mandar solo el total invita a pagar de más, así que el abonado y lo que
  // resta van en su propio renglón. En una orden sin abonos no aparecen.
  const abonado = Number(orden.abonado_total) || 0;
  if (abonado > 0) {
    L.push(`✅ *Abonado:* ${montoTxt(abonado, mon)}`);
    L.push(`🔺 *Saldo pendiente:* ${montoTxt(saldoPendiente(orden), mon)}`);
  }
  // En cuentas a crédito no se muestra método de pago (se paga por abonos en Tesorería;
  // no lleva método fijo ni se muestra «todavía sin método de pago indicado»).
  if (!esCuentaCredito(orden)) {
    L.push(...bloquePago(orden.metodo_pago, Number(orden.total) || 0, mon));
  }
  return L.join('\n'); // saltos simples: WhatsApp los respeta
}

/**
 * El mensaje para pedirle la aprobación al Gerente General (20-10-2026): la OC está en
 * «Pendiente por aprobación» y él decide viendo lo esencial —qué es, quién la pide y la lleva,
 * cuántos productos, qué condición y cuánto—. No lleva método de pago (todavía no se indica) ni
 * «Autorizó» (todavía no hay quien). Mismas reglas de emojis que el de pagar: sin selector U+FE0F.
 */
export function textoOrdenAprobacion(orden: Orden, proveedorNombre: string, personas?: PersonasOrden): string {
  const mon = (orden.moneda ?? 'USD').toUpperCase() === 'BS' ? 'Bs' : '$';
  const detalle = detalleTxt(orden);
  const nota = (orden.notas ?? '').trim();
  const productos = (orden.items ?? []).filter((i) => i.comprar !== false);

  const L: string[] = [];
  L.push(`🔹 *ORDEN:* ${orden.oc_codigo ?? orden.codigo}`);
  L.push('⏳ *Pendiente por aprobación · Gerente General*');
  if (orden.urgente) L.push('🚨 *URGENTE*');
  L.push(`🏭 *Proveedor:* ${proveedorNombre || '—'}`);
  if (detalle) L.push(`📝 *Detalle:* ${detalle}`);
  if (nota) L.push(`📌 *Nota:* ${nota.replace(/\s*\r?\n\s*/g, ' ')}`);
  L.push(...lineasPersonas({ solicita: personas?.solicita, analista: personas?.analista }));
  // Solo CUÁNTOS productos son (pedido del 20-10-2026): el detalle de cada uno se ve en la OC.
  if (productos.length) L.push(`📦 *Productos:* ${productos.length}`);
  if (orden.condiciones_pago) L.push(`📋 *Condición:* ${labelCondicionPago(orden.condiciones_pago)}`);
  L.push(`💵 *Total:* ${montoTxt(orden.total, mon)}`);
  return L.join('\n');
}
