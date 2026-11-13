/* ============================================================
   MGG · Conciliación · ENTRADAS DE RETENCIÓN (13-11-2026 / Fases 2 y 3)

   Submódulo para la conciliación de reintegros de impuestos y retenciones
   (IVA, ISLR, ISAE) de compras y servicios. Permite:
     1. Registrar y auditar el día del reintegro, referencia de entrada,
        monto reintegrado en Bs, cuenta bancaria y comprobante (PDF/imagen).
     2. Cotejar contra las entradas del archivo Drive / Caja Multimoneda.
     3. Filtrar y consultar el estado de cada retención (Reintegrada / Pendiente).
   ============================================================ */
import type { Orden } from '@/shared/lib/types';
import { retencionesDe, totalRetenciones } from '@/modules/pedidos/retencionesOc';
import {
  mismaReferencia, TOLERANCIA_BS, type DatosDrive, type ResultadoDrive,
} from './conciliacionDrive';
import type { RetencionFiscalOc } from './conciliacion';

export const EVENTO_REINTEGRO_RETENCION = 'reintegro_retencion';
export const EVENTO_DRIVE_ENTRADA = 'drive_conciliacion_entrada';

/** Lo cotejado del archivo Drive / Caja Multimoneda para una entrada de retención. */
export interface DatosDriveEntrada extends DatosDrive {
  fecha?: string;
  tipoRetencion?: string;
}

/** Lo registrado en Conciliación cuando se confirma el reintegro de la retención. */
export interface DatosReintegroRetencion {
  fechaReintegro: string; // 'YYYY-MM-DD'
  referencia: string;
  banco?: string | null;
  montoBs: number;
  montoUsd?: number | null;
  comprobantePath?: string | null;
  comprobanteNombre?: string | null;
  nota?: string | null;
  at?: string;
  actor?: string;
}

const evsDe = (historial: unknown) => (Array.isArray(historial) ? historial as Array<Record<string, unknown>> : []);
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Lee el último reintegro registrado para una orden en su historial. */
export function reintegroDeOrden(historialOrOrden: unknown): DatosReintegroRetencion | null {
  const historial = (typeof historialOrOrden === 'object' && historialOrOrden !== null && 'historial' in historialOrOrden)
    ? (historialOrOrden as { historial: unknown }).historial
    : historialOrOrden;
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== EVENTO_REINTEGRO_RETENCION) continue;
    const ref = txt(e.referencia);
    const monto = Number(e.monto_bs ?? e.montoBs);
    const fecha = txt(e.fecha_reintegro) ?? txt(e.fechaReintegro) ?? txt(e.fecha) ?? (typeof e.at === 'string' ? e.at.slice(0, 10) : '');
    return {
      fechaReintegro: fecha,
      referencia: ref ?? '',
      banco: txt(e.banco),
      montoBs: Number.isFinite(monto) ? monto : 0,
      montoUsd: Number(e.monto_usd ?? e.montoUsd) || undefined,
      comprobantePath: txt(e.comprobante_path ?? e.comprobantePath),
      comprobanteNombre: txt(e.comprobante_nombre ?? e.comprobanteNombre),
      nota: txt(e.nota),
      at: typeof e.at === 'string' ? e.at : undefined,
      actor: typeof e.actor === 'string' ? e.actor : undefined,
    };
  }
  return null;
}

/** Lee lo último que se cotejó del Drive para la ENTRADA de retención. */
export function driveEntradaDe(historialOrOrden: unknown): DatosDriveEntrada | null {
  const historial = (typeof historialOrOrden === 'object' && historialOrOrden !== null && 'historial' in historialOrOrden)
    ? (historialOrOrden as { historial: unknown }).historial
    : historialOrOrden;
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== EVENTO_DRIVE_ENTRADA) continue;
    const refs = Array.isArray(e.referencias)
      ? (e.referencias as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    const monto = Number(e.monto_bs ?? e.montoBs);
    return {
      referencias: refs,
      montoBs: Number.isFinite(monto) ? monto : 0,
      archivo: String(e.archivo ?? ''),
      filas: Array.isArray(e.filas) ? (e.filas as unknown[]).map(Number).filter(Number.isFinite) : [],
      fecha: txt(e.fecha) ?? (typeof e.at === 'string' ? e.at.slice(0, 10) : undefined),
      tipoRetencion: txt(e.tipo_retencion ?? e.tipoRetencion) ?? undefined,
      at: typeof e.at === 'string' ? e.at : undefined,
      actor: typeof e.actor === 'string' ? e.actor : undefined,
    };
  }
  return null;
}

const fmtBs = (n: number) => `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Cruce de la entrada con Drive:
 * CUADRA si la referencia del reintegro coincide con el archivo Y el monto en Bs coincide.
 */
export function cruzarDriveEntrada(
  reintegro: DatosReintegroRetencion | null,
  datosDrive: DatosDrive | null,
  montoEsperadoBs?: number | null,
): ResultadoDrive | null {
  if (!datosDrive) return null;

  if (!reintegro) {
    // Si no hay reintegro registrado pero el archivo trajo entrada:
    const esperados = [montoEsperadoBs].filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
    const montoOk = esperados.some((x) => Math.abs(x - datosDrive.montoBs) <= TOLERANCIA_BS);
    return {
      estado: 'NO CUADRA',
      motivo: montoOk
        ? 'Detectado en archivo · pendiente por registrar en el sistema'
        : `Monto en archivo (${fmtBs(datosDrive.montoBs)}) · pendiente registrar en el sistema`,
      datos: datosDrive,
    };
  }

  const refOk = datosDrive.referencias.some((a) => mismaReferencia(a, reintegro.referencia));
  const montoOk = Math.abs(reintegro.montoBs - datosDrive.montoBs) <= TOLERANCIA_BS;

  const problemas: string[] = [];
  if (!refOk) {
    problemas.push(`referencia distinta (archivo ${datosDrive.referencias.join(', ') || '—'} · sistema ${reintegro.referencia || '—'})`);
  }
  if (!montoOk) {
    problemas.push(`monto distinto (archivo ${fmtBs(datosDrive.montoBs)} · sistema ${fmtBs(reintegro.montoBs)})`);
  }

  return problemas.length
    ? { estado: 'NO CUADRA', motivo: problemas.join(' · ').replace(/^./, (c) => c.toUpperCase()), datos: datosDrive }
    : { estado: 'CUADRA', motivo: 'La referencia y el monto reintegrado coinciden con el archivo', datos: datosDrive };
}

/** ¿Lleva retención esta orden? (Compras, Libro fiscal o Reintegro previo). */
export function ordenLlevaRetencion(o: Partial<Orden>, fiscales: RetencionFiscalOc[] = []): boolean {
  if (reintegroDeOrden(o.historial)) return true;
  if (retencionesDe(o).length > 0) return true;
  if (o.retencion_momento != null) return true;
  if (o.retencion_aplicada === true) return true;
  if (o.retencion_iva_path || o.retencion_islr_path || o.retencion_municipal_path) return true;
  if (fiscales.length > 0) return true;
  return false;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Calcula los montos retenidos (USD y Bs) esperados para la orden. */
export function calcularMontosRetencion(
  o: Orden,
  tasa: number | null,
): { usd: number; bs: number | null; totalUsd: number; totalBs: number | null } {
  const rs = retencionesDe(o);
  const totalR = totalRetenciones(rs);
  const esBs = (o.moneda ?? 'USD').toUpperCase() === 'BS';

  let usd = 0;
  let bs: number | null = null;

  if (totalR > 0) {
    if (esBs) {
      bs = totalR;
      usd = tasa && tasa > 0 ? r2(totalR / tasa) : 0;
    } else {
      usd = totalR;
      bs = tasa && tasa > 0 ? r2(totalR * tasa) : null;
    }
  } else {
    // Si no está en retencionesDe pero tiene un reintegro ya registrado:
    const reint = reintegroDeOrden(o.historial);
    if (reint && reint.montoBs > 0) {
      bs = reint.montoBs;
      usd = reint.montoUsd ?? (tasa && tasa > 0 ? r2(reint.montoBs / tasa) : 0);
    }
  }

  return { usd, bs, totalUsd: usd, totalBs: bs };
}

/** Busca el número de factura asociado a la orden. */
export function extraerNumeroFactura(o: Orden, fiscales: RetencionFiscalOc[] = []): string | null {
  for (const f of fiscales) {
    if (f.numero) return f.numero;
  }
  const root = o as unknown as Record<string, unknown>;
  const num = root.factura_numero ?? root.facturaNumero ?? root.numero_factura ?? root.numeroFactura;
  if (typeof num === 'string' && num.trim()) return num.trim();

  if (o.factura_nombre) {
    const m = o.factura_nombre.match(/factura[-_\s]*([0-9A-Z]+)/i);
    if (m) return m[1];
  }
  const evs = evsDe(o.historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (typeof e?.factura_numero === 'string' && e.factura_numero.trim()) return e.factura_numero.trim();
    if (typeof e?.numero_factura === 'string' && e.numero_factura.trim()) return e.numero_factura.trim();
    if (typeof e?.nota === 'string') {
      const m = e.nota.match(/factura\s*#?\s*([0-9A-Z]+)/i);
      if (m) return m[1];
    }
  }
  return null;
}

export interface FilaEntradaRetencion {
  id: string;
  item: number;
  codigo: string;
  sp: string;
  proveedor: string;
  facturaNumero: string | null;
  facturasCount: number;
  tiposRetencion: string[];
  montoRetencionUsd: number;
  montoRetencionBs: number | null;
  reintegro: DatosReintegroRetencion | null;
  tieneReintegro: boolean;
  estadoReintegro: 'reintegrada' | 'pendiente';
  drive: ResultadoDrive | null;
  driveEntradaDetectada?: DatosDrive | null;
  orden: Orden;
  fechaOc: string | null;
  tasa: number | null;
}

export function armarFilaEntrada(
  o: Orden,
  proveedor: string,
  tasa: number | null,
  item: number,
  fiscales: RetencionFiscalOc[] = [],
  facturasCount: number = 0,
  datosDriveEntrada?: DatosDrive | null,
): FilaEntradaRetencion {
  const rs = retencionesDe(o);
  const tiposSet = new Set<string>(rs.map((r) => r.tipo));
  for (const f of fiscales) tiposSet.add(f.tipo.toUpperCase());
  if (o.retencion_iva_path) tiposSet.add('IVA');
  if (o.retencion_islr_path) tiposSet.add('ISLR');
  if (o.retencion_municipal_path) tiposSet.add('ISAE');

  const reintegro = reintegroDeOrden(o.historial);
  const { usd, bs } = calcularMontosRetencion(o, tasa);
  const driveDatos = datosDriveEntrada ?? driveEntradaDe(o.historial);
  const drive = cruzarDriveEntrada(reintegro, driveDatos, bs);

  const ordenTipos = ['IVA', 'ISLR', 'ISAE', 'IGTF'];
  const pos = (t: string) => (ordenTipos.includes(t) ? ordenTipos.indexOf(t) : ordenTipos.length);
  const tiposRetencion = [...tiposSet].sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));

  return {
    id: o.id,
    item,
    codigo: o.oc_codigo ?? o.codigo,
    sp: o.codigo,
    proveedor: proveedor || '—',
    facturaNumero: extraerNumeroFactura(o, fiscales),
    facturasCount,
    tiposRetencion: tiposRetencion.length ? tiposRetencion : ['RETENCIÓN'],
    montoRetencionUsd: usd,
    montoRetencionBs: bs,
    reintegro,
    tieneReintegro: !!(reintegro && reintegro.montoBs > 0),
    estadoReintegro: reintegro && reintegro.montoBs > 0 ? 'reintegrada' : 'pendiente',
    drive,
    driveEntradaDetectada: driveDatos,
    orden: o,
    fechaOc: o.oc_creada_en ?? o.created_at ?? null,
    tasa,
  };
}

export interface FiltrosEntradasRetencion {
  busqueda?: string;
  estado?: 'todos' | 'reintegradas' | 'pendientes';
  tipoRetencion?: 'todos' | 'IVA' | 'ISLR' | 'ISAE' | string;
  drive?: 'todos' | 'cuadra' | 'no_cuadra' | 'sin';
}

export function filtrarEntradas(filas: FilaEntradaRetencion[], filtros: FiltrosEntradasRetencion): FilaEntradaRetencion[] {
  return filas.filter((f) => {
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase().trim();
      const match = f.codigo.toLowerCase().includes(q)
        || f.sp.toLowerCase().includes(q)
        || f.proveedor.toLowerCase().includes(q)
        || (f.facturaNumero && f.facturaNumero.toLowerCase().includes(q))
        || (f.reintegro?.referencia && f.reintegro.referencia.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (filtros.estado && filtros.estado !== 'todos') {
      const esReintegrada = f.estadoReintegro === 'reintegrada' || !!(f.tieneReintegro) || !!(f.reintegro && f.reintegro.montoBs > 0);
      if (filtros.estado === 'reintegradas' && !esReintegrada) return false;
      if (filtros.estado === 'pendientes' && esReintegrada) return false;
    }
    if (filtros.tipoRetencion && filtros.tipoRetencion !== 'todos') {
      const target = filtros.tipoRetencion.toUpperCase();
      if (!f.tiposRetencion.some((t) => t.toUpperCase().includes(target))) return false;
    }
    if (filtros.drive && filtros.drive !== 'todos') {
      if (filtros.drive === 'cuadra' && f.drive?.estado !== 'CUADRA') return false;
      if (filtros.drive === 'no_cuadra' && f.drive?.estado !== 'NO CUADRA') return false;
      if (filtros.drive === 'sin' && f.drive != null) return false;
    }
    return true;
  });
}

export function tarjetasEntradas(filas: FilaEntradaRetencion[]) {
  const totalCount = filas.length;
  const totalUsd = filas.reduce((a, f) => a + (f.montoRetencionUsd ?? (f as unknown as { montoRetenidoUsd?: number }).montoRetenidoUsd ?? 0), 0);
  const totalBs = filas.reduce((a, f) => a + (f.montoRetencionBs ?? (f as unknown as { montoRetenidoBs?: number }).montoRetenidoBs ?? 0), 0);

  const reintegradas = filas.filter((f) => f.estadoReintegro === 'reintegrada' || f.tieneReintegro || !!(f.reintegro && f.reintegro.montoBs > 0));
  const montoReintegradoBs = reintegradas.reduce((a, f) => a + (f.reintegro?.montoBs || 0), 0);

  const pendientes = filas.filter((f) => !reintegradas.includes(f));
  const montoPendienteBs = pendientes.reduce((a, f) => a + (f.montoRetencionBs ?? (f as unknown as { montoRetenidoBs?: number }).montoRetenidoBs ?? 0), 0);

  const cuadran = filas.filter((f) => f.drive?.estado === 'CUADRA').length;
  const noCuadran = filas.filter((f) => f.drive?.estado === 'NO CUADRA').length;
  const sin = filas.filter((f) => f.drive == null).length;

  return {
    totalConRetencion: { count: totalCount, cantidad: totalCount, usd: r2(totalUsd), montoUsd: r2(totalUsd), bs: r2(totalBs), montoBs: r2(totalBs) },
    total: { count: totalCount, cantidad: totalCount, usd: r2(totalUsd), montoUsd: r2(totalUsd), bs: r2(totalBs), montoBs: r2(totalBs) },
    reintegradas: { count: reintegradas.length, cantidad: reintegradas.length, bs: r2(montoReintegradoBs), montoBs: r2(montoReintegradoBs) },
    pendientes: { count: pendientes.length, cantidad: pendientes.length, bs: r2(montoPendienteBs), montoBs: r2(montoPendienteBs) },
    drive: { cuadran, cuadra: cuadran, noCuadran, noCuadra: noCuadran, sin, sinCotejar: sin },
  };
}
