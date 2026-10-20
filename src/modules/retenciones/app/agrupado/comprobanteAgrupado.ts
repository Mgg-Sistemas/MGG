/* ============================================================
   MGG · Retenciones v8 · El comprobante agrupado (lógica pura)

   El de la maqueta (v8, abrirAgrupado, y v8-12 §3; M1): solo IVA, del mismo
   proveedor, la misma quincena y la misma moneda; arranca apagado con su
   interruptor. Un comprobante con una línea por factura y un total; cada
   factura conserva su propia retención. Si una cambia (se anula), el
   comprobante se anula entero y se rehace.
   ============================================================ */

export interface ItemAgrupado {
  /** «<documento>:<impuesto>», como la selección de la Vista agrupada. */
  clave: string;
  impuesto: string;
  proveedorId: string;
  proveedorNombre: string;
  rif: string;
  factura: string;
  /** Fecha de la factura (aaaa-mm-dd). */
  fecha: string;
  moneda: string;
  base: number;
  iva: number;
  /** null = varias líneas («varios»). */
  pct: number | null;
  retenido: number;
  registrada: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const NOMBRE: Record<string, string> = { iva: 'IVA', islr: 'ISLR', isae: 'ISAE' };

/** El período del IVA: la quincena (hasta el 15, la 1.ª). */
export const quincenaDe = (fecha: string) => `${fecha.slice(0, 7)}-${Number(fecha.slice(8, 10)) <= 15 ? 1 : 2}`;
const periodoDe = (x: ItemAgrupado) => (x.impuesto === 'iva' ? quincenaDe(x.fecha) : x.fecha.slice(0, 7));

/** Por qué no se puede agrupar (un solo mensaje, como la maqueta); null si se puede. */
export function validarAgrupado(xs: readonly ItemAgrupado[], encendido: boolean): string | null {
  if (!xs.length) return 'No se puede agrupar: no hay facturas seleccionadas.';
  const e: string[] = [];
  const ks = new Set(xs.map((x) => x.impuesto));
  if (ks.size > 1) e.push('las retenciones seleccionadas son de impuestos distintos');
  if (new Set(xs.map((x) => x.proveedorId)).size > 1) e.push('las facturas son de proveedores distintos');
  if (new Set(xs.map(periodoDe)).size > 1) e.push(`las facturas son de períodos distintos (${xs[0].impuesto === 'iva' ? 'quincena' : 'mes'})`);
  if (xs.some((x) => x.registrada)) e.push('hay retenciones ya registradas en la selección');
  const base = e.length ? ` ${e.join('; ')}.` : '';
  const extra: string[] = [];
  if (!encendido) extra.push('el comprobante agrupado está apagado (Ajustes avanzados › IVA › Interruptores propios)');
  if (xs.some((x) => x.impuesto !== 'iva')) extra.push('solo el IVA se agrupa');
  if (new Set(xs.map((x) => x.moneda || 'Bs')).size > 1) extra.push('las facturas tienen monedas distintas');
  if (!e.length && !extra.length) return null;
  const todos = [...e, ...extra];
  return `No se puede agrupar: ${todos.join('; ')}.${base ? ' Un comprobante agrupa facturas del mismo proveedor, impuesto y período.' : ''}`;
}

export function lineasAgrupado(xs: readonly ItemAgrupado[]) {
  const lineas = [...xs].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const total = lineas.reduce((a, l) => ({ base: r2(a.base + l.base), iva: r2(a.iva + l.iva), retenido: r2(a.retenido + l.retenido) }), { base: 0, iva: 0, retenido: 0 });
  return { lineas, total };
}

export function subtituloAgrupado(xs: readonly ItemAgrupado[]): string {
  const x = xs[0];
  return x ? `${NOMBRE[x.impuesto] ?? x.impuesto.toUpperCase()} · ${x.proveedorNombre} · ${xs.length} factura(s)` : '';
}

export const NOTA_AGRUPADO = 'Un comprobante con una línea por factura y un total. Solo IVA, del mismo proveedor, la misma quincena y la misma moneda. Cada factura conserva su retención; si una cambia, el comprobante se rehace entero.';
