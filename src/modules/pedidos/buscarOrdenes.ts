import type { ItemOrden, Orden, PagoMetodo, Proveedor } from '@/shared/lib/types';
import { coincideTodo, formasDeNumero, textoBuscable } from '@/shared/lib/buscar';
import { date, statusBadge } from '@/shared/lib/format';

/* ============================================================
   MGG · Buscar en las Órdenes de Compra (16-10-2026)

   Orden de la administradora: el buscador de la pestaña «Órdenes de Compra»
   tiene que encontrar la orden por CUALQUIER cosa que se sepa de ella, no solo
   por código, proveedor y solicitante. Quien busca se acuerda del dato (el
   tornillo que pidió, el monto, el día, «pago móvil», «urgente»), no de la
   columna donde está.

   Se arma un solo texto con todo lo que la orden sabe de sí misma y se busca
   ahí con las reglas de `buscar.ts`: sin acentos ni mayúsculas, varias
   palabras = TODAS deben estar (en cualquier orden) y los números en las
   formas en que alguien los teclea (2.946,59 · 2946,59 · 2946.59).
   ============================================================ */

/** Lo que la pantalla sabe además de la fila: el proveedor casado y cómo llama
 *  a cada método de pago. Todo opcional: sin contexto, igual se busca por lo
 *  que la orden trae guardado. */
export interface ContextoBusquedaOrden {
  /** Proveedor de la orden (la fila solo guarda su id). */
  proveedor?: (o: Orden) => Proveedor | null | undefined;
  /** Etiqueta en español del método de pago ('pago_movil' → «Pago móvil»). */
  labelMetodo?: (metodo: string | null | undefined) => string;
  /** Correo → «Nombre Apellido» (tabla usuarios). Con esto «kelvin peña» encuentra
   *  las órdenes que hizo kelvin@… aunque la fila solo guarde el correo. */
  nombreDe?: (email: string | null | undefined) => string | null | undefined;
}

/**
 * Quién REALIZÓ la orden, para el filtro «Realizada por» (16-10-2026).
 *
 * La administradora quiere ver «todas las OC que cargó KELVIN»: eso es el
 * analista de compras que eligió la oferta y creó la OC, y la fila lo guarda en
 * `oc_creada_por` (correo). Las OC viejas que no lo tienen lo conservan en el
 * historial (evento 'oc_creada'). Una OP que aún no tiene OC la «realizó» quien
 * la cargó (evento 'creada' = `solicitante_email`), así el desplegable también
 * sirve en la columna de pendientes. Siempre un correo en minúscula, o '' si no
 * hay nada.
 */
export function creadorDeOrden(o: Orden): string {
  const h = o.historial ?? [];
  const actorDe = (evento: string) => h.find((e) => e.evento === evento && e.actor?.includes('@'))?.actor;
  const email = o.oc_creada_por || actorDe('oc_creada') || actorDe('creada') || o.solicitante_email || '';
  return String(email).trim().toLowerCase();
}

/** Una opción del desplegable «Realizada por»: el correo (valor) y cómo se muestra. */
export interface OpcionCreador {
  email: string;
  label: string;
}

/**
 * Los usuarios que aparecen como creadores en las órdenes cargadas, sin
 * repetir y ordenados por nombre. `nombreDe` resuelve correo → nombre; si no
 * lo conoce, se muestra el correo tal cual.
 */
export function opcionesCreador(ordenes: Orden[], nombreDe?: ContextoBusquedaOrden['nombreDe']): OpcionCreador[] {
  const vistos = new Map<string, OpcionCreador>();
  for (const o of ordenes) {
    const email = creadorDeOrden(o);
    if (!email || vistos.has(email)) continue;
    const nombre = (nombreDe?.(email) ?? '').trim();
    vistos.set(email, { email, label: nombre || email });
  }
  return Array.from(vistos.values()).sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
}

/** Deja solo las órdenes realizadas por ese correo. Vacío = «Todos los usuarios». */
export function filtrarPorCreador(ordenes: Orden[], email: string): Orden[] {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return ordenes;
  return ordenes.filter((o) => creadorDeOrden(o) === e);
}

const TZ = 'America/Caracas';

/**
 * Una fecha ISO en las formas en que alguien la escribiría en el buscador:
 * 16/10/2026 · 2026-10-16 · 16-10-2026 · 16 oct 2026 (como la muestra la tabla).
 * Se pasa a hora de Venezuela para que el día sea el que la gente vio en pantalla.
 */
export function formasDeFecha(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso).trim();
  let dd: string, mm: string, yyyy: string;
  const pura = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (pura) {
    [, yyyy, mm, dd] = pura;
  } else {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d);
    const parte = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
    yyyy = parte('year'); mm = parte('month'); dd = parte('day');
  }
  if (!dd || !mm || !yyyy) return '';
  return [`${dd}/${mm}/${yyyy}`, `${yyyy}-${mm}-${dd}`, `${dd}-${mm}-${yyyy}`, date(s)].join(' ');
}

/** Todo lo que se puede buscar de un renglón: nombre, SKU, marca, unidad, precio… */
function textoDeItem(it: ItemOrden): unknown[] {
  const sub = Number(it.cantidad) * Number(it.precio);
  return [
    it.nombre, it.sku, it.unidad, it.unidad_compra, it.marca, it.modelo, it.marca_recibida, it.nota_marca,
    it.finalidad, it.area,
    it.servicio_categoria, it.servicio_tipo, it.equipo_nombre, it.repuesto_nombre, it.repuesto_almacen,
    formasDeNumero(it.cantidad), formasDeNumero(it.precio),
    Number.isFinite(sub) ? formasDeNumero(sub) : '',
    ...(it.detalle_items ?? []).flatMap((d) => [d.descripcion, formasDeNumero(d.cantidad), formasDeNumero(d.precio)]),
  ];
}

/** Una pata del pago: método (clave y etiqueta), moneda, monto y los datos del proveedor. */
function textoDePago(p: PagoMetodo, labelMetodo?: ContextoBusquedaOrden['labelMetodo']): unknown[] {
  return [
    p.metodo, (p.metodo ?? '').replace(/_/g, ' '), labelMetodo?.(p.metodo),
    p.moneda, formasDeNumero(p.monto),
    ...Object.values(p.datos ?? {}),
  ];
}

/**
 * Todo el texto de la orden donde tiene sentido buscar, ya normalizado.
 * Entra cada campo textual de `Orden`, el proveedor, los renglones (nombre y
 * SKU incluidos), el estado (clave y etiqueta en español), los métodos de pago,
 * los montos en sus varias formas y las fechas de cada hito.
 */
export function textoBuscableOrden(o: Orden, ctx?: ContextoBusquedaOrden): string {
  const prov = ctx?.proveedor?.(o);
  const estado = statusBadge(o.estado);
  // Cada correo que hizo algo en la orden, también por su nombre (si se conoce).
  const correos = [
    creadorDeOrden(o), o.solicitante_email,
    o.aprobada_por, o.oc_creada_por, o.oc_aprobada_por, o.oc_emitida_por, o.metodo_pago_por,
    o.pagada_por, o.recibida_por, o.finalizada_por, o.rechazada_por, o.retencion_finalizada_por,
    ...(o.historial ?? []).map((h) => h.actor),
  ];
  const nombres = ctx?.nombreDe ? Array.from(new Set(correos.filter(Boolean))).map((e) => ctx.nombreDe?.(e)) : [];
  return textoBuscable([
    // Identidad y quién pide / quién la realizó (por correo y por nombre)
    o.codigo, o.oc_codigo, o.clase ?? 'producto',
    o.solicitante, o.solicitante_email, o.solicitante_persona, o.ci_solicitante,
    creadorDeOrden(o), ...nombres,
    // Proveedor casado
    prov?.razon_social, prov?.rif, prov?.contacto, prov?.telefono, prov?.email, prov?.numero_administracion,
    // Estado: la clave ('oc_aprobada', 'oc aprobada') y como lo ve la gente («Confirmada pagar»)
    o.estado, (o.estado ?? '').replace(/_/g, ' '), estado.label,
    o.urgente ? 'urgente orden urgente prioridad' : '',
    // Qué se pide y por qué
    o.motivo, o.finalidad, o.notas, ...(o.clasificacion ?? []),
    ...(o.items ?? []).flatMap(textoDeItem),
    // Dinero
    o.moneda ?? 'USD', formasDeNumero(o.total),
    formasDeNumero(o.oferta_precio_efectivo), formasDeNumero(o.oferta_precio_bcv),
    formasDeNumero(o.recibido_total), formasDeNumero(o.abonado_total),
    formasDeNumero(o.descuento_obtenido), formasDeNumero(o.descuento_pago),
    formasDeNumero(o.iva), formasDeNumero(o.igtf), o.iva_incluido ? 'iva incluido' : '',
    formasDeNumero(o.retencion_monto), formasDeNumero(o.retencion_bs), formasDeNumero(o.retencion_usd),
    formasDeNumero(o.reembolso_monto), o.reembolso_moneda,
    formasDeNumero(o.ajuste), o.ajuste_motivo,
    formasDeNumero(o.anticipo_monto), o.anticipo_moneda,
    // Pago
    ...(o.metodo_pago ?? []).flatMap((p) => textoDePago(p, ctx?.labelMetodo)),
    o.condiciones_pago, o.comprobante_tipo, (o.comprobante_tipo ?? '').replace(/_/g, ' '),
    o.retencion_modo, (o.retencion_modo ?? '').replace(/_/g, ' '),
    o.numero_administracion, ...(o.seriales_billetes ?? []),
    o.factura_nombre, o.retencion_nombre, o.pago_qr_nombre,
    o.retencion_iva_nombre, o.retencion_islr_nombre, o.retencion_municipal_nombre,
    // Oferta elegida y recepción
    o.oferta_motivo,
    o.oferta_detalle?.marca, o.oferta_detalle?.modelo, o.oferta_detalle?.procedencia,
    o.oferta_detalle?.materiales, o.oferta_detalle?.dimensiones, o.oferta_detalle?.peso, o.oferta_detalle?.calidad,
    o.almacen_destino, o.nota_recepcion, o.motivo_rechazo,
    // Quién hizo cada paso
    o.aprobada_por, o.oc_creada_por, o.oc_aprobada_por, o.oc_emitida_por, o.metodo_pago_por,
    o.pagada_por, o.recibida_por, o.finalizada_por, o.rechazada_por, o.retencion_finalizada_por,
    ...(o.historial ?? []).flatMap((h) => [h.evento, h.actor, h.motivo]),
    // Cuándo
    formasDeFecha(o.created_at), formasDeFecha(o.aprobada_en), formasDeFecha(o.oc_creada_en),
    formasDeFecha(o.oc_aprobada_en), formasDeFecha(o.oc_emitida_en), formasDeFecha(o.metodo_pago_en),
    formasDeFecha(o.pagada_en), formasDeFecha(o.recibida_en), formasDeFecha(o.finalizada_en),
  ]);
}

/** Filtra las órdenes por texto libre (todas las palabras, sin acentos). Sin texto, devuelve todo. */
export function filtrarOrdenes(ordenes: Orden[], q: string, ctx?: ContextoBusquedaOrden): Orden[] {
  if (!q.trim()) return ordenes;
  return ordenes.filter((o) => coincideTodo(textoBuscableOrden(o, ctx), q));
}
