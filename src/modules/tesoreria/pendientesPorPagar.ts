/* ============================================================
   Golden Touch · Tesorería · datos del reporte «Pendientes por pagar»

   UNA sola lectura y UN solo armado para las tres salidas —PDF, Excel y
   WhatsApp—: así lo que se imprime, lo que se exporta y lo que se manda por
   el chat dicen exactamente lo mismo (mismos renglones, mismos montos, misma
   tasa).

   Segmentos (en este orden; los vacíos no salen):
     · 🛒 Compras directas
     · 📄 Órdenes de compra (OC)
     · 🔧 Servicios (Control de Servicio · CS)
     · 🧰 Servicios directos
   Más, aparte y FUERA del total, las cuentas a crédito (cuenta abierta): se
   saldan por abonos en Tesorería, no se pagan de inmediato.

   Cada renglón lleva su monto en $ y su equivalente en Bs a la tasa BCV del
   día, y CÓMO se le paga (método y datos), para pagar sin volver a la pantalla.

   Los textos salen CRUDOS (con acentos y emojis): el PDF los sanea con
   `pdfSafe` al dibujar, porque las fuentes base de jsPDF no tienen todo.
   ============================================================ */
import { labelMetodoPago, listOrdenesPorPagar, listOrdenesEnCredito, type OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import { listComprasDirectas, type CompraDirecta } from '@/modules/pedidos/compras.repository';
import { listServiciosDirectos, type ServicioDirecto } from '@/modules/pedidos/serviciosDirectos.repository';
import { listDatosPagoDeProveedores, type DatosPago } from '@/modules/pedidos/datosPago.repository';
import { resumenDatosPago } from '@/shared/ui/DatosPagoFields';
import type { PagoMetodo } from '@/shared/lib/types';
import { money } from '@/shared/lib/format';
import { getTasaHoy } from './tasas.repository';

/** Una línea de «cómo se le paga»: el método (para su emoji) y el texto completo. */
export interface LineaPago {
  /** Clave del método (`pago_movil`, `transferencia`…). */
  metodo: string;
  texto: string;
  /** true = dato guardado del proveedor, solo como referencia (el método se decide al pagar). */
  registrado: boolean;
}

/** Fila común del reporte + sus montos normalizados ($ y Bs). */
export interface FilaPendiente {
  codigo: string;
  proveedor: string;
  estado: string;
  /** true = ya se puede pagar (Compras indicó el método o es un directo). */
  listaParaPagar: boolean;
  pagos: LineaPago[];
  usd: number;
  bs: number;
}

export type ClaveSegmento = 'compras_directas' | 'oc' | 'servicios' | 'servicios_directos' | 'credito';

export interface SegmentoPendiente {
  clave: ClaveSegmento;
  titulo: string;
  filas: FilaPendiente[];
  subUsd: number;
  subBs: number;
}

/* ───────────── «Por preparar»: cuánto se paga, NATIVO por moneda ─────────────
   Cada compromiso cuenta en UNA sola moneda: la de su método de pago. NO se
   reconvierte (el total en Bs no es el total en $ por la tasa). Así Tesorería sabe
   cuánto preparar realmente en divisa (USD/USDT) y cuánto en bolívares, por separado.
   Lo que aún no tiene método elegido va a «Sin método asignado» (ahí sí $ y Bs de
   referencia, porque no se sabe en qué moneda se pagará). */

/** Una combinación método × moneda con su total NATIVO (en esa moneda). */
export interface PreparacionLinea {
  metodo: string;
  metodoLabel: string;
  moneda: string;      // USD, USDT, Bs, COP…
  monto: number;       // en `moneda`, nativo (sin reconversión)
  nOrdenes: number;
}

/** Total por moneda (suma de las líneas de esa moneda), nativo e independiente. */
export interface PreparacionTotalMoneda {
  moneda: string;
  monto: number;
  nOrdenes: number;
}

export interface PreparacionPorPagar {
  /** Desglose por método y moneda, cada monto en su moneda. */
  porMetodoMoneda: PreparacionLinea[];
  /** Totales por moneda (USD, USDT, Bs…), independientes entre sí. */
  totalesPorMoneda: PreparacionTotalMoneda[];
  /** Compromisos aún sin método elegido: en $ y Bs como referencia (no entran en los totales nativos). */
  sinMetodo: { usd: number; bs: number; nOrdenes: number };
}

/** true si la moneda es divisa (todo lo que no es Bs). Para el badge Divisa/Bolívares. */
export function esMonedaDivisa(moneda: string): boolean {
  return (moneda || '').toUpperCase() !== 'BS';
}

const ORDEN_MONEDA = ['USD', 'USDT', 'Bs', 'COP'];
const ordenMoneda = (m: string): number => {
  const i = ORDEN_MONEDA.indexOf(m);
  return i < 0 ? ORDEN_MONEDA.length : i;
};

/**
 * Calcula «Por preparar» a partir de las filas ya filtradas por pagar. Reglas:
 *  · OC/CS con UN solo método → el total de la orden va a (método, su moneda), nativo
 *    (si la moneda es Bs usa el equivalente Bs; si es divisa usa el monto en $).
 *  · OC/CS con pago PARTIDO → cada pata suma su `monto` en su `moneda`.
 *  · OC/CS esperando método, y toda compra/servicio directo → «Sin método asignado».
 *  Los totales por moneda son independientes: un pago en Bs NO aparece en el total de divisa.
 */
export function calcularPreparacion(input: {
  ocRows: OrdenPorPagar[];       // OC + CS (ambas `OrdenPorPagar`)
  comprasPP: CompraDirecta[];
  serviciosPP: ServicioDirecto[];
  tasa: number;
}): PreparacionPorPagar {
  const { ocRows, comprasPP, serviciosPP } = input;
  const tasa = Number(input.tasa) || 0;
  const map = new Map<string, PreparacionLinea>();
  const sinMetodo = { usd: 0, bs: 0, nOrdenes: 0 };

  const add = (metodo: string, moneda: string, monto: number) => {
    const mon = moneda || 'USD';
    const key = `${metodo}|${mon}`;
    const cur = map.get(key);
    if (cur) { cur.monto = redondear2(cur.monto + monto); cur.nOrdenes += 1; }
    else map.set(key, { metodo, metodoLabel: labelMetodoPago(metodo), moneda: mon, monto: redondear2(monto), nOrdenes: 1 });
  };
  const aSinMetodo = (usd: number, bs: number) => {
    sinMetodo.usd = redondear2(sinMetodo.usd + usd);
    sinMetodo.bs = redondear2(sinMetodo.bs + bs);
    sinMetodo.nOrdenes += 1;
  };

  for (const r of ocRows) {
    const usd = Number(r.montoAPagar || 0);
    const bs = tasa > 0 ? redondear2(usd * tasa) : 0;
    const metodos = (r.orden.metodo_pago ?? []).filter(Boolean);
    if (r.esperandoMetodo || metodos.length === 0) { aSinMetodo(usd, bs); continue; }
    if (metodos.length === 1) {
      const m = metodos[0];
      const moneda = m.moneda || 'USD';
      add(m.metodo, moneda, moneda === 'Bs' ? bs : usd);   // nativo, sin reconvertir
    } else {
      for (const m of metodos) add(m.metodo, m.moneda || 'USD', Number(m.monto) || 0);
    }
  }
  // Los directos aún no eligen método: van a «Sin método asignado».
  for (const c of comprasPP) { const { usd, bs } = normMonto(c.gasto, c.moneda, tasa); aSinMetodo(usd, bs); }
  for (const s of serviciosPP) {
    const total = Number(s.gasto) || 0;
    const pend = s.con_abonos ? Math.max(0, total - (Number(s.abonado_total) || 0)) : total;
    const { usd, bs } = normMonto(pend, s.moneda, tasa);
    aSinMetodo(usd, bs);
  }

  const porMetodoMoneda = Array.from(map.values()).sort(
    (a, b) => ordenMoneda(a.moneda) - ordenMoneda(b.moneda) || a.metodoLabel.localeCompare(b.metodoLabel, 'es-VE'),
  );
  const totMap = new Map<string, PreparacionTotalMoneda>();
  for (const l of porMetodoMoneda) {
    const t = totMap.get(l.moneda);
    if (t) { t.monto = redondear2(t.monto + l.monto); t.nOrdenes += l.nOrdenes; }
    else totMap.set(l.moneda, { moneda: l.moneda, monto: l.monto, nOrdenes: l.nOrdenes });
  }
  const totalesPorMoneda = Array.from(totMap.values()).sort((a, b) => ordenMoneda(a.moneda) - ordenMoneda(b.moneda));
  return { porMetodoMoneda, totalesPorMoneda, sinMetodo };
}

export interface BloquePreparacionReporte {
  clave: string;
  etiqueta: string;
  esDivisa: boolean;
  totalTexto: string;
  totalNum: number;
  monedaCol: string;
  numFmt: string;
  nOrdenes: number;
  metodos: Array<{
    label: string;
    montoTexto: string;
    montoNum: number;
    nOrdenes: number;
  }>;
}

export interface ResultadoBloquesPreparacion {
  tituloSeccion: string;
  bloques: BloquePreparacionReporte[];
  sinMetodoTexto?: string;
}

const fmtNumVE = (n: number) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Prepara los bloques del «Resumen de Pagos / Por preparar» según la preferencia del usuario:
 * - Solo Bolívares (Bs): representa los pagos estrictamente en Bs, sin dólares.
 * - Solo Dólares ($): representa los pagos en $ USD (convirtiendo Bs a tasa BCV).
 * - Ambos (Bs y $): muestra el monto nativo junto a su equivalente entre paréntesis, ej: ($ 1.234,56).
 */
export function generarBloquesPreparacion(
  prep: PreparacionPorPagar,
  tasaRef: number,
  opciones: { mostrarUsd: boolean; mostrarBs: boolean },
): ResultadoBloquesPreparacion {
  const { mostrarUsd, mostrarBs } = opciones;
  const soloUsd = Boolean(mostrarUsd && !mostrarBs);
  const soloBs = Boolean(!mostrarUsd && mostrarBs);

  const tituloSeccion = soloUsd
    ? 'RESUMEN DE PAGOS — por método (expresado en $ USD)'
    : soloBs
      ? 'RESUMEN DE PAGOS — por método (expresado en Bolívares)'
      : 'RESUMEN DE PAGOS — por moneda y método (Bolívares y $ USD)';

  const bloques: BloquePreparacionReporte[] = [];

  for (const t of prep.totalesPorMoneda) {
    const esDivisa = esMonedaDivisa(t.moneda);
    const metodosOrig = prep.porMetodoMoneda.filter((x) => x.moneda === t.moneda);

    if (soloBs) {
      if (!esDivisa) {
        bloques.push({
          clave: t.moneda,
          etiqueta: `BOLIVARES · ${t.moneda}`,
          esDivisa: false,
          totalTexto: `Bs ${fmtNumVE(t.monto)}`,
          totalNum: t.monto,
          monedaCol: 'Bs',
          numFmt: '#,##0.00',
          nOrdenes: t.nOrdenes,
          metodos: metodosOrig.map((m) => ({
            label: m.metodoLabel,
            montoTexto: `Bs ${fmtNumVE(m.monto)}`,
            montoNum: m.monto,
            nOrdenes: m.nOrdenes,
          })),
        });
      } else if (tasaRef > 0) {
        const montoEnBs = t.monto * tasaRef;
        bloques.push({
          clave: t.moneda,
          etiqueta: `DIVISA (${t.moneda}) · al cambio BCV`,
          esDivisa: false,
          totalTexto: `Bs ${fmtNumVE(montoEnBs)}`,
          totalNum: montoEnBs,
          monedaCol: 'Bs',
          numFmt: '#,##0.00',
          nOrdenes: t.nOrdenes,
          metodos: metodosOrig.map((m) => ({
            label: m.metodoLabel,
            montoTexto: `Bs ${fmtNumVE(m.monto * tasaRef)}`,
            montoNum: m.monto * tasaRef,
            nOrdenes: m.nOrdenes,
          })),
        });
      }
    } else if (soloUsd) {
      if (esDivisa) {
        bloques.push({
          clave: t.moneda,
          etiqueta: `DIVISA · ${t.moneda}`,
          esDivisa: true,
          totalTexto: `$ ${fmtNumVE(t.monto)}`,
          totalNum: t.monto,
          monedaCol: 'USD',
          numFmt: '$#,##0.00',
          nOrdenes: t.nOrdenes,
          metodos: metodosOrig.map((m) => ({
            label: m.metodoLabel,
            montoTexto: `$ ${fmtNumVE(m.monto)}`,
            montoNum: m.monto,
            nOrdenes: m.nOrdenes,
          })),
        });
      } else if (tasaRef > 0) {
        const montoEnUsd = t.monto / tasaRef;
        bloques.push({
          clave: t.moneda,
          etiqueta: 'DÓLARES ($ USD · ref. BCV)',
          esDivisa: true,
          totalTexto: `$ ${fmtNumVE(montoEnUsd)}`,
          totalNum: montoEnUsd,
          monedaCol: 'USD',
          numFmt: '$#,##0.00',
          nOrdenes: t.nOrdenes,
          metodos: metodosOrig.map((m) => ({
            label: m.metodoLabel,
            montoTexto: `$ ${fmtNumVE(m.monto / tasaRef)}`,
            montoNum: m.monto / tasaRef,
            nOrdenes: m.nOrdenes,
          })),
        });
      }
    } else {
      // Ambos
      if (!esDivisa) {
        const equivUsd = tasaRef > 0 ? t.monto / tasaRef : null;
        const totalTxt = equivUsd != null
          ? `Bs ${fmtNumVE(t.monto)}  ($ ${fmtNumVE(equivUsd)})`
          : `Bs ${fmtNumVE(t.monto)}`;
        bloques.push({
          clave: t.moneda,
          etiqueta: `BOLIVARES · ${t.moneda}`,
          esDivisa: false,
          totalTexto: totalTxt,
          totalNum: t.monto,
          monedaCol: 'Bs',
          numFmt: '#,##0.00',
          nOrdenes: t.nOrdenes,
          metodos: metodosOrig.map((m) => {
            const eqL = tasaRef > 0 ? m.monto / tasaRef : null;
            const mTxt = eqL != null
              ? `Bs ${fmtNumVE(m.monto)}  ($ ${fmtNumVE(eqL)})`
              : `Bs ${fmtNumVE(m.monto)}`;
            return {
              label: m.metodoLabel,
              montoTexto: mTxt,
              montoNum: m.monto,
              nOrdenes: m.nOrdenes,
            };
          }),
        });
      } else {
        const equivBs = tasaRef > 0 ? t.monto * tasaRef : null;
        const totalTxt = equivBs != null
          ? `$ ${fmtNumVE(t.monto)}  (Bs ${fmtNumVE(equivBs)})`
          : `$ ${fmtNumVE(t.monto)}`;
        bloques.push({
          clave: t.moneda,
          etiqueta: `DIVISA · ${t.moneda}`,
          esDivisa: true,
          totalTexto: totalTxt,
          totalNum: t.monto,
          monedaCol: 'USD',
          numFmt: '$#,##0.00',
          nOrdenes: t.nOrdenes,
          metodos: metodosOrig.map((m) => {
            const eqL = tasaRef > 0 ? m.monto * tasaRef : null;
            const mTxt = eqL != null
              ? `$ ${fmtNumVE(m.monto)}  (Bs ${fmtNumVE(eqL)})`
              : `$ ${fmtNumVE(m.monto)}`;
            return {
              label: m.metodoLabel,
              montoTexto: mTxt,
              montoNum: m.monto,
              nOrdenes: m.nOrdenes,
            };
          }),
        });
      }
    }
  }

  // Sin método asignado
  let sinMetodoTexto: string | undefined;
  if (prep.sinMetodo.nOrdenes > 0) {
    if (soloBs) {
      const bsMonto = prep.sinMetodo.bs > 0 ? prep.sinMetodo.bs : (tasaRef > 0 ? prep.sinMetodo.usd * tasaRef : 0);
      if (bsMonto > 0) {
        sinMetodoTexto = `Sin método asignado (referencia): Bs ${fmtNumVE(bsMonto)}  ·  ${prep.sinMetodo.nOrdenes} op.`;
      }
    } else if (soloUsd) {
      const usdMonto = prep.sinMetodo.usd > 0 ? prep.sinMetodo.usd : (tasaRef > 0 ? prep.sinMetodo.bs / tasaRef : 0);
      if (usdMonto > 0) {
        sinMetodoTexto = `Sin método asignado (referencia): $ ${fmtNumVE(usdMonto)}  ·  ${prep.sinMetodo.nOrdenes} op.`;
      }
    } else {
      const partes: string[] = [];
      if (prep.sinMetodo.usd > 0) partes.push(`$ ${fmtNumVE(prep.sinMetodo.usd)}`);
      if (prep.sinMetodo.bs > 0) partes.push(`Bs ${fmtNumVE(prep.sinMetodo.bs)}`);
      if (partes.length > 0) {
        sinMetodoTexto = `Sin método asignado (referencia): ${partes.join(' · ')}  ·  ${prep.sinMetodo.nOrdenes} op.`;
      }
    }
  }

  return { tituloSeccion, bloques, sinMetodoTexto };
}

export interface DatosPendientesPorPagar {
  /** Lo por pagar (SIN el crédito), solo los segmentos con filas. */
  segmentos: SegmentoPendiente[];
  /** Cuentas a crédito abiertas: indicativo aparte, no suman al total. */
  credito: SegmentoPendiente | null;
  /** Bs por 1 USD (BCV). 0 = no se calculan equivalencias en Bs. */
  tasa: number;
  tasaFecha: string | null;
  totUsd: number;
  totBs: number;
  totCant: number;
  /** «Por preparar»: cuánto pagar nativo por método y moneda (sin reconversión). */
  preparacion: PreparacionPorPagar;
  /** ISO del momento en que se armó. */
  generadoEn: string;
}

/** Entradas ya leídas, para armar el reporte sin tocar la base (lo que se prueba). */
export interface EntradaPendientes {
  rows: OrdenPorPagar[];
  creditos?: OrdenPorPagar[];
  comprasDir?: CompraDirecta[];
  serviciosDir?: ServicioDirecto[];
  /** Datos de pago guardados por proveedor: { proveedorId: { metodo: datos } }. */
  datosProv?: Record<string, Record<string, DatosPago>>;
  tasa?: number;
  tasaFecha?: string | null;
  generadoEn?: string;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Normaliza el monto de un directo (Bs o USD) a { usd, bs } con la tasa del día. */
function normMonto(gasto: number | null | undefined, moneda: string | null | undefined, tasa: number): { usd: number; bs: number } {
  const g = Number(gasto) || 0;
  if (moneda === 'Bs') return { usd: tasa > 0 ? redondear2(g / tasa) : 0, bs: g };
  return { usd: g, bs: tasa > 0 ? redondear2(g * tasa) : 0 };
}

/** Bs con separador de miles VE y 2 decimales (sin prefijo). */
function bsNum(n: number): string {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Monto de una pata del pago, en su propia moneda. */
function montoPata(m: PagoMetodo): string {
  const n = Number(m.monto) || 0;
  if (m.moneda === 'Bs') return 'Bs ' + bsNum(n);
  if (!m.moneda || m.moneda === 'USD') return money(n);
  return m.moneda + ' ' + bsNum(n);
}

/**
 * «Cómo se le paga esto». Una línea por método. El monto por pata solo aparece si el
 * pago va partido en varias: con una sola repetiría el importe de la columna de al lado.
 * Sin método en el documento: lo que el proveedor tenga guardado, marcado «(registrado)»
 * para que nadie lo lea como «se paga así».
 */
export function lineasDePago(
  metodos: PagoMetodo[] | null | undefined,
  proveedorId: string | null | undefined,
  datosProv: Record<string, Record<string, DatosPago>>,
): LineaPago[] {
  const list = (metodos ?? []).filter(Boolean);
  if (list.length) {
    return list.map((m) => {
      const datos = resumenDatosPago(m.metodo, (m.datos ?? {}) as DatosPago).trim();
      const cabeza = labelMetodoPago(m.metodo) + (list.length > 1 ? ' · ' + montoPata(m) : '');
      return { metodo: m.metodo, texto: datos ? cabeza + ' — ' + datos : cabeza, registrado: false };
    });
  }
  const guardados = (proveedorId && datosProv[proveedorId]) || null;
  if (!guardados) return [];
  return Object.entries(guardados)
    .map(([metodo, d]): LineaPago | null => {
      const datos = resumenDatosPago(metodo, d).trim();
      return datos ? { metodo, texto: labelMetodoPago(metodo) + ' — ' + datos + ' (registrado)', registrado: true } : null;
    })
    .filter((l): l is LineaPago => l !== null);
}

function mkSeg(clave: ClaveSegmento, titulo: string, filas: FilaPendiente[]): SegmentoPendiente {
  return {
    clave, titulo, filas,
    subUsd: filas.reduce((a, f) => a + f.usd, 0),
    subBs: filas.reduce((a, f) => a + f.bs, 0),
  };
}

/** Arma el reporte a partir de lo ya leído (sin tocar la base). */
export function armarPendientesPorPagar(e: EntradaPendientes): DatosPendientesPorPagar {
  const tasa = Number(e.tasa) || 0;
  const datosProv = e.datosProv ?? {};
  const creditos = e.creditos ?? [];

  const filaOc = (r: OrdenPorPagar): FilaPendiente => {
    const usd = Number(r.montoAPagar || 0);
    return {
      codigo: r.orden.oc_codigo || '—',
      proveedor: r.proveedorNombre || '—',
      estado: r.esperandoMetodo ? 'Esperando método' : 'Lista para pagar',
      listaParaPagar: !r.esperandoMetodo,
      pagos: lineasDePago(r.orden.metodo_pago, r.orden.proveedor_id, datosProv),
      usd,
      bs: tasa > 0 ? redondear2(usd * tasa) : 0,
    };
  };
  const filaCompra = (c: CompraDirecta): FilaPendiente => {
    const { usd, bs } = normMonto(c.gasto, c.moneda, tasa);
    return {
      codigo: c.codigo || '—',
      proveedor: c.proveedor_nombre || '—',
      estado: 'Por pagar',
      listaParaPagar: true,
      // Una compra directa elige el método recién al pagarla: aquí van los datos
      // guardados del proveedor, como referencia.
      pagos: lineasDePago(null, c.proveedor_id, datosProv),
      usd, bs,
    };
  };
  const filaServicio = (s: ServicioDirecto): FilaPendiente => {
    // Con abonos: lo pendiente es el saldo (total − abonado).
    const total = Number(s.gasto) || 0;
    const pend = s.con_abonos ? Math.max(0, total - (Number(s.abonado_total) || 0)) : total;
    const { usd, bs } = normMonto(pend, s.moneda, tasa);
    return {
      codigo: s.codigo || '—',
      proveedor: s.proveedor_nombre || '—',
      // «Se salda por abonos» cambia cuánto se paga hoy: va en el estado.
      estado: s.con_abonos ? 'Por pagar · saldo con abonos' : 'Por pagar',
      listaParaPagar: true,
      pagos: lineasDePago(null, s.proveedor_id, datosProv),
      usd, bs,
    };
  };
  const filaCredito = (r: OrdenPorPagar): FilaPendiente => {
    const usd = Number(r.orden.total || 0);
    return {
      codigo: r.orden.oc_codigo || '—',
      proveedor: r.proveedorNombre || '—',
      estado: 'Crédito · se salda por abonos',
      listaParaPagar: false,
      pagos: lineasDePago(r.orden.metodo_pago, r.orden.proveedor_id, datosProv),
      usd,
      bs: tasa > 0 ? redondear2(usd * tasa) : 0,
    };
  };

  const esServicio = (r: OrdenPorPagar) => r.orden.tipo === 'servicio' || r.orden.clase === 'servicio';
  const ocRows = e.rows.filter((r) => !esServicio(r));
  const csRows = e.rows.filter((r) => esServicio(r));
  const comprasPP = (e.comprasDir ?? []).filter((c) => (c.estado === 'por_pagar' || (c.estado as string) === 'abierta') && !c.caja_mov_id && !c.credito_cxp_id);
  const serviciosPP = (e.serviciosDir ?? []).filter((s) => s.estado === 'por_pagar' && !s.caja_mov_id);

  const segmentos = [
    mkSeg('compras_directas', 'COMPRAS DIRECTAS', comprasPP.map(filaCompra)),
    mkSeg('oc', 'ÓRDENES DE COMPRA (OC)', ocRows.map(filaOc)),
    mkSeg('servicios', 'SERVICIOS (CONTROL DE SERVICIO · CS)', csRows.map(filaOc)),
    mkSeg('servicios_directos', 'SERVICIOS DIRECTOS', serviciosPP.map(filaServicio)),
  ].filter((s) => s.filas.length > 0);

  return {
    segmentos,
    credito: creditos.length ? mkSeg('credito', 'CUENTAS A CRÉDITO (CUENTA ABIERTA)', creditos.map(filaCredito)) : null,
    tasa,
    tasaFecha: e.tasaFecha ?? null,
    totUsd: segmentos.reduce((a, s) => a + s.subUsd, 0),
    totBs: segmentos.reduce((a, s) => a + s.subBs, 0),
    totCant: segmentos.reduce((a, s) => a + s.filas.length, 0),
    preparacion: calcularPreparacion({ ocRows: [...ocRows, ...csRows], comprasPP, serviciosPP, tasa }),
    generadoEn: e.generadoEn ?? new Date().toISOString(),
  };
}

/** Lee las OC por pagar (solo las que ya tienen método de pago cargado) y a crédito para armar el reporte de Tesorería. */
export async function cargarPendientesPorPagar(opts?: { soloConMetodo?: boolean }): Promise<DatosPendientesPorPagar> {
  const [rows, creditos] = await Promise.all([listOrdenesPorPagar({ soloConMetodo: opts?.soloConMetodo ?? true }), listOrdenesEnCredito()]);
  return cargarConLecturas(rows, creditos);
}

/** Igual, pero con las OC ya leídas (la pantalla de Tesorería ya las tiene). */
export async function cargarConLecturas(rows: OrdenPorPagar[], creditos: OrdenPorPagar[] = []): Promise<DatosPendientesPorPagar> {
  const [tasaHoy, comprasDir, serviciosDir] = await Promise.all([
    getTasaHoy().catch(() => ({ usd: null, eur: null, fecha: null })),
    listComprasDirectas().catch(() => [] as CompraDirecta[]),
    listServiciosDirectos().catch(() => [] as ServicioDirecto[]),
  ]);
  // Datos de pago guardados de TODOS los proveedores del reporte, en una sola consulta
  // (uno por renglón serían decenas). Si falla, el reporte sale igual.
  const datosProv = await listDatosPagoDeProveedores([
    ...rows.map((r) => r.orden.proveedor_id),
    ...creditos.map((r) => r.orden.proveedor_id),
    ...comprasDir.map((c) => c.proveedor_id),
    ...serviciosDir.map((sv) => sv.proveedor_id),
  ]).catch(() => ({} as Record<string, Record<string, DatosPago>>));
  return armarPendientesPorPagar({
    rows, creditos, comprasDir, serviciosDir, datosProv,
    tasa: Number(tasaHoy?.usd) || 0, tasaFecha: tasaHoy?.fecha ?? null,
  });
}
