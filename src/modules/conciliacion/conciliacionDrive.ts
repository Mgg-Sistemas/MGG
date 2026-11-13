/* ============================================================
   MGG · Conciliación · DRIVE (12-11-2026 / Adaptación Fase 1)

   Se carga un archivo (Excel o CSV) con los pagos —el que se lleva en el Drive /
   el estado de cuenta o el libro de CAJA PRINCIPAL MULTIMONEDAS MGG— con tres datos
   básicos por fila: código de OC, referencia y monto en Bs. Se valida como la
   importación de Inventario (Validado / Duplicados / Error: las filas con error
   bloquean la carga) y se CRUZA con cada OC:

     · por código de OC → qué orden es;
     · por referencia    → la de Tesorería (últimos dígitos) o la de Conciliación;
     · y el monto en Bs  → lo pagado en Bs (Tesorería) o el monto Bs de la OC.

   Si la referencia Y el monto coinciden: «CUADRA»; si no: «NO CUADRA».
   Lo del archivo queda en el historial de la OC (evento «drive_conciliacion»);
   el estado se calcula en vivo con la referencia y el monto actuales de la OC.

   Soporta:
     1. Formato estándar tradicional (columnas «Código OC», «Referencia», «Monto Bs»).
     2. Libro de «CAJA PRINCIPAL MULTIMONEDAS MGG» con extracción inteligente de
        pagos de órdenes (Salidas) y reintegros/retenciones (Entradas), filtrando
        estrictamente los movimientos de MGG y evitando doble cruce en conciliadas.
     3. Plantilla descargable multilibro (Salidas - Compras, Entradas - Reintegros, Instrucciones).
   ============================================================ */
import type { FilaConciliacion } from './conciliacion';

export const EVENTO_DRIVE = 'drive_conciliacion';

export type EstadoDrive = 'CUADRA' | 'NO CUADRA';

/** Lo que trajo el archivo para una OC (lo que se guarda en el historial). */
export interface DatosDrive {
  referencias: string[];
  montoBs: number;
  archivo: string;
  filas: number[];
  at?: string;
  actor?: string;
}

export interface ResultadoDrive {
  estado: EstadoDrive;
  /** Por qué (para el title y la vista previa). */
  motivo: string;
  datos: DatosDrive;
}

/* ───────── Lectura del historial ───────── */
const evsDe = (historial: unknown) => (Array.isArray(historial) ? historial as Array<Record<string, unknown>> : []);

/** Lo último que se cargó del Drive para la OC (o null si nunca se cotejó). */
export function driveDe(historial: unknown): DatosDrive | null {
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== EVENTO_DRIVE) continue;
    const refs = Array.isArray(e.referencias) ? (e.referencias as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    const monto = Number(e.monto_bs);
    return {
      referencias: refs,
      montoBs: Number.isFinite(monto) ? monto : 0,
      archivo: String(e.archivo ?? ''),
      filas: Array.isArray(e.filas) ? (e.filas as unknown[]).map(Number).filter(Number.isFinite) : [],
      at: typeof e.at === 'string' ? e.at : undefined,
      actor: typeof e.actor === 'string' ? e.actor : undefined,
    };
  }
  return null;
}

/** Lo pagado en Bs según Tesorería (suma de los pagos en Bs del último «pagada»). */
export function pagadoBsTesoreria(historial: unknown): number | null {
  const evs = evsDe(historial);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e?.evento !== 'pagada') continue;
    const mp = Array.isArray(e.multipago) ? e.multipago as Array<Record<string, unknown>> : [];
    const bs = mp.filter((p) => /^bs$/i.test(String(p?.moneda ?? '').trim())).reduce((a, p) => a + (Number(p?.monto) || 0), 0);
    if (bs > 0) return Math.round(bs * 100) / 100;
    if (e.referencia_bs && Number(e.monto) > 0) {
      return Math.round(Number(e.monto) * 100) / 100;
    }
  }
  return null;
}

/* ───────── Normalización ───────── */
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** «oc-2026-251», «OC 2026 0251», «ODC 183», «ODC-236», «SV-2026-0012» → «OC-2026-0251». Otro texto: en mayúsculas sin espacios. */
export function normalizarCodigoOc(v: unknown): string {
  const s = sinAcentos(String(v ?? '')).toUpperCase().trim();
  if (!s) return '';
  const m = s.match(/^([A-Z]{2,4})[\s._-]*(\d{4})[\s._-]*(\d{1,6})(?:[\s._-]*(\d{1,3}))?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3].padStart(4, '0')}${m[4] ? `-${m[4]}` : ''}`;
  const m2 = s.match(/^(?:ODC|OC)[\s._-]*(\d{1,6})$/);
  if (m2) return `OC-2026-${m2[1].padStart(4, '0')}`;
  return s.replace(/\s+/g, '');
}

/** Solo los dígitos / letras de una referencia («Ref. 0012-3456» → «00123456»). */
const limpiaRef = (v: unknown) => sinAcentos(String(v ?? '')).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿Es la misma referencia? Tesorería guarda los ÚLTIMOS dígitos (…6196) y el banco la
 * completa (000123456196): coinciden si una termina con la otra (al menos 4 caracteres).
 */
export function mismaReferencia(a: unknown, b: unknown): boolean {
  const x = limpiaRef(a), y = limpiaRef(b);
  if (!x || !y) return false;
  const terminaCon = (p: string, q: string) => {
    if (p === q) return true;
    const [corta, larga] = p.length <= q.length ? [p, q] : [q, p];
    return corta.length >= 4 && larga.endsWith(corta);
  };
  if (terminaCon(x, y)) return true;
  // Con solo dígitos, los ceros de la izquierda no cuentan (Excel los borra).
  const sinCeros = (s: string) => (/^\d+$/.test(s) ? s.replace(/^0+/, '') : s);
  return /^\d+$/.test(x) && /^\d+$/.test(y) && terminaCon(sinCeros(x), sinCeros(y));
}

/**
 * Monto en Bs de una celda: número de Excel o texto «Bs 281.103,06», «281103.06», «1.500».
 * Devuelve NaN si no es un número.
 */
export function leerMontoBs(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  if (/[a-z]/i.test(s.replace(/^\s*(bs\.?s?|ves|bs\.?f)\s*/i, ''))) return NaN;
  s = s.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return NaN;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal.
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0) {
    const dec = s.length - coma - 1;
    s = (s.split(',').length > 2 || dec === 3) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (punto >= 0) {
    const dec = s.length - punto - 1;
    if (s.split('.').length > 2 || dec === 3) s = s.replace(/\./g, ''); // 1.500 = mil quinientos
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/**
 * Convierte un número serial de fecha de Excel (ej. 46326 -> 2026-10-31) o texto
 * con fecha (YYYY-MM-DD o DD/MM/YYYY) a formato ISO YYYY-MM-DD.
 */
export function serialExcelAFechaIso(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1000 && v < 100000) {
      const utcMs = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${month}-${day}`;
  }
  return s;
}

/**
 * Extrae todos los códigos de ODC/OC en una descripción (ej. «ODC 183» o «ODC 189 Y 191»).
 * Devuelve lista de códigos normalizados (ej. `['OC-2026-0189', 'OC-2026-0191']`).
 */
export function extraerOdc(texto: string): string[] {
  const s = sinAcentos(String(texto ?? '')).toUpperCase();
  const odcs: string[] = [];
  const re = /\b(?:ODC|OC)[\s._#-]*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const num = m[1];
    odcs.push(`OC-2026-${num.padStart(4, '0')}`);

    let after = s.slice(m.index + m[0].length);
    let mAfter: RegExpMatchArray | null;
    while ((mAfter = after.match(/^\s*(?:Y|E|,|\/)\s*(?:(?:ODC|OC)[\s._#-]*)?(\d+)/i)) !== null) {
      odcs.push(`OC-2026-${mAfter[1].padStart(4, '0')}`);
      after = after.slice(mAfter[0].length);
    }
  }
  return Array.from(new Set(odcs));
}

/**
 * Extrae la referencia bancaria de una descripción (ej. «REF 35137250», «REF. 01709810»).
 * Si no hay REF pero hay número de factura (ej. «factura #00322»), lo usa como referencia alternativa.
 */
export function extraerReferencia(desc: string): string {
  const s = String(desc ?? '');
  const mRef = s.match(/\bREF(?:ERENCIA)?[\s.:#-]+([0-9A-Z]*\d[0-9A-Z]*)/i);
  if (mRef) return mRef[1].trim();
  const mFact = s.match(/\bfactura[s]?\s*#?\s*([0-9A-Z]*\d[0-9A-Z]*)/i);
  if (mFact) return mFact[1].trim();
  return '';
}

/**
 * Obtiene el monto en Bs: primero busca en la celda monto; si no es válido,
 * busca el patrón `MONTO\s+([\d.,]+)` en la descripción.
 */
export function extraerMonto(montoCol: unknown, desc: string): number {
  const mCol = leerMontoBs(montoCol);
  if (Number.isFinite(mCol) && mCol > 0) return mCol;
  const m = String(desc ?? '').match(/\bMONTO\s+([\d.,]+)/i);
  if (m) {
    const mDesc = leerMontoBs(m[1]);
    if (Number.isFinite(mDesc) && mDesc > 0) return mDesc;
  }
  return NaN;
}

/**
 * Detecta tipos de retención mencionados en reintegros (ej. «ISAE-ISLR-IVA», «ISAE-IVA», «IVA»).
 */
export function extraerTipoRetencion(desc: string): string | undefined {
  const s = String(desc ?? '').toUpperCase();
  const mEsp = s.match(/\b(ISAE\s*-\s*ISLR\s*-\s*IVA|ISAE\s*-\s*IVA|ISLR\s*-\s*IVA|ISLR|IVA|ISAE)\b/i);
  if (mEsp) return mEsp[1].replace(/\s+/g, '');
  const mGen = s.match(/\b(DESCUENTO|RETENCION(?:ES)?)\b/i);
  if (mGen) return mGen[1].replace(/\s+/g, '');
  return undefined;
}

/* ───────── Cruce ───────── */
/** Diferencia aceptada en Bs (redondeos). */
export const TOLERANCIA_BS = 0.5;

const fmtBs = (n: number) => `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Referencias que conoce el sistema para la OC. */
function referenciasSistema(f: Pick<FilaConciliacion, 'referencia'>): string[] {
  return [f.referencia.bs, f.referencia.binance, f.referencia.manual].filter((x): x is string => !!x && !!x.trim());
}

/**
 * CUADRA si alguna referencia del archivo es la de la OC Y el monto en Bs coincide con lo
 * pagado en Bs (Tesorería) o con el monto Bs de la OC.
 */
export function cruzarDrive(
  f: Pick<FilaConciliacion, 'referencia' | 'montoBs'>, datos: DatosDrive, pagadoBs?: number | null,
): ResultadoDrive {
  const refsSis = referenciasSistema(f);
  const refOk = datos.referencias.some((a) => refsSis.some((b) => mismaReferencia(a, b)));
  const esperados = [pagadoBs, f.montoBs].filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  const montoOk = esperados.some((x) => Math.abs(x - datos.montoBs) <= TOLERANCIA_BS);

  const problemas: string[] = [];
  if (!refsSis.length) problemas.push('la OC no tiene referencia de pago en el sistema');
  else if (!refOk) problemas.push(`referencia distinta (archivo ${datos.referencias.join(', ') || '—'} · sistema ${refsSis.join(', ')})`);
  if (!esperados.length) problemas.push('la OC no tiene monto en Bs en el sistema');
  else if (!montoOk) problemas.push(`monto distinto (archivo ${fmtBs(datos.montoBs)} · sistema ${fmtBs(esperados[0])})`);
  return problemas.length
    ? { estado: 'NO CUADRA', motivo: problemas.join(' · ').replace(/^./, (c) => c.toUpperCase()), datos }
    : { estado: 'CUADRA', motivo: 'La referencia y el monto en Bs coinciden', datos };
}

/* ───────── Lectura y validación del archivo (como Inventario) ───────── */
export type EstadoFilaDrive = 'valido' | 'duplicado' | 'error' | 'ya_conciliada' | 'omitida';

export interface FilaDrive {
  fila: number;
  codigo: string;
  referencia: string;
  montoBs: number;
  errores: string[];
  /** La OC aparece más de una vez en el archivo (sus montos se suman). */
  duplicado: boolean;
  estado: EstadoFilaDrive;
  /** id de la OC en Conciliación (si existe). */
  ordenId: string | null;
  fecha?: string;
  tipo?: 'salida' | 'entrada' | 'reintegro';
  tipoRetencion?: string;
  descripcion?: string;
  yaConciliada?: boolean;
  motivoOmitida?: string;
}

export interface AnalisisDrive {
  archivo: string;
  total: number;
  validas: number;
  conError: number;
  duplicadas: number;
  yaConciliadas: number;
  omitidas: number;
  errorPorColumna: Record<string, number>;
  filas: FilaDrive[];
  estado: 'Validado' | 'Duplicados' | 'Error';
  /** Por OC: lo que se guardará (las filas repetidas de una OC se juntan). */
  porOrden: Map<string, DatosDrive>;
  /** Por OC: lo que se guardará en Entradas de retención. */
  porOrdenEntradas: Map<string, DatosDrive>;
}

export interface OrdenCriterioConciliacion {
  id: string;
  codigo: string;
  sp?: string;
  historial?: unknown;
  drive?: DatosDrive | ResultadoDrive | null;
  yaConciliada?: boolean;
  referencias?: string[];
  /** Solo las referencias que cargó Tesorería al pagar (Bs / Binance): son las que mandan para elegir el pago. */
  refsTesoreria?: string[];
  montoBs?: number | null;
  pagadoBs?: number | null;
  pagado?: boolean;
  seCruza?: boolean;
  monedaPago?: string;
}

/** Verifica si la orden ya está conciliada previamente en el sistema (CUADRA). */
export function estaConciliada(o: OrdenCriterioConciliacion): boolean {
  if (o.yaConciliada) return true;
  if (o.drive && 'estado' in o.drive) return o.drive.estado === 'CUADRA';
  const d = o.drive && 'referencias' in o.drive ? o.drive : driveDe(o.historial);
  if (!d) return false;
  if (o.pagado === false || o.seCruza === false) return false;
  const refsSis = (o.referencias ?? []).filter(Boolean);
  const refOk = refsSis.length > 0 && d.referencias.some((a) => refsSis.some((b) => mismaReferencia(a, b)));
  const montoEsp = o.pagadoBs ?? o.montoBs;
  const montoOk = montoEsp != null && Number.isFinite(montoEsp) && montoEsp > 0 && Math.abs(montoEsp - d.montoBs) <= TOLERANCIA_BS;
  return refOk && montoOk;
}

type Columna = 'codigo' | 'referencia' | 'monto';

const ALIAS: Record<Columna, string[]> = {
  codigo: ['codigo oc', 'cod oc', 'oc', 'n oc', 'nro oc', 'no oc', 'numero oc', 'orden', 'orden de compra', 'codigo', 'odc', 'n odc', 'nro odc', 'orden de servicio', 'codigo orden'],
  referencia: ['referencia', 'ref', 'nro referencia', 'n referencia', 'no referencia', 'numero referencia', 'numero de referencia', 'referencia bancaria', 'referencia de pago', 'ref bancaria', 'nro ref', 'n ref'],
  monto: ['monto bs', 'monto en bs', 'monto', 'bs', 'monto bolivares', 'monto en bolivares', 'importe', 'importe bs', 'total bs', 'monto pagado', 'monto pagado bs', 'debe', 'debito', 'cargo'],
};

const normHeader = (v: unknown) => sinAcentos(String(v ?? '')).toLowerCase().replace(/[°º#.:()/_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Busca la fila de encabezados estándar (en las primeras 15) y la columna de cada dato. */
export function ubicarColumnas(tabla: unknown[][]): { fila: number; col: Record<Columna, number> } | null {
  for (let r = 0; r < Math.min(tabla.length, 15); r++) {
    const hs = (tabla[r] ?? []).map(normHeader);
    const col = {} as Record<Columna, number>;
    for (const k of Object.keys(ALIAS) as Columna[]) {
      let i = -1;
      for (const a of ALIAS[k]) { i = hs.indexOf(a); if (i >= 0) break; }
      if (i < 0) for (const a of ALIAS[k]) { i = hs.findIndex((h) => h.startsWith(`${a} `)); if (i >= 0) break; }
      col[k] = i;
    }
    if (col.codigo >= 0 && col.referencia >= 0 && col.monto >= 0 && new Set([col.codigo, col.referencia, col.monto]).size === 3) return { fila: r, col };
  }
  return null;
}

/* ───────── Parser de CAJA MULTIMONEDA ───────── */
export interface ColumnasCaja {
  fila: number;
  descripcion: number;
  monto: number;
  movimiento: number;
  fecha: number;
  moneda: number;
  desde: number;
  hacia: number;
  clasificacion: number;
  subclasificacion: number;
}

/** Detecta si una hoja tiene las columnas del formato «CAJA PRINCIPAL MULTIMONEDAS MGG». */
export function ubicarColumnasCaja(tabla: unknown[][]): ColumnasCaja | null {
  for (let r = 0; r < Math.min(tabla.length, 15); r++) {
    const hs = (tabla[r] ?? []).map(normHeader);
    const colDesc = hs.findIndex((h) => (h.includes('nombre') && h.includes('descripcion')) || h === 'descripcion' || h === 'concepto');
    const colMonto = hs.findIndex((h) => h === 'monto' || h === 'importe');
    const colMov = hs.findIndex((h) => h.includes('movimiento'));
    const colFecha = hs.findIndex((h) => h === 'fecha');
    const colMoneda = hs.findIndex((h) => h === 'moneda' || h === 'cuenta');
    const colDesde = hs.findIndex((h) => h.includes('desde') || h.includes('origen'));
    const colHacia = hs.findIndex((h) => h.includes('hacia') || h.includes('destino'));
    const colClasif = hs.findIndex((h) => h.includes('clasificacion'));
    const colSubclasif = hs.findIndex((h) => h.includes('sub clasificacion') || h.includes('subclasificacion'));

    if (colDesc >= 0 && colMonto >= 0 && colMov >= 0) {
      return {
        fila: r,
        descripcion: colDesc,
        monto: colMonto,
        movimiento: colMov,
        fecha: colFecha,
        moneda: colMoneda,
        desde: colDesde,
        hacia: colHacia,
        clasificacion: colClasif,
        subclasificacion: colSubclasif,
      };
    }
  }
  return null;
}

/** ¿Es una tabla con estructura de Caja Multimoneda? */
export function esCajaMultimoneda(tabla: unknown[][]): boolean {
  return ubicarColumnasCaja(tabla) !== null;
}

export interface MovimientoCajaParsed {
  fila: number;
  codigo: string;
  referencia: string;
  montoBs: number;
  fecha: string;
  tipo: 'salida' | 'entrada' | 'reintegro';
  descripcion: string;
  tipoRetencion?: string;
  esMgg: boolean;
}

/**
 * Parsea una hoja de Caja Multimoneda extrayendo solo los movimientos de MGG
 * (pagos de compras y reintegros de retención), descartando pagos propios de Golden Touch.
 */
export function parsearCajaMultimoneda(
  tabla: unknown[][],
  opciones?: {
    ordenesMgg?: Array<{ id: string; codigo: string; sp?: string }>;
    soloMgg?: boolean;
  },
): MovimientoCajaParsed[] {
  const ub = ubicarColumnasCaja(tabla);
  if (!ub) return [];

  const soloMgg = opciones?.soloMgg !== false; // default true
  const codigosMgg = new Set<string>();
  if (opciones?.ordenesMgg) {
    for (const o of opciones.ordenesMgg) {
      codigosMgg.add(normalizarCodigoOc(o.codigo));
      if (o.sp) codigosMgg.add(normalizarCodigoOc(o.sp));
    }
  }

  const out: MovimientoCajaParsed[] = [];

  for (let r = ub.fila + 1; r < tabla.length; r++) {
    const row = tabla[r] ?? [];
    const descRaw = String(row[ub.descripcion] ?? '').trim();
    if (!descRaw) continue;

    // Detectar si menciona ODC / OC (no debe coincidir con palabras como OCTUBRE)
    if (!/\b(?:ODC|OC)[\s._#-]*\d+/i.test(descRaw)) continue;

    const rawOdcs = extraerOdc(descRaw);
    if (!rawOdcs.length) continue;

    const mov = String(row[ub.movimiento] ?? '').trim();
    const hacia = ub.hacia >= 0 ? String(row[ub.hacia] ?? '') : '';
    const moneda = ub.moneda >= 0 ? String(row[ub.moneda] ?? '') : '';
    const clasif = ub.clasificacion >= 0 ? String(row[ub.clasificacion] ?? '') : '';
    const subclasif = ub.subclasificacion >= 0 ? String(row[ub.subclasificacion] ?? '') : '';

    const textAll = `${descRaw} ${moneda} ${hacia} ${clasif} ${subclasif}`.toUpperCase();
    const esDescMgg = /\b(MGG|MINERAL GROUP|LOS PINOS)\b/.test(descRaw.toUpperCase());
    const esDestinoMgg = /\b(MINERAL GROUP|LOS PINOS)\b/.test(`${hacia} ${clasif} ${subclasif}`.toUpperCase());
    const esCuentaMgg = /\bMGG\b/.test(moneda.toUpperCase());
    const esGtGeneral = /\b(GT|GOLDEN TOUCH|PERAMANAL|MATANZAS|GUAIRA)\b/.test(textAll) && !esDescMgg && !esDestinoMgg && !esCuentaMgg;

    const esEntrada = /entrada/i.test(mov) || /reintegro/i.test(descRaw);
    const tipo = esEntrada ? 'reintegro' : 'salida';
    const fecha = ub.fecha >= 0 ? serialExcelAFechaIso(row[ub.fecha]) : '';
    const ref = extraerReferencia(descRaw);
    const montoTotal = extraerMonto(row[ub.monto], descRaw);
    const retencion = extraerTipoRetencion(descRaw);

    // Filtrar ODCs para MGG: si la fila o contexto es de Golden Touch, descartar completamente para MGG
    if (esGtGeneral) continue;

    const odcsValidas = rawOdcs.filter((cod) => {
      // Verificar si en el contexto inmediato de la ODC dice GT o MGG (ej. ODC 236 MGG Y ODC 181 GT)
      const numCorto = cod.replace('OC-2026-', '').replace(/^0+/, '');
      const idx = descRaw.toUpperCase().indexOf(numCorto);
      const context = idx >= 0 ? descRaw.toUpperCase().slice(idx, idx + 35) : '';
      const odcDiceGt = /\b(GT|GOLDEN TOUCH|MATANZAS|PERAMANAL)\b/.test(context);
      const odcDiceMgg = /\b(MGG|MINERAL GROUP|LOS PINOS)\b/.test(context);

      if (odcDiceGt && !odcDiceMgg && !esDescMgg && !esDestinoMgg) return false;

      // Si la OC existe en la lista de órdenes de MGG, pertenece a MGG
      if (codigosMgg.size > 0 && codigosMgg.has(cod)) return true;

      // Si se proporcionó lista de órdenes y no está en MGG cuando soloMgg está activo
      if (soloMgg && codigosMgg.size > 0 && !codigosMgg.has(cod)) return false;

      return true;
    });

    if (!odcsValidas.length) continue;

    // Si hay múltiples ODCs en la fila, dividir monto equitativamente
    const montoPorOdc = rawOdcs.length > 1 && Number.isFinite(montoTotal)
      ? Math.round((montoTotal / rawOdcs.length) * 100) / 100
      : montoTotal;

    for (const cod of odcsValidas) {
      out.push({
        fila: r + 1,
        codigo: cod,
        referencia: ref || (tipo === 'reintegro' ? (retencion ?? 'REINTEGRO') : ''),
        montoBs: Number.isFinite(montoPorOdc) ? montoPorOdc : 0,
        fecha,
        tipo,
        tipoRetencion: retencion,
        descripcion: descRaw.replace(/\s+/g, ' '),
        esMgg: true,
      });
    }
  }

  return out;
}

/** Convierte una tabla de Caja Multimoneda en la tabla de columnas estándar para `analizarTablaDrive`. */
export function convertirCajaATablaEstandar(
  tabla: unknown[][],
  ordenes?: Array<{ id: string; codigo: string; sp?: string }>,
): unknown[][] {
  const parsed = parsearCajaMultimoneda(tabla, { ordenesMgg: ordenes, soloMgg: true });
  const result: unknown[][] = [
    ['Código OC', 'Referencia', 'Monto Bs', 'Fecha', 'Tipo', 'Tipo Retención', 'Descripción', 'Fila Original'],
  ];
  for (const p of parsed) {
    result.push([
      p.codigo,
      p.referencia,
      p.montoBs,
      p.fecha,
      p.tipo,
      p.tipoRetencion ?? '',
      p.descripcion,
      p.fila,
    ]);
  }
  return result;
}

/** Lee el Excel o CSV como tabla; busca inteligentemente la hoja adecuada o combina todas las hojas con datos. */
export async function leerTablaArchivo(file: File): Promise<unknown[][]> {
  const mod = await import('xlsx-js-style');
  const X = ((mod as unknown as { default?: unknown }).default ?? mod) as {
    read: (d: unknown, o: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
    utils: { sheet_to_json: <T>(ws: unknown, o?: unknown) => T[] };
  };
  const esCsv = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';
  const wb = esCsv
    ? X.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : X.read(await file.arrayBuffer(), { type: 'array' });

  if (!wb.SheetNames || !wb.SheetNames.length) {
    throw new Error('El archivo no tiene hojas con datos.');
  }

  // 1. Archivo de una sola hoja o CSV
  if (wb.SheetNames.length === 1) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const t = X.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
    if (esCajaMultimoneda(t)) return convertirCajaATablaEstandar(t);
    return t;
  }

  // 2. Extraer movimientos a través de TODAS las hojas del libro (multi-pestaña)
  const hojasAIgnorar = /^(base de datos|datos|formato\s*tasa|instrucciones|resumen|config|plantilla)/i;
  const filasSalida: Array<{ codigo: string; ref: string; monto: number; fecha: string; tipo: string; ret: string; desc: string; fila: number }> = [];

  for (const sheetName of wb.SheetNames) {
    if (hojasAIgnorar.test(sinAcentos(sheetName).trim())) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const t = X.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
    if (!t || t.length < 2) continue;

    // Caso A: Formato Caja Multimoneda (ej. "CAJA PRINCIPAL MULTIMONEDAS MGG" o copias)
    if (ubicarColumnasCaja(t)) {
      const parsed = parsearCajaMultimoneda(t, { soloMgg: true });
      for (const p of parsed) {
        filasSalida.push({
          codigo: p.codigo,
          ref: p.referencia,
          monto: p.montoBs,
          fecha: p.fecha,
          tipo: p.tipo,
          ret: p.tipoRetencion ?? '',
          desc: p.descripcion,
          fila: p.fila,
        });
      }
      continue;
    }

    // Caso B: Formato estándar con columnas Código OC, Referencia, Monto Bs
    const ubStd = ubicarColumnas(t);
    if (ubStd) {
      const hs = (t[ubStd.fila] ?? []).map(normHeader);
      const iFecha = hs.findIndex((h) => h.includes('fecha'));
      const iRet = hs.findIndex((h) => h.includes('retencion'));
      const iTipo = hs.findIndex((h) => h === 'tipo' || h.includes('movimiento'));
      const iDesc = hs.findIndex((h) => h.includes('descripcion') || h.includes('concepto'));
      for (let r = ubStd.fila + 1; r < t.length; r++) {
        const row = t[r] ?? [];
        const cod = normalizarCodigoOc(row[ubStd.col.codigo]);
        const ref = String(row[ubStd.col.referencia] ?? '').trim();
        const monto = leerMontoBs(row[ubStd.col.monto]);
        if (!cod && !ref && !Number.isFinite(monto)) continue;
        const fecha = iFecha >= 0 ? serialExcelAFechaIso(row[iFecha]) : '';
        const ret = iRet >= 0 ? String(row[iRet] ?? '').trim() : '';
        const tipo = iTipo >= 0 && /reintegro|entrada/i.test(String(row[iTipo] ?? '')) ? 'reintegro' : 'salida';
        const desc = iDesc >= 0 ? String(row[iDesc] ?? '').trim() : '';
        filasSalida.push({ codigo: cod, ref, monto: Number.isFinite(monto) ? monto : 0, fecha, tipo, ret, desc, fila: r + 1 });
      }
      continue;
    }

    // Caso C: Hojas de TASA DE BS diarias (ej. " TASA DE BS 12-11-26")
    if (/tasa\s*(?:de)?\s*bs/i.test(sinAcentos(sheetName))) {
      let fechaHoja = '';
      const mFecha = sheetName.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
      if (mFecha) {
        const d = mFecha[1].padStart(2, '0');
        const m = mFecha[2].padStart(2, '0');
        const y = mFecha[3].length === 2 ? `20${mFecha[3]}` : mFecha[3];
        fechaHoja = `${y}-${m}-${d}`;
      }
      for (let r = 1; r < t.length; r++) {
        const row = t[r] ?? [];
        let desc = '';
        for (const cell of row) {
          if (typeof cell === 'string' && /\b(?:ODC|OC|REINTEGRO)[\s._#-]*\d+/i.test(cell)) {
            desc = cell;
            break;
          }
        }
        if (!desc) continue;
        const esDescMgg = /\b(MGG|MINERAL GROUP|LOS PINOS)\b/i.test(desc);
        const esDescGt = /\b(GT|GOLDEN TOUCH|PERAMANAL|MATANZAS|GUAIRA)\b/i.test(desc) && !esDescMgg;
        if (esDescGt) continue;

        const odcs = extraerOdc(desc);
        if (!odcs.length) continue;
        const ref = extraerReferencia(desc);
        const esEntrada = /reintegro|entrada/i.test(desc);
        const tipo = esEntrada ? 'reintegro' : 'salida';
        const mSalida = typeof row[5] === 'number' ? row[5] : leerMontoBs(row[5]);
        const mEntrada = typeof row[3] === 'number' ? row[3] : leerMontoBs(row[3]);
        const montoTotal = Number.isFinite(mSalida) && mSalida > 0 ? mSalida
          : Number.isFinite(mEntrada) && mEntrada > 0 ? mEntrada
          : extraerMonto(null, desc);

        const montoPorOdc = odcs.length > 1 && Number.isFinite(montoTotal)
          ? Math.round((montoTotal / odcs.length) * 100) / 100
          : montoTotal;

        for (const cod of odcs) {
          filasSalida.push({
            codigo: cod,
            ref,
            monto: Number.isFinite(montoPorOdc) ? montoPorOdc : 0,
            fecha: fechaHoja,
            tipo,
            ret: extraerTipoRetencion(desc) ?? '',
            desc: desc.replace(/\s+/g, ' '),
            fila: r + 1,
          });
        }
      }
      continue;
    }
  }

  // Si se extrajeron movimientos de múltiples hojas, deduplicar los idénticos
  if (filasSalida.length > 0) {
    const unicos: typeof filasSalida = [];
    for (const f of filasSalida) {
      const yaExiste = unicos.some((u) => {
        if (u.codigo !== f.codigo) return false;
        const mismaRef = (!u.ref && !f.ref) || u.ref === f.ref;
        const mismoMonto = Math.abs(u.monto - f.monto) <= TOLERANCIA_BS;
        return mismaRef && mismoMonto;
      });
      if (!yaExiste) {
        unicos.push(f);
      } else if (f.ref) {
        const ex = unicos.find((u) => u.codigo === f.codigo && Math.abs(u.monto - f.monto) <= TOLERANCIA_BS);
        if (ex && !ex.ref) ex.ref = f.ref;
      }
    }

    const resultado: unknown[][] = [
      ['Código OC', 'Referencia', 'Monto Bs', 'Fecha', 'Tipo', 'Tipo Retención', 'Descripción', 'Fila Original'],
    ];
    for (const u of unicos) {
      resultado.push([u.codigo, u.ref, u.monto, u.fecha, u.tipo, u.ret, u.desc, u.fila]);
    }
    return resultado;
  }

  // Fallback si no hubo coincidencias estructuradas
  const sheet0 = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json<unknown[]>(sheet0, { header: 1, defval: null, blankrows: false });
}

const EXT_OK = /\.(xlsx|xls|csv)$/i;

/** ¿Sirve el archivo? (Excel o CSV, hasta 10 MB). */
export function errorArchivoDrive(f: { name: string; size: number }): string | null {
  if (!EXT_OK.test(f.name)) return 'El archivo debe ser Excel (.xlsx, .xls) o CSV (.csv).';
  if (f.size > 10 * 1024 * 1024) return 'El archivo no puede superar 10 MB.';
  if (!f.size) return 'El archivo está vacío.';
  return null;
}

/**
 * Valida cada fila (como Inventario): código de OC, referencia y monto obligatorios; la OC
 * tiene que existir en Conciliación; el monto, un número mayor que cero. Una OC repetida en
 * el archivo queda como «duplicada» (se juntan: se suman los montos y valen todas sus referencias).
 *
 * Si una OC ya está conciliada en el sistema (CUADRA), se marca como «ya_conciliada»,
 * evitando doble cruce y evitando sumar montos de conciliaciones de días previos.
 */
/**
 * De varios pagos del archivo con el mismo N° de ODC, cuáles son de esta orden:
 *  1) los que traen la referencia que cargó Tesorería (últimos 4 dígitos);
 *  2) si no, los que tienen el monto en Bs del sistema (lo pagado en Bs o el monto Bs de la OC);
 *  3) si no, los que traen la referencia colocada en Conciliación;
 *  4) si nada coincide, todos (se suman: pagos parciales) y el cruce dirá por qué no cuadra.
 */
export function elegirPagosDeOrden(cand: FilaDrive[], info?: OrdenCriterioConciliacion): FilaDrive[] {
  if (cand.length < 2 || !info) return cand;
  const refsT = (info.refsTesoreria ?? []).filter(Boolean);
  const refsTodas = (info.referencias ?? []).filter(Boolean);
  const esperados = [info.pagadoBs, info.montoBs].filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  const montoOk = (m: number) => esperados.some((x) => Math.abs(x - m) <= TOLERANCIA_BS);

  const porRefT = cand.filter((f) => refsT.some((r) => mismaReferencia(f.referencia, r)));
  if (porRefT.length) {
    const conMonto = porRefT.filter((f) => montoOk(f.montoBs));
    return conMonto.length ? conMonto : porRefT;
  }
  const porMonto = cand.filter((f) => montoOk(f.montoBs));
  if (porMonto.length) return [porMonto[0]];
  const porRef = cand.filter((f) => refsTodas.some((r) => mismaReferencia(f.referencia, r)));
  if (porRef.length) return porRef;
  return cand;
}

export function analizarTablaDrive(
  tablaOriginal: unknown[][],
  archivo: string,
  ordenes: Array<OrdenCriterioConciliacion>,
): AnalisisDrive {
  let tabla = tablaOriginal;
  if (esCajaMultimoneda(tabla)) {
    tabla = convertirCajaATablaEstandar(tabla, ordenes);
  }

  const ub = ubicarColumnas(tabla);
  if (!ub) throw new Error('No se encontraron las columnas. El archivo debe tener: «Código OC», «Referencia» y «Monto Bs» (descarga la plantilla).');

  const porCodigo = new Map<string, string>();
  const porNumero = new Map<string, string>();
  const infoPorId = new Map<string, OrdenCriterioConciliacion>();
  for (const o of ordenes) {
    const cod = normalizarCodigoOc(o.codigo);
    porCodigo.set(cod, o.id);
    infoPorId.set(o.id, o);
    // Indexar por número final solo del código de orden (o.codigo), NUNCA por o.sp (evita que ODC 219 cruce con OC-2026-0249 por tener SP-0219)
    if (o.codigo) {
      const m = o.codigo.match(/(\d{1,6})$/);
      if (m) {
        const num = m[1].replace(/^0+/, '');
        if (num && !porNumero.has(num)) porNumero.set(num, o.id);
        const pad4 = num.padStart(4, '0');
        if (pad4 && !porNumero.has(pad4)) porNumero.set(pad4, o.id);
      }
    }
  }

  // Detectar columnas adicionales opcionales en el encabezado
  const hs = (tabla[ub.fila] ?? []).map(normHeader);
  const colFecha = hs.findIndex((h) => h.includes('fecha'));
  const colTipo = hs.findIndex((h) => h === 'tipo' || h.includes('movimiento'));
  const colRet = hs.findIndex((h) => h.includes('retencion'));
  const colDesc = hs.findIndex((h) => h.includes('descripcion') || h.includes('concepto'));
  const colFilaOrig = hs.findIndex((h) => h.includes('fila original') || h.includes('fila orig'));

  const filas: FilaDrive[] = [];
  const errorPorColumna: Record<string, number> = {};
  const sumCol = (c: string) => { errorPorColumna[c] = (errorPorColumna[c] ?? 0) + 1; };

  for (let r = ub.fila + 1; r < tabla.length; r++) {
    const row = tabla[r] ?? [];
    const crudo = {
      codigo: row[ub.col.codigo],
      referencia: row[ub.col.referencia],
      monto: row[ub.col.monto],
      fecha: colFecha >= 0 ? row[colFecha] : undefined,
      tipo: colTipo >= 0 ? String(row[colTipo] ?? '').toLowerCase() : undefined,
      tipoRetencion: colRet >= 0 ? String(row[colRet] ?? '').trim() : undefined,
      descripcion: colDesc >= 0 ? String(row[colDesc] ?? '').trim() : undefined,
      filaOrig: colFilaOrig >= 0 && typeof row[colFilaOrig] === 'number' ? row[colFilaOrig] : r + 1,
    };
    const vacio = (v: unknown) => v == null || String(v).trim() === '';
    if (vacio(crudo.codigo) && vacio(crudo.referencia) && vacio(crudo.monto)) continue; // fila en blanco

    const codigo = normalizarCodigoOc(crudo.codigo);
    let referencia = String(crudo.referencia ?? '').trim();
    const montoBs = leerMontoBs(crudo.monto);
    let ordenId = porCodigo.get(codigo) ?? null;
    // Si no encontró por código exacto normalizado, buscar por número corto (tolera prefijos SV-, SP-, etc.)
    if (!ordenId && codigo) {
      const mNum = codigo.match(/(\d{1,6})$/);
      if (mNum) {
        const num = mNum[1].replace(/^0+/, '');
        ordenId = porNumero.get(num) ?? porNumero.get(mNum[1]) ?? null;
      }
    }
    const ordenInfo = ordenId ? infoPorId.get(ordenId) : undefined;
    const yaConciliada = ordenInfo ? estaConciliada(ordenInfo) : false;

    // Solo se cruzan las órdenes que estén pagadas por tesorería en el sistema y en Bs
    const noPagadaEnSistema = ordenInfo && (ordenInfo.pagado === false || ordenInfo.seCruza === false);
    const esCaja = colDesc >= 0 || colFilaOrig >= 0;

    if (noPagadaEnSistema || (!ordenId && esCaja)) {
      filas.push({
        fila: crudo.filaOrig,
        codigo,
        referencia: referencia || '—',
        montoBs: Number.isFinite(montoBs) ? montoBs : 0,
        errores: [],
        duplicado: false,
        estado: 'omitida',
        ordenId,
        fecha: crudo.fecha ? serialExcelAFechaIso(crudo.fecha) : undefined,
        tipo: (crudo.tipo === 'reintegro' || crudo.tipo === 'entrada') ? 'reintegro' : 'salida',
        tipoRetencion: crudo.tipoRetencion || undefined,
        descripcion: crudo.descripcion || undefined,
        yaConciliada: false,
        motivoOmitida: noPagadaEnSistema
          ? 'No está pagada por Tesorería en Bs en el sistema (no se cruza)'
          : `La orden ${codigo || 'sin código'} no está en la vista actual de Conciliación (período de noviembre o no pagada en Bs)`,
      });
      continue;
    }

    // Si ya está conciliada en el sistema (CUADRA), no sumamos doble ni hacemos doble cruce
    if (yaConciliada) {
      filas.push({
        fila: crudo.filaOrig,
        codigo,
        referencia: referencia || 'CONCILIADA',
        montoBs: Number.isFinite(montoBs) ? montoBs : 0,
        errores: [],
        duplicado: false,
        estado: 'ya_conciliada',
        ordenId,
        fecha: crudo.fecha ? serialExcelAFechaIso(crudo.fecha) : undefined,
        tipo: (crudo.tipo === 'reintegro' || crudo.tipo === 'entrada') ? 'reintegro' : 'salida',
        tipoRetencion: crudo.tipoRetencion || undefined,
        descripcion: crudo.descripcion || undefined,
        yaConciliada: true,
      });
      continue;
    }

    const errores: string[] = [];

    if (!codigo) {
      errores.push('Código de OC vacío');
      sumCol('codigo');
    } else if (!ordenId) {
      errores.push(`La OC ${codigo} no existe en Conciliación`);
      sumCol('codigo');
    }

    if (!referencia) {
      if (crudo.tipo === 'reintegro' || crudo.tipo === 'entrada') {
        referencia = crudo.tipoRetencion || 'REINTEGRO';
      } else {
        errores.push('Referencia vacía');
        sumCol('referencia');
      }
    }

    if (vacio(crudo.monto)) {
      errores.push('Monto vacío');
      sumCol('monto');
    } else if (!Number.isFinite(montoBs)) {
      errores.push('Monto no es un número');
      sumCol('monto');
    } else if (montoBs <= 0) {
      errores.push('Monto en cero o negativo');
      sumCol('monto');
    }

    filas.push({
      fila: crudo.filaOrig,
      codigo,
      referencia,
      montoBs,
      errores,
      duplicado: false,
      estado: errores.length ? 'error' : 'valido',
      ordenId,
      fecha: crudo.fecha ? serialExcelAFechaIso(crudo.fecha) : undefined,
      tipo: (crudo.tipo === 'reintegro' || crudo.tipo === 'entrada') ? 'reintegro' : 'salida',
      tipoRetencion: crudo.tipoRetencion || undefined,
      descripcion: crudo.descripcion || undefined,
      yaConciliada: false,
    });
  }

  if (!filas.length) throw new Error('El archivo no trae filas con datos debajo de los encabezados.');

  // GT y MGG reutilizan los mismos números de ODC (ej. ODC 200, 217, 224, 227, 228, 0039) y la caja
  // es compartida: cuando una orden tiene varios pagos con su número, se queda con el que coincide
  // con la referencia de Tesorería o con el monto del sistema; los demás se omiten (son de otra orden).
  const candidatas = new Map<string, FilaDrive[]>();
  for (const f of filas) {
    if (f.estado === 'error' || f.estado === 'omitida' || !f.ordenId || f.yaConciliada) continue;
    if (f.tipo === 'reintegro' || f.tipo === 'entrada') continue;
    const l = candidatas.get(f.ordenId) ?? [];
    l.push(f);
    candidatas.set(f.ordenId, l);
  }
  for (const [id, cand] of candidatas) {
    if (cand.length < 2) continue;
    const elegidas = elegirPagosDeOrden(cand, infoPorId.get(id));
    for (const f of cand) {
      if (elegidas.includes(f)) continue;
      f.estado = 'omitida';
      f.motivoOmitida = `Otro pago con el mismo N° de ODC (ref. ${f.referencia || '—'}): no coincide con la referencia de Tesorería ni con el monto de ${f.codigo} en el sistema`;
    }
  }
  // Duplicados entre las filas válidas del archivo
  const veces = new Map<string, number>();
  for (const f of filas) {
    if (f.ordenId && f.estado !== 'omitida' && f.estado !== 'error') {
      veces.set(f.ordenId, (veces.get(f.ordenId) ?? 0) + 1);
    }
  }
  for (const f of filas) {
    if (f.ordenId && f.estado !== 'omitida' && f.estado !== 'error' && (veces.get(f.ordenId) ?? 0) > 1) {
      f.duplicado = true;
      if (f.estado === 'valido') f.estado = 'duplicado';
    }
  }

  const porOrden = new Map<string, DatosDrive>();
  const porOrdenEntradas = new Map<string, DatosDrive>();
  for (const f of filas) {
    if (f.estado === 'error' || f.estado === 'omitida' || !f.ordenId || f.yaConciliada) continue;
    if (f.tipo === 'reintegro' || f.tipo === 'entrada') {
      const d = porOrdenEntradas.get(f.ordenId) ?? { referencias: [], montoBs: 0, archivo, filas: [] };
      if (f.referencia && !d.referencias.includes(f.referencia)) d.referencias.push(f.referencia);
      d.montoBs = Math.round((d.montoBs + f.montoBs) * 100) / 100;
      d.filas.push(f.fila);
      porOrdenEntradas.set(f.ordenId, d);
    } else {
      const d = porOrden.get(f.ordenId) ?? { referencias: [], montoBs: 0, archivo, filas: [] };
      if (f.referencia && !d.referencias.includes(f.referencia)) d.referencias.push(f.referencia);
      d.montoBs = Math.round((d.montoBs + f.montoBs) * 100) / 100;
      d.filas.push(f.fila);
      porOrden.set(f.ordenId, d);
    }
  }

  const conError = filas.filter((f) => f.estado === 'error').length;
  const duplicadas = filas.filter((f) => f.estado === 'duplicado').length;
  const yaConciliadas = filas.filter((f) => f.estado === 'ya_conciliada').length;
  const omitidas = filas.filter((f) => f.estado === 'omitida').length;
  const validas = filas.filter((f) => f.estado === 'valido').length;

  return {
    archivo,
    total: filas.length,
    validas,
    conError,
    duplicadas,
    yaConciliadas,
    omitidas,
    errorPorColumna,
    filas,
    porOrden,
    porOrdenEntradas,
    estado: conError ? 'Error' : duplicadas ? 'Duplicados' : 'Validado',
  };
}

/** Texto de la columna DRIVE (vacío si la OC no se ha cotejado). */
export const textoDrive = (r: ResultadoDrive | null | undefined) => r?.estado ?? '';

/** Plantilla del archivo: Hoja 1 Salidas, Hoja 2 Reintegros, Hoja 3 Instrucciones. */
export async function descargarPlantillaDrive(): Promise<void> {
  const [XLSX, { previewWorkbook }] = await Promise.all([import('xlsx-js-style'), import('@/shared/lib/reportPreview')]);
  const X = XLSX as unknown as {
    utils: { book_new: () => unknown; aoa_to_sheet: (a: unknown[][]) => Record<string, unknown>; book_append_sheet: (wb: unknown, ws: unknown, n: string) => void };
  };
  const wb = X.utils.book_new();

  // Hoja 1: Salidas - Compras
  const wsSalidas = X.utils.aoa_to_sheet([
    ['Código OC', 'Referencia', 'Monto Bs'],
    ['OC-2026-0251', '68973570', 281103.06],
    ['OC-2026-0250', '68974400', 90833.91],
  ]);
  wsSalidas['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }];
  X.utils.book_append_sheet(wb, wsSalidas, 'Salidas - Compras');

  // Hoja 2: Entradas - Reintegros
  const wsEntradas = X.utils.aoa_to_sheet([
    ['Código OC', 'Fecha Reintegro', 'Referencia', 'Monto Bs', 'Tipo Retención'],
    ['OC-2026-0201', '2026-11-10', '00322', 91833.41, 'ISAE-ISLR-IVA'],
    ['OC-2026-0236', '2026-11-09', 'REINTEGRO', 197225.38, 'ISAE-IVA'],
  ]);
  wsEntradas['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 24 }];
  X.utils.book_append_sheet(wb, wsEntradas, 'Entradas - Reintegros');

  // Hoja 3: Instrucciones
  const wsInstrucciones = X.utils.aoa_to_sheet([
    ['INSTRUCCIONES DE USO — CONCILIACIÓN DRIVE Y CAJA MULTIMONEDAS MGG'],
    [''],
    ['1. FORMATOS ACEPTADOS:'],
    ['   • Esta plantilla oficial con hojas "Salidas - Compras" y "Entradas - Reintegros".'],
    ['   • El libro oficial de Excel de la empresa: "CAJA PRINCIPAL MULTIMONEDAS MGG".'],
    [''],
    ['2. CARGA DEL LIBRO DE CAJA MULTIMONEDAS:'],
    ['   • Si subes el archivo completo de Caja Multimonedas, el sistema detecta de forma automática'],
    ['     la hoja "CAJA PRINCIPAL MULTIMONEDAS MGG".'],
    ['   • Filtra automáticamente solo los movimientos que corresponden a MGG (Mineral Group Guayana),'],
    ['     descartando los pagos propios de Golden Touch (GT) o de otras unidades.'],
    ['   • Si se suben archivos diarios o semanales recurrentemente, las órdenes ya conciliadas (CUADRA)'],
    ['     se detectan y se mantienen intactas sin duplicar montos ni hacer doble cruce.'],
    [''],
    ['3. USO DE ESTA PLANTILLA:'],
    ['   • Hoja "Salidas - Compras": registrar pagos de compras con Código OC, Referencia bancaria y Monto en Bs.'],
    ['   • Hoja "Entradas - Reintegros": registrar reintegros y retenciones aplicadas (ISLR, IVA, ISAE).'],
    ['   • El sistema concilia ambos tipos de movimientos contra el módulo de Conciliación de MGG.'],
  ]);
  wsInstrucciones['!cols'] = [{ wch: 100 }];
  X.utils.book_append_sheet(wb, wsInstrucciones, 'Instrucciones');

  previewWorkbook(XLSX, wb, 'plantilla-drive-conciliacion.xlsx');
}
