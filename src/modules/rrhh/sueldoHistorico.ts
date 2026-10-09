/* ============================================================
   MGG · RRHH · Sueldos viejos (carga del histórico en Excel) — 09-10-2026

   El historial de sueldos arrancó el 22-09-2026 con un renglón «inicial» por
   persona: el sueldo con el que la ficha ya estaba cargada, fechado con la
   FECHA DE INGRESO. Todo lo de antes (los aumentos de 2023, 2024, 2025…) vive
   en un Excel. Esta pieza permite cargar esos renglones VIEJOS al historial,
   a mano o en lote desde el Excel, para ver en qué año cambió el sueldo de
   cada quien, SIN tocar el sueldo actual de la ficha.

   LA SEMILLA. Ese renglón «inicial» que puso la migración dice «gana X desde
   la fecha de ingreso», y eso casi nunca es verdad: la persona entró con
   otro sueldo y fue subiendo. Por eso la semilla NO es tope para los sueldos
   viejos, y cuando se carga el sueldo de hoy con su fecha real (el último
   renglón del Excel), la base le CORRIGE la fecha a la semilla en vez de
   duplicarla. Así el historial termina diciendo la verdad: entró con A,
   pasó a B, y gana X desde tal fecha.

   Reglas (las mismas que aplica la base):
   · Un sueldo viejo rige ANTES del último cambio real (los renglones que sí
     movieron la ficha, sin contar la semilla). Si fuera igual o posterior,
     eso es «cambiar sueldo», que exige motivo y mueve la ficha.
   · Nunca a futuro. No dos renglones con la misma fecha para la misma persona.
   · El monto no puede ser negativo; sí puede ser 0 (no cobraba).
   · Con fecha igual o posterior a la semilla solo entra el sueldo de hoy
     (corrige la semilla). Para los demás hay que cargar primero ese.
   · Queda marcado tipo «historico».
   ============================================================ */
import { aCentavos } from './cambioSueldo';

export const TIPO_HISTORICO = 'historico';

/** El motivo que se propone cuando se carga desde el Excel. Se puede cambiar. */
export const MOTIVO_HISTORICO_POR_DEFECTO = 'Registro histórico (Excel anterior al sistema)';

export interface RenglonSueldoMin {
  sueldoNuevo: number;
  vigenteDesde: string;
  tipo: string | null;
  motivo?: string;
  actorName?: string | null;
}

/**
 * La semilla: el renglón «inicial» de cada persona. Lo puso la migración del
 * 22-09 («sueldo con el que la ficha ya estaba cargada») o el trigger al crear
 * la ficha («sueldo con el que se creó la ficha»); en los dos casos lleva la
 * fecha de ingreso y el sueldo de ese momento, no la historia anterior.
 */
export function esRenglonSemilla(r: RenglonSueldoMin): boolean {
  return r.tipo === 'inicial';
}

/** ¿Este renglón se puede quitar? Solo los cargados a mano como históricos. */
export function esRenglonHistorico(r: { tipo: string | null }): boolean {
  return r.tipo === TIPO_HISTORICO;
}

/**
 * Desde cuándo rige el sueldo de HOY según los cambios REALES: la vigencia
 * más reciente entre los renglones que movieron la ficha, sin contar los
 * históricos ni la semilla. `null` cuando no hay ninguno.
 */
export function vigenciaSueldoActual(historial: RenglonSueldoMin[]): string | null {
  let max: string | null = null;
  for (const r of historial) {
    if (r.tipo === TIPO_HISTORICO || esRenglonSemilla(r)) continue;
    const v = String(r.vigenteDesde ?? '').slice(0, 10);
    if (!v) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

/** La semilla de la persona, si la tiene. */
export function semillaDe(historial: RenglonSueldoMin[]): RenglonSueldoMin | null {
  return historial.find(esRenglonSemilla) ?? null;
}

/**
 * El sueldo que se sugiere como «anterior» para un renglón que rige en
 * `vigenteDesde`: el sueldo nuevo del renglón inmediatamente anterior ya
 * cargado (sin contar la semilla, que todavía no dice la verdad). 0 si no hay nada antes.
 */
export function sugerirSueldoAnterior(historial: RenglonSueldoMin[], vigenteDesde: string): number {
  const f = String(vigenteDesde ?? '').slice(0, 10);
  if (!f) return 0;
  let mejor: RenglonSueldoMin | null = null;
  for (const r of historial) {
    if (esRenglonSemilla(r)) continue;
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
  /** Para la semilla y las fechas repetidas. */
  historial?: RenglonSueldoMin[];
  /** El sueldo de hoy de la ficha (para saber si este renglón es «el de hoy»). */
  sueldoActual?: number;
  /** Quien carga marcó «es el sueldo actual» aunque la fecha sea anterior a la semilla (la semilla quedó con fecha posterior a la real). */
  marcarActual?: boolean;
}

type EntradaSemilla = Pick<SueldoHistoricoInput, 'vigenteDesde' | 'sueldoNuevo' | 'historial' | 'sueldoActual' | 'marcarActual'>;

/** ¿Este renglón es el sueldo de hoy con su fecha real? (corrige la semilla en vez de duplicarla) */
export function corrigeSemilla(i: EntradaSemilla): boolean {
  const semilla = semillaDe(i.historial ?? []);
  if (!semilla) return false;
  const f = String(i.vigenteDesde ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const esElDeHoy = aCentavos(i.sueldoNuevo) === aCentavos(i.sueldoActual ?? 0);
  return esElDeHoy && (f >= String(semilla.vigenteDesde).slice(0, 10) || !!i.marcarActual);
}

/**
 * ¿Tiene sentido ofrecer la casilla «es el sueldo actual»? Cuando el monto es
 * el de hoy, hay semilla y la fecha es ANTERIOR a ella: la semilla quedó con
 * una fecha posterior a la real (por ejemplo, la ficha se creó sin fecha de
 * ingreso) y sin la marca el renglón entraría como un histórico duplicado.
 */
export function puedeMarcarSueldoActual(i: EntradaSemilla): boolean {
  const semilla = semillaDe(i.historial ?? []);
  if (!semilla) return false;
  const f = String(i.vigenteDesde ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  return aCentavos(i.sueldoNuevo) === aCentavos(i.sueldoActual ?? 0) && f < String(semilla.vigenteDesde).slice(0, 10);
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
    return `Esa fecha es igual o posterior al último cambio real de sueldo (${fmtDia(i.vigenciaActual)}). Los sueldos viejos van antes; para cambiar el sueldo de hoy usá «cambiar sueldo» en la ficha.`;
  }
  const nuevo = Number(i.sueldoNuevo);
  if (!Number.isFinite(nuevo) || String(i.sueldoNuevo ?? '').trim() === '') return 'Indicá el sueldo mensual en USD que regía desde esa fecha.';
  if (nuevo < 0) return 'El sueldo no puede ser negativo.';
  const anterior = Number(i.sueldoAnterior);
  if (!Number.isFinite(anterior) || anterior < 0) return 'El sueldo anterior no puede ser negativo.';
  const motivo = String(i.motivo ?? '').trim();
  if (motivo.length < 4) return 'Escribí el motivo o de dónde sale el dato (queda en el historial).';
  const historial = i.historial ?? [];
  const semilla = semillaDe(historial);
  const esDeHoy = corrigeSemilla(i);
  if (semilla && f >= String(semilla.vigenteDesde).slice(0, 10) && !esDeHoy) {
    return `Esa fecha es igual o posterior a la carga inicial del sueldo actual (${fmtDia(String(semilla.vigenteDesde))}, tomada de la fecha de ingreso). Cargá primero el sueldo de hoy (${aCentavos(i.sueldoActual ?? 0).toLocaleString('es-VE')}) con la fecha real desde la que rige: eso corrige la carga inicial. Después cargá los anteriores.`;
  }
  if (historial.some((r) => String(r.vigenteDesde).slice(0, 10) === f && !(esDeHoy && esRenglonSemilla(r)))) {
    return `Ya hay un renglón que rige desde el ${fmtDia(f)}. Si quedó mal, el administrador lo puede quitar y volver a cargar.`;
  }
  return null;
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

/* ───────────────────── Carga desde Excel (como en GT) ─────────────────────
   Una fila por sueldo: Cédula, Fecha (o Año), Sueldo, Motivo (opcional),
   Nota (opcional). Acá se revisa cada fila contra el personal antes de
   mandar nada; las reglas contra el historial ya cargado (tope, semilla,
   fechas repetidas) las aplica la base al guardar, todo o nada. */

/** Cédula comparable: solo los dígitos («V-12.345.678» → «12345678»). */
export function normCedula(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

const pad = (n: number) => String(n).padStart(2, '0');
function valida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${a}-${pad(m)}-${pad(d)}`;
}

/**
 * Fecha del Excel a ISO. Acepta: fecha de Excel (Date o número de serie),
 * «dd/mm/aaaa», «aaaa-mm-dd», «mm/aaaa» (día 1) y solo el año «2021» (1 de enero).
 */
export function parseFechaExcel(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v >= 1900 && v <= 2200 && Number.isInteger(v)) return `${v}-01-01`;
    // Número de serie de Excel (días desde 1899-12-30).
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m) return valida(+m[2], +m[1], 1);
  return null;
}

/** Monto del Excel: número, o texto con coma o punto decimal («1.250,50», «1250.5», «$300»). */
export function parseMontoExcel(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface PersonaRef { id: string; cedula?: string | null; nombre: string; apellido?: string | null }

export interface FilaHistoricoExcel {
  /** Número de fila en la hoja (para que quien carga la encuentre). */
  fila: number;
  cedula: string;
  persona: PersonaRef | null;
  fecha: string | null;
  sueldo: number | null;
  motivo: string;
  nota: string;
  error: string | null;
}

/** Busca la columna por nombre, sin importar mayúsculas, tildes ni espacios. */
function col(row: Record<string, unknown>, ...nombres: string[]): unknown {
  const clave = (k: string) => k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const buscadas = nombres.map(clave);
  for (const k of Object.keys(row)) if (buscadas.includes(clave(k))) return row[k];
  return undefined;
}

/**
 * Revisa las filas leídas del Excel (una por sueldo) contra el personal.
 * Columnas: Cédula, Fecha (o Año), Sueldo, Motivo (opcional), Nota (opcional).
 */
export function analizarFilasHistorico(
  rows: Record<string, unknown>[],
  personas: PersonaRef[],
  hoy: string,
): FilaHistoricoExcel[] {
  const porCedula = new Map(personas.filter((p) => normCedula(p.cedula)).map((p) => [normCedula(p.cedula), p]));
  const vistas = new Set<string>();
  const out: FilaHistoricoExcel[] = [];
  rows.forEach((row, i) => {
    const cedRaw = col(row, 'cedula', 'ci', 'c.i.', 'cedula de identidad');
    const fechaRaw = col(row, 'fecha', 'desde', 'ano', 'año', 'anio', 'vigente desde', 'rige desde');
    const sueldoRaw = col(row, 'sueldo', 'monto', 'salario', 'sueldo usd', 'sueldo mensual');
    // Fila totalmente vacía: se ignora.
    if ([cedRaw, fechaRaw, sueldoRaw].every((v) => v == null || String(v).trim() === '')) return;
    const cedula = normCedula(cedRaw);
    const persona = porCedula.get(cedula) ?? null;
    const fecha = parseFechaExcel(fechaRaw);
    const sueldo = parseMontoExcel(sueldoRaw);
    const motivo = String(col(row, 'motivo') ?? '').trim() || MOTIVO_HISTORICO_POR_DEFECTO;
    const nota = String(col(row, 'nota', 'observacion', 'observaciones') ?? '').trim();
    let error: string | null = null;
    if (!cedula) error = 'Falta la cédula.';
    else if (!persona) error = `No hay nadie en el personal con la cédula ${cedula}.`;
    else if (!fecha) error = 'La fecha no se entiende (usá dd/mm/aaaa, mm/aaaa o el año).';
    else if (fecha > hoy) error = 'La fecha es futura.';
    else if (sueldo == null) error = 'Falta el sueldo o no es un número.';
    else if (sueldo < 0) error = 'El sueldo no puede ser negativo.';
    else {
      const k = `${persona.id}|${fecha}`;
      if (vistas.has(k)) error = 'Fecha repetida para la misma persona en el archivo.';
      vistas.add(k);
    }
    out.push({ fila: i + 2, cedula, persona, fecha, sueldo, motivo, nota, error });
  });
  return out;
}
