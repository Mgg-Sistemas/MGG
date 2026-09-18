/* ============================================================
   MGG · Ventas · reglas puras (sin Supabase)

   · Documento: FACTURA (con IVA / IGTF opcionales por casilla) o NOTA DE
     ENTREGA (sin impuestos).
   · Forma de pago: contado (entra a caja), crédito (cuenta por cobrar) o
     INTERCAMBIO: el cliente paga con material, que ENTRA al inventario.
   · Editar una venta ya emitida mueve el inventario solo por la DIFERENCIA.
   · Todo cambio queda en el historial (trazabilidad) con quién, cuándo y por qué.
   ============================================================ */

export type TipoDocumentoVenta = 'factura' | 'nota_entrega';
/** contado = entra a caja · credito = cuenta por cobrar · intercambio = paga con material. */
export type CondicionPagoVenta = 'contado' | 'credito' | 'intercambio';

export const IVA_PCT_DEFECTO = 16;
export const IGTF_PCT_DEFECTO = 3;

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface VentaItem {
  producto_id: string | null;
  producto_nombre: string;
  almacen: string;
  cantidad: number;
  unidad?: string | null;
  tenor_pct: number;     // ley / tenor del mineral (%) — informativo
  precio_unit: number;   // precio de venta unitario
  costo_unit: number;    // costo unitario (PMP) — para la ganancia
  subtotal: number;      // cantidad × precio_unit
  costo: number;         // cantidad × costo_unit
  ganancia: number;      // subtotal − costo
}

/** Material que el cliente entrega como pago (intercambio). ENTRA al inventario. */
export interface PagoMaterial {
  /** Ficha existente. Null = material nuevo: se crea la ficha al emitir. */
  producto_id: string | null;
  producto_nombre: string;
  unidad?: string | null;
  almacen: string;
  cantidad: number;
  /** Valor total que se le reconoce al cliente, en la moneda de la venta. */
  valor: number;
}

export interface VentaTotales {
  subtotal: number;
  costo_total: number;
  iva_monto: number;
  igtf_monto: number;
  total: number;
  ganancia: number;
  ganancia_pct: number;  // margen sobre la base (sin impuestos)
}

export type AccionVenta = 'creada' | 'editada' | 'emitida' | 'cobrada' | 'anulada';

export interface EventoVenta {
  at: string;
  actor: string;
  actor_name?: string | null;
  accion: AccionVenta;
  detalle?: string | null;
  motivo?: string | null;
  cambios?: string[];
}

export function prefijoDocumento(tipo: TipoDocumentoVenta | null | undefined): 'FAC' | 'NE' {
  return tipo === 'nota_entrega' ? 'NE' : 'FAC';
}

export function nombreDocumento(tipo: TipoDocumentoVenta | null | undefined): string {
  return tipo === 'nota_entrega' ? 'Nota de entrega' : 'Factura';
}

export function nombreCondicion(c: CondicionPagoVenta | null | undefined): string {
  return c === 'credito' ? 'Crédito' : c === 'intercambio' ? 'Intercambio (material)' : 'Contado';
}

/** Recalcula los importes de una línea (subtotal/costo/ganancia). */
export function calcItem(it: Partial<VentaItem>): VentaItem {
  const cantidad = Number(it.cantidad) || 0;
  const precio = Number(it.precio_unit) || 0;
  const costoU = Number(it.costo_unit) || 0;
  const subtotal = r2(cantidad * precio);
  const costo = r2(cantidad * costoU);
  return {
    producto_id: it.producto_id ?? null,
    producto_nombre: it.producto_nombre ?? '',
    almacen: it.almacen ?? '',
    cantidad, unidad: it.unidad ?? null,
    tenor_pct: Number(it.tenor_pct) || 0,
    precio_unit: precio, costo_unit: costoU,
    subtotal, costo, ganancia: r2(subtotal - costo),
  };
}

/**
 * Impuestos que de verdad aplican. Una nota de entrega no lleva ninguno; en la
 * factura cada uno cuenta solo si su casilla está marcada.
 */
export function impuestosAplicados(input: {
  tipo: TipoDocumentoVenta | null | undefined;
  aplicaIva: boolean; ivaPct: number;
  aplicaIgtf: boolean; igtfPct: number;
}): { iva_pct: number; igtf_pct: number } {
  if (input.tipo === 'nota_entrega') return { iva_pct: 0, igtf_pct: 0 };
  return {
    iva_pct: input.aplicaIva ? Math.max(0, Number(input.ivaPct) || 0) : 0,
    igtf_pct: input.aplicaIgtf ? Math.max(0, Number(input.igtfPct) || 0) : 0,
  };
}

/**
 * Totales. Base = subtotal − descuento. IVA sobre la base. IGTF sobre lo que se
 * paga (base + IVA). La ganancia es sobre la base: los impuestos no son ganancia.
 */
export function calcVenta(items: VentaItem[], descuento = 0, ivaPct = 0, igtfPct = 0): VentaTotales {
  const subtotal = r2(items.reduce((a, i) => a + (Number(i.subtotal) || 0), 0));
  const costo_total = r2(items.reduce((a, i) => a + (Number(i.costo) || 0), 0));
  const base = r2(subtotal - (Number(descuento) || 0));
  const iva_monto = r2(base * (Number(ivaPct) || 0) / 100);
  const igtf_monto = r2((base + iva_monto) * (Number(igtfPct) || 0) / 100);
  const total = r2(base + iva_monto + igtf_monto);
  const ganancia = r2(base - costo_total);
  const ganancia_pct = base > 0 ? r2((ganancia / base) * 100) : 0;
  return { subtotal, costo_total, iva_monto, igtf_monto, total, ganancia, ganancia_pct };
}

/** Líneas de material válidas (con cantidad, valor y producto). */
export function materialValido(pagos: PagoMaterial[] | null | undefined): PagoMaterial[] {
  return (pagos ?? []).filter((p) =>
    (Number(p.cantidad) || 0) > 0 && (Number(p.valor) || 0) > 0 && (p.producto_id || p.producto_nombre.trim()));
}

export function valorMaterial(pagos: PagoMaterial[] | null | undefined): number {
  return r2(materialValido(pagos).reduce((a, p) => a + (Number(p.valor) || 0), 0));
}

/** Costo unitario con que ENTRA el material: valor reconocido ÷ cantidad. */
export function costoUnitMaterial(p: Pick<PagoMaterial, 'cantidad' | 'valor'>): number {
  const c = Number(p.cantidad) || 0;
  return c > 0 ? r2((Number(p.valor) || 0) / c) : 0;
}

/**
 * Lo que falta cobrar en dinero. Crédito: todo (se cobra en Tesorería).
 * Intercambio: total − material. Contado: total.
 */
export function porCobrarEnDinero(v: { total: number; condicion_pago?: CondicionPagoVenta | null; valor_material?: number | null }): number {
  if (v.condicion_pago === 'intercambio') return Math.max(0, r2((Number(v.total) || 0) - (Number(v.valor_material) || 0)));
  return r2(Number(v.total) || 0);
}

/** Errores de un intercambio (null si está bien). */
export function errorIntercambio(total: number, pagos: PagoMaterial[] | null | undefined): string | null {
  const validas = materialValido(pagos);
  if (!validas.length) return 'Agregá el material que entrega el cliente: producto, cantidad y valor.';
  if (validas.some((p) => !p.almacen?.trim())) return 'Indicá a qué almacén entra cada material.';
  const valor = valorMaterial(validas);
  if (valor > r2(total)) {
    return `El material (${valor}) vale más que la venta (${r2(total)}). Ajustá el valor o agregá productos a la venta.`;
  }
  return null;
}

/* ───────────── Diferencias de stock al editar ───────────── */

export interface AjusteStock {
  producto_id: string;
  almacen: string;
  producto_nombre: string;
  /** Diferencia de cantidad (después − antes). */
  delta: number;
}

function agrupar(filas: Array<{ producto_id: string | null; almacen: string; producto_nombre: string; cantidad: number }>) {
  const m = new Map<string, { producto_id: string; almacen: string; producto_nombre: string; cantidad: number }>();
  for (const f of filas) {
    if (!f.producto_id || !f.almacen) continue;
    const c = Number(f.cantidad) || 0;
    if (c <= 0) continue;
    const k = `${f.producto_id}|${f.almacen}`;
    const cur = m.get(k);
    if (cur) cur.cantidad += c;
    else m.set(k, { producto_id: f.producto_id, almacen: f.almacen, producto_nombre: f.producto_nombre, cantidad: c });
  }
  return m;
}

/**
 * Diferencias por producto y almacén entre dos listas (sin ceros).
 * Para lo VENDIDO: delta > 0 = sale más del inventario; < 0 = reingresa.
 * Para el MATERIAL recibido: delta > 0 = entra más; < 0 = sale lo que sobra.
 */
export function diferenciasStock(
  antes: Array<{ producto_id: string | null; almacen: string; producto_nombre: string; cantidad: number }> | null | undefined,
  despues: Array<{ producto_id: string | null; almacen: string; producto_nombre: string; cantidad: number }> | null | undefined,
): AjusteStock[] {
  const a = agrupar(antes ?? []);
  const d = agrupar(despues ?? []);
  const out: AjusteStock[] = [];
  for (const k of new Set([...a.keys(), ...d.keys()])) {
    const x = a.get(k);
    const y = d.get(k);
    const delta = Math.round(((y?.cantidad ?? 0) - (x?.cantidad ?? 0)) * 1e6) / 1e6;
    if (delta === 0) continue;
    const ref = (y ?? x)!;
    out.push({ producto_id: ref.producto_id, almacen: ref.almacen, producto_nombre: ref.producto_nombre, delta });
  }
  return out;
}

/* ───────────── Trazabilidad: qué cambió ───────────── */

interface Comparable {
  tipo_documento?: TipoDocumentoVenta | null;
  fecha?: string | null;
  cliente_nombre?: string | null;
  condicion_pago?: CondicionPagoVenta | null;
  moneda?: string | null;
  total?: number | null;
  descuento?: number | null;
  iva_pct?: number | null;
  igtf_pct?: number | null;
  vendedor?: string | null;
  nota?: string | null;
  items?: VentaItem[] | null;
  pago_material?: PagoMaterial[] | null;
}

const txt = (s: unknown) => String(s ?? '').trim();

/** Lista legible de lo que cambió entre dos versiones de la venta. */
export function cambiosVenta(antes: Comparable, despues: Comparable): string[] {
  const out: string[] = [];
  const campo = (label: string, a: unknown, b: unknown) => {
    if (txt(a) !== txt(b)) out.push(`${label}: ${txt(a) || '—'} → ${txt(b) || '—'}`);
  };
  if ((antes.tipo_documento ?? 'factura') !== (despues.tipo_documento ?? 'factura')) {
    out.push(`Documento: ${nombreDocumento(antes.tipo_documento)} → ${nombreDocumento(despues.tipo_documento)}`);
  }
  campo('Fecha', antes.fecha, despues.fecha);
  campo('Cliente', antes.cliente_nombre, despues.cliente_nombre);
  if ((antes.condicion_pago ?? 'contado') !== (despues.condicion_pago ?? 'contado')) {
    out.push(`Forma de pago: ${nombreCondicion(antes.condicion_pago)} → ${nombreCondicion(despues.condicion_pago)}`);
  }
  campo('Moneda', antes.moneda, despues.moneda);
  if (r2(Number(antes.descuento)) !== r2(Number(despues.descuento))) out.push(`Descuento: ${r2(Number(antes.descuento))} → ${r2(Number(despues.descuento))}`);
  if (r2(Number(antes.iva_pct)) !== r2(Number(despues.iva_pct))) out.push(`IVA: ${r2(Number(antes.iva_pct))}% → ${r2(Number(despues.iva_pct))}%`);
  if (r2(Number(antes.igtf_pct)) !== r2(Number(despues.igtf_pct))) out.push(`IGTF: ${r2(Number(antes.igtf_pct))}% → ${r2(Number(despues.igtf_pct))}%`);
  campo('Vendedor', antes.vendedor, despues.vendedor);
  campo('Nota', antes.nota, despues.nota);

  // Productos vendidos: por nombre + almacén, cantidad y precio.
  const clave = (i: VentaItem) => `${i.producto_id ?? i.producto_nombre}|${i.almacen}`;
  const ia = new Map((antes.items ?? []).map((i) => [clave(i), i]));
  const ib = new Map((despues.items ?? []).map((i) => [clave(i), i]));
  for (const [k, x] of ia) {
    const y = ib.get(k);
    if (!y) { out.push(`Se quitó ${x.producto_nombre} (${r2(x.cantidad)})`); continue; }
    if (r2(x.cantidad) !== r2(y.cantidad)) out.push(`${x.producto_nombre}: cantidad ${r2(x.cantidad)} → ${r2(y.cantidad)}`);
    if (r2(x.precio_unit) !== r2(y.precio_unit)) out.push(`${x.producto_nombre}: precio ${r2(x.precio_unit)} → ${r2(y.precio_unit)}`);
  }
  for (const [k, y] of ib) if (!ia.has(k)) out.push(`Se agregó ${y.producto_nombre} (${r2(y.cantidad)})`);

  // Material recibido.
  const cm = (p: PagoMaterial) => `${p.producto_id ?? p.producto_nombre}|${p.almacen}`;
  const ma = new Map((antes.pago_material ?? []).map((p) => [cm(p), p]));
  const mb = new Map((despues.pago_material ?? []).map((p) => [cm(p), p]));
  for (const [k, x] of ma) {
    const y = mb.get(k);
    if (!y) { out.push(`Material quitado: ${x.producto_nombre} (${r2(x.cantidad)})`); continue; }
    if (r2(x.cantidad) !== r2(y.cantidad) || r2(x.valor) !== r2(y.valor)) {
      out.push(`Material ${x.producto_nombre}: ${r2(x.cantidad)} por ${r2(x.valor)} → ${r2(y.cantidad)} por ${r2(y.valor)}`);
    }
  }
  for (const [k, y] of mb) if (!ma.has(k)) out.push(`Material agregado: ${y.producto_nombre} (${r2(y.cantidad)} por ${r2(y.valor)})`);

  if (r2(Number(antes.total)) !== r2(Number(despues.total))) out.push(`Total: ${r2(Number(antes.total))} → ${r2(Number(despues.total))}`);
  return out;
}

/** Motivo obligatorio (editar una emitida, anular). Lanza si no sirve. */
export function exigirMotivo(motivo: string | null | undefined, que: string): string {
  const m = txt(motivo);
  if (!m) throw new Error(`Escribí el motivo para ${que}: queda en la trazabilidad de la venta.`);
  if (m.length < 4) throw new Error('El motivo es muy corto: explicá brevemente por qué.');
  return m;
}
