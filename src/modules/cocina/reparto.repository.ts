/* ============================================================
   MGG · Cocina · Reparto del mercado entre cocinas

   El mercado llega a Los Pinos y desde ahí se reparte a La Esperanza
   (Matanza guarda un resguardo del que se saca cuando hace falta).

   «Repartir» NO mueve el inventario: arma una solicitud de traslado
   (TRA) en Salidas. La autorizan Leydis Rengel o Jesús Lozada —la base
   lo exige con `trg_salidas_solo_autorizados`— y recién al ejecutarla
   se mueve el stock. Por eso usa Salidas y no `transferir()` de
   Inventario, que movería el stock sin que nadie lo autorice.

   Ya ejecutado, el traslado entra al libro de las dos cocinas en la
   columna «Traslados»: resta en la que envía y suma en la que recibe,
   sin generar diferencia en ninguna. Da igual si se hace antes o
   después de cerrar el ciclo: cae en el ciclo que esté corriendo ese
   día.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { hoyISO } from '@/shared/lib/format';
import type { EstadoSolicitudSalida, ItemSolicitudSalida, SolicitudSalida } from '@/shared/lib/types';
import { listAlmacenes, listExistencias } from '@/modules/inventario/almacenes.repository';
import { crearSolicitudSalida } from '@/modules/salidas/salidas.repository';
import { listCocinas, listViveresGlobal } from './cocina.repository';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Una cocina a la que se le puede repartir, con el almacén donde entra el traslado. */
export interface CocinaDestino {
  id: string;
  nombre: string;
  almacen: string;
}

/** Un víver que este centro puede enviar, desde UN almacén concreto. */
export interface ViverParaRepartir {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  /** De dónde sale el traslado. */
  almacen: string;
  /** Stock de ESE almacén: un traslado sale de un almacén, no del centro sumado. */
  stock: number;
  /** PMP del almacén de origen, que es el costo con el que entra al destino. */
  costo: number;
}

/**
 * A qué cocinas se puede repartir y qué hay para enviar.
 *
 * El origen de cada víver es el almacén del que la cocina descuenta sus comidas
 * (el principal de la sede). Si el víver está además en otro almacén del centro,
 * se ofrece solo lo del principal: lo demás se traslada desde Salidas eligiendo el
 * almacén a mano. Ofrecer el total del centro dejaría pedir algo que ningún
 * almacén puede entregar por sí solo.
 */
export async function prepararReparto(
  cocinaId: string,
  almacen: string | null,
): Promise<{ destinos: CocinaDestino[]; viveres: ViverParaRepartir[] }> {
  if (!almacen) throw new Error('Esta cocina no tiene un almacén vinculado: no hay de dónde repartir.');
  const [cocinas, viveres, existencias] = await Promise.all([
    listCocinas(), listViveresGlobal(almacen), listExistencias(),
  ]);
  const exPor = new Map(existencias.map((e) => [`${e.producto_id}|${e.almacen}`, e] as const));
  const destinos = cocinas
    .filter((c) => c.cocina.id !== cocinaId && !!c.almacenNombre)
    .map((c) => ({ id: c.cocina.id, nombre: c.cocina.nombre, almacen: c.almacenNombre as string }));

  const out: ViverParaRepartir[] = [];
  for (const v of viveres) {
    const alm = v.almacenMasStock;
    if (!alm) continue;
    const ex = exPor.get(`${v.producto.id}|${alm}`);
    const stock = r2(Number(ex?.stock) || 0);
    if (stock <= 0) continue;
    out.push({
      producto_id: v.producto.id, sku: v.producto.sku, nombre: v.producto.nombre, unidad: v.producto.unidad ?? '',
      almacen: alm, stock, costo: Number(ex?.costo_promedio) || Number(v.precio) || 0,
    });
  }
  return { destinos, viveres: out };
}

export interface LineaReparto {
  producto_id: string;
  nombre: string;
  unidad: string;
  almacen: string;
  cantidad: number;
  costo: number;
}

/** El motivo de la solicitud. Al ejecutarla viaja al detalle de las dos patas del kardex. */
export function motivoReparto(numero: number, origen: string, destino: string, nota?: string | null): string {
  const extra = (nota ?? '').trim();
  return `Reparto del mercado #${numero} de ${origen} a ${destino}${extra ? ` · ${extra}` : ''}`;
}

/**
 * Crea la solicitud de traslado del reparto, «por aprobar». No mueve stock.
 * Valida acá y no solo en el formulario, porque el formulario se puede saltear.
 */
export async function crearReparto(input: {
  mercadoNumero: number;
  cocinaOrigen: string;
  destino: CocinaDestino;
  lineas: LineaReparto[];
  nota?: string | null;
  solicitante: string;
  actor: string;
  actorName?: string | null;
}): Promise<SolicitudSalida> {
  const lineas = input.lineas.filter((l) => (Number(l.cantidad) || 0) > 0);
  if (!lineas.length) throw new Error('Indicá cuánto va de al menos un víver.');
  const mismo = lineas.find((l) => l.almacen === input.destino.almacen);
  if (mismo) throw new Error(`${mismo.nombre} ya está en ${input.destino.almacen}: ese traslado no movería nada.`);

  // Salidas vuelve a mirar el stock al ejecutar, pero una solicitud que pide más de
  // lo que hay no la va a poder ejecutar nadie: mejor decirlo ahora.
  const existencias = await listExistencias();
  const stockDe = new Map<string, number>(existencias.map((e) => [`${e.producto_id}|${e.almacen}`, Number(e.stock) || 0]));
  const pedido = new Map<string, number>();
  for (const l of lineas) {
    const k = `${l.producto_id}|${l.almacen}`;
    pedido.set(k, r2((pedido.get(k) ?? 0) + Number(l.cantidad)));
    const hay = stockDe.get(k) ?? 0;
    if ((pedido.get(k) ?? 0) > hay + 1e-6) {
      throw new Error(`No hay ${pedido.get(k)} ${l.unidad} de ${l.nombre} en ${l.almacen}: hay ${r2(hay)}.`);
    }
  }

  const items: ItemSolicitudSalida[] = lineas.map((l) => ({
    producto_id: l.producto_id,
    producto_nombre: l.nombre,
    cantidad: Number(l.cantidad),
    // El mismo criterio que el formulario de traslados de Salidas: viaja el costo
    // del origen, así la orden de traslado sale valorizada.
    precio_unit: l.costo > 0 ? l.costo : null,
    unidad: l.unidad || null,
    almacen: l.almacen,
    observacion: null,
  }));
  return crearSolicitudSalida({
    scope: 'traslado',
    tipo: 'material',
    almacenDestino: input.destino.almacen,
    items,
    motivo: motivoReparto(input.mercadoNumero, input.cocinaOrigen, input.destino.nombre, input.nota),
    fechaEntrega: hoyISO(),
    solicitante: input.solicitante,
    actor: input.actor,
    actorName: input.actorName ?? null,
  });
}

/** Una solicitud de traslado de víveres que toca este centro y no se ejecutó todavía. */
export interface RepartoPendiente {
  id: string;
  codigo: string;
  estado: EstadoSolicitudSalida;
  /** `sale`: saca víveres de este centro. `entra`: los trae. */
  sentido: 'sale' | 'entra';
  /** El otro lado: el destino si sale, el origen si entra. */
  contraparte: string;
  viveres: number;
  creado: string;
}

/**
 * Traslados de víveres que tocan este centro y todavía no se ejecutaron.
 *
 * Mientras la solicitud está por aprobar o aprobada, el stock no se movió y el
 * libro no la cuenta. Sin este aviso, la cocina que acaba de repartir ve el
 * mercado igual que antes y cree que el reparto no se guardó; o, peor, lo carga
 * otra vez.
 */
export async function repartosPendientes(
  almacen: string | null,
  esViver: (productoId: string) => boolean,
): Promise<RepartoPendiente[]> {
  if (!almacen) return [];
  const almacenes = await listAlmacenes();
  const sede = almacenes.find((a) => a.nombre === almacen)?.sede ?? null;
  const scope = new Set(sede ? almacenes.filter((a) => (a.sede ?? null) === sede).map((a) => a.nombre) : [almacen]);

  const { data, error } = await supabase
    .from('solicitudes_salida')
    .select('id, codigo, estado, almacen_origen, almacen_destino, producto_id, items, created_at')
    .eq('scope', 'traslado')
    .eq('tipo', 'material')
    .in('estado', ['por_aprobar', 'aprobada'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  const out: RepartoPendiente[] = [];
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const items = Array.isArray(raw.items) ? (raw.items as ItemSolicitudSalida[]) : [];
    const origenCab = (raw.almacen_origen as string | null) ?? null;
    const lineas: ItemSolicitudSalida[] = items.length
      ? items
      : raw.producto_id ? [{ producto_id: String(raw.producto_id), cantidad: 0, almacen: origenCab }] : [];
    const deViveres = lineas.filter((l) => esViver(l.producto_id));
    if (!deViveres.length) continue;

    // El destino puede venir como almacén o como sede: Salidas lo resuelve al ejecutar.
    const destino = String(raw.almacen_destino ?? '');
    const entra = scope.has(destino) || (!!sede && destino === sede);
    const origenes = [...new Set(deViveres.map((l) => l.almacen ?? origenCab ?? '').filter(Boolean))];
    const sale = origenes.some((o) => scope.has(o));
    // Dentro del mismo centro no cambia lo que la cocina tiene: no se avisa.
    if (entra === sale) continue;
    out.push({
      id: String(raw.id),
      codigo: String(raw.codigo ?? ''),
      estado: raw.estado as EstadoSolicitudSalida,
      sentido: sale ? 'sale' : 'entra',
      contraparte: sale ? destino : origenes.join(', '),
      viveres: deViveres.length,
      creado: String(raw.created_at ?? ''),
    });
  }
  return out;
}
