/* ============================================================
   MGG · RRHH · Descansos por rotación (21×7)

   En MGG la rotación es SOLO para la gente de COCINA: cocinero, chef,
   ayudante de cocina y lo que dependa del departamento de cocina. Ellos
   trabajan 21 días y salen 7 de descanso. El resto del personal no rota
   y no aparece en esta pantalla.

   El problema es que no pueden salir todos juntos: la cocina tiene que
   seguir dando de comer, así que hay un TOPE de personas fuera a la vez
   (por defecto 4, se cambia en Ajustes).

   Acá vive la lógica pura, sin pantalla ni base, para poder probarla:
     · fechas como texto AAAA-MM-DD (en UTC, así un cambio de horario no corre un día);
     · cuántos están fuera cada día y qué días se pasan del tope;
     · el armado del plan: a cada trabajador se le busca el "desfase" dentro del
       ciclo de 28 días que menos carga agrega, respetando lo que ya está cargado
       y, si se puede, siguiendo el ritmo que traía (su último descanso).
   ============================================================ */

export interface DescansoRango {
  personal_id: string;
  desde: string;
  hasta: string;
}

export interface ConfigDescansos {
  dias_trabajo: number;
  dias_descanso: number;
  max_simultaneos: number;
}

export const CONFIG_POR_DEFECTO: ConfigDescansos = { dias_trabajo: 21, dias_descanso: 7, max_simultaneos: 4 };

/* ───────────────────── Quién entra en la rotación ─────────────────────

   En MGG el 21×7 es de la COCINA y de nadie más. El almacenista, el
   chofer y la analista no rotan: vienen todos los días.

   Se mira el CARGO y el DEPARTAMENTO, no una lista de personas: así una
   ficha nueva de «AYUDANTE DE COCINA» entra sola en la rotación sin que
   nadie tenga que acordarse de agregarla. Se compara sin tildes y sin
   mayúsculas, porque el cargo lo escribe quien carga la ficha y entra
   como «COCINERA», «Cocinero» y «cocina».

   Las raíces son parciales a propósito: «cocin» agarra cocina, cocinero,
   cocinera y ayudante de cocina de un saque. */

/** Raíces de cargo o departamento que ponen a alguien en la rotación. */
export const RAICES_COCINA = ['cocin', 'chef', 'comedor', 'menu', 'cheff'] as const;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * ¿Esta persona trabaja en cocina y por lo tanto rota 21×7?
 *
 * Alcanza con que el cargo O el departamento nombre la cocina: hay fichas
 * donde el cargo dice «AYUDANTE» a secas y lo que ubica es el departamento.
 */
export function esCargoDeCocina(cargo?: string | null, departamento?: string | null): boolean {
  const texto = sinTildes(`${cargo ?? ''} ${departamento ?? ''}`);
  return RAICES_COCINA.some((r) => texto.includes(r));
}

/** De una lista de personal, solo las que rotan. */
export function soloCocina<T extends { cargo?: string | null; departamento?: string | null }>(gente: T[]): T[] {
  return gente.filter((p) => esCargoDeCocina(p.cargo, p.departamento));
}

const DIA_MS = 86_400_000;

function aMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}
function deMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Suma (o resta) días a una fecha AAAA-MM-DD. */
export function sumarDias(iso: string, n: number): string {
  return deMs(aMs(iso) + n * DIA_MS);
}

/** Días de `a` a `b` (b − a). Del 1 al 3 da 2. */
export function difDias(a: string, b: string): number {
  return Math.round((aMs(b) - aMs(a)) / DIA_MS);
}

/** Días que dura un descanso, contando los dos extremos. */
export function diasDe(r: { desde: string; hasta: string }): number {
  return difDias(r.desde, r.hasta) + 1;
}

/** Todas las fechas de `desde` a `hasta`, ambas incluidas. */
export function fechasEntre(desde: string, hasta: string): string[] {
  const n = difDias(desde, hasta);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => sumarDias(desde, i));
}

/** ¿Se pisan los dos rangos? (extremos incluidos) */
export function seCruzan(a: { desde: string; hasta: string }, b: { desde: string; hasta: string }): boolean {
  return a.desde <= b.hasta && b.desde <= a.hasta;
}

/** Cuántas personas están fuera cada día del rango (fecha → cantidad). */
export function cargaPorDia(descansos: DescansoRango[], desde: string, hasta: string): Map<string, number> {
  const carga = new Map<string, number>(fechasEntre(desde, hasta).map((f) => [f, 0]));
  for (const d of descansos) {
    if (!seCruzan(d, { desde, hasta })) continue;
    const ini = d.desde < desde ? desde : d.desde;
    const fin = d.hasta > hasta ? hasta : d.hasta;
    for (const f of fechasEntre(ini, fin)) carga.set(f, (carga.get(f) ?? 0) + 1);
  }
  return carga;
}

/** Días en los que salen más personas que el tope. */
export function diasConChoque(carga: Map<string, number>, max: number): string[] {
  return [...carga.entries()].filter(([, n]) => n > max).map(([f]) => f);
}

/** Quiénes están de descanso ese día. */
export function fueraEl(descansos: DescansoRango[], fecha: string): string[] {
  return [...new Set(descansos.filter((d) => d.desde <= fecha && fecha <= d.hasta).map((d) => d.personal_id))];
}

/**
 * Lo mínimo que puede haber fuera a la vez con N personas en rotación:
 * cada una pasa `descanso` de cada `trabajo + descanso` días afuera.
 */
export function minimoSimultaneo(n: number, cfg: Pick<ConfigDescansos, 'dias_trabajo' | 'dias_descanso'>): number {
  const ciclo = cfg.dias_trabajo + cfg.dias_descanso;
  return n <= 0 || ciclo <= 0 ? 0 : Math.ceil((n * cfg.dias_descanso) / ciclo);
}

/** Cuánta gente entra como máximo en la rotación sin pasar el tope. */
export function capacidadRotacion(cfg: ConfigDescansos): number {
  const ciclo = cfg.dias_trabajo + cfg.dias_descanso;
  return Math.floor((cfg.max_simultaneos * ciclo) / Math.max(cfg.dias_descanso, 1));
}

export interface PersonaPlan {
  personal_id: string;
  /** Fin del último descanso ANTES del inicio del plan (para seguir su ritmo). */
  ultimoHasta?: string | null;
}

export interface EntradaPlan {
  personas: PersonaPlan[];
  /** Primer día del plan y último día a cubrir. */
  desde: string;
  hasta: string;
  cfg: ConfigDescansos;
  /** Descansos que se quedan como están (de otros trabajadores o cargados a mano). */
  fijos: DescansoRango[];
}

export interface ResultadoPlan {
  descansos: DescansoRango[];
  /** Días del período en que igual se pasa el tope (con fijos + plan). */
  choques: string[];
  /** Pico de gente afuera en el período. */
  pico: number;
}

/** Los descansos de una persona si su primer descanso arranca `inicio` días después de `desde`. */
function bloquesDesde(inicio: string, hasta: string, cfg: ConfigDescansos): { desde: string; hasta: string }[] {
  const ciclo = cfg.dias_trabajo + cfg.dias_descanso;
  const out: { desde: string; hasta: string }[] = [];
  for (let s = inicio; s <= hasta; s = sumarDias(s, ciclo)) {
    out.push({ desde: s, hasta: sumarDias(s, cfg.dias_descanso - 1) });
  }
  return out;
}

/**
 * Arma el plan. A cada persona le prueba los `ciclo` arranques posibles y se
 * queda con el que deja el pico más bajo (y, a igualdad, menos carga total);
 * si su arranque "natural" (último descanso + días de trabajo) empata, gana
 * ese, así nadie trabaja de más o de menos sin necesidad. Los que ya traían
 * ritmo se ubican primero.
 */
export function generarPlan(e: EntradaPlan): ResultadoPlan {
  const { cfg, desde, hasta } = e;
  const ciclo = cfg.dias_trabajo + cfg.dias_descanso;
  if (ciclo <= 0 || cfg.dias_descanso <= 0 || hasta < desde) return { descansos: [], choques: [], pico: 0 };

  // La carga se lleva un poco más allá de `hasta` para que el último descanso cuente entero.
  const finCarga = sumarDias(hasta, cfg.dias_descanso);
  const carga = cargaPorDia(e.fijos, desde, finCarga);
  const propios = new Map<string, DescansoRango[]>();
  for (const f of e.fijos) propios.set(f.personal_id, [...(propios.get(f.personal_id) ?? []), f]);

  const natural = (p: PersonaPlan): number | null => {
    if (!p.ultimoHasta) return null;
    let s = sumarDias(p.ultimoHasta, cfg.dias_trabajo + 1);
    while (s < desde) s = sumarDias(s, ciclo);
    return difDias(desde, s) % ciclo;
  };
  const orden = [...e.personas].sort((a, b) => {
    const na = natural(a), nb = natural(b);
    if (na != null && nb == null) return -1;
    if (na == null && nb != null) return 1;
    return (na ?? 0) - (nb ?? 0);
  });

  const nuevos: DescansoRango[] = [];
  for (const p of orden) {
    const nat = natural(p);
    // Si la persona está (o estuvo hace poco) de descanso, el primero nuevo no puede pegarse.
    const minimoInicio = p.ultimoHasta ? sumarDias(p.ultimoHasta, 1) : desde;
    const suyos = propios.get(p.personal_id) ?? [];
    let mejor: { off: number; bloques: { desde: string; hasta: string }[]; pico: number; suma: number } | null = null;
    for (let off = 0; off < ciclo; off++) {
      const inicio = sumarDias(desde, off);
      const bloques = bloquesDesde(inicio, hasta, cfg).filter((b) => b.desde >= minimoInicio && !suyos.some((s) => seCruzan(s, b)));
      if (!bloques.length) continue;
      let pico = 0, suma = 0;
      for (const b of bloques) for (const f of fechasEntre(b.desde, b.hasta)) {
        const c = (carga.get(f) ?? 0) + 1;
        if (c > pico) pico = c;
        suma += c;
      }
      const esNat = nat === off;
      const gana = !mejor
        || pico < mejor.pico
        || (pico === mejor.pico && esNat && mejor.off !== nat)
        || (pico === mejor.pico && mejor.off !== nat && suma < mejor.suma);
      if (gana) mejor = { off, bloques, pico, suma };
    }
    if (!mejor) continue;
    for (const b of mejor.bloques) {
      nuevos.push({ personal_id: p.personal_id, desde: b.desde, hasta: b.hasta });
      for (const f of fechasEntre(b.desde, b.hasta)) carga.set(f, (carga.get(f) ?? 0) + 1);
    }
  }

  const total = cargaPorDia([...e.fijos, ...nuevos], desde, hasta);
  const pico = Math.max(0, ...total.values());
  return {
    descansos: nuevos.sort((a, b) => a.desde.localeCompare(b.desde) || a.personal_id.localeCompare(b.personal_id)),
    choques: diasConChoque(total, cfg.max_simultaneos),
    pico,
  };
}
