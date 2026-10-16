/* ============================================================
   MGG · Retenciones · El motor: una línea, los 8 pasos

   Recorre los pasos de la versión en su orden fijo (regla.ts) y deja en la
   foto lo que hizo cada uno: con qué entradas, qué valor dio y por qué. La
   foto se guarda con la retención (retenciones.calculo_foto), así que el
   comprobante y el contador ven de dónde salió el número, y un cambio de
   norma no altera lo emitido.

   Es una función pura: los parámetros, las tasas y las tarifas llegan ya
   resueltos a la fecha de la factura (la tasa, con el día que fija
   retencion_dia_tasa; ver tasas.ts). Sin un dato que hace falta no se
   calcula: nunca con 0 en silencio. Un monto del documento sin cargar no
   es lo mismo que un 0.

   Entre pasos se trabaja con los valores exactos; se redondea solo en el
   paso 8. El interruptor `redondeoIntermedio: 'publicado'` usa el mínimo y
   el sustraendo en Bs con 2 decimales, como los publica la norma
   (3.583,34 y 107,50): lo decide el usuario, y vale igual por línea y por
   factura.

   Convenciones acordadas con BD (16/10):
   · se calcula con magnitudes positivas; la nota de crédito pone el signo
     −1 DESPUÉS del paso 8, y la foto lo guarda;
   · una retención negativa no existe: el resultado nunca baja de 0, aunque
     la regla no tenga el paso de topes;
   · con varios supuestos marcados, se toma el mayor %;
   · una fila de la tabla lleva o su % o su tarifa por tramos;
   · los tramos comparan la base llevada a la unidad de la tarifa (UT a la
     fecha de la factura), y el resultado vuelve a Bs.
   ============================================================ */

import type {
  ColumnaTabla, Componente, FilaClasificacion, Fuente, NombrePaso, Operacion, PasosRegla, SupuestoMarcado,
  TarifaVigente, TasaFecha, TipoDocumento, TramoTarifa, UnidadMinimo, VersionRegla,
} from './regla';
import { fmt2 } from './numeros';

/** La clave del parámetro de la unidad tributaria. */
export const CLAVE_UT = 'valor_ut';

export interface EntradaLinea {
  /**
   * Los montos de la línea, en la moneda del documento. `subtotal` = los
   * renglones sin IVA ni IGTF, antes del descuento (con lo exento dentro);
   * `total` = lo que se paga. Un componente que la regla usa y no viene
   * (undefined o null) es un dato que falta; un 0 es un 0.
   */
  montos: Readonly<Partial<Record<Componente, number | null>>>;
  /** La moneda del documento ('Bs', 'USD', 'EUR'…). */
  moneda: string;
  tipo: TipoDocumento;
  /** Si la línea es de bienes o de servicios; sin dato, se toma la del documento. */
  operacion?: Exclude<Operacion, 'ambos'>;
  /** La fila de clasificación elegida para esta línea (concepto, actividad…). */
  fila: FilaClasificacion | null;
  supuestos: readonly SupuestoMarcado[];
}

/** Los valores vigentes a la fecha de la factura. */
export interface ContextoCalculo {
  /** Por clave. null o ausente = sin valor a esa fecha. */
  parametros: Readonly<Record<string, number | null | undefined>>;
  /** La tasa de la moneda del documento a Bs. */
  tasa: TasaFecha | null;
  /** La de la moneda de mayor valor del BCV (la mayor del día). */
  tasaMmv: TasaFecha | null;
  tarifas: Readonly<Record<string, TarifaVigente | undefined>>;
  /** Interruptor: 'exacto' (por defecto) o 'publicado' (mínimo y sustraendo en Bs con 2 decimales). */
  redondeoIntermedio?: 'exacto' | 'publicado';
}

/** Lo que el documento impone a la línea cuando el mínimo o el sustraendo van «una vez por factura». */
export interface AjustesDocumento {
  /** La base con la que se compara el mínimo (la de todo el documento). */
  baseMinimo?: number;
  /** El sustraendo que queda por descontar en el documento; la línea toma lo que pueda. */
  sustraendoDisponible?: number;
  /** El texto de la foto cuando el sustraendo se aplicó en otra línea. */
  notaSustraendo?: string;
}

export interface PasoFoto {
  paso: NombrePaso;
  operacion: string;
  entradas: Record<string, number | string | null>;
  valor: number;
  nota: string;
}

export interface ValoresFoto {
  valor_ut: number | null;
  alicuota: number | null;
  fila_id: string | null;
  supuestos: string[];
  pct_supuesto: number | null;
  tasas: TasaFecha[];
  base_ut?: number;
  tramo?: TramoTarifa;
}

export interface FotoCalculo {
  regla_version_id: string;
  signo: 1 | -1;
  pasos: PasoFoto[];
  valores: ValoresFoto;
}

export type Falta =
  | { tipo: 'parametro'; clave: string }
  | { tipo: 'componente'; componente: Componente }
  | { tipo: 'base_negativa' }
  | { tipo: 'fila' }
  | { tipo: 'columna'; columna: ColumnaTabla }
  | { tipo: 'tasa'; moneda: string }
  | { tipo: 'tasa_mmv' }
  | { tipo: 'tarifa'; tarifa_id: string }
  | { tipo: 'tramo' }
  | { tipo: 'regla'; detalle: string };

export type ResultadoCalculo =
  | {
    estado: 'calculado';
    /** Con su signo, redondeado: negativo en la nota de crédito. */
    monto: number;
    magnitud: number;
    cero: boolean;
    nota: string;
    /** Lo que conviene revisar aunque se haya calculado. */
    avisos: string[];
    /** La base después de convertir la moneda (pasos 1 y 2), sin redondear. */
    base: number;
    /** El % del paso de la tasa, si fue un % o un tramo. */
    pct: number | null;
    /** Lo que restó el sustraendo, antes de los topes, sin redondear. */
    sustraendo: number;
    foto: FotoCalculo;
  }
  | { estado: 'no_aplica'; motivo: string; foto: FotoCalculo }
  | { estado: 'sin_dato'; falta: Falta; nota: string; foto: FotoCalculo };

class FaltaDato extends Error {
  constructor(readonly falta: Falta, mensaje: string) { super(mensaje); }
}

/**
 * Redondeo a `d` decimales, la mitad hacia arriba. Corta primero el ruido de
 * coma flotante (1,005 × 100 = 100,49999… → 100,5) a 15 cifras significativas.
 */
export function redondear(n: number, d = 2): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** d;
  const escalado = Number((Math.abs(n) * f).toPrecision(15));
  const r = (Math.sign(n) * Math.round(escalado)) / f;
  return r === 0 ? 0 : r;
}

/** Para la foto: sin el ruido de coma flotante, sin perder precisión útil. */
const limpio = (n: number) => redondear(n, 6);

const MONEDAS_BS = new Set(['bs', 'ves', 'bs.', 'bss']);
export const esBolivares = (moneda: string) => MONEDAS_BS.has(moneda.trim().toLowerCase());

const COLUMNA_TEXTO: Record<ColumnaTabla, string> = {
  pct: 'el % ni una tarifa', base_pct: 'el % de la base', minimo: 'el mínimo', sustraendo_factor: 'el factor del sustraendo',
};

export function calcularLinea(
  version: VersionRegla, e: EntradaLinea, ctx: ContextoCalculo, ajustes: AjustesDocumento = {},
): ResultadoCalculo {
  const p: PasosRegla = version.pasos ?? {};
  const signo: 1 | -1 = e.tipo === 'nc' ? -1 : 1;
  const publicado = ctx.redondeoIntermedio === 'publicado';
  const foto: FotoCalculo = {
    regla_version_id: version.id, signo, pasos: [],
    valores: { valor_ut: null, alicuota: null, fila_id: e.fila?.id ?? null, supuestos: [], pct_supuesto: null, tasas: [] },
  };
  const avisos: string[] = [];
  const anotar = (paso: NombrePaso, operacion: string, entradas: PasoFoto['entradas'], valor: number, nota = '') => {
    foto.pasos.push({ paso, operacion, entradas, valor: limpio(valor), nota });
  };
  const agregarTasa = (t: TasaFecha) => {
    if (!foto.valores.tasas.some((x) => x.moneda === t.moneda && x.fecha === t.fecha)) foto.valores.tasas.push(t);
  };

  // La operación se decide por línea: una regla de servicios no aplica a una línea de bienes.
  if (e.operacion && version.operacion !== 'ambos' && e.operacion !== version.operacion) {
    return { estado: 'no_aplica', motivo: `La línea es de ${e.operacion}; la regla aplica solo a ${version.operacion === 'bienes' ? 'bienes' : 'servicios'}.`, foto };
  }

  const parametro = (clave: string): number => {
    const v = ctx.parametros[clave];
    if (v == null || !Number.isFinite(v)) throw new FaltaDato({ tipo: 'parametro', clave }, `Sin valor de «${clave}» para la fecha de la factura. Registrarlo en ⚙ Parámetros. No se calcula.`);
    return v;
  };
  const ut = (): number => {
    const v = parametro(CLAVE_UT);
    if (v <= 0) throw new FaltaDato({ tipo: 'parametro', clave: CLAVE_UT }, 'El valor de la UT para la fecha de la factura es 0. Registrar el valor correcto en ⚙ Parámetros. No se calcula.');
    foto.valores.valor_ut = v;
    return v;
  };
  const fila = (): FilaClasificacion => {
    if (!e.fila) throw new FaltaDato({ tipo: 'fila' }, 'Falta elegir el concepto o la actividad de la línea. No se calcula.');
    return e.fila;
  };
  /** Resuelve una fuente. `opcional` = una columna vacía de la tabla vale null (sin mínimo, sin sustraendo). */
  const resolver = (f: Fuente, opcional = false): number | null => {
    switch (f.tipo) {
      case 'fijo': return f.valor;
      case 'parametro': return parametro(f.clave);
      case 'tabla': {
        const v = fila()[f.columna];
        if (v == null) {
          if (opcional) return null;
          if (f.columna === 'base_pct') return 100;
          throw new FaltaDato({ tipo: 'columna', columna: f.columna }, `La fila «${fila().codigo}» no tiene ${COLUMNA_TEXTO[f.columna]}. Completarla en ⚙ Parámetros. No se calcula.`);
        }
        return v;
      }
      case 'supuesto': {
        if (e.supuestos.length) {
          const mayor = Math.max(...e.supuestos.map((s) => s.pct));
          foto.valores.supuestos = e.supuestos.map((s) => s.id);
          foto.valores.pct_supuesto = mayor;
          return mayor;
        }
        return resolver(f.defecto, opcional);
      }
    }
  };
  const requerido = (f: Fuente): number => resolver(f) as number;
  const monto = (c: Componente): number => {
    const v = e.montos[c];
    if (v == null || !Number.isFinite(v)) throw new FaltaDato({ tipo: 'componente', componente: c }, `Falta el monto «${c}» del documento. Cargarlo (con 0 si no tiene). No se calcula.`);
    return v;
  };

  try {
    // 1. Componer la base
    let v = 0;
    if (p.base) {
      const entradas: PasoFoto['entradas'] = {};
      const suma = p.base.suma.reduce((a, c) => { const m = monto(c); entradas[c] = m; return a + m; }, 0);
      const resta = p.base.resta.reduce((a, c) => { const m = monto(c); entradas[`− ${c}`] = m; return a + m; }, 0);
      v = suma - resta;
      if (v < 0) {
        anotar('base', 'componer', entradas, v, 'La base da negativa.');
        throw new FaltaDato({ tipo: 'base_negativa' },
          `La base da negativa: ${fmt2(suma)} − ${fmt2(resta)} = ${fmt2(v)}. Revisar los montos del documento. No se calcula.`);
      }
      if (p.base.porcion) {
        const porc = requerido(p.base.porcion);
        entradas.porcion = porc;
        v = (v * porc) / 100;
      }
      if (p.base.alicuota) {
        const ali = requerido(p.base.alicuota);
        entradas.alicuota = ali;
        foto.valores.alicuota = ali;
        v = (v * ali) / 100;
      }
      anotar('base', 'componer', entradas, v);
    }

    // 2. Convertir la moneda
    if (!esBolivares(e.moneda)) {
      if (p.moneda?.convertir) {
        const t = ctx.tasa;
        if (!t || t.moneda !== e.moneda || !(t.tasa > 0)) {
          throw new FaltaDato({ tipo: 'tasa', moneda: e.moneda }, `Sin tasa BCV de ${e.moneda} para la fecha de la factura. No se calcula.`);
        }
        agregarTasa(t);
        v *= t.tasa;
        anotar('moneda', 'multiplicar_tasa', { moneda: t.moneda, tasa: t.tasa, fecha: t.fecha }, v);
      } else {
        avisos.push(`El documento está en ${e.moneda} y la regla no convierte la moneda: el resultado queda en ${e.moneda}.`);
      }
    }
    const base = v;

    // 3. Comparar con el mínimo
    if (p.minimo) {
      const m = resolver(p.minimo.fuente, true);
      if (m != null && m > 0) {
        const unidad: UnidadMinimo = p.minimo.fuente.tipo === 'tabla' && e.fila?.minimo_unidad ? e.fila.minimo_unidad : p.minimo.unidad;
        let minimoBs = m;
        if (unidad === 'ut') minimoBs = m * ut();
        if (unidad === 'mmv') {
          const t = ctx.tasaMmv;
          if (!t || !(t.tasa > 0)) throw new FaltaDato({ tipo: 'tasa_mmv' }, 'Sin la tasa de la moneda de mayor valor del BCV para la fecha de la factura. No se calcula.');
          agregarTasa(t);
          minimoBs = m * t.tasa;
        }
        if (publicado) minimoBs = redondear(minimoBs);
        const comparada = ajustes.baseMinimo ?? base;
        const llega = comparada >= minimoBs;
        const delDocumento = ajustes.baseMinimo != null;
        anotar('minimo', 'comparar', { minimo: m, unidad, minimo_bs: limpio(minimoBs), base_comparada: limpio(comparada) }, v,
          llega ? '' : delDocumento ? 'La base del documento no llega al mínimo.' : 'La base no llega al mínimo.');
        if (!llega) {
          return {
            estado: 'calculado', monto: 0, magnitud: 0, cero: true, avisos, base, pct: null, sustraendo: 0, foto,
            nota: delDocumento ? 'No se retiene: la base del documento no llega al mínimo.' : 'No se retiene: la base no llega al mínimo.',
          };
        }
      }
    }

    // 4. Aplicar la tasa
    let pct: number | null = null;
    const porTramos = (tarifaId: string, origen: string) => {
      const tarifa = ctx.tarifas[tarifaId];
      if (!tarifa) throw new FaltaDato({ tipo: 'tarifa', tarifa_id: tarifaId }, `La tarifa ${origen} no tiene tramos vigentes a la fecha de la factura. No se calcula.`);
      const factor = tarifa.unidad === 'ut' ? ut() : 1;
      const x = v / factor;
      const tramo = [...tarifa.tramos].sort((a, b) => a.desde - b.desde).find((t) => x >= t.desde && (t.hasta == null || x <= t.hasta));
      if (!tramo) throw new FaltaDato({ tipo: 'tramo' }, `Ningún tramo de «${tarifa.nombre}» cubre una base de ${fmt2(x)} ${tarifa.unidad === 'ut' ? 'UT' : 'Bs'}. No se calcula.`);
      foto.valores.base_ut = tarifa.unidad === 'ut' ? redondear(x, 4) : undefined;
      foto.valores.tramo = tramo;
      pct = tramo.pct;
      v = Math.max(0, (x * tramo.pct) / 100 - tramo.sustraendo) * factor;
      anotar('tasa', 'tramos', { tarifa: tarifa.nombre, base_en_unidad: limpio(x), desde: tramo.desde, hasta: tramo.hasta, pct: tramo.pct, sustraendo: tramo.sustraendo }, v);
    };
    if (p.tasa) {
      if (p.tasa.op === 'pct') {
        // Una fila de la tabla lleva o su % o su tarifa por tramos (la Tarifa N° 2), nunca las dos.
        const f = p.tasa.fuente;
        if (f.tipo === 'tabla' && f.columna === 'pct' && e.fila && e.fila.pct == null && e.fila.tarifa_id) {
          porTramos(e.fila.tarifa_id, `de la fila «${e.fila.codigo}»`);
        } else {
          pct = requerido(f);
          v = (v * pct) / 100;
          anotar('tasa', 'pct', { pct }, v);
        }
      } else if (p.tasa.op === 'monto_fijo') {
        const fijo = requerido(p.tasa.fuente);
        v = fijo;
        anotar('tasa', 'monto_fijo', { monto: fijo }, v);
      } else {
        porTramos(p.tasa.tarifa_id, 'de la regla');
      }
    }

    // 5. Restar el sustraendo
    let sustraendo = 0;
    if (ajustes.sustraendoDisponible != null) {
      sustraendo = Math.min(v, ajustes.sustraendoDisponible);
      v -= sustraendo;
      anotar('sustraendo', 'una_vez_por_documento', { disponible: limpio(ajustes.sustraendoDisponible) }, v,
        ajustes.notaSustraendo ?? (sustraendo > 0 ? 'El sustraendo del documento se descuenta aquí.' : 'El sustraendo del documento ya se descontó.'));
    } else if (p.sustraendo) {
      const s = sustraendoDeLinea(p, pct, resolver, ut);
      if (s != null) {
        sustraendo = publicado ? redondear(s.monto) : s.monto;
        v -= sustraendo;
        anotar('sustraendo', p.sustraendo.op, { ...s.entradas, sustraendo: limpio(sustraendo) }, v);
      }
    }
    const causado = Math.max(0, v);

    // 6. Cuánto se retiene
    if (p.retiene) {
      if (p.retiene.op === 'pct') {
        const r = requerido(p.retiene.fuente);
        v = (v * r) / 100;
        anotar('retiene', 'pct', { pct: r }, v, foto.valores.pct_supuesto != null ? 'Por el supuesto marcado.' : '');
      } else {
        anotar('retiene', 'todo', {}, v);
      }
    }

    // 7. Topes (nunca negativo, aunque la regla no lo pida)
    const antes = v;
    v = Math.max(0, v);
    if (p.topes?.max_causado) v = Math.min(v, causado);
    if (p.topes?.max_base) v = Math.min(v, base);
    if (p.topes || antes !== v) anotar('topes', 'max_min', { antes: limpio(antes), causado: limpio(causado), base: limpio(base) }, v);

    // 8. Redondear
    const decimales = p.redondeo?.decimales ?? 2;
    const magnitud = redondear(v, decimales);
    anotar('redondeo', 'mitad_arriba', { decimales }, magnitud);

    const montoFinal = signo === -1 && magnitud !== 0 ? -magnitud : magnitud;
    return {
      estado: 'calculado', monto: montoFinal, magnitud, cero: magnitud === 0, avisos, base, pct, sustraendo, foto,
      nota: magnitud === 0 ? 'El cálculo da 0,00 con estos datos.' : signo === -1 ? 'Nota de crédito: el monto resta.' : '',
    };
  } catch (err) {
    if (err instanceof FaltaDato) return { estado: 'sin_dato', falta: err.falta, nota: err.message, foto };
    throw err;
  }
}

/** El sustraendo de una línea. null = la regla lo pide pero la fila no tiene factor (sin sustraendo). */
function sustraendoDeLinea(
  p: PasosRegla, pct: number | null, resolver: (f: Fuente, opcional?: boolean) => number | null, ut: () => number,
): { monto: number; entradas: PasoFoto['entradas'] } | null {
  const s = p.sustraendo;
  if (!s) return null;
  if (s.op === 'monto') {
    const m = resolver(s.fuente, true);
    return m == null ? null : { monto: m, entradas: { monto: m } };
  }
  const factor = resolver(s.factor, true);
  if (factor == null || factor === 0) return null;
  if (pct == null) throw new FaltaDato({ tipo: 'regla', detalle: 'sustraendo_sin_pct' }, 'La regla pide un sustraendo «% × UT × factor» sin un paso de tasa en %. Revisar la regla. No se calcula.');
  const valorUt = ut();
  return { monto: (pct / 100) * valorUt * factor, entradas: { pct, ut: valorUt, factor } };
}
