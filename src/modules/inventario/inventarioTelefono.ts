/* ============================================================
   MGG · Inventario y Almacenes · Vista de teléfono (29-10-2026)

   Traída de Golden Touch (Depósito Mina) y adaptada a los almacenes de MGG:
   se elige el almacén y ahí se carga un producto nuevo, una entrada, una
   salida (con «¿retorna?» y fotos), el retorno de lo que salió y —nuevo en
   MGG— el TRASLADO ENTRE ALMACENES directo. Cada botón deja su mensaje de
   WhatsApp, y aparte está el reporte de stock por fechas.

   Acá vive lo que no toca la base: validar, cuánto falta por retornar, el
   stock de un período y los mensajes. Todos los emojis son de color por sí
   mismos, sin el selector U+FE0F (ver combustible/mensajeMovimiento.ts).
   ============================================================ */
import { nombreAlmacenVisible } from './sectorizacion';

export const MAX_FOTOS_SALIDA = 4;

export type EstadoSalidaTelefono = 'sin_retorno' | 'por_retornar' | 'retornada';

export interface FotoSalida { path: string; filename: string }

export interface RetornoSalida {
  at: string;
  cantidad: number;
  nota?: string | null;
  actor?: string | null;
  actor_name?: string | null;
}

export interface SalidaTelefono {
  id: string;
  codigo: string;
  almacen: string;
  producto_id: string;
  producto_nombre: string;
  unidad: string | null;
  cantidad: number;
  motivo: string;
  autorizado_por: string | null;
  retorna: boolean;
  retornado: number;
  retornos: RetornoSalida[];
  fotos: FotoSalida[];
  estado: EstadoSalidaTelefono;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

export const ETIQUETA_ESTADO_SALIDA: Record<EstadoSalidaTelefono, string> = {
  sin_retorno: 'No retorna',
  por_retornar: 'Por retornar',
  retornada: 'Retornó',
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** «2», «2,5» → número; vacío o basura → 0. */
export function leerCantidad(t: string): number {
  const n = Number(String(t ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export const num = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 4 });

/** Cuánto falta por retornar (0 si no retorna o ya volvió todo). */
export function pendienteRetorno(s: Pick<SalidaTelefono, 'retorna' | 'cantidad' | 'retornado'>): number {
  if (!s.retorna) return 0;
  return Math.max(0, r4(Number(s.cantidad) - Number(s.retornado)));
}

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Buscador de «Por retornar»: material, N°, motivo, quién autorizó, quién la cargó o la fecha. */
export function filtrarPorRetornar<T extends SalidaTelefono>(salidas: T[], busca: string): T[] {
  const q = sinAcentos(busca.trim());
  if (!q) return salidas;
  return salidas.filter((s) => sinAcentos([
    s.producto_nombre, s.codigo, s.motivo, s.autorizado_por ?? '', s.actor_name ?? '', fechaHoraVE(s.created_at),
  ].join(' ')).includes(q));
}

/** Lo que impide registrar la salida. `null` = se puede. */
export function errorSalida(d: {
  productoId: string | null; cantidad: number; stock: number; motivo: string; autorizado: string; retorna: boolean | null;
}): string | null {
  if (!d.productoId) return 'Elige el material.';
  if (!(d.cantidad > 0)) return 'Escribe cuánto sale.';
  if (d.cantidad > d.stock) return `No alcanza: en el almacén hay ${num(d.stock)}.`;
  if (d.motivo.trim().length < 3) return 'Escribe el motivo de la salida.';
  if (!d.autorizado.trim()) return 'Indica quién autorizó la salida.';
  if (d.retorna === null) return '¿Retorna? Marca SÍ o NO.';
  return null;
}

/** Lo que impide un retorno. `null` = se puede. */
export function errorRetorno(s: Pick<SalidaTelefono, 'retorna' | 'cantidad' | 'retornado'>, cantidad: number): string | null {
  const falta = pendienteRetorno(s);
  if (!s.retorna) return 'Esa salida no retorna.';
  if (falta <= 0) return 'Esa salida ya retornó completa.';
  if (!(cantidad > 0)) return 'Escribe cuánto retorna.';
  if (cantidad > falta) return `Solo faltan ${num(falta)} por retornar.`;
  return null;
}

/** Lo que impide un traslado. `null` = se puede. */
export function errorTraslado(d: {
  productoId: string | null; origen: string; destino: string; cantidad: number; stock: number; motivo: string;
}): string | null {
  if (!d.productoId) return 'Elige el material.';
  if (!d.destino.trim()) return 'Elige el almacén destino.';
  if (d.destino === d.origen) return 'El destino tiene que ser otro almacén.';
  if (!(d.cantidad > 0)) return 'Escribe cuánto se traslada.';
  if (d.cantidad > d.stock) return `No alcanza: en ${nombreAlmacenVisible(d.origen)} hay ${num(d.stock)}.`;
  if (d.motivo.trim().length < 3) return 'Escribe el motivo del traslado.';
  return null;
}

/** Hasta 4 fotos y solo imágenes. */
export function errorFotos(archivos: { name: string; type: string }[], yaHay = 0): string | null {
  if (yaHay + archivos.length > MAX_FOTOS_SALIDA) return `Se pueden adjuntar hasta ${MAX_FOTOS_SALIDA} fotos.`;
  const mala = archivos.find((f) => !/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name));
  return mala ? `«${mala.name}» no es una imagen.` : null;
}

/** Fecha y hora de Venezuela: «29/10/2026 09:45». */
export function fechaHoraVE(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const f = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const v = (t: string) => f.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`;
}

const conUnidad = (n: number, u?: string | null) => `${num(n)}${u ? ` ${u}` : ''}`;

function pie(almacen: string, quien: string | null | undefined, cuando: string | null | undefined): string[] {
  const l: string[] = [''];
  if (quien) l.push(`👷 *Registrado por:* ${quien}`);
  const f = fechaHoraVE(cuando ?? new Date().toISOString());
  if (f) l.push(`🕒 ${f}`);
  l.push('', `🏢 *MINERAL GROUP GUAYANA C.A.* · ${nombreAlmacenVisible(almacen)}`);
  return l;
}

/** Producto nuevo dado de alta (con lo que entró, si entró algo). */
export function mensajeProductoNuevo(d: {
  almacen: string; sku: string; nombre: string; categoria: string; unidad: string; cantidad: number;
  costo?: number | null; ubicacion?: string | null; quien?: string | null; cuando?: string | null;
}): string {
  const l = [
    '🆕 *PRODUCTO NUEVO EN INVENTARIO*',
    `🏬 *Almacén:* ${nombreAlmacenVisible(d.almacen)}`,
    '',
    `📦 *Producto:* ${d.nombre}`,
    `🔖 *Código:* ${d.sku}`,
    `📂 *Categoría:* ${d.categoria}`,
    `🔢 *Cantidad inicial:* ${conUnidad(d.cantidad, d.unidad)}`,
  ];
  if ((Number(d.costo) || 0) > 0) l.push(`💵 *Costo c/u:* $${num(Number(d.costo))}`);
  if (d.ubicacion?.trim()) l.push(`📍 *Ubicación:* ${d.ubicacion.trim()}`);
  l.push(...pie(d.almacen, d.quien, d.cuando));
  return l.join('\n');
}

/** Entrada a un producto que ya estaba. */
export function mensajeEntrada(d: {
  almacen: string; nombre: string; sku?: string | null; unidad?: string | null; cantidad: number;
  stockDespues: number; costo?: number | null; nota?: string | null; quien?: string | null; cuando?: string | null;
}): string {
  const l = [
    '📥 *ENTRADA A INVENTARIO*',
    `🏬 *Almacén:* ${nombreAlmacenVisible(d.almacen)}`,
    '',
    `📦 *Producto:* ${d.nombre}${d.sku ? ` (${d.sku})` : ''}`,
    `🔢 *Entró:* ${conUnidad(d.cantidad, d.unidad)}`,
    `📊 *Queda en:* ${conUnidad(d.stockDespues, d.unidad)}`,
  ];
  if ((Number(d.costo) || 0) > 0) l.push(`💵 *Costo c/u:* $${num(Number(d.costo))}`);
  if (d.nota?.trim()) l.push(`📝 *Nota:* ${d.nota.trim()}`);
  l.push(...pie(d.almacen, d.quien, d.cuando));
  return l.join('\n');
}

/** El aviso de la salida. */
export function mensajeSalida(s: SalidaTelefono, quien?: string | null): string {
  const l = [
    '📤 *SALIDA DE ALMACÉN*',
    `🔖 *N°:* ${s.codigo}`,
    `🏬 *Almacén:* ${nombreAlmacenVisible(s.almacen)}`,
    '',
    `📦 *Material:* ${s.producto_nombre}`,
    `🔢 *Cantidad:* ${conUnidad(s.cantidad, s.unidad)}`,
    `📝 *Motivo:* ${s.motivo}`,
  ];
  if (s.autorizado_por) l.push(`✅ *Autorizado por:* ${s.autorizado_por}`);
  l.push(s.retorna ? '🔄 *Retorna:* SÍ' : '❌ *Retorna:* NO');
  if (s.fotos.length) l.push(`📷 *Fotos:* ${s.fotos.length}`);
  l.push(...pie(s.almacen, quien ?? s.actor_name ?? s.actor, s.created_at));
  return l.join('\n');
}

/** El aviso de un retorno (total o parcial). `s` es la salida YA actualizada. */
export function mensajeRetorno(s: SalidaTelefono, cantidad: number, nota?: string | null, quien?: string | null, cuando?: string | null): string {
  const falta = pendienteRetorno(s);
  const l = [
    '🔄 *RETORNO AL ALMACÉN*',
    `🔖 *Salida:* ${s.codigo}`,
    `🏬 *Almacén:* ${nombreAlmacenVisible(s.almacen)}`,
    '',
    `📦 *Material:* ${s.producto_nombre}`,
    `🔢 *Retorna:* ${conUnidad(cantidad, s.unidad)} de ${conUnidad(s.cantidad, s.unidad)}`,
    falta > 0 ? `⏳ *Falta por retornar:* ${conUnidad(falta, s.unidad)}` : '✅ *Retornó completo*',
  ];
  if (nota?.trim()) l.push(`📝 *Nota:* ${nota.trim()}`);
  l.push(...pie(s.almacen, quien, cuando));
  return l.join('\n');
}

/** El aviso del traslado entre almacenes. */
export function mensajeTraslado(d: {
  origen: string; destino: string; nombre: string; sku?: string | null; unidad?: string | null; cantidad: number;
  motivo: string; quedaOrigen?: number | null; quien?: string | null; cuando?: string | null;
}): string {
  const l = [
    '🔁 *TRASLADO ENTRE ALMACENES*',
    `🏬 *De:* ${nombreAlmacenVisible(d.origen)}`,
    `🏬 *A:* ${nombreAlmacenVisible(d.destino)}`,
    '',
    `📦 *Material:* ${d.nombre}${d.sku ? ` (${d.sku})` : ''}`,
    `🔢 *Cantidad:* ${conUnidad(d.cantidad, d.unidad)}`,
    `📝 *Motivo:* ${d.motivo.trim()}`,
  ];
  if (d.quedaOrigen != null) l.push(`📊 *Queda en ${nombreAlmacenVisible(d.origen)}:* ${conUnidad(d.quedaOrigen, d.unidad)}`);
  l.push(...pie(d.origen, d.quien, d.cuando));
  return l.join('\n');
}

/* ── Reporte de stock por período (igual que en GT) ── */

export interface ProductoStock {
  id: string;
  nombre: string;
  categoria?: string | null;
  unidad?: string | null;
  /** Stock HOY en el almacén. */
  stock: number | string | null;
}

export interface MovimientoStock {
  producto_id: string;
  delta: number | string;
  at: string;
}

export interface FilaStockPeriodo {
  id: string;
  nombre: string;
  categoria: string;
  unidad: string;
  inicio: number;
  entradas: number;
  salidas: number;
  cierre: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const diaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Día (AAAA-MM-DD) en hora de Venezuela de un instante ISO. */
export function diaVE(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : diaFmt.format(d);
}

/** «2026-10-01» → «01/10/2026». */
export function fechaCortaVE(dia: string): string {
  const [y, m, d] = dia.split('-');
  return y && m && d ? `${d}/${m}/${y}` : dia;
}

/**
 * Stock de cada producto en el período: el de hoy menos lo que se movió DESPUÉS del
 * «hasta». Quedan los que cierran con existencia o tuvieron movimiento en esas fechas.
 */
export function stockPorPeriodo(
  productos: ProductoStock[], movimientos: MovimientoStock[], desde: string, hasta: string,
): FilaStockPeriodo[] {
  const acc = new Map<string, { despues: number; entradas: number; salidas: number; movio: boolean }>();
  for (const m of movimientos) {
    const dia = diaVE(m.at);
    if (!dia || dia < desde) continue;
    const delta = Number(m.delta) || 0;
    const a = acc.get(m.producto_id) ?? { despues: 0, entradas: 0, salidas: 0, movio: false };
    if (dia > hasta) a.despues += delta;
    else {
      a.movio = true;
      if (delta > 0) a.entradas += delta; else a.salidas += -delta;
    }
    acc.set(m.producto_id, a);
  }
  const filas: FilaStockPeriodo[] = [];
  for (const p of productos) {
    const a = acc.get(p.id);
    const cierre = r3((Number(p.stock) || 0) - (a?.despues ?? 0));
    const entradas = r3(a?.entradas ?? 0);
    const salidas = r3(a?.salidas ?? 0);
    if (cierre === 0 && !a?.movio) continue;
    filas.push({
      id: p.id,
      nombre: p.nombre,
      categoria: (p.categoria ?? '').trim() || 'SIN CATEGORÍA',
      unidad: (p.unidad ?? '').trim(),
      inicio: r3(cierre - entradas + salidas),
      entradas, salidas, cierre,
    });
  }
  return filas.sort((x, y) => x.categoria.localeCompare(y.categoria, 'es') || x.nombre.localeCompare(y.nombre, 'es'));
}

/** El reporte de stock de un almacén, listo para WhatsApp. */
export function mensajeStock(
  almacen: string, filas: FilaStockPeriodo[], desde: string, hasta: string,
  opts: { quien?: string | null; cuando?: string | null } = {},
): string {
  const l = [
    `📦 *STOCK · ${nombreAlmacenVisible(almacen).toUpperCase()}*`,
    desde === hasta
      ? `📅 *Fecha:* ${fechaCortaVE(hasta)}`
      : `📅 *Período:* ${fechaCortaVE(desde)} al ${fechaCortaVE(hasta)}`,
    `📊 *Existencia al cierre del ${fechaCortaVE(hasta)}*`,
  ];
  if (!filas.length) {
    l.push('', 'Sin existencias ni movimientos en esas fechas.');
  } else {
    let cat = '';
    for (const f of filas) {
      if (f.categoria !== cat) {
        cat = f.categoria;
        l.push('', `📂 *${cat}*`);
      }
      const mov: string[] = [];
      if (f.entradas > 0) mov.push(`📥 +${num(f.entradas)}`);
      if (f.salidas > 0) mov.push(`📤 −${num(f.salidas)}`);
      l.push(`• ${f.nombre}: *${conUnidad(f.cierre, f.unidad)}*${mov.length ? ` (${mov.join(' · ')})` : ''}`);
    }
    const conStock = filas.filter((f) => f.cierre > 0).length;
    const movidos = filas.filter((f) => f.entradas > 0 || f.salidas > 0).length;
    l.push('', `🔢 *Productos con existencia:* ${conStock}`);
    if (movidos) l.push(`🔄 *Con movimiento en el período:* ${movidos}`);
  }
  l.push('');
  if (opts.quien) l.push(`👷 *Generado por:* ${opts.quien}`);
  const f = fechaHoraVE(opts.cuando ?? new Date().toISOString());
  if (f) l.push(`🕒 ${f}`);
  l.push('', `🏢 *MINERAL GROUP GUAYANA C.A.* · ${nombreAlmacenVisible(almacen)}`);
  return l.join('\n');
}
