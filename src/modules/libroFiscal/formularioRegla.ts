/* ============================================================
   Golden Touch · Retenciones · Condiciones y pasos de una regla, sin JSON

   La pantalla de Reglas pide cada dato con su rótulo (selectores y montos)
   y aquí se arma el valor que guarda la base. Los mensajes dicen qué falta
   en palabras de quien usa la pantalla, nunca la forma técnica.
   ============================================================ */
import { leerMonto, numeroATexto } from './validarCarga';
import { validarCondicion, validarPaso, VALORES_PIEZA, type CampoMonto, type CondicionRegla, type Operador, type PasoRegla, type Pieza } from './motorReglas';

/* ───────── Condición ───────── */

export interface FormCondicion {
  pieza: Pieza;
  operador: Operador;
  /** Para las piezas con lista: uno (es / no es) o varios (es uno de / no es ninguno de). */
  elegidos: string[];
  clasificacion: string;
  codigos: string;
  monto: string;
  unidad: 'UT' | 'Bs';
  sobre: 'base' | 'pago';
}

export const formCondicionVacio = (pieza: Pieza = 'direccion'): FormCondicion => ({
  pieza, operador: 'es', elegidos: [], clasificacion: '', codigos: '', monto: '', unidad: 'UT', sobre: 'base',
});

/** Lo elegido → la condición que guarda la base, o qué falta. */
export function condicionDeForm(f: FormCondicion): { condicion: CondicionRegla } | { error: string } {
  const lista = VALORES_PIEZA[f.pieza];
  let valor: unknown;
  if (lista) {
    const vals = f.elegidos.filter((x) => lista.includes(x));
    if (!vals.length) return { error: 'Elige una opción.' };
    valor = f.operador === 'en' || f.operador === 'no_en' ? vals : vals[0];
  } else if (f.pieza === 'clasificacion') {
    if (!f.clasificacion.trim()) return { error: 'Elige la clasificación.' };
    const codigos = f.codigos.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    valor = { clasificacion: f.clasificacion.trim(), ...(codigos.length ? { codigos } : {}) };
  } else {
    const monto = f.monto.trim() ? leerMonto(f.monto) : null;
    if (monto == null) return { error: f.monto.trim() ? 'No se entiende el monto: escribe 1.234,56 o 1234,56.' : 'Indica el monto mínimo.' };
    if (monto < 0) return { error: 'El monto mínimo no puede ser negativo.' };
    valor = { monto, unidad: f.unidad, sobre: f.sobre };
  }
  const condicion: CondicionRegla = { pieza: f.pieza, operador: lista ? f.operador : f.operador === 'no_es' ? 'no_es' : 'es', valor };
  return validarCondicion(condicion) ? { error: 'La base no aceptaría esa condición: revisa lo elegido.' } : { condicion };
}

/* ───────── Paso ───────── */

export interface FormPaso {
  componentes: { campo: CampoMonto; signo: '+' | '-' }[];
  /** Porción de la base: vacío = toda; «del concepto»; o un %. */
  porcionDe: 'toda' | 'concepto' | 'pct';
  porcion: string;
  /** Mínimo y sustraendo: del concepto, o un monto. */
  desdeConcepto: boolean;
  monto: string;
  unidad: 'UT' | 'Bs' | 'MMV';
  /** Sustraendo: factor × UT o monto en Bs. */
  sustraendoPor: 'concepto' | 'factor' | 'monto';
  factor: string;
  /** Porcentaje: fijo o de Parámetros. */
  pctDe: 'fijo' | 'parametro';
  pct: string;
  parametro: string;
  supuestos: string;
  clasificacion: string;
  tarifa: string;
  minimo: string;
  maximo: '' | 'impuesto_causado' | 'base';
  decimales: string;
}

const texto = (v: unknown) => (v == null ? '' : typeof v === 'number' ? numeroATexto(v) : String(v));

/** Los valores guardados de un paso → el formulario. */
export function formDePaso(operacion: string, v: Record<string, unknown> = {}): FormPaso {
  const comps = Array.isArray(v.componentes) ? (v.componentes as { campo: CampoMonto; signo: '+' | '-' }[]) : [];
  return {
    componentes: comps.length ? comps : [{ campo: operacion === 'componer_base' ? 'base_imponible' : 'pago', signo: '+' }],
    porcionDe: v.porcion === 'clasificacion' ? 'concepto' : v.porcion != null ? 'pct' : 'toda',
    porcion: typeof v.porcion === 'number' ? numeroATexto(v.porcion) : '',
    desdeConcepto: v.desde === 'clasificacion',
    monto: texto(v.monto), unidad: (['UT', 'Bs', 'MMV'].includes(String(v.unidad)) ? v.unidad : 'UT') as FormPaso['unidad'],
    sustraendoPor: v.desde === 'clasificacion' ? 'concepto' : v.factor != null ? 'factor' : v.monto != null ? 'monto' : 'concepto',
    factor: texto(v.factor),
    pctDe: v.pct != null || operacion === 'pct_fijo' ? 'fijo' : 'parametro',
    pct: texto(v.pct), parametro: texto(v.parametro), supuestos: texto(v.supuestos),
    clasificacion: texto(v.clasificacion), tarifa: texto(v.tarifa),
    minimo: texto(v.minimo), maximo: (v.maximo === 'impuesto_causado' || v.maximo === 'base' ? v.maximo : '') as FormPaso['maximo'],
    decimales: v.decimales != null ? String(v.decimales) : '2',
  };
}

const leer = (t: string, campo: string): number | { error: string } => {
  if (!t.trim()) return { error: `Indica ${campo}.` };
  const n = leerMonto(t);
  return n == null ? { error: `No se entiende ${campo}: escribe 1.234,56 o 1234,56.` } : n;
};
const esError = (x: unknown): x is { error: string } => typeof x === 'object' && x != null && 'error' in x;

/** El formulario → los valores que guarda la base, o qué falta. */
export function valoresDeForm(paso: number, operacion: string, f: FormPaso): { valores: Record<string, unknown> } | { error: string } {
  let v: Record<string, unknown> = {};
  switch (operacion) {
    case 'componer_base': {
      if (!f.componentes.length) return { error: 'Agrega al menos un monto de la factura.' };
      v = { componentes: f.componentes };
      if (f.porcionDe === 'concepto') v.porcion = 'clasificacion';
      if (f.porcionDe === 'pct') {
        const p = leer(f.porcion, 'el % de la base'); if (esError(p)) return p;
        if (p <= 0 || p > 100) return { error: 'El % de la base va de más de 0 a 100.' };
        v.porcion = p;
      }
      break;
    }
    case 'convertir_moneda': v = { tasa: 'bcv_fecha_factura' }; break;
    case 'comparar_minimo':
    case 'monto_fijo': {
      if (operacion === 'comparar_minimo' && f.desdeConcepto) { v = { desde: 'clasificacion' }; break; }
      const m = leer(f.monto, 'el monto'); if (esError(m)) return m;
      if (m < 0) return { error: 'El monto no puede ser negativo.' };
      if (operacion === 'monto_fijo' && f.unidad === 'MMV') return { error: 'El monto fijo va en UT o en Bs.' };
      v = { monto: m, unidad: f.unidad };
      break;
    }
    case 'pct_fijo': {
      const p = leer(f.pct, 'el porcentaje'); if (esError(p)) return p;
      if (p < 0 || p > 100) return { error: 'El porcentaje va de 0 a 100.' };
      v = { pct: p };
      break;
    }
    case 'pct_parametro':
      if (!f.parametro) return { error: 'Elige el valor de Parámetros.' };
      v = { parametro: f.parametro };
      break;
    case 'pct_clasificacion':
      if (!f.clasificacion) return { error: 'Elige la clasificación.' };
      v = { clasificacion: f.clasificacion };
      break;
    case 'tramos':
      if (!f.tarifa) return { error: 'Elige la tarifa por tramos.' };
      v = { tarifa: f.tarifa };
      break;
    case 'restar_sustraendo': {
      if (f.sustraendoPor === 'concepto') { v = { desde: 'clasificacion' }; break; }
      const n = leer(f.sustraendoPor === 'factor' ? f.factor : f.monto, f.sustraendoPor === 'factor' ? 'el factor' : 'el monto');
      if (esError(n)) return n;
      if (n < 0) return { error: 'El sustraendo no puede ser negativo.' };
      v = f.sustraendoPor === 'factor' ? { factor: n } : { monto: n };
      break;
    }
    case 'retener_pct': {
      if (f.pctDe === 'fijo') {
        const p = leer(f.pct, 'el porcentaje'); if (esError(p)) return p;
        if (p < 0 || p > 100) return { error: 'El porcentaje va de 0 a 100.' };
        v = { pct: p };
      } else {
        if (!f.parametro) return { error: 'Elige el valor de Parámetros con el % que se retiene.' };
        v = { parametro: f.parametro, ...(f.supuestos ? { supuestos: f.supuestos } : {}) };
      }
      break;
    }
    case 'retener_todo': v = {}; break;
    case 'topes': {
      if (f.minimo.trim()) { const m = leer(f.minimo, 'el mínimo'); if (esError(m)) return m; v.minimo = m; }
      if (f.maximo) v.maximo = f.maximo;
      break;
    }
    case 'redondear': {
      const d = Number(f.decimales);
      if (![0, 1, 2, 3, 4].includes(d)) return { error: 'Los decimales van de 0 a 4.' };
      v = { decimales: d };
      break;
    }
    default: return { error: 'Elige qué hace este paso.' };
  }
  const p: PasoRegla = { paso, operacion, valores: v };
  return validarPaso(p) ? { error: 'La base no aceptaría este paso: revisa los datos.' } : { valores: v };
}
