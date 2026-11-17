/* ============================================================
   Golden Touch · Compras · Motor del Reporte Moldeable
   (10/11/2026)

   Motor de datos PURO y SÍNCRONO para el reporte de compras flexible,
   calcado del de Tesorería/Inventario. Une TRES fuentes de compra en una
   sola fila normalizada:
     · ordenes            → OC con cotización (EstadoOrden, con departamento)
     · compras_directas   → sin departamento; se agrupan por categoría de gasto
     · servicios_directos → con departamento (unidad_solicitante)

   REGLA DE ORO: aquí NO se lee de Supabase. Las funciones reciben los datos
   YA leídos por la capa de datos (`datosReporteCompras.ts`), más el contexto
   de tasa BCV y los mapas de apoyo. Así todo el cálculo es determinista y
   testeable con fixtures.

   REGLA DURA (palabras del usuario): ninguna clave interna, sigla, uuid ni
   `null` llega a pantalla. Los datos faltantes van a buckets con nombre claro.
   ============================================================ */

import type { Orden } from '@/shared/lib/types';
import type { CompraDirecta } from './compras.repository';
import type { ServicioDirecto } from './serviciosDirectos.repository';
import { statusBadge } from '@/shared/lib/format';
import { nombrePersonaCompras } from './personasCompras';

/* ───────────── Tipos de configuración ───────────── */

/** Grano del dato que se está reportando. */
export type AmbitoCompras = 'ordenes' | 'items';

/** De qué fuente salió la compra. */
export type TipoCompra = 'orden' | 'directa' | 'servicio';

/** Clase de estado unificada para las tres fuentes. */
export type ClaseEstadoCompra = 'finalizada' | 'pendiente' | 'excluida';

/** Dimensión principal de agrupación de las filas. */
export type ModoAgrupacionCompras =
  | 'departamento'
  | 'proveedor'
  | 'estado'
  | 'clasificacion'
  | 'tipo'
  | 'categoria'
  | 'producto'
  | 'mes'
  | 'dia'
  | 'detallado';

/* ───────────── Buckets con nombre claro (datos faltantes) ───────────── */

export const SIN_DEPARTAMENTO = 'Sin departamento asignado';
export const SIN_CATEGORIA_INV = 'Servicios / sin categoría';
export const SIN_CATEGORIA_GASTO = 'Sin categoría de gasto';

/* ───────────── Contexto (tasa + mapas, ya leídos) ───────────── */

export interface ContextoCompras {
  /** Tasa BCV del día (Bs por $). 0 = no se pudo resolver → no se convierte. */
  tasaBcv: number;
  /** sku → categoría de inventario (cruce con el catálogo de Inventario). */
  categoriasPorSku: Map<string, string>;
  /** proveedor_id → razón social (para mostrar nombre, nunca el id). */
  nombreProveedor: Map<string, string>;
}

/* ───────────── Clasificación de estados ───────────── */

/** Órdenes finalizadas (compra cerrada): pagada/finalizada/recibida/por_recibir. */
const ORDEN_FINALIZADA = new Set(['finalizada', 'pagada', 'recibida', 'por_recibir']);
/** Órdenes pendientes (ciclo de compra abierto). */
const ORDEN_PENDIENTE = new Set(['oc_creada', 'confirmada_metodo', 'oc_aprobada', 'cuenta_abierta', 'oc_emitida']);
// Todo lo demás (cancelada, rechazada, revision_almacen, pendiente, aprobada…) → excluida.

/** Clase de estado de una ORDEN (`EstadoOrden`). */
export function clasificarEstadoOrden(estado: string): ClaseEstadoCompra {
  if (ORDEN_FINALIZADA.has(estado)) return 'finalizada';
  if (ORDEN_PENDIENTE.has(estado)) return 'pendiente';
  return 'excluida';
}

/** Clase de estado de una COMPRA/SERVICIO DIRECTO (en_proceso/por_pagar/finalizada). */
export function clasificarEstadoDirectaServicio(estado: string): ClaseEstadoCompra {
  if (estado === 'finalizada') return 'finalizada';
  if (estado === 'por_pagar') return 'pendiente';
  return 'excluida'; // en_proceso (sin monto aún) queda fuera del reporte
}

/* ───────────── Conversión multimoneda ───────────── */

/** Redondeo a 2 decimales. */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Convierte un monto nativo a $ y Bs con la tasa BCV. USD/USDT 1:1 con $; Bs por
 * tasa. Si no hay tasa válida (≤0), NO se divide/multiplica por cero: el lado que
 * requiere la tasa queda en 0 y el nativo se conserva. Nunca devuelve NaN/Infinity.
 */
export function montoUsdBs(montoOriginal: number, moneda: string, tasaBcv: number): { usd: number; bs: number } {
  const monto = Number(montoOriginal) || 0;
  const tasa = Number(tasaBcv) || 0;
  const esBs = (moneda || '').toUpperCase() === 'BS';
  if (esBs) {
    return { usd: tasa > 0 ? round2(monto / tasa) : 0, bs: round2(monto) };
  }
  // USD, USDT o cualquier divisa que se trata 1:1 con el dólar.
  return { usd: round2(monto), bs: tasa > 0 ? round2(monto * tasa) : 0 };
}

/* ───────────── Normalización de texto ───────────── */

/** Recorta y colapsa espacios de un nombre de departamento; vacío → bucket nombrado. */
export function normalizarDepartamento(valor: string | null | undefined): string {
  const limpio = (valor ?? '').replace(/\s+/g, ' ').trim();
  return limpio || SIN_DEPARTAMENTO;
}

/* ───────────── Utilidades de fecha ───────────── */

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Día (YYYY-MM-DD) de un instante ISO o de una fecha ya en ese formato. */
export function diaDe(valor: string | null | undefined): string {
  const s = (valor ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Etiqueta "Mes Año" a partir de un YYYY-MM o YYYY-MM-DD. */
export function mesEtiqueta(fechaIso: string): string {
  const [y, m] = (fechaIso || '').split('-');
  const mesIdx = Number(m) - 1;
  if (mesIdx >= 0 && mesIdx < 12 && y) return `${MESES_ES[mesIdx]} ${y}`;
  return fechaIso || 'Sin fecha';
}

/* ───────────── Fila normalizada ───────────── */

export interface FilaReporteCompras {
  id: string;
  ambito: AmbitoCompras;
  tipo_compra: TipoCompra;

  fecha: string;              // YYYY-MM-DD (ancla: created_at)
  codigo: string;             // OC-/CD-/SD-… (nunca el uuid)
  departamento: string;       // unidad_solicitante normalizada o «Sin departamento asignado»
  proveedor: string;          // razón social o «—»
  estado: string;             // estado crudo (para agrupar)
  estado_rotulo: string;      // rótulo en palabras del usuario
  clase_estado: ClaseEstadoCompra;

  categoria: string;          // categoría de inventario (ámbito ítems) o ''
  categoria_gasto: string | null; // solo compras directas
  nombre_item: string;        // nombre del ítem (ámbito ítems) o ''
  cantidad: number | null;    // cantidad del ítem (ámbito ítems)

  moneda_original: string;
  monto_original: number;
  monto_usd: number;
  monto_bs: number;
  pagado_usd: number;
  pagado_bs: number;
  analista?: string | null;
  notas?: string | null;
  items_lista?: Array<{
    nombre: string;
    cantidad: number;
    unidad?: string | null;
    precio_unitario?: number | null;
    monto_usd?: number | null;
  }> | null;

  // Métricas de grupo (cuando la fila representa un grupo agregado)
  total_items?: number;
  pct_del_total?: number;
}

/* ───────────── Normalizadores (ámbito órdenes: una fila = una compra) ───────────── */

/** Nombre del proveedor por id (o «—» si no hay). */
function proveedorDe(id: string | null | undefined, ctx: ContextoCompras): string {
  const nombre = id ? ctx.nombreProveedor.get(id) : null;
  return (nombre || '').trim() || '—';
}

/**
 * Normaliza las ÓRDENES (`ordenes`) a filas del reporte. Descarta las de clase
 * `excluida` (canceladas/rechazadas/solicitudes previas a la OC). El monto sale de
 * `total`/`total_moneda`; lo pagado, de `total` si tiene fecha de pago o de
 * `abonado_total` si está a crédito.
 */
export function normalizarOrdenes(ordenes: Orden[], ctx: ContextoCompras): FilaReporteCompras[] {
  const filas: FilaReporteCompras[] = [];
  for (const o of ordenes) {
    const clase = clasificarEstadoOrden(o.estado);
    if (clase === 'excluida') continue;
    const moneda = (o.total_moneda || 'USD').toUpperCase();
    const monto = Number(o.total) || 0;
    const { usd, bs } = montoUsdBs(monto, moneda, ctx.tasaBcv);
    const pagadoNativo = o.pagada_en
      ? monto
      : (o.estado === 'cuenta_abierta' ? (Number(o.abonado_total) || 0) : 0);
    const pagado = montoUsdBs(pagadoNativo, moneda, ctx.tasaBcv);
    filas.push({
      id: `oc-${o.id}`,
      ambito: 'ordenes',
      tipo_compra: 'orden',
      fecha: diaDe(o.created_at),
      codigo: (o.oc_codigo || o.codigo || '—').trim() || '—',
      departamento: normalizarDepartamento(o.unidad_solicitante),
      proveedor: proveedorDe(o.proveedor_id, ctx),
      estado: o.estado,
      estado_rotulo: statusBadge(o.estado).label,
      clase_estado: clase,
      categoria: '',
      categoria_gasto: null,
      nombre_item: '',
      cantidad: null,
      moneda_original: moneda,
      monto_original: round2(monto),
      monto_usd: usd,
      monto_bs: bs,
      pagado_usd: pagado.usd,
      pagado_bs: pagado.bs,
      analista: nombrePersonaCompras(o.oc_creada_por || o.oc_emitida_por || o.solicitante_email),
      notas: (o.notas || o.motivo || o.finalidad || '').trim() || null,
      items_lista: (Array.isArray(o.items) ? o.items : []).map((it) => {
        const cant = Number(it.cantidad) || 0;
        const pUnit = (Number(it.precio_usd) > 0 ? Number(it.precio_usd) : Number(it.precio)) || 0;
        const itMonto = montoUsdBs(cant * pUnit, moneda, ctx.tasaBcv);
        return {
          nombre: (it.nombre || '').trim() || '—',
          cantidad: cant,
          unidad: (it.unidad || '').trim() || 'u.',
          precio_unitario: pUnit,
          monto_usd: itMonto.usd,
        };
      }),
    });
  }
  return filas;
}

/**
 * Normaliza las ÓRDENES al ámbito ÍTEMS: una fila por ítem de cada orden no
 * excluida. De aquí salen «ítem más comprado» y «por categoría de inventario».
 * La categoría se cruza con el catálogo de Inventario (`categoriasPorSku`); los
 * ítems sin categoría (servicios, sku desconocido) van a «Servicios / sin categoría».
 * Solo aplica a órdenes: las compras/servicios directos no llevan ítems de inventario.
 */
export function normalizarItemsOrdenes(ordenes: Orden[], ctx: ContextoCompras): FilaReporteCompras[] {
  const filas: FilaReporteCompras[] = [];
  for (const o of ordenes) {
    const clase = clasificarEstadoOrden(o.estado);
    if (clase === 'excluida') continue;
    const moneda = (o.total_moneda || 'USD').toUpperCase();
    const codigo = (o.oc_codigo || o.codigo || '—').trim() || '—';
    const depto = normalizarDepartamento(o.unidad_solicitante);
    const prov = proveedorDe(o.proveedor_id, ctx);
    const rotulo = statusBadge(o.estado).label;
    const items = Array.isArray(o.items) ? o.items : [];
    const totalOrden = Number(o.total) || 0;
    const sumaPrecioNativo = items.reduce(
      (acc, it) => acc + (Number(it.cantidad) || 0) * (Number(it.precio) || 0),
      0,
    );
    // Si la orden está en USD y la suma de ítems coincide con el total de la orden
    // (o no excede desproporcionadamente la tasa BCV), it.precio ya está en USD.
    const precioDirectoUsd =
      moneda !== 'BS' &&
      totalOrden > 0 &&
      (Math.abs(sumaPrecioNativo - totalOrden) <= Math.max(2, totalOrden * 0.1) ||
        (sumaPrecioNativo <= totalOrden * 1.5 && (ctx.tasaBcv <= 1 || sumaPrecioNativo < totalOrden * (ctx.tasaBcv * 0.1))));

    items.forEach((it, idx) => {
      const cantidad = Number(it.cantidad) || 0;
      let montoNativo: number;
      if (moneda === 'BS') {
        montoNativo = cantidad * (Number(it.precio) || 0);
      } else {
        let precioUsd: number;
        if (Number(it.precio_usd) > 0) {
          precioUsd = Number(it.precio_usd);
        } else if (precioDirectoUsd) {
          precioUsd = Number(it.precio) || 0;
        } else {
          precioUsd = ctx.tasaBcv > 0 ? (Number(it.precio) || 0) / ctx.tasaBcv : (Number(it.precio) || 0);
        }
        montoNativo = cantidad * precioUsd;
      }
      const monto = round2(montoNativo);
      const { usd, bs } = montoUsdBs(monto, moneda, ctx.tasaBcv);
      const categoria = (ctx.categoriasPorSku.get(it.sku) || '').trim() || SIN_CATEGORIA_INV;
      filas.push({
        id: `oci-${o.id}-${idx}`,
        ambito: 'items',
        tipo_compra: 'orden',
        fecha: diaDe(o.created_at),
        codigo,
        departamento: depto,
        proveedor: prov,
        estado: o.estado,
        estado_rotulo: rotulo,
        clase_estado: clase,
        categoria,
        categoria_gasto: null,
        nombre_item: (it.nombre || '').trim() || '—',
        cantidad,
        moneda_original: moneda,
        monto_original: monto,
        monto_usd: usd,
        monto_bs: bs,
        pagado_usd: 0,
        pagado_bs: 0,
        analista: nombrePersonaCompras(o.oc_creada_por || o.oc_emitida_por || o.solicitante_email),
        notas: (o.notas || o.motivo || o.finalidad || '').trim() || null,
        items_lista: [{
          nombre: (it.nombre || '').trim() || '—',
          cantidad,
          unidad: (it.unidad || '').trim() || 'u.',
          precio_unitario: Number(it.precio_usd) > 0 ? Number(it.precio_usd) : Number(it.precio) || 0,
          monto_usd: usd,
        }],
      });
    });
  }
  return filas;
}

/**
 * Normaliza las COMPRAS DIRECTAS (`compras_directas`) a filas. Sin departamento
 * (bucket nombrado); se agrupan por categoría de gasto (`gasto_categoria`).
 * `en_proceso` queda fuera (sin monto). Lo pagado sale de `gasto` si tiene
 * `pagada_at`.
 */
export function normalizarDirectas(directas: CompraDirecta[], ctx: ContextoCompras): FilaReporteCompras[] {
  const filas: FilaReporteCompras[] = [];
  for (const c of directas) {
    const clase = clasificarEstadoDirectaServicio(c.estado);
    if (clase === 'excluida') continue;
    const moneda = (c.moneda || 'USD').toUpperCase();
    const monto = Number(c.gasto) || 0;
    const { usd, bs } = montoUsdBs(monto, moneda, ctx.tasaBcv);
    const pagado = montoUsdBs(c.pagada_at ? monto : 0, moneda, ctx.tasaBcv);
    filas.push({
      id: `cd-${c.id}`,
      ambito: 'ordenes',
      tipo_compra: 'directa',
      fecha: diaDe(c.created_at),
      codigo: (c.codigo || '—').trim() || '—',
      departamento: SIN_DEPARTAMENTO,
      proveedor: (c.proveedor_nombre || '').trim() || proveedorDe(c.proveedor_id, ctx),
      estado: c.estado,
      estado_rotulo: statusBadge(c.estado).label,
      clase_estado: clase,
      categoria: '',
      categoria_gasto: (c.gasto_categoria || '').trim() || SIN_CATEGORIA_GASTO,
      nombre_item: '',
      cantidad: null,
      moneda_original: moneda,
      monto_original: round2(monto),
      monto_usd: usd,
      monto_bs: bs,
      pagado_usd: pagado.usd,
      pagado_bs: pagado.bs,
      analista: nombrePersonaCompras((c as any).actor_name || (c as any).actor || (c as any).creado_por),
      notas: ((c as any).nota || '').trim() || null,
      items_lista: Array.isArray((c as any).items) && (c as any).items.length > 0
        ? (c as any).items.map((it: any) => ({
            nombre: (it.producto_nombre || (c as any).producto_nombre || '—').trim(),
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || 'u.',
            precio_unitario: it.gasto ? Number(it.gasto) / (Number(it.cantidad) || 1) : null,
            monto_usd: usd,
          }))
        : ((c as any).producto_nombre ? [{
            nombre: ((c as any).producto_nombre || '—').trim(),
            cantidad: Number((c as any).cantidad) || 1,
            unidad: 'u.',
            precio_unitario: monto,
            monto_usd: usd,
          }] : null),
    });
  }
  return filas;
}

/**
 * Normaliza los SERVICIOS DIRECTOS (`servicios_directos`) a filas. Traen
 * `unidad_solicitante` (departamento). `en_proceso` fuera. Lo pagado sale de
 * `gasto` si tiene `pagada_at`, o de `abonado_total` (pago con abonos).
 */
export function normalizarServicios(servicios: ServicioDirecto[], ctx: ContextoCompras): FilaReporteCompras[] {
  const filas: FilaReporteCompras[] = [];
  for (const s of servicios) {
    const clase = clasificarEstadoDirectaServicio(s.estado);
    if (clase === 'excluida') continue;
    const moneda = (s.moneda || 'USD').toUpperCase();
    const monto = Number(s.gasto) || 0;
    const { usd, bs } = montoUsdBs(monto, moneda, ctx.tasaBcv);
    const pagadoNativo = s.pagada_at ? monto : (Number(s.abonado_total) || 0);
    const pagado = montoUsdBs(pagadoNativo, moneda, ctx.tasaBcv);
    filas.push({
      id: `sd-${s.id}`,
      ambito: 'ordenes',
      tipo_compra: 'servicio',
      fecha: diaDe(s.created_at),
      codigo: (s.codigo || '—').trim() || '—',
      departamento: normalizarDepartamento(s.unidad_solicitante),
      proveedor: (s.proveedor_nombre || '').trim() || proveedorDe(s.proveedor_id, ctx),
      estado: s.estado,
      estado_rotulo: statusBadge(s.estado).label,
      clase_estado: clase,
      categoria: '',
      categoria_gasto: null,
      nombre_item: '',
      cantidad: null,
      moneda_original: moneda,
      monto_original: round2(monto),
      monto_usd: usd,
      monto_bs: bs,
      pagado_usd: pagado.usd,
      pagado_bs: pagado.bs,
      analista: nombrePersonaCompras((s as any).actor_name || (s as any).actor || (s as any).creado_por),
      notas: ((s as any).observaciones || (s as any).descripcion || '').trim() || null,
      items_lista: Array.isArray((s as any).items) && (s as any).items.length > 0
        ? (s as any).items.map((it: any) => ({
            nombre: (it.descripcion || 'Servicio directo').trim(),
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || 'srv.',
            precio_unitario: it.gasto ? Number(it.gasto) / (Number(it.cantidad) || 1) : null,
            monto_usd: usd,
          }))
        : [{
            nombre: ((s as any).descripcion || 'Servicio directo').trim(),
            cantidad: 1,
            unidad: 'srv.',
            precio_unitario: monto,
            monto_usd: usd,
          }],
    });
  }
  return filas;
}

/* ───────────── Filtros ───────────── */

export interface FiltrosCompras {
  departamentosSel?: string[];
  categoriasSel?: string[];
  proveedoresSel?: string[];
  estadosSel?: ClaseEstadoCompra[];
  tiposSel?: TipoCompra[];
}

/** Filtra las filas por las selecciones (vacío/omitido = sin filtro). */
export function filtrarFilasCompras(filas: FilaReporteCompras[], f: FiltrosCompras): FilaReporteCompras[] {
  const { departamentosSel, categoriasSel, proveedoresSel, estadosSel, tiposSel } = f;
  return filas.filter((row) => {
    if (departamentosSel && departamentosSel.length > 0 && !departamentosSel.includes(row.departamento)) return false;
    if (categoriasSel && categoriasSel.length > 0 && !categoriasSel.includes(row.categoria)) return false;
    if (proveedoresSel && proveedoresSel.length > 0 && !proveedoresSel.includes(row.proveedor)) return false;
    if (estadosSel && estadosSel.length > 0 && !estadosSel.includes(row.clase_estado)) return false;
    if (tiposSel && tiposSel.length > 0 && !tiposSel.includes(row.tipo_compra)) return false;
    return true;
  });
}

/* ───────────── Resumen / KPIs ───────────── */

/** Cotización ya atribuida a un departamento por la capa de datos. */
export interface CotizacionCompras {
  departamento: string;
}

export interface RankDepto {
  departamento: string;
  usd: number;
  bs: number;
  pct: number;
}

export interface BloqueCategoriaGasto {
  categoria: string;
  usd: number;
  bs: number;
}

export interface TopCompras {
  nombre: string;
  usd: number;
  cantidad?: number;
}

export interface ResumenReporteCompras {
  totalCompras: number;
  totalUsd: number;
  totalBs: number;
  finalizadasCount: number;
  finalizadasUsd: number;
  finalizadasBs: number;
  pendientesCount: number;
  pendientesUsd: number;
  pendientesBs: number;
  pagadoUsd: number;
  pagadoBs: number;
  rankingDeptoGasto: RankDepto[];
  comprasDirectasPorCategoriaGasto: BloqueCategoriaGasto[];
  totalDirectasUsd: number;
  totalDirectasBs: number;
  rankingDeptoCotizaciones: { departamento: string; cotizaciones: number }[];
  topCategorias: TopCompras[];
  topItems: TopCompras[];
  deptoQueMasGasto: string | null;
  tasaBcv: number;
}

/** Top-N de una clave sumando usd (y, opcional, cantidad). */
function topPor(
  filas: FilaReporteCompras[],
  clave: (f: FilaReporteCompras) => string,
  conCantidad: boolean,
  n = 5,
): TopCompras[] {
  const usd = new Map<string, number>();
  const cant = new Map<string, number>();
  for (const f of filas) {
    const k = clave(f);
    usd.set(k, (usd.get(k) || 0) + (f.monto_usd || 0));
    if (conCantidad) cant.set(k, (cant.get(k) || 0) + (f.cantidad || 0));
  }
  return Array.from(usd.entries())
    .map(([nombre, v]) => (conCantidad
      ? { nombre, usd: round2(v), cantidad: round2(cant.get(nombre) || 0) }
      : { nombre, usd: round2(v) }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, n);
}

/**
 * Resumen/KPIs del rango. `filasOrdenes` = ámbito órdenes (las 3 fuentes, ya sin
 * excluidas); `filasItems` = ámbito ítems (solo órdenes); `cotizaciones` = ya
 * atribuidas a su departamento por la capa de datos.
 *
 * Reglas duras (decisión de la líder):
 *  · Total del rango: incluye las TRES fuentes.
 *  · Ranking por departamento: SOLO órdenes + servicios (EXCLUYE compras directas).
 *  · Compras directas: bloque propio por categoría de gasto, dentro del total.
 */
export function resumenCompras(
  filasOrdenes: FilaReporteCompras[],
  filasItems: FilaReporteCompras[],
  cotizaciones: CotizacionCompras[],
  tasaBcv: number,
): ResumenReporteCompras {
  let totalUsd = 0, totalBs = 0;
  let finCount = 0, finUsd = 0, finBs = 0;
  let penCount = 0, penUsd = 0, penBs = 0;
  let pagUsd = 0, pagBs = 0;
  let dirUsd = 0, dirBs = 0;

  const gastoDepto = new Map<string, { usd: number; bs: number }>();
  const dirPorCat = new Map<string, { usd: number; bs: number }>();

  for (const f of filasOrdenes) {
    totalUsd += f.monto_usd; totalBs += f.monto_bs;
    if (f.clase_estado === 'finalizada') { finCount += 1; finUsd += f.monto_usd; finBs += f.monto_bs; }
    else if (f.clase_estado === 'pendiente') { penCount += 1; penUsd += f.monto_usd; penBs += f.monto_bs; }
    pagUsd += f.pagado_usd; pagBs += f.pagado_bs;

    if (f.tipo_compra === 'directa') {
      dirUsd += f.monto_usd; dirBs += f.monto_bs;
      const cat = f.categoria_gasto || SIN_CATEGORIA_GASTO;
      const g = dirPorCat.get(cat) || { usd: 0, bs: 0 };
      g.usd += f.monto_usd; g.bs += f.monto_bs; dirPorCat.set(cat, g);
    } else {
      // órdenes + servicios directos entran al ranking por departamento
      const g = gastoDepto.get(f.departamento) || { usd: 0, bs: 0 };
      g.usd += f.monto_usd; g.bs += f.monto_bs; gastoDepto.set(f.departamento, g);
    }
  }

  const baseRanking = Array.from(gastoDepto.values()).reduce((a, g) => a + Math.abs(g.usd), 0);
  const rankingDeptoGasto: RankDepto[] = Array.from(gastoDepto.entries())
    .map(([departamento, g]) => ({
      departamento,
      usd: round2(g.usd),
      bs: round2(g.bs),
      pct: baseRanking > 0 ? Math.round((g.usd / baseRanking) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.usd - a.usd);

  const comprasDirectasPorCategoriaGasto: BloqueCategoriaGasto[] = Array.from(dirPorCat.entries())
    .map(([categoria, g]) => ({ categoria, usd: round2(g.usd), bs: round2(g.bs) }))
    .sort((a, b) => b.usd - a.usd);

  const cotDepto = new Map<string, number>();
  for (const c of cotizaciones) cotDepto.set(c.departamento, (cotDepto.get(c.departamento) || 0) + 1);
  const rankingDeptoCotizaciones = Array.from(cotDepto.entries())
    .map(([departamento, n]) => ({ departamento, cotizaciones: n }))
    .sort((a, b) => b.cotizaciones - a.cotizaciones);

  return {
    totalCompras: filasOrdenes.length,
    totalUsd: round2(totalUsd),
    totalBs: round2(totalBs),
    finalizadasCount: finCount,
    finalizadasUsd: round2(finUsd),
    finalizadasBs: round2(finBs),
    pendientesCount: penCount,
    pendientesUsd: round2(penUsd),
    pendientesBs: round2(penBs),
    pagadoUsd: round2(pagUsd),
    pagadoBs: round2(pagBs),
    rankingDeptoGasto,
    comprasDirectasPorCategoriaGasto,
    totalDirectasUsd: round2(dirUsd),
    totalDirectasBs: round2(dirBs),
    rankingDeptoCotizaciones,
    topCategorias: topPor(filasItems, (f) => f.categoria, false),
    topItems: topPor(filasItems, (f) => f.nombre_item, true),
    deptoQueMasGasto: rankingDeptoGasto[0]?.departamento ?? null,
    tasaBcv,
  };
}

/* ───────────── Catálogo de columnas ───────────── */

export interface CampoColumnaCompras {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoPdf: number;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'porcentaje';
  /** En qué ámbito tiene sentido la columna ('ambos' por defecto). */
  ambito?: AmbitoCompras | 'ambos';
}

export const CAMPOS_REPORTE_COMPRAS: CampoColumnaCompras[] = [
  { clave: 'fecha', etiqueta: 'Fecha', anchoPdf: 14, anchoExcel: 13, alineacion: 'center', formato: 'texto', descripcion: 'Fecha de la compra', ambito: 'ambos' },
  { clave: 'codigo', etiqueta: 'Código', anchoPdf: 16, anchoExcel: 16, alineacion: 'left', formato: 'texto', descripcion: 'Correlativo (OC/CD/SD)', ambito: 'ambos' },
  { clave: 'departamento', etiqueta: 'Departamento', anchoPdf: 22, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Unidad solicitante', ambito: 'ambos' },
  { clave: 'proveedor', etiqueta: 'Proveedor', anchoPdf: 26, anchoExcel: 26, alineacion: 'left', formato: 'texto', descripcion: 'Razón social del proveedor', ambito: 'ambos' },
  { clave: 'analista', etiqueta: 'Analista', anchoPdf: 22, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Analista de compras a cargo', ambito: 'ambos' },
  { clave: 'estado_rotulo', etiqueta: 'Estado', anchoPdf: 16, anchoExcel: 16, alineacion: 'center', formato: 'texto', descripcion: 'Estado de la compra', ambito: 'ambos' },
  { clave: 'tipo_compra', etiqueta: 'Tipo', anchoPdf: 14, anchoExcel: 14, alineacion: 'center', formato: 'texto', descripcion: 'Orden, directa o servicio', ambito: 'ambos' },
  { clave: 'categoria', etiqueta: 'Categoría', anchoPdf: 22, anchoExcel: 22, alineacion: 'left', formato: 'texto', descripcion: 'Categoría de inventario', ambito: 'items' },
  { clave: 'nombre_item', etiqueta: 'Ítem', anchoPdf: 28, anchoExcel: 30, alineacion: 'left', formato: 'texto', descripcion: 'Nombre del ítem', ambito: 'items' },
  { clave: 'cantidad', etiqueta: 'Cantidad', anchoPdf: 13, anchoExcel: 13, alineacion: 'right', formato: 'numero', descripcion: 'Cantidad comprada', ambito: 'items' },
  { clave: 'monto_usd', etiqueta: 'Monto ($)', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'moneda', descripcion: 'Monto en dólares', ambito: 'ambos' },
  { clave: 'monto_bs', etiqueta: 'Monto (Bs)', anchoPdf: 18, anchoExcel: 18, alineacion: 'right', formato: 'moneda', descripcion: 'Monto en bolívares', ambito: 'ambos' },
  { clave: 'pagado_usd', etiqueta: 'Pagado ($)', anchoPdf: 16, anchoExcel: 16, alineacion: 'right', formato: 'moneda', descripcion: 'Monto pagado en dólares', ambito: 'ordenes' },
  { clave: 'pct_total', etiqueta: '% del Total', anchoPdf: 13, anchoExcel: 12, alineacion: 'right', formato: 'porcentaje', descripcion: 'Peso sobre el total', ambito: 'ambos' },
];

export const CAMPOS_POR_DEFECTO_POR_MODO: Record<ModoAgrupacionCompras, string[]> = {
  departamento: ['departamento', 'monto_usd', 'monto_bs', 'pct_total'],
  proveedor: ['proveedor', 'monto_usd', 'monto_bs', 'pct_total'],
  estado: ['estado_rotulo', 'monto_usd', 'monto_bs', 'pct_total'],
  clasificacion: ['categoria', 'monto_usd', 'monto_bs', 'pct_total'],
  tipo: ['tipo_compra', 'monto_usd', 'monto_bs', 'pct_total'],
  categoria: ['categoria', 'cantidad', 'monto_usd', 'pct_total'],
  producto: ['nombre_item', 'cantidad', 'monto_usd', 'pct_total'],
  mes: ['fecha', 'monto_usd', 'monto_bs', 'pct_total'],
  dia: ['fecha', 'monto_usd', 'monto_bs'],
  detallado: ['fecha', 'codigo', 'departamento', 'proveedor', 'estado_rotulo', 'monto_usd', 'monto_bs'],
};

export const CAMPOS_DETALLE_POR_AMBITO: Record<AmbitoCompras, string[]> = {
  ordenes: ['fecha', 'codigo', 'departamento', 'proveedor', 'estado_rotulo', 'tipo_compra', 'monto_usd', 'monto_bs', 'pagado_usd'],
  items: ['fecha', 'codigo', 'departamento', 'categoria', 'nombre_item', 'cantidad', 'monto_usd', 'monto_bs'],
};

/* ───────────── Agrupación y procesamiento ───────────── */

export type OrdenReporteCompras = 'monto' | 'cantidad' | 'nombre' | 'fecha';

/** Clave + etiqueta del grupo de una fila según la dimensión elegida. */
function claveGrupoCompras(f: FilaReporteCompras, modo: ModoAgrupacionCompras): { clave: string; etiqueta: string } {
  switch (modo) {
    case 'departamento': return { clave: f.departamento, etiqueta: f.departamento };
    case 'proveedor': return { clave: f.proveedor, etiqueta: f.proveedor };
    case 'estado': return { clave: f.estado, etiqueta: f.estado_rotulo };
    case 'tipo': return { clave: f.tipo_compra, etiqueta: ETIQUETA_TIPO_COMPRA[f.tipo_compra] };
    case 'clasificacion':
    case 'categoria': return { clave: f.categoria || SIN_CATEGORIA_INV, etiqueta: f.categoria || SIN_CATEGORIA_INV };
    case 'producto': return { clave: f.nombre_item || '—', etiqueta: f.nombre_item || '—' };
    case 'dia': return { clave: f.fecha || 'Sin fecha', etiqueta: f.fecha || 'Sin fecha' };
    case 'mes': return { clave: (f.fecha || '').slice(0, 7) || 'Sin fecha', etiqueta: mesEtiqueta(f.fecha) };
    default: return { clave: f.id, etiqueta: f.nombre_item || f.codigo };
  }
}

export const ETIQUETA_TIPO_COMPRA: Record<TipoCompra, string> = {
  orden: 'Orden de compra',
  directa: 'Compra directa',
  servicio: 'Servicio',
};

function ordenarFilasCompras(filas: FilaReporteCompras[], ordenarPor: OrdenReporteCompras): void {
  switch (ordenarPor) {
    case 'cantidad': filas.sort((a, b) => Math.abs(b.cantidad ?? 0) - Math.abs(a.cantidad ?? 0)); break;
    case 'nombre': filas.sort((a, b) => (a.nombre_item || a.departamento).localeCompare(b.nombre_item || b.departamento, 'es')); break;
    case 'fecha': filas.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')); break;
    default: filas.sort((a, b) => Math.abs(b.monto_usd) - Math.abs(a.monto_usd));
  }
}

/**
 * Agrupa las filas por la dimensión elegida, con subtotales ($/Bs), cantidad,
 * nº de ítems y % del total. `detallado` no agrupa. El % se calcula sobre el
 * |monto_usd| de todas las filas del período.
 */
export function procesarFilasCompras(
  filasDetalle: FilaReporteCompras[],
  agrupacion: ModoAgrupacionCompras,
  opts: { ordenarPor?: OrdenReporteCompras; ambito?: AmbitoCompras } = {},
): { filas: FilaReporteCompras[] } {
  const ambito = opts.ambito ?? filasDetalle[0]?.ambito ?? 'ordenes';
  const ordenarPor = opts.ordenarPor ?? 'monto';
  const totalUsd = filasDetalle.reduce((a, f) => a + Math.abs(f.monto_usd), 0);
  const pctDe = (usd: number): number => (totalUsd > 0 ? Math.round((Math.abs(usd) / totalUsd) * 1000) / 10 : 0);

  if (agrupacion === 'detallado') {
    const filas = filasDetalle.map((f) => ({ ...f, total_items: 1, pct_del_total: pctDe(f.monto_usd) }));
    ordenarFilasCompras(filas, ordenarPor);
    return { filas };
  }

  interface Acc {
    clave: string; etiqueta: string;
    departamento: string; proveedor: string; categoria: string; nombre_item: string;
    estado: string; estado_rotulo: string; tipo_compra: TipoCompra; fecha: string;
    usd: number; bs: number; pagadoUsd: number; pagadoBs: number; cantidad: number; items: number; tieneCantidad: boolean;
  }
  const mapa = new Map<string, Acc>();
  for (const f of filasDetalle) {
    const { clave, etiqueta } = claveGrupoCompras(f, agrupacion);
    let g = mapa.get(clave);
    if (!g) {
      g = {
        clave, etiqueta,
        departamento: f.departamento, proveedor: f.proveedor, categoria: f.categoria, nombre_item: f.nombre_item,
        estado: f.estado, estado_rotulo: f.estado_rotulo, tipo_compra: f.tipo_compra, fecha: f.fecha,
        usd: 0, bs: 0, pagadoUsd: 0, pagadoBs: 0, cantidad: 0, items: 0, tieneCantidad: false,
      };
      mapa.set(clave, g);
    }
    g.usd += f.monto_usd; g.bs += f.monto_bs; g.pagadoUsd += f.pagado_usd; g.pagadoBs += f.pagado_bs;
    if (f.cantidad != null) { g.cantidad += f.cantidad; g.tieneCantidad = true; }
    g.items += 1;
  }

  const filas: FilaReporteCompras[] = Array.from(mapa.values()).map((g) => ({
    id: g.clave || g.etiqueta,
    ambito,
    tipo_compra: g.tipo_compra,
    // En mes/día el rótulo del grupo va en la columna «fecha» (p. ej. «Nov 2026»),
    // no la fecha suelta de la primera compra del grupo.
    fecha: (agrupacion === 'mes' || agrupacion === 'dia') ? g.etiqueta : g.fecha,
    codigo: '',
    departamento: agrupacion === 'departamento' ? g.etiqueta : g.departamento,
    proveedor: agrupacion === 'proveedor' ? g.etiqueta : g.proveedor,
    estado: g.estado,
    estado_rotulo: agrupacion === 'estado' ? g.etiqueta : g.estado_rotulo,
    clase_estado: 'finalizada',
    categoria: (agrupacion === 'categoria' || agrupacion === 'clasificacion') ? g.etiqueta : g.categoria,
    categoria_gasto: null,
    nombre_item: agrupacion === 'producto' ? g.etiqueta : g.nombre_item,
    cantidad: g.tieneCantidad ? round2(g.cantidad) : null,
    moneda_original: 'USD',
    monto_original: round2(g.usd),
    monto_usd: round2(g.usd),
    monto_bs: round2(g.bs),
    pagado_usd: round2(g.pagadoUsd),
    pagado_bs: round2(g.pagadoBs),
    analista: null,
    total_items: g.items,
    pct_del_total: pctDe(g.usd),
  }));

  if (agrupacion === 'mes' || agrupacion === 'dia') {
    filas.sort((a, b) => a.id.localeCompare(b.id));
  } else {
    ordenarFilasCompras(filas, ordenarPor);
  }
  return { filas };
}

/* ───────────── Métricas de la ficha ejecutiva ───────────── */

export interface MetricaFichaCompras {
  clave: string;
  etiqueta: string;
  valor: string;
  sub?: string;
  colorHex: string;
  colorRgb: [number, number, number];
}

const fmtNumC = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtUsdC = (n: number) => `$ ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBsC = (n: number) => `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Métricas visibles de una ficha ejecutiva según las columnas marcadas. Devuelve
 * como máximo 4 recuadros; si no quedó ninguno, al menos el monto en $.
 */
export function obtenerMetricasFichaCompras(
  f: FilaReporteCompras,
  columnasClaves: string[],
): MetricaFichaCompras[] {
  const m: MetricaFichaCompras[] = [];
  if (columnasClaves.includes('monto_usd')) {
    m.push({ clave: 'monto_usd', etiqueta: 'MONTO ($)', valor: fmtUsdC(f.monto_usd), sub: f.estado_rotulo, colorHex: '#22c55e', colorRgb: [22, 163, 74] });
  }
  if (columnasClaves.includes('monto_bs')) {
    m.push({ clave: 'monto_bs', etiqueta: 'MONTO (Bs)', valor: fmtBsC(f.monto_bs), sub: 'equivalente', colorHex: '#38bdf8', colorRgb: [2, 132, 199] });
  }
  if (columnasClaves.includes('cantidad') && f.cantidad != null) {
    m.push({ clave: 'cantidad', etiqueta: 'CANTIDAD', valor: fmtNumC(f.cantidad), sub: f.nombre_item || '', colorHex: '#a855f7', colorRgb: [147, 51, 234] });
  }
  if (f.total_items != null) {
    m.push({ clave: 'items', etiqueta: 'COMPRAS', valor: `${f.total_items}`, sub: f.total_items === 1 ? 'registro' : 'registros', colorHex: '#f59e0b', colorRgb: [202, 138, 4] });
  }
  if (columnasClaves.includes('pct_total') && f.pct_del_total != null) {
    m.push({ clave: 'pct_total', etiqueta: '% DEL TOTAL', valor: `${f.pct_del_total.toFixed(1)}%`, sub: 'del monto', colorHex: '#eab308', colorRgb: [202, 138, 4] });
  }
  if (m.length === 0) {
    m.push({ clave: 'monto_usd', etiqueta: 'MONTO ($)', valor: fmtUsdC(f.monto_usd), sub: f.estado_rotulo, colorHex: '#22c55e', colorRgb: [22, 163, 74] });
  }
  return m.slice(0, 4);
}
