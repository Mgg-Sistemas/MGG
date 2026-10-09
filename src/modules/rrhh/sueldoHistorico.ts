/* ============================================================
   MGG · RRHH · Sueldos viejos (carga del histórico en Excel) — 09-10-2026

   El historial de sueldos arrancó el 22-09-2026 con un renglón «inicial» por
   persona: el sueldo con el que la ficha ya estaba cargada. Todo lo de antes
   (los aumentos de 2023, 2024, 2025…) vive en un Excel. Esta pieza permite
   cargar esos renglones VIEJOS al historial, para ver en qué año cambió el
   sueldo de cada quien, SIN tocar el sueldo actual de la ficha.

   Reglas (las mismas que aplica la base en `registrar_sueldo_historico`):
   · Un sueldo viejo rige ANTES del sueldo actual: su «vigente desde» tiene
     que ser anterior a la vigencia del renglón que puso el sueldo de hoy.
     Si fuera igual o posterior, estaría diciendo que la persona gana otra
     cosa, y eso se hace con «cambiar sueldo», que exige motivo y mueve la ficha.
   · Nunca a futuro.
   · El monto no puede ser negativo; sí puede ser 0 (no cobraba).
   · El «sueldo anterior» se sugiere con el renglón inmediatamente anterior
     que ya esté cargado; quien carga lo puede corregir (es lo que dice el Excel).
   · Queda marcado tipo «historico»: en el PDF y el Excel se ve que fue una
     carga manual del histórico y no una decisión tomada en el sistema.
   ============================================================ */
import { aCentavos } from './cambioSueldo';

export const TIPO_HISTORICO = 'historico';

export interface RenglonSueldoMin {
  sueldoNuevo: number;
  vigenteDesde: string;
  tipo: string | null;
}

/** El motivo que se propone cuando se carga desde el Excel. Se puede cambiar. */
export const MOTIVO_HISTORICO_POR_DEFECTO = 'Carga del histórico de sueldos (registro anterior al sistema).';

/**
 * Desde cuándo rige el sueldo de HOY: la vigencia más reciente entre los
 * renglones que de verdad movieron la ficha (todo lo que no sea «historico»).
 * `null` cuando la persona no tiene ninguno (ficha sin sueldo): ahí cualquier
 * fecha pasada vale.
 */
export function vigenciaSueldoActual(historial: RenglonSueldoMin[]): string | null {
  let max: string | null = null;
  for (const r of historial) {
    if (r.tipo === TIPO_HISTORICO) continue;
    const v = String(r.vigenteDesde ?? '').slice(0, 10);
    if (!v) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

/**
 * El sueldo que se sugiere como «anterior» para un renglón que rige en
 * `vigenteDesde`: el sueldo nuevo del renglón inmediatamente anterior ya
 * cargado (cualquier tipo). 0 si no hay nada antes.
 */
export function sugerirSueldoAnterior(historial: RenglonSueldoMin[], vigenteDesde: string): number {
  const f = String(vigenteDesde ?? '').slice(0, 10);
  if (!f) return 0;
  let mejor: RenglonSueldoMin | null = null;
  for (const r of historial) {
    const v = String(r.vigenteDesde ?? '').slice(0, 10);
    if (!v || v >= f) continue;
    if (!mejor || v > String(mejor.vigenteDesde).slice(0, 10)) mejor = r;
  }
  return mejor ? aCentavos(mejor.sueldoNuevo) : 0;
}

export interface SueldoHistoricoInput {
  vigenteDesde: string;
  sueldoNuevo: unknown;
  sueldoAnterior: unknown;
  motivo?: string | null;
  /** YYYY-MM-DD de hoy (se pasa para poder probarlo). */
  hoy: string;
  /** Lo que devuelve `vigenciaSueldoActual`. */
  vigenciaActual: string | null;
  /** Para avisar que ya hay un renglón con esa misma vigencia. */
  historial?: RenglonSueldoMin[];
}

/**
 * Qué falta o qué está mal para poder guardar. El reclamo en palabras, o
 * `null` si se puede guardar. No lanza: el formulario lo muestra.
 */
export function validarSueldoHistorico(i: SueldoHistoricoInput): string | null {
  const f = String(i.vigenteDesde ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return 'Indicá desde cuándo rigió ese sueldo (la fecha).';
  if (f > i.hoy) return 'Un sueldo viejo no puede regir a futuro.';
  if (i.vigenciaActual && f >= i.vigenciaActual) {
    return `Esa fecha es igual o posterior a la vigencia del sueldo actual (${fmtDia(i.vigenciaActual)}). Los sueldos viejos van antes; para cambiar el sueldo de hoy usá «cambiar sueldo» en la ficha.`;
  }
  const nuevo = Number(i.sueldoNuevo);
  if (!Number.isFinite(nuevo) || String(i.sueldoNuevo ?? '').trim() === '') return 'Indicá el sueldo mensual en USD que regía desde esa fecha.';
  if (nuevo < 0) return 'El sueldo no puede ser negativo.';
  const anterior = Number(i.sueldoAnterior);
  if (!Number.isFinite(anterior) || anterior < 0) return 'El sueldo anterior no puede ser negativo.';
  const motivo = String(i.motivo ?? '').trim();
  if (motivo.length < 4) return 'Escribí el motivo o de dónde sale el dato (queda en el historial).';
  if ((i.historial ?? []).some((r) => String(r.vigenteDesde).slice(0, 10) === f)) {
    return `Ya hay un renglón que rige desde el ${fmtDia(f)}. Si quedó mal, el administrador lo puede quitar y volver a cargar.`;
  }
  return null;
}

/** ¿Este renglón se puede quitar? Solo los cargados a mano como históricos. */
export function esRenglonHistorico(r: { tipo: string | null }): boolean {
  return r.tipo === TIPO_HISTORICO;
}

/**
 * Los años en que cambió el sueldo, para leerlos de un vistazo: por cada año
 * con al menos un renglón, el último sueldo que rigió ese año.
 */
export function sueldoPorAnio(historial: RenglonSueldoMin[]): { anio: number; sueldo: number; cambios: number }[] {
  const porAnio = new Map<number, { ultimoDesde: string; sueldo: number; cambios: number }>();
  for (const r of historial) {
    const v = String(r.vigenteDesde ?? '').slice(0, 10);
    const anio = Number(v.slice(0, 4));
    if (!anio) continue;
    const cur = porAnio.get(anio);
    if (!cur) porAnio.set(anio, { ultimoDesde: v, sueldo: aCentavos(r.sueldoNuevo), cambios: 1 });
    else {
      cur.cambios += 1;
      if (v >= cur.ultimoDesde) { cur.ultimoDesde = v; cur.sueldo = aCentavos(r.sueldoNuevo); }
    }
  }
  return [...porAnio.entries()].sort((a, b) => a[0] - b[0]).map(([anio, x]) => ({ anio, sueldo: x.sueldo, cambios: x.cambios }));
}

function fmtDia(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
