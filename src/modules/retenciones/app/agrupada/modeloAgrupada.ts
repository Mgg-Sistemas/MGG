/* ============================================================
   MGG · Retenciones v8 · Vista agrupada (lógica pura)

   Traslado de la maqueta v8: `casilla`, `base`, `casillaCuenta`,
   `vistaFactura`, `vistaImpuesto`, `porProveedor` y `v7CuentasDe`
   (2026-10-14-retenciones-v8.html, §«Pintar» y v7 «Totales»), con los
   datos de la puerta en lugar de los inventados:
   · cada factura registrada en el libro es una fila, con una casilla por
     impuesto (Registrada, Declarada, o Anulada y pendiente otra vez);
   · lo que un documento todavía tiene pendiente (impuestosQueAplican)
     va en su única factura registrada o, si no hay una sola, en una fila
     «Factura por indicar» (el N° se escribe al registrar).
   «Por definir» y «No aplica con motivo» esperan al perfil fiscal y a las
   decisiones (D27, D32): hoy, lo que no aplica por la configuración sale
   como «No aplica» con su motivo dicho.
   ============================================================ */

import { buscaEn } from '../listas/filtros';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import type { ConceptoRetencion, ConfigRetencion, RetencionItem, RetencionPracticada } from '../datos/puerta';

/**
 * Los impuestos de la tira (`impuestos()` de la maqueta): el IVA si la
 * empresa es agente, el ISLR, el ISAE y el estadal si tienen conceptos
 * activos; y todo impuesto que ya tenga retenciones en el libro. El IGTF no
 * va en la tira (nota de la maqueta: es una percepción por pago).
 */
export function impuestosActivos(config: ConfigRetencion, conceptos: readonly ConceptoRetencion[], libro: readonly RetencionPracticada[]): string[] {
  const enLibro = new Set(libro.map((r) => r.tipo));
  return ['iva', 'islr', 'municipal', 'regional'].filter((k) =>
    enLibro.has(k as RetencionPracticada['tipo']) || (k === 'iva' ? config.esContribuyenteEspecial : conceptos.some((c) => c.tipo === k && c.activo)));
}

/** Por qué un impuesto no aplica a una factura, dicho con lo que hay hoy. */
export function motivoNoAplica(config: ConfigRetencion, conceptos: readonly ConceptoRetencion[]) {
  return (item: RetencionItem | undefined, k: string): string => {
    const n = nombreImpuesto(k);
    if (k === 'iva') {
      if (!config.esContribuyenteEspecial) return 'La empresa no es agente de retención del IVA';
      const iva = item?.kind === 'compra_directa' ? item.compra?.iva : item?.orden?.iva;
      if (iva != null && !(Number(iva) > 0)) return 'La factura no lleva IVA';
    } else if (!conceptos.some((c) => c.tipo === k && c.activo)) return `Sin conceptos de ${n} activos en Parámetros`;
    return `Sin retención de ${n} en el documento`;
  };
}

export type EstadoCasilla = 'falta' | 'ok' | 'declarada' | 'anulada' | 'pd' | 'nc';

export const EST: Record<EstadoCasilla, string> = { ok: 'Registrada', declarada: 'Declarada', falta: 'Pendiente', anulada: 'Anulada · pendiente', nc: 'No aplica', pd: 'Por definir' };
export const SIGNO: Record<EstadoCasilla, string> = { ok: '✓', declarada: '✓', falta: '!', anulada: '⊘', nc: '·', pd: '?' };
export const faltaEn = (e: EstadoCasilla) => e === 'falta' || e === 'anulada';
export const hecha = (e: EstadoCasilla) => e === 'ok' || e === 'declarada';

export interface Casilla {
  k: string;
  estado: EstadoCasilla;
  origen: 'libro' | 'configuracion';
  /** La retención del libro (registrada, declarada o la anulada). */
  retencion?: RetencionPracticada;
  /** Por qué no aplica, dicho. */
  motivo?: string;
}

export interface FacturaAgrupada {
  id: string;
  proveedorId: string | null;
  proveedorNombre: string;
  proveedorRif: string | null;
  docKind: string;
  docId: string | null;
  docCodigo: string | null;
  /** null = «Factura por indicar». */
  num: string | null;
  fecha: string;
  moneda: string;
  total: number | null;
  dir: 'practicada' | 'recibida';
  casillas: Record<string, Casilla>;
  /** El documento de origen, para registrar lo pendiente. */
  item?: RetencionItem;
}

/** La fecha de un documento pendiente: la de la compra, o cuándo la OC entró a pagarse o se creó. */
export function fechaDoc(item: RetencionItem): string {
  const c = item.compra as { fecha?: string | null; created_at?: string } | undefined;
  const o = item.orden as { metodo_pago_en?: string | null; oc_creada_en?: string | null; created_at?: string } | undefined;
  return (c?.fecha ?? c?.created_at ?? o?.metodo_pago_en ?? o?.oc_creada_en ?? o?.created_at ?? '').slice(0, 10);
}

const fechaRet = (r: RetencionPracticada) => (r.facturaFecha ?? r.createdAt).slice(0, 10);

/** Las facturas de la vista: las del libro y las «por indicar» de lo que queda pendiente. */
export function armarFacturas(
  pendientes: readonly RetencionItem[], libro: readonly RetencionPracticada[],
  impuestos: readonly string[], aplican: (item: RetencionItem) => string[], motivoNoAplica: (item: RetencionItem | undefined, k: string) => string,
): FacturaAgrupada[] {
  const porFactura = new Map<string, RetencionPracticada[]>();
  for (const r of libro) {
    const clave = `${r.docKind}:${r.docId ?? ''}:${r.facturaNumero ?? r.id}`;
    const xs = porFactura.get(clave);
    if (xs) xs.push(r); else porFactura.set(clave, [r]);
  }
  const facturas: FacturaAgrupada[] = [];
  const delDoc = new Map<string, FacturaAgrupada[]>();
  for (const [clave, rs] of porFactura) {
    const r0 = rs[0];
    const casillas: Record<string, Casilla> = {};
    for (const k of impuestos) {
      const deK = rs.filter((r) => r.tipo === k);
      const viva = deK.find((r) => !r.anulada);
      const anulada = deK.find((r) => r.anulada);
      if (viva) casillas[k] = { k, estado: viva.estado === 'declarada' ? 'declarada' : 'ok', origen: 'libro', retencion: viva };
      else if (anulada) casillas[k] = { k, estado: 'anulada', origen: 'libro', retencion: anulada };
    }
    const f: FacturaAgrupada = {
      id: clave, proveedorId: r0.contraparteId, proveedorNombre: r0.contraparteNombre ?? '—', proveedorRif: r0.contraparteRif,
      docKind: r0.docKind, docId: r0.docId, docCodigo: r0.docCodigo, num: r0.facturaNumero, fecha: fechaRet(r0), moneda: r0.moneda,
      total: null, dir: r0.direccion, casillas,
    };
    facturas.push(f);
    if (r0.docId) {
      const dk = `${r0.docKind}:${r0.docId}`;
      const xs = delDoc.get(dk);
      if (xs) xs.push(f); else delDoc.set(dk, [f]);
    }
  }
  for (const item of pendientes) {
    const regs = delDoc.get(`${item.kind}:${item.id}`) ?? [];
    const hechos = new Set(regs.flatMap((f) => Object.values(f.casillas).filter((c) => hecha(c.estado)).map((c) => c.k)));
    const falta = aplican(item).filter((k) => !hechos.has(k) && impuestos.includes(k));
    for (const f of regs) f.item = item;
    // Sin nada pendiente: si ya tiene facturas, no se agrega otra; si no, sale en «Sin retención».
    if (!falta.length && regs.length) continue;
    // Con una sola factura registrada, lo pendiente va en ella (se registra con su número); si no, en una «por indicar».
    const destino = regs.length === 1 ? regs[0] : null;
    const f: FacturaAgrupada = destino ?? {
      id: `pend:${item.kind}:${item.id}`, proveedorId: item.proveedorId, proveedorNombre: item.proveedorNombre, proveedorRif: item.proveedorRif,
      docKind: item.kind, docId: item.id, docCodigo: item.ocCodigo, num: null, fecha: fechaDoc(item), moneda: item.moneda,
      total: item.total, dir: 'practicada', casillas: {}, item,
    };
    // Una anulada ya cuenta como pendiente («Anulada · pendiente»): se deja como está.
    for (const k of falta) if (!f.casillas[k]) f.casillas[k] = { k, estado: 'falta', origen: 'configuracion' };
    if (!destino) facturas.push(f);
  }
  // Las casillas que quedan vacías: no aplican, con su motivo.
  for (const f of facturas) for (const k of impuestos) {
    if (!f.casillas[k]) f.casillas[k] = { k, estado: 'nc', origen: 'configuracion', motivo: motivoNoAplica(f.item, k) };
  }
  return facturas;
}

/* ───────── Filtros ───────── */

export type FiltroFecha = 'quincena' | 'mes' | 'pasado' | 'todo' | 'rango';
export interface EstadoVista {
  q: string;
  fecha: FiltroFecha;
  desde: string;
  hasta: string;
  provs: Set<string>;
  /** Los impuestos que se ven (chips «Impuesto»). */
  imp: Set<string>;
  dir: '' | 'practicada' | 'recibida';
  /** '' = las que no son «No aplica»; 'falta', 'ok', 'declarada', 'anulada'… */
  est: '' | EstadoCasilla;
  /** Un número de una tarjeta: solo ese impuesto y ese estado. */
  cuenta: { k: string; tipo: 'falta' | 'hechas' | 'pd' | 'nc' } | null;
  /** La tarjeta seleccionada («Ver solo este»). */
  sel: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function rangoFechas(e: Pick<EstadoVista, 'fecha' | 'desde' | 'hasta'>, hoy = new Date()): [string, string] {
  const y = hoy.getFullYear(), m = hoy.getMonth() + 1, d = hoy.getDate();
  const fin = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
  if (e.fecha === 'quincena') return d <= 15 ? [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-15`] : [`${y}-${pad(m)}-16`, `${y}-${pad(m)}-${fin(y, m)}`];
  if (e.fecha === 'mes') return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${fin(y, m)}`];
  if (e.fecha === 'pasado') { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${fin(py, pm)}`]; }
  if (e.fecha === 'rango') return [e.desde || '0000-01-01', e.hasta || '9999-12-31'];
  return ['0000-01-01', '9999-12-31'];
}

/** `base()` de la maqueta: fecha, dirección, proveedores y búsqueda. */
export function base(fs: readonly FacturaAgrupada[], e: EstadoVista, hoy?: Date): FacturaAgrupada[] {
  const [d, h] = rangoFechas(e, hoy);
  return fs.filter((f) => {
    if (f.fecha && (f.fecha < d || f.fecha > h)) return false;
    if (e.dir && f.dir !== e.dir) return false;
    if (e.provs.size && !e.provs.has(f.proveedorId ?? f.proveedorNombre)) return false;
    const comps = Object.values(f.casillas).map((c) => c.retencion?.numeroComprobante);
    return buscaEn(e.q, f.num, f.proveedorNombre, f.proveedorRif, f.docCodigo, ...comps);
  });
}

function cumple(e: EstadoVista, est: EstadoCasilla): boolean {
  if (!e.est) return est !== 'nc';
  if (e.est === 'falta') return faltaEn(est);
  return est === e.est;
}

/** ¿La casilla cuenta para lo que se ve? (`casillaCuenta`). */
export function casillaCuenta(e: EstadoVista, f: FacturaAgrupada, k: string): boolean {
  if (!e.imp.has(k)) return false;
  const est = f.casillas[k]?.estado ?? 'nc';
  if (e.cuenta) return k === e.cuenta.k && (e.cuenta.tipo === 'falta' ? faltaEn(est) : e.cuenta.tipo === 'hechas' ? hecha(est) : est === e.cuenta.tipo);
  return cumple(e, est);
}

/** Más recientes primero; las «por indicar» de la misma fecha, después. */
export const ordenar = (xs: readonly FacturaAgrupada[]) => xs.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.id.localeCompare(b.id)));

export const vistaFactura = (fs: readonly FacturaAgrupada[], e: EstadoVista, impuestos: readonly string[]) =>
  ordenar(fs.filter((f) => impuestos.some((k) => casillaCuenta(e, f, k))));

export const sinRetencion = (fs: readonly FacturaAgrupada[], impuestos: readonly string[]) =>
  ordenar(fs.filter((f) => impuestos.every((k) => (f.casillas[k]?.estado ?? 'nc') === 'nc')));

/** Las cuentas de una tarjeta (`v7CuentasDe`): pendientes, registradas, por definir, no aplican y lo retenido por moneda. */
export function cuentasDe(fs: readonly FacturaAgrupada[], k: string) {
  let faltan = 0, hechas = 0, pd = 0, nc = 0;
  const monto: Record<string, number> = {};
  for (const f of fs) {
    const c = f.casillas[k];
    const est = c?.estado ?? 'nc';
    if (faltaEn(est)) faltan++;
    else if (hecha(est)) {
      hechas++;
      if (c?.retencion) monto[c.retencion.moneda] = (monto[c.retencion.moneda] ?? 0) + c.retencion.montoRetenido;
    } else if (est === 'pd') pd++;
    else nc++;
  }
  return { faltan, hechas, pd, nc, monto };
}

/** Lo retenido en una factura, por moneda (la columna «Total retenido»). */
export function retenidoDe(f: FacturaAgrupada): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of Object.values(f.casillas)) if (hecha(c.estado) && c.retencion) out[c.retencion.moneda] = (out[c.retencion.moneda] ?? 0) + c.retencion.montoRetenido;
  return out;
}

/** `porProveedor`: el orden de la lista, agrupado sin partir facturas. */
export function porProveedor(fs: readonly FacturaAgrupada[]): [string, FacturaAgrupada[]][] {
  const g = new Map<string, FacturaAgrupada[]>();
  for (const f of fs) {
    const p = f.proveedorId ?? f.proveedorNombre;
    const xs = g.get(p);
    if (xs) xs.push(f); else g.set(p, [f]);
  }
  return [...g.entries()];
}

/** `v6AgruparPorDocumento`: las facturas de un proveedor, por documento. */
export function porDocumento(fs: readonly FacturaAgrupada[]): [string, FacturaAgrupada[]][] {
  const g = new Map<string, FacturaAgrupada[]>();
  for (const f of fs) {
    const d = f.docCodigo ?? (f.docId ? `${f.docKind}:${f.docId}` : `manual:${f.id}`);
    const xs = g.get(d);
    if (xs) xs.push(f); else g.set(d, [f]);
  }
  return [...g.entries()];
}

/* ───────── «Por impuesto» (v7): un impuesto a la vez, por proveedor ───────── */

export type MostrarImpuesto = 'pend' | 'pd' | 'hechas' | 'nc';
export const MOSTRAR_I: Record<MostrarImpuesto, string> = {
  pend: 'Pendientes (rango de fechas de los filtros)',
  pd: 'Por definir',
  hechas: 'Registradas',
  nc: 'No aplican',
};
export type OrdenImpuesto = 'antigua' | 'reciente' | 'monto';

export interface GrupoImpuesto { p: string; nombre: string; rif: string | null; xs: FacturaAgrupada[]; total: Record<string, number>; antigua: string }

/** Lo retenido de un impuesto en una factura (las pendientes aún no tienen monto: lo calcula el registro). */
export function montoDe(f: FacturaAgrupada, k: string): { moneda: string; monto: number } | null {
  const c = f.casillas[k];
  return c && hecha(c.estado) && c.retencion ? { moneda: c.retencion.moneda, monto: c.retencion.montoRetenido } : null;
}

/** `vistaImpuesto` de la v7: las facturas del impuesto según «Mostrar», agrupadas por proveedor y ordenadas. */
export function gruposPorImpuesto(fs: readonly FacturaAgrupada[], k: string, mostrar: MostrarImpuesto, orden: OrdenImpuesto, q: string): { grupos: GrupoImpuesto[]; facturas: number } {
  const prueba = (f: FacturaAgrupada) => {
    const e = f.casillas[k]?.estado ?? 'nc';
    if (mostrar === 'pend') return faltaEn(e);
    if (mostrar === 'hechas') return hecha(e);
    return e === mostrar;
  };
  const xs = fs.filter((f) => prueba(f) && buscaEn(q, f.proveedorNombre, f.proveedorRif, f.num, f.docCodigo));
  const g = new Map<string, GrupoImpuesto>();
  for (const f of xs) {
    const p = f.proveedorId ?? f.proveedorNombre;
    let x = g.get(p);
    if (!x) { x = { p, nombre: f.proveedorNombre, rif: f.proveedorRif, xs: [], total: {}, antigua: f.fecha }; g.set(p, x); }
    x.xs.push(f);
    const m = montoDe(f, k);
    if (m) x.total[m.moneda] = (x.total[m.moneda] ?? 0) + m.monto;
  }
  const grupos = [...g.values()];
  for (const x of grupos) { x.xs.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)); x.antigua = x.xs[0].fecha; }
  const suma = (x: GrupoImpuesto) => Object.values(x.total).reduce((a, b) => a + b, 0);
  if (orden === 'monto') grupos.sort((a, b) => suma(b) - suma(a));
  else if (orden === 'reciente') grupos.sort((a, b) => (a.xs[a.xs.length - 1].fecha < b.xs[b.xs.length - 1].fecha ? 1 : -1));
  else grupos.sort((a, b) => (a.antigua < b.antigua ? -1 : a.antigua > b.antigua ? 1 : 0));
  return { grupos, facturas: xs.length };
}

/** Por qué una selección no se agrupa en un comprobante (`v7ResumenSeleccion`). */
export function razonSeleccion(sel: readonly { f: FacturaAgrupada; k: string }[]): string {
  const provs = new Set(sel.map((x) => x.f.proveedorId ?? x.f.proveedorNombre)), ks = new Set(sel.map((x) => x.k));
  const meses = new Set(sel.map((x) => x.f.fecha.slice(0, 7)));
  if (provs.size > 1) return `No se pueden agrupar: son de ${provs.size} proveedores distintos.`;
  if (ks.size > 1) return `No se pueden agrupar: son de ${ks.size} impuestos distintos.`;
  if (meses.size > 1) return `No se pueden agrupar: son de ${meses.size} meses distintos.`;
  return 'Mismo proveedor, impuesto y período: se pueden agrupar en un comprobante con el interruptor «Agrupar comprobantes» encendido (solo IVA, la misma quincena y la misma moneda).';
}
