/* ============================================================
   MGG · Inventario · reconstruir las RECEPCIONES desde el kardex

   No existe una tabla de recepciones: recibir una orden escribe un movimiento
   de entrada por ítem y nada más. Para responder «qué se recibió hoy, quién lo
   recibió y a qué almacén entró» había que consultar la base a mano.

   Acá se agrupan esos movimientos en la operación que realmente ocurrió. La
   asociación ya está en los datos —`ref_tipo`, `ref_id`, `ref_codigo`,
   `proveedor_id`—; lo único que faltaba era juntarlos y ponerles nombre.

   POR QUÉ AGRUPAR Y NO CREAR UNA ENTIDAD
   Es lo acordado: primero se prueba con lo que ya hay. Si aparecen recepciones
   parciales frecuentes o el comprobante empieza a circular en papel, conviene la
   tabla con su correlativo propio — el código de acá es derivado y por lo tanto
   depende de que los movimientos no se editen.
   ============================================================ */

/** Lo mínimo de un movimiento para reconstruir una recepción. */
export interface MovimientoRecepcion {
  id: string;
  at: string;
  producto_id: string;
  delta: number;
  almacen?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  ref_tipo?: string | null;
  ref_id?: string | null;
  ref_codigo?: string | null;
  proveedor_id?: string | null;
  precio_unitario?: number | null;
  detalle?: string | null;
}

export interface ItemRecepcion {
  producto_id: string;
  cantidad: number;
  precio: number | null;
  detalle: string | null;
}

export interface Recepcion {
  /** Código derivado: el del documento más el número de recepción. */
  codigo: string;
  /** Documento de origen (la orden o la compra directa). */
  documento: string | null;
  ref_tipo: string;
  ref_id: string | null;
  proveedor_id: string | null;
  /** Cuándo se registró (la del primer movimiento del lote). */
  at: string;
  /** Quién la registró. */
  actor: string | null;
  actor_name: string | null;
  /** A qué almacén entró. `null` en las recepciones anteriores al 08/09/2026,
   *  cuando el movimiento no guardaba la columna. */
  almacen: string | null;
  items: ItemRecepcion[];
  /** Cuántas unidades entraron en total. */
  unidades: number;
  /** Cuánto costó lo recibido, si los movimientos traen precio. */
  valor: number | null;
  /** Nº de recepción DENTRO de su documento: distingue las parciales. */
  numero: number;
}

/** Tipos de movimiento que son una recepción de compra. */
const REF_RECEPCION = new Set(['orden', 'compra_directa']);

/** ¿Este movimiento es parte de una recepción de compra? */
export function esMovimientoDeRecepcion(m: MovimientoRecepcion): boolean {
  return !!m.ref_tipo && REF_RECEPCION.has(m.ref_tipo) && Number(m.delta) > 0;
}

/**
 * Clave del lote: un mismo documento recibido en un mismo instante.
 *
 * Se agrupa por documento + segundo, no solo por documento: una orden se puede
 * recibir PARCIALMENTE y volver a recibir días después, y esas son dos
 * recepciones distintas aunque compartan el código de la orden. El segundo
 * alcanza porque los ítems de una recepción se insertan en el mismo `for`.
 */
function claveLote(m: MovimientoRecepcion): string {
  return `${m.ref_tipo}|${m.ref_id ?? m.ref_codigo ?? '?'}|${String(m.at).slice(0, 19)}`;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Reconstruye las recepciones a partir de los movimientos del kardex.
 *
 * Devuelve de la más reciente a la más vieja, que es como se busca: «¿qué entró
 * hoy?» es la pregunta frecuente, «¿qué entró en marzo?» es la excepción.
 */
export function recepcionesDesdeMovimientos(movs: MovimientoRecepcion[]): Recepcion[] {
  const lotes = new Map<string, MovimientoRecepcion[]>();
  for (const m of movs) {
    if (!esMovimientoDeRecepcion(m)) continue;
    const k = claveLote(m);
    const prev = lotes.get(k);
    if (prev) prev.push(m); else lotes.set(k, [m]);
  }

  const recepciones: Recepcion[] = [];
  for (const grupo of lotes.values()) {
    grupo.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const cab = grupo[0];
    const items: ItemRecepcion[] = grupo.map((m) => ({
      producto_id: m.producto_id,
      cantidad: r2(Number(m.delta) || 0),
      precio: m.precio_unitario == null ? null : Number(m.precio_unitario),
      detalle: m.detalle ?? null,
    }));
    const unidades = r2(items.reduce((a, i) => a + i.cantidad, 0));
    // El valor solo se informa si TODOS los renglones traen precio: un total
    // parcial se leería como el costo de la recepción y sería menor que el real.
    const conPrecio = items.every((i) => i.precio != null);
    const valor = conPrecio ? r2(items.reduce((a, i) => a + i.cantidad * (i.precio ?? 0), 0)) : null;

    recepciones.push({
      codigo: '',                                  // se numera abajo, ya ordenado
      documento: cab.ref_codigo ?? null,
      ref_tipo: cab.ref_tipo ?? 'orden',
      ref_id: cab.ref_id ?? null,
      proveedor_id: cab.proveedor_id ?? null,
      at: cab.at,
      actor: cab.actor ?? null,
      actor_name: cab.actor_name ?? null,
      // Las viejas no lo tienen: se deja null en vez de adivinarlo del detalle.
      almacen: cab.almacen ?? null,
      items,
      unidades,
      valor,
      numero: 0,
    });
  }

  /* NUMERACIÓN. El correlativo va POR DOCUMENTO y en orden cronológico, así que
     «OC-2026-0108 · R2» siempre es la segunda vez que se recibió esa orden, sin
     importar qué se consultó ni con qué filtro. Un correlativo global tendría
     que renumerarse cada vez que aparece una recepción más vieja. */
  const porDocumento = new Map<string, Recepcion[]>();
  for (const r of recepciones) {
    const k = `${r.ref_tipo}|${r.ref_id ?? r.documento ?? '?'}`;
    const prev = porDocumento.get(k);
    if (prev) prev.push(r); else porDocumento.set(k, [r]);
  }
  for (const grupo of porDocumento.values()) {
    grupo.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const unica = grupo.length === 1;
    grupo.forEach((r, i) => {
      r.numero = i + 1;
      // Con una sola recepción el sufijo sobra y ensucia: el documento la nombra.
      r.codigo = unica ? (r.documento ?? '—') : `${r.documento ?? '—'} · R${i + 1}`;
    });
  }

  return recepciones.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * OC recibida con «ya lo cargué a mano»: como NO escribió movimientos, el
 * histórico reconstruido del kardex no la veía (24-11-2026). La mostramos como
 * recepción SIN stock para que quede rastro de quién la marcó y cuándo.
 */
export interface OrdenRecibidaSinInventario {
  id: string;
  codigo?: string | null;
  oc_codigo?: string | null;
  proveedor_id?: string | null;
  recibida_en?: string | null;
  recibida_por?: string | null;
  almacen_destino?: string | null;
  sin_inventario?: boolean | null;
  items?: unknown;
}

function esRegistro(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Se convierten en «movimientos» SOLO para el armado del histórico: no se
 * escriben en la base ni suman al stock. El precio queda null (no se sabe en
 * qué moneda se cargó a mano) y el detalle dice explícitamente que no entró.
 */
export function movimientosRecepcionSinInventarioDesdeOrdenes(
  ordenes: OrdenRecibidaSinInventario[],
): MovimientoRecepcion[] {
  const out: MovimientoRecepcion[] = [];
  for (const o of ordenes) {
    if (o.sin_inventario !== true || !o.recibida_en) continue;
    const items = Array.isArray(o.items) ? o.items.filter(esRegistro) : [];
    for (const it of items) {
      const cantidad = numero(it.cantidad_recibida ?? it.cantidad);
      if (cantidad <= 0) continue;
      const nombre = texto(it.nombre);
      const sku = texto(it.sku) || texto(it.producto_id) || 'ítem';
      out.push({
        id: `${o.id}:${sku}`,
        at: o.recibida_en,
        producto_id: texto(it.producto_id) || sku,
        delta: cantidad,
        almacen: texto(o.almacen_destino) || null,
        actor: texto(o.recibida_por) || null,
        actor_name: null,
        ref_tipo: 'orden',
        ref_id: o.id,
        ref_codigo: texto(o.oc_codigo) || texto(o.codigo) || null,
        proveedor_id: o.proveedor_id ?? null,
        precio_unitario: null,
        detalle: `Recibido SIN inventario (carga manual) · ${nombre || sku}`,
      });
    }
  }
  return out;
}

/** Filtros de la pantalla. Todos opcionales: sin ninguno, devuelve todo. */
export interface FiltroRecepciones {
  desde?: string | null;
  hasta?: string | null;
  almacen?: string | null;
  actor?: string | null;
  texto?: string | null;
}

/** Aplica los filtros de la pantalla sobre las recepciones ya armadas. */
export function filtrarRecepciones(recs: Recepcion[], f: FiltroRecepciones): Recepcion[] {
  const q = (f.texto ?? '').trim().toLowerCase();
  return recs.filter((r) => {
    const dia = String(r.at).slice(0, 10);
    if (f.desde && dia < f.desde) return false;
    if (f.hasta && dia > f.hasta) return false;
    if (f.almacen && r.almacen !== f.almacen) return false;
    if (f.actor && r.actor !== f.actor) return false;
    if (q) {
      const enCabecera = `${r.codigo} ${r.documento ?? ''} ${r.actor_name ?? ''} ${r.almacen ?? ''}`.toLowerCase();
      const enItems = r.items.map((i) => i.detalle ?? '').join(' ').toLowerCase();
      if (!enCabecera.includes(q) && !enItems.includes(q)) return false;
    }
    return true;
  });
}
