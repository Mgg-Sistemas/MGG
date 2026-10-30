/* ============================================================
   MGG · Compras · Revisión de ALMACÉN de la Solicitud de Pedido (29-10-2026)

   Flujo nuevo (arranca APAGADO, ver `revisionAlmacen.repository.ts`):
     SP nace → «En revisión de almacén» → CADA almacén (Los Pinos, Matanza)
     responde por renglón si lo tiene y cuánto, y confirma su revisión (30-10).
     Cuando confirmaron todos, la base reparte: lo que entrega cada almacén
     (Los Pinos primero, después Matanza) y lo que ninguno tiene llega a
     Compras como la SP que aceptan y cotizan. Si entre los dos lo tienen
     todo, la SP queda «Atendida por almacén».

   Acá vive lo que no toca la base: el reparto, el resumen «tiene / falta» y
   los mensajes de WhatsApp (la SP, la respuesta de cada sede y la revisión
   completa). Los emojis son todos de color por sí mismos, sin el selector
   U+FE0F (ver mensajeMovimiento.ts).
   ============================================================ */
import type { ItemOrden, Orden } from '@/shared/lib/types';

/* ── Las sedes que revisan ── */

export interface SedeRevision {
  /** Valor de `almacenes.sede` / `usuarios.sedes_asignadas`. */
  sede: string;
  /** Cómo se muestra («Los Pinos», «Matanza»). */
  etiqueta: string;
}

/**
 * Las sedes cuyo almacén confirma la SP, en el ORDEN en que se reparte la entrega
 * (Los Pinos primero). Para sumar La Esperanza: agregarla acá y en
 * `public.almacen_sedes_revision()` (supabase/sql/compras-revision-almacen-sedes-2026-10-30.sql).
 */
export const SEDES_REVISION_ALMACEN: readonly SedeRevision[] = [
  { sede: 'LOS PINOS', etiqueta: 'Los Pinos' },
  { sede: 'CENTRO DE FUNDICION - MATANZAS', etiqueta: 'Matanza' },
];

const ETIQUETAS_EXTRA: Record<string, string> = { 'CENTRO DE ACOPIO - LA ESPERANZA': 'La Esperanza' };

export function etiquetaSede(sede: string | null | undefined): string {
  const s = String(sede ?? '').trim();
  return SEDES_REVISION_ALMACEN.find((x) => x.sede === s)?.etiqueta ?? ETIQUETAS_EXTRA[s] ?? (s || 'Almacén');
}

/** Por qué sedes puede responder el usuario: sin restricción (null) = todas; si no, las suyas que revisan. */
export function sedesQuePuedeResponder(sedesUsuario: readonly string[] | null | undefined): string[] {
  const todas = SEDES_REVISION_ALMACEN.map((s) => s.sede);
  if (!sedesUsuario || !sedesUsuario.length) return todas;
  return todas.filter((s) => sedesUsuario.includes(s));
}

/* ── Tipos de lo que guarda la base (columnas jsonb sin tipar en `types.ts`) ── */

/** Lo que almacén va marcando de un renglón (por SKU). */
export interface MarcaAlmacen {
  disponible: number;
  revisado: boolean;
}

/** La marca guardada de UNA sede en un renglón. */
export interface MarcaSede extends MarcaAlmacen {
  por?: string | null;
  en?: string | null;
}

/** El renglón con la revisión por sede: `almacen_sedes` mientras se revisa, `almacen_origenes` al cerrar. */
export type ItemRevision = ItemOrden & {
  almacen_sedes?: Record<string, MarcaSede> | null;
  almacen_origenes?: Record<string, number> | null;
};

export interface ConfirmacionSede {
  confirmada_por?: string | null;
  confirmada_en?: string | null;
  nota?: string | null;
}

export type OrdenRevision = Orden & { revision_sedes?: Record<string, ConfirmacionSede> | null };

export interface RenglonResumen {
  sku: string;
  nombre: string;
  unidad: string;
  cantidad: number;
}

export interface EntregaSede {
  sede: string;
  etiqueta: string;
  renglones: RenglonResumen[];
}

export interface ResumenRevision {
  tiene: RenglonResumen[];
  falta: RenglonResumen[];
  /** Lo que entrega cada almacén (solo los que entregan algo), en el orden de reparto. */
  porSede?: EntregaSede[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
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

/** La marca guardada de una sede en el renglón (o nada si esa sede no lo tocó). */
export function marcaDeSede(it: ItemOrden, sede: string): MarcaSede | undefined {
  const ms = (it as ItemRevision).almacen_sedes;
  const m = esObjeto(ms) ? ms[sede] : undefined;
  if (!esObjeto(m)) return undefined;
  return { disponible: num(m.disponible), revisado: m.revisado === true, por: m.por ?? null, en: m.en ?? null };
}

/** La confirmación de una sede en la SP, o null si todavía no confirmó. */
export function confirmacionDe(o: Pick<Orden, 'id'> & Partial<OrdenRevision>, sede: string): ConfirmacionSede | null {
  const rs = o.revision_sedes;
  const c = esObjeto(rs) ? rs[sede] : undefined;
  return esObjeto(c) ? c : null;
}

/** Las marcas de partida de UNA sede: lo que ya guardó en la base, o nada revisado. */
export function marcasIniciales(items: ItemOrden[], sede: string): Record<string, MarcaAlmacen> {
  const out: Record<string, MarcaAlmacen> = {};
  for (const it of items) {
    if (!seRevisa(it)) continue;
    const m = marcaDeSede(it, sede);
    out[it.sku] = { disponible: m?.disponible ?? 0, revisado: m?.revisado === true };
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

/** ¿Están todos los renglones revisados? Hace falta para confirmar la revisión de la sede. */
export function todoRevisado(items: ItemOrden[], marcas: Record<string, MarcaAlmacen>): boolean {
  const aRevisar = items.filter(seRevisa);
  return aRevisar.length > 0 && aRevisar.every((it) => marcas[it.sku]?.revisado);
}

/** Los renglones con las marcas de una sede puestas encima (para ver cómo quedaría antes de guardar). */
export function conMarcasDeSede(items: ItemOrden[], sede: string, marcas: Record<string, MarcaAlmacen>): ItemRevision[] {
  return items.map((it) => {
    const m = marcas[it.sku];
    if (!m || !seRevisa(it)) return it;
    const prev = (it as ItemRevision).almacen_sedes;
    return { ...it, almacen_sedes: { ...(esObjeto(prev) ? prev : {}), [sede]: { disponible: m.disponible, revisado: m.revisado } } };
  });
}

/* ── Reparto: cuánto entrega cada almacén ── */

export interface RepartoRenglon {
  origenes: Array<{ sede: string; etiqueta: string; cantidad: number }>;
  /** Lo que entrega almacén en total. */
  almacen: number;
  /** Lo que falta (va a Compras). */
  falta: number;
}

/**
 * Cuánto da cada sede de este renglón. Con la SP cerrada usa lo que fijó la base
 * (`almacen_origenes`); mientras se revisa, el mismo reparto que hará la base:
 * Los Pinos primero, después Matanza, hasta lo pedido. Una SP revisada antes del
 * 30-10 (sin sedes) cae en un solo «Almacén».
 */
export function repartoRenglon(it: ItemOrden): RepartoRenglon {
  const pedido = cantidadSolicitada(it);
  const orig = (it as ItemRevision).almacen_origenes;
  const origenes: RepartoRenglon['origenes'] = [];
  if (esObjeto(orig)) {
    const orden = [...SEDES_REVISION_ALMACEN.map((s) => s.sede), ...Object.keys(orig).filter((k) => !SEDES_REVISION_ALMACEN.some((s) => s.sede === k))];
    for (const sede of orden) {
      const c = num(orig[sede]);
      if (c > 0) origenes.push({ sede, etiqueta: etiquetaSede(sede), cantidad: c });
    }
  } else if (esObjeto((it as ItemRevision).almacen_sedes)) {
    let resto = pedido;
    for (const { sede, etiqueta } of SEDES_REVISION_ALMACEN) {
      const m = marcaDeSede(it, sede);
      const c = r4(Math.min(Math.max(m?.revisado ? m.disponible : 0, 0), resto));
      if (c > 0) { origenes.push({ sede, etiqueta, cantidad: c }); resto = r4(resto - c); }
    }
  } else if (num(it.cantidad_almacen) > 0) {
    origenes.push({ sede: '', etiqueta: 'Almacén', cantidad: disponibleAcotado(it, num(it.cantidad_almacen)) });
  }
  const almacen = r4(origenes.reduce((a, o) => a + o.cantidad, 0));
  return { origenes, almacen, falta: Math.max(r4(pedido - almacen), 0) };
}

/** «Los Pinos 3 · Matanza 2» (vacío si almacén no entrega nada). */
export function desgloseAlmacen(it: ItemOrden): string {
  return repartoRenglon(it).origenes.filter((o) => o.sede).map((o) => `${o.etiqueta} ${fmtCant(o.cantidad)}`).join(' · ');
}

function base(it: ItemOrden) {
  return { sku: it.sku, nombre: it.nombre, unidad: it.unidad ?? '' };
}

/**
 * Tiene / falta de TODA la revisión (lo que entregan los almacenes y lo que va a
 * Compras), con lo que entrega cada sede. Sirve para la SP cerrada y, con
 * `conMarcasDeSede`, para ver cómo quedaría antes de confirmar.
 */
export function resumenRevision(items: ItemOrden[]): ResumenRevision {
  const tiene: RenglonResumen[] = [];
  const falta: RenglonResumen[] = [];
  const porSede = new Map<string, EntregaSede>();
  for (const it of items) {
    if (!seRevisa(it) && it.cantidad_almacen == null) continue;
    const rep = repartoRenglon(it);
    if (rep.almacen > 0) tiene.push({ ...base(it), cantidad: rep.almacen });
    if (rep.falta > 0) falta.push({ ...base(it), cantidad: rep.falta });
    for (const o of rep.origenes) {
      const e = porSede.get(o.sede) ?? { sede: o.sede, etiqueta: o.etiqueta, renglones: [] };
      e.renglones.push({ ...base(it), cantidad: o.cantidad });
      porSede.set(o.sede, e);
    }
  }
  const orden = SEDES_REVISION_ALMACEN.map((s) => s.sede);
  const lista = [...porSede.values()].sort((a, b) => {
    const ia = orden.indexOf(a.sede); const ib = orden.indexOf(b.sede);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return { tiene, falta, porSede: lista };
}

/** Tiene / no tiene de UNA sede (con sus marcas en curso, o lo guardado). */
export function resumenSede(items: ItemOrden[], sede: string, marcas?: Record<string, MarcaAlmacen>): ResumenRevision {
  const tiene: RenglonResumen[] = [];
  const falta: RenglonResumen[] = [];
  for (const it of items) {
    if (!seRevisa(it)) continue;
    const m = marcas ? marcas[it.sku] : marcaDeSede(it, sede);
    const disp = m?.revisado ? disponibleAcotado(it, m.disponible) : 0;
    if (disp > 0) tiene.push({ ...base(it), cantidad: disp });
    const resto = r4(cantidadSolicitada(it) - disp);
    if (resto > 0) falta.push({ ...base(it), cantidad: resto });
  }
  return { tiene, falta };
}

/* ── Cómo va cada sede ── */

export interface EstadoSede {
  sede: string;
  etiqueta: string;
  confirmada: boolean;
  revisados: number;
  total: number;
  confirmacion: ConfirmacionSede | null;
}

export function estadoSedes(o: Pick<Orden, 'id' | 'items'> & Partial<OrdenRevision>): EstadoSede[] {
  const items = (o.items ?? []).filter(seRevisa);
  return SEDES_REVISION_ALMACEN.map(({ sede, etiqueta }) => {
    const confirmacion = confirmacionDe(o, sede);
    return {
      sede, etiqueta, confirmacion,
      confirmada: !!confirmacion,
      revisados: items.filter((it) => marcaDeSede(it, sede)?.revisado).length,
      total: items.length,
    };
  });
}

/** «Los Pinos ✓ · Matanza pendiente» (con el avance si ya marcó algo: «Matanza 2/5»). */
export function textoEstadoSedes(o: Pick<Orden, 'id' | 'items'> & Partial<OrdenRevision>): string {
  return estadoSedes(o).map((e) => e.confirmada ? `${e.etiqueta} ✓`
    : e.revisados > 0 ? `${e.etiqueta} ${e.revisados}/${e.total}` : `${e.etiqueta} pendiente`).join(' · ');
}

/** Sedes que todavía no confirmaron (sin contar `excepto`). */
export function sedesPendientes(o: Pick<Orden, 'id' | 'items'> & Partial<OrdenRevision>, excepto?: string): EstadoSede[] {
  return estadoSedes(o).filter((e) => !e.confirmada && e.sede !== excepto);
}

/* ── Mensajes ── */

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
 * La respuesta de UNA sede: «ALMACÉN LOS PINOS HA REVISADO LA ORDEN SP-…», lo que
 * tiene y lo que no tiene. Sale de la SP como quedó al confirmar esa sede.
 */
export function mensajeRevisionSede(
  o: Pick<Orden, 'id' | 'codigo' | 'items'> & Partial<OrdenRevision>,
  sede: string,
  opts?: { revisor?: string | null },
): string {
  const etq = etiquetaSede(sede);
  const conf = confirmacionDe(o, sede);
  const { tiene, falta } = resumenSede(o.items ?? [], sede);
  const partes: string[] = [];
  partes.push(`🏬 *ALMACÉN ${etq.toUpperCase()} HA REVISADO LA ORDEN ${o.codigo}*`);
  partes.push(`📅 ${fechaHoraVE(conf?.confirmada_en)}`);
  const revisor = (opts?.revisor ?? '').trim();
  if (revisor) partes.push(`👤 Revisó: ${revisor}`);
  partes.push('');
  partes.push(`📦 *TIENE (${etq}):*`);
  if (tiene.length) for (const r of tiene) partes.push(linea(r));
  else partes.push('• Nada de lo solicitado');
  partes.push('');
  partes.push(`❌ *NO TIENE (${etq}):*`);
  if (falta.length) for (const r of falta) partes.push(linea(r));
  else partes.push('• Tiene todo lo solicitado');
  const nota = (conf?.nota ?? '').trim();
  if (nota) { partes.push(''); partes.push(`📝 ${nota}`); }
  const pend = sedesPendientes(o, sede);
  partes.push('');
  partes.push(pend.length
    ? `⏳ Falta que responda: ${pend.map((p) => p.etiqueta).join(', ')}`
    : '✅ Respondieron todos los almacenes: la revisión queda completa.');
  return partes.join('\n');
}

/**
 * El mensaje de la revisión completa: «ALMACÉN HA REVISADO LA ORDEN», lo que
 * entrega cada almacén y lo que va a solicitar a Compras.
 */
export function mensajeRevisionAlmacen(
  o: Pick<Orden, 'id' | 'codigo' | 'items' | 'revisada_almacen_en' | 'nota_almacen'> & Partial<OrdenRevision>,
  opts?: { revisor?: string | null; nota?: string | null; nombre?: (correo: string) => string },
): string {
  const { tiene, falta, porSede = [] } = resumenRevision(o.items ?? []);
  const partes: string[] = [];
  partes.push(`✅ *ALMACÉN HA REVISADO LA ORDEN ${o.codigo}*`);
  partes.push(`📅 ${fechaHoraVE(o.revisada_almacen_en)}`);
  const confirmaron = estadoSedes(o).filter((e) => e.confirmada);
  if (confirmaron.length) {
    const quien = (c: ConfirmacionSede | null) => {
      const correo = (c?.confirmada_por ?? '').trim();
      return correo ? (opts?.nombre?.(correo) || correo) : '';
    };
    partes.push(`👤 Revisaron: ${confirmaron.map((e) => [e.etiqueta, quien(e.confirmacion)].filter(Boolean).join(' — ')).join(' · ')}`);
  } else {
    const revisor = (opts?.revisor ?? '').trim();
    if (revisor) partes.push(`👤 Revisó: ${revisor}`);
  }
  partes.push('');
  partes.push('📦 *TIENE (lo entrega almacén):*');
  if (!tiene.length) partes.push('• Nada de lo solicitado');
  else if (porSede.length === 1 && !porSede[0].sede) for (const r of tiene) partes.push(linea(r));
  else {
    porSede.forEach((e, i) => {
      if (i > 0) partes.push('');
      partes.push(`🏬 *${e.etiqueta}:*`);
      for (const r of e.renglones) partes.push(linea(r));
    });
  }
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
