/* ============================================================
   MGG · Compras · Revisión de ALMACÉN de la Solicitud de Pedido (29-10-2026)

   Flujo nuevo (arranca APAGADO, ver `revisionAlmacen.repository.ts`):
     SP nace → «En revisión de almacén» → almacén marca qué tiene y cuánto →
     «Revisada»: lo que falta llega a Compras como la SP que aceptan y cotizan.
     Si almacén lo tiene todo, la SP queda «Atendida por almacén».

   Acá vive lo que no toca la base: el resumen «tiene / falta» y los dos
   mensajes de WhatsApp (la SP y la revisión). Los emojis son todos de color
   por sí mismos, sin el selector U+FE0F (ver mensajeMovimiento.ts).
   ============================================================ */
import type { ItemOrden, Orden } from '@/shared/lib/types';

/** Lo que almacén va marcando de un renglón (por SKU). */
export interface MarcaAlmacen {
  disponible: number;
  revisado: boolean;
}

export interface RenglonResumen {
  sku: string;
  nombre: string;
  unidad: string;
  cantidad: number;
}

export interface ResumenRevision {
  tiene: RenglonResumen[];
  falta: RenglonResumen[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Lo que se pidió en la SP (antes de la revisión `cantidad` lo es; después, `cantidad_solicitada`). */
export function cantidadSolicitada(it: ItemOrden): number {
  return it.cantidad_solicitada != null ? num(it.cantidad_solicitada) : num(it.cantidad);
}

/** El renglón entra a la revisión: los desmarcados en la SP (`comprar === false`) no se piden. */
export function seRevisa(it: ItemOrden): boolean {
  return it.comprar !== false;
}

/** Lo que almacén tiene, acotado a lo pedido: nunca negativo ni de más. */
export function disponibleAcotado(it: ItemOrden, disponible: number): number {
  return Math.min(Math.max(num(disponible), 0), cantidadSolicitada(it));
}

/** Las marcas de partida: lo que ya se guardó en la base, o nada revisado. */
export function marcasIniciales(items: ItemOrden[]): Record<string, MarcaAlmacen> {
  const out: Record<string, MarcaAlmacen> = {};
  for (const it of items) {
    if (!seRevisa(it)) continue;
    out[it.sku] = { disponible: num(it.cantidad_almacen), revisado: it.almacen_revisado === true };
  }
  return out;
}

/**
 * Marca por LOTE: todos los renglones a la vez. `hay` = lo tiene todo (disponible =
 * lo pedido), o el stock del inventario si se pasa `stock` (lo que alcance).
 */
export function marcarLote(
  items: ItemOrden[],
  modo: 'todo' | 'nada' | 'stock',
  stock?: Map<string, number>,
): Record<string, MarcaAlmacen> {
  const out: Record<string, MarcaAlmacen> = {};
  for (const it of items) {
    if (!seRevisa(it)) continue;
    const pedido = cantidadSolicitada(it);
    const disp = modo === 'todo' ? pedido
      : modo === 'nada' ? 0
        : disponibleAcotado(it, stock?.get(it.sku) ?? 0);
    out[it.sku] = { disponible: disp, revisado: true };
  }
  return out;
}

/** ¿Están todos los renglones revisados? Hace falta para marcar la SP como revisada. */
export function todoRevisado(items: ItemOrden[], marcas: Record<string, MarcaAlmacen>): boolean {
  const aRevisar = items.filter(seRevisa);
  return aRevisar.length > 0 && aRevisar.every((it) => marcas[it.sku]?.revisado);
}

/**
 * Tiene / falta. Con `marcas` se calcula sobre lo que almacén está marcando (antes de
 * guardar); sin ellas, sobre la SP ya revisada (cantidad_almacen + lo que quedó a comprar).
 */
export function resumenRevision(items: ItemOrden[], marcas?: Record<string, MarcaAlmacen>): ResumenRevision {
  const tiene: RenglonResumen[] = [];
  const falta: RenglonResumen[] = [];
  for (const it of items) {
    if (!seRevisa(it) && it.cantidad_almacen == null) continue;
    const pedido = cantidadSolicitada(it);
    const disp = marcas
      ? disponibleAcotado(it, marcas[it.sku]?.disponible ?? 0)
      : disponibleAcotado(it, num(it.cantidad_almacen));
    const base = { sku: it.sku, nombre: it.nombre, unidad: it.unidad ?? '' };
    if (disp > 0) tiene.push({ ...base, cantidad: disp });
    const resto = Math.round((pedido - disp) * 10000) / 10000;
    if (resto > 0) falta.push({ ...base, cantidad: resto });
  }
  return { tiene, falta };
}

/** Cantidad en formato venezolano, sin ceros de sobra (2 · 0,5 · 1.250). */
export function fmtCant(n: number): string {
  return num(n).toLocaleString('es-VE', { maximumFractionDigits: 3 });
}

function fechaHoraVE(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function linea(r: { nombre: string; cantidad: number; unidad?: string }): string {
  const u = (r.unidad ?? '').trim();
  return `• ${r.nombre} — ${fmtCant(r.cantidad)}${u ? ' ' + u : ''}`;
}

/** El mensaje de WhatsApp de la Solicitud de Pedido, tal como se pidió. */
export function mensajeSolicitudPedido(
  o: Pick<Orden, 'codigo' | 'items' | 'created_at' | 'finalidad' | 'motivo' | 'urgente' | 'notas'>,
  quien?: { unidad?: string | null; persona?: string | null },
): string {
  const items = (o.items ?? []).filter(seRevisa);
  const partes: string[] = [];
  partes.push(`📋 *SOLICITUD DE PEDIDO ${o.codigo}*`);
  if (o.urgente) partes.push('🚨 *URGENTE*');
  partes.push(`📅 ${fechaHoraVE(o.created_at)}`);
  const unidad = (quien?.unidad ?? '').trim();
  const persona = (quien?.persona ?? '').trim();
  if (unidad || persona) partes.push(`👤 Solicita: ${[unidad, persona].filter(Boolean).join(' — ')}`);
  const finalidad = (o.finalidad ?? o.motivo ?? '').trim();
  if (finalidad) partes.push(`🎯 Finalidad: ${finalidad}`);
  partes.push('');
  partes.push(`*PRODUCTOS SOLICITADOS (${items.length}):*`);
  for (const it of items) partes.push(linea({ nombre: it.nombre, cantidad: cantidadSolicitada(it), unidad: it.unidad }));
  const nota = (o.notas ?? '').trim();
  if (nota) { partes.push(''); partes.push(`📝 ${nota}`); }
  return partes.join('\n');
}

/**
 * El mensaje de la revisión: «ALMACÉN HA REVISADO LA ORDEN», lo que tiene y lo
 * que va a solicitar a Compras. Sale de la SP ya revisada o de las marcas en curso.
 */
export function mensajeRevisionAlmacen(
  o: Pick<Orden, 'codigo' | 'items' | 'revisada_almacen_en' | 'nota_almacen'>,
  opts?: { marcas?: Record<string, MarcaAlmacen>; revisor?: string | null; nota?: string | null },
): string {
  const { tiene, falta } = resumenRevision(o.items ?? [], opts?.marcas);
  const partes: string[] = [];
  partes.push(`✅ *ALMACÉN HA REVISADO LA ORDEN ${o.codigo}*`);
  partes.push(`📅 ${fechaHoraVE(o.revisada_almacen_en)}`);
  const revisor = (opts?.revisor ?? '').trim();
  if (revisor) partes.push(`👤 Revisó: ${revisor}`);
  partes.push('');
  partes.push('📦 *TIENE (disponible en almacén):*');
  if (tiene.length) for (const r of tiene) partes.push(linea(r));
  else partes.push('• Nada de lo solicitado');
  partes.push('');
  if (falta.length) {
    partes.push('🛒 *VA A SOLICITAR A COMPRAS:*');
    for (const r of falta) partes.push(linea(r));
  } else {
    partes.push('🛒 *VA A SOLICITAR A COMPRAS:* nada, almacén tiene todo.');
  }
  const nota = (opts?.nota ?? o.nota_almacen ?? '').trim();
  if (nota) { partes.push(''); partes.push(`📝 ${nota}`); }
  return partes.join('\n');
}
