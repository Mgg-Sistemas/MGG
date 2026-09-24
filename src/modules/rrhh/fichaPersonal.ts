/* ============================================================
   MGG · RRHH · La ficha técnica del trabajador

   Los catálogos, las cuentas y los filtros de la ficha, sin base de datos y
   sin pantalla, para poder probarlos renglón por renglón.

   LA EDAD NO SE GUARDA, SE CALCULA
   Se guarda la fecha de nacimiento. Una edad guardada queda vieja al día
   siguiente del cumpleaños y nadie la va a ir corrigiendo persona por
   persona. Lo mismo la antigüedad.

   QUIÉN TIENE HIJOS NO SE PREGUNTA
   Sale de la carga familiar: si tiene un familiar cargado como «hijo», tiene
   hijos. Preguntarlo aparte abre la puerta a que la casilla diga una cosa y
   la lista de familiares diga otra.
   ============================================================ */

/* ───────────────────────── Catálogos ───────────────────────── */

export type Genero = 'masculino' | 'femenino' | 'otro';

export const GENEROS: { key: Genero; label: string; plural: string }[] = [
  { key: 'femenino', label: 'Femenino', plural: 'Mujeres' },
  { key: 'masculino', label: 'Masculino', plural: 'Hombres' },
  { key: 'otro', label: 'Otro', plural: 'Otros' },
];

export function labelGenero(g: Genero | string | null | undefined): string {
  return GENEROS.find((x) => x.key === g)?.label ?? '—';
}

export type EstadoCivil = 'soltero' | 'casado' | 'concubinato' | 'divorciado' | 'viudo';

export const ESTADOS_CIVILES: { key: EstadoCivil; label: string }[] = [
  { key: 'soltero', label: 'Soltero/a' },
  { key: 'casado', label: 'Casado/a' },
  { key: 'concubinato', label: 'Concubinato' },
  { key: 'divorciado', label: 'Divorciado/a' },
  { key: 'viudo', label: 'Viudo/a' },
];

export function labelEstadoCivil(e: EstadoCivil | string | null | undefined): string {
  return ESTADOS_CIVILES.find((x) => x.key === e)?.label ?? '—';
}

/* ─────────────────── Grado de instrucción ─────────────────── */

export type GradoInstruccion =
  | 'ninguno' | 'primaria' | 'bachiller' | 'tecnico_medio'
  | 'tsu' | 'universitario' | 'postgrado' | 'doctorado';

/**
 * Los grados, del más bajo al más alto. Lista cerrada a propósito: escrito a
 * mano, el mismo nivel entra como «BACHILLER», «Bto.» y «bachillerato», y
 * después no se puede contar cuánta gente tiene cada grado.
 */
export const GRADOS_INSTRUCCION: { key: GradoInstruccion; label: string }[] = [
  { key: 'ninguno', label: 'Sin estudios formales' },
  { key: 'primaria', label: 'Primaria' },
  { key: 'bachiller', label: 'Bachiller' },
  { key: 'tecnico_medio', label: 'Técnico medio' },
  { key: 'tsu', label: 'TSU' },
  { key: 'universitario', label: 'Universitario' },
  { key: 'postgrado', label: 'Postgrado / Maestría' },
  { key: 'doctorado', label: 'Doctorado' },
];

export function labelGradoInstruccion(g: GradoInstruccion | string | null | undefined): string {
  return GRADOS_INSTRUCCION.find((x) => x.key === g)?.label ?? '—';
}

export const GRUPOS_SANGUINEOS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] as const;
export type GrupoSanguineo = typeof GRUPOS_SANGUINEOS[number];

export type Parentesco = 'hijo' | 'conyuge' | 'padre' | 'madre' | 'hermano' | 'otro';

export const PARENTESCOS: { key: Parentesco; label: string }[] = [
  { key: 'hijo', label: 'Hijo/a' },
  { key: 'conyuge', label: 'Cónyuge / pareja' },
  { key: 'padre', label: 'Padre' },
  { key: 'madre', label: 'Madre' },
  { key: 'hermano', label: 'Hermano/a' },
  { key: 'otro', label: 'Otro' },
];

export function labelParentesco(p: Parentesco | string | null | undefined): string {
  return PARENTESCOS.find((x) => x.key === p)?.label ?? '—';
}

/* ───────────────────── Edad y antigüedad ───────────────────── */

const soloFecha = (v: unknown) => String(v ?? '').slice(0, 10);

/**
 * Años cumplidos a una fecha. `null` si no hay fecha de nacimiento o si la
 * fecha es futura: una edad negativa no es un dato, es un error de carga.
 */
export function edadEn(fechaNacimiento: unknown, hoy: string = new Date().toISOString().slice(0, 10)): number | null {
  const n = soloFecha(fechaNacimiento);
  const h = soloFecha(hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n) || !/^\d{4}-\d{2}-\d{2}$/.test(h)) return null;
  if (n > h) return null;
  let años = Number(h.slice(0, 4)) - Number(n.slice(0, 4));
  // Si todavía no llegó el cumpleaños de este año, falta uno.
  if (h.slice(5) < n.slice(5)) años -= 1;
  return años >= 0 ? años : null;
}

/** «52 años» / «—». */
export function textoEdad(fechaNacimiento: unknown, hoy?: string): string {
  const e = edadEn(fechaNacimiento, hoy);
  return e == null ? '—' : `${e} ${e === 1 ? 'año' : 'años'}`;
}

/**
 * Antigüedad desde el ingreso, en años y meses. Los primeros meses importan
 * (vacaciones, período de prueba), así que no se redondea a años.
 */
export function antiguedad(fechaIngreso: unknown, hoy: string = new Date().toISOString().slice(0, 10)): string {
  const i = soloFecha(fechaIngreso);
  const h = soloFecha(hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i) || !/^\d{4}-\d{2}-\d{2}$/.test(h) || i > h) return '—';
  let meses = (Number(h.slice(0, 4)) - Number(i.slice(0, 4))) * 12
    + (Number(h.slice(5, 7)) - Number(i.slice(5, 7)));
  if (Number(h.slice(8, 10)) < Number(i.slice(8, 10))) meses -= 1;
  if (meses < 0) meses = 0;
  const años = Math.floor(meses / 12);
  const m = meses % 12;
  if (!años) return `${m} ${m === 1 ? 'mes' : 'meses'}`;
  if (!m) return `${años} ${años === 1 ? 'año' : 'años'}`;
  return `${años} ${años === 1 ? 'año' : 'años'} y ${m} ${m === 1 ? 'mes' : 'meses'}`;
}

/** Mínimo de caracteres del N° de ficha. «1» y «2» no identifican a nadie. */
export const MIN_FICHA = 3;

/**
 * «Ficha 001».
 *
 * El número es TEXTO: se muestra tal cual se cargó, con sus ceros de adelante y
 * su prefijo si lo tiene. Antes era un entero y se rellenaba a cuatro dígitos,
 * que inventaba un formato que nadie había pedido.
 */
export function numeroFicha(n: unknown): string {
  const v = String(n ?? '').trim();
  return v ? `Ficha ${v}` : 'Ficha —';
}

/**
 * ¿Sirve este N° de ficha? Devuelve el motivo, o `null` si está bien.
 *
 * Vacío es válido a propósito: hay fichas viejas sin número y no se puede
 * bloquear su edición por algo que nunca se cargó. Lo que no se acepta es un
 * número demasiado corto.
 */
export function errorNumeroFicha(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.length < MIN_FICHA) return `El N° de ficha necesita al menos ${MIN_FICHA} caracteres (ej.: 001).`;
  return null;
}

/** Cómo se guarda: sin espacios de sobra y en mayúsculas, para que «a01» y «A01» sean la misma. */
export function normalizarNumeroFicha(v: string | null | undefined): string {
  return (v ?? '').trim().toUpperCase();
}

/**
 * Ordena por N° de ficha, como se lee un listado de nómina.
 *
 * Es texto, así que un `sort` común pondría «10» antes que «2». Se compara el
 * TRAMO NUMÉRICO como número y el resto como texto: «001» < «002» < «010» <
 * «A01» < «MGG-015». Quien todavía no tiene ficha va al final —no encabeza la
 * lista un renglón sin número— y entre esos se ordena por nombre.
 */
export function ordenarPorFicha<T extends { numero_ficha?: string | null; nombre?: string; apellido?: string | null }>(filas: T[]): T[] {
  const partes = (v: string) => {
    const m = /^(\D*)(\d*)(.*)$/.exec(v) ?? [];
    return { pre: m[1] ?? '', num: m[2] ? Number(m[2]) : null, post: m[3] ?? '' };
  };
  return [...(filas ?? [])].sort((a, b) => {
    const fa = normalizarNumeroFicha(a.numero_ficha);
    const fb = normalizarNumeroFicha(b.numero_ficha);
    if (!fa || !fb) {
      if (fa !== fb) return fa ? -1 : 1;                  // sin ficha, al final
      return `${a.nombre ?? ''} ${a.apellido ?? ''}`.localeCompare(`${b.nombre ?? ''} ${b.apellido ?? ''}`, 'es');
    }
    const pa = partes(fa); const pb = partes(fb);
    if (pa.pre !== pb.pre) return pa.pre.localeCompare(pb.pre, 'es');
    if (pa.num != null && pb.num != null && pa.num !== pb.num) return pa.num - pb.num;
    if ((pa.num == null) !== (pb.num == null)) return pa.num == null ? 1 : -1;
    return pa.post.localeCompare(pb.post, 'es') || fa.localeCompare(fb, 'es');
  });
}

/* ───────────────────── Correo electrónico ───────────────────── */

/**
 * Cómo se guarda un correo: sin espacios y en minúsculas.
 *
 * Los correos no distinguen mayúsculas en la parte del dominio, y en la
 * práctica tampoco en la del nombre. Guardarlos tal cual se escribieron deja
 * el mismo correo cargado de tres formas distintas según quién lo tipeó.
 */
export function normalizarCorreo(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * ¿Sirve este correo? Devuelve el motivo, o `null` si está bien.
 *
 * Vacío es válido: hay gente que no tiene correo y no se le puede trabar la
 * ficha por eso. Lo que se revisa es la FORMA —que haya algo, una arroba, un
 * dominio con punto—, no que la casilla exista: eso solo lo dice mandarle un
 * mensaje. Es la misma comprobación que hace la base de datos.
 */
export function errorCorreo(v: string | null | undefined): string | null {
  const s = normalizarCorreo(v);
  if (!s) return null;
  if (/\s/.test(s)) return 'El correo no puede llevar espacios.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    return 'El correo está incompleto (ej.: nombre@gmail.com).';
  }
  return null;
}

/* ───────────────────── Carga familiar ───────────────────── */

export interface Familiar {
  parentesco: Parentesco | string;
  fecha_nacimiento?: string | null;
}

/** ¿Tiene hijos cargados? De acá sale «quiénes son padres». */
export function tieneHijos(familia: Familiar[] | null | undefined): boolean {
  return (familia ?? []).some((f) => f.parentesco === 'hijo');
}

export function cantidadHijos(familia: Familiar[] | null | undefined): number {
  return (familia ?? []).filter((f) => f.parentesco === 'hijo').length;
}

/** Hijos menores de 18: los que pesan para bono y guardería. */
export function hijosMenores(familia: Familiar[] | null | undefined, hoy?: string): number {
  return (familia ?? []).filter((f) => {
    if (f.parentesco !== 'hijo') return false;
    const e = edadEn(f.fecha_nacimiento, hoy);
    return e != null && e < 18;
  }).length;
}

/* ───────────────────── Filtros y agrupación ───────────────────── */

export interface PersonaFiltrable {
  nombre: string;
  apellido?: string | null;
  cedula?: string | null;
  cargo?: string | null;
  departamento?: string | null;
  genero?: string | null;
  estado_civil?: string | null;
  fecha_nacimiento?: string | null;
  activo?: boolean;
}

export type EstadoFiltro = 'todos' | 'activos' | 'inactivos';
export type HijosFiltro = '' | 'con' | 'sin';

/**
 * Filtro por «esta ficha no lo tiene cargado». Vale para género y estado civil.
 * Hace falta porque el vacío ya significa otra cosa —«no filtres por esto»— y
 * sin un valor aparte no habría forma de pedir justo las fichas incompletas,
 * que son las que hay que ir a completar.
 */
export const SIN_DATO = '__sin__';

export interface FiltroPersonal {
  texto?: string;
  departamento?: string;
  cargo?: string;
  genero?: string;
  estadoCivil?: string;
  estado?: EstadoFiltro;
  hijos?: HijosFiltro;
  edadDesde?: number | null;
  edadHasta?: number | null;
}

/**
 * Aplica los filtros. `hijosDe` dice si cada persona tiene hijos: eso vive en
 * otra tabla, así que se pasa resuelto en vez de consultarlo acá.
 */
export function filtrarPersonal<T extends PersonaFiltrable & { id: string }>(
  filas: T[],
  f: FiltroPersonal = {},
  hijosDe: (id: string) => boolean = () => false,
  hoy?: string,
): T[] {
  const q = (f.texto ?? '').trim().toLowerCase();
  return filas.filter((p) => {
    if (f.estado === 'activos' && p.activo === false) return false;
    if (f.estado === 'inactivos' && p.activo !== false) return false;
    if (f.departamento && (p.departamento ?? '') !== f.departamento) return false;
    if (f.cargo && (p.cargo ?? '') !== f.cargo) return false;
    if (f.genero) {
      const g = p.genero ?? '';
      if (f.genero === SIN_DATO ? g !== '' : g !== f.genero) return false;
    }
    if (f.estadoCivil) {
      const c = p.estado_civil ?? '';
      if (f.estadoCivil === SIN_DATO ? c !== '' : c !== f.estadoCivil) return false;
    }
    if (f.hijos === 'con' && !hijosDe(p.id)) return false;
    if (f.hijos === 'sin' && hijosDe(p.id)) return false;
    if (f.edadDesde != null || f.edadHasta != null) {
      const e = edadEn(p.fecha_nacimiento, hoy);
      if (e == null) return false;                       // sin fecha no se puede filtrar por edad
      if (f.edadDesde != null && e < f.edadDesde) return false;
      if (f.edadHasta != null && e > f.edadHasta) return false;
    }
    if (q) {
      const hay = `${p.nombre} ${p.apellido ?? ''} ${p.cedula ?? ''} ${p.cargo ?? ''} ${p.departamento ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type Agrupador = '' | 'departamento' | 'cargo' | 'genero' | 'estado_civil' | 'hijos';

export const AGRUPADORES: { key: Agrupador; label: string }[] = [
  { key: '', label: 'Sin agrupar' },
  { key: 'departamento', label: 'Departamento' },
  { key: 'cargo', label: 'Cargo' },
  { key: 'genero', label: 'Género' },
  { key: 'estado_civil', label: 'Estado civil' },
  { key: 'hijos', label: 'Con hijos / sin hijos' },
];

/** El nombre del grupo al que cae una persona. */
export function grupoDe<T extends PersonaFiltrable & { id: string }>(
  p: T, por: Agrupador, hijosDe: (id: string) => boolean = () => false,
): string {
  switch (por) {
    case 'departamento': return p.departamento || 'Sin departamento';
    case 'cargo': return p.cargo || 'Sin cargo';
    case 'genero': return p.genero ? labelGenero(p.genero) : 'Sin género cargado';
    case 'estado_civil': return p.estado_civil ? labelEstadoCivil(p.estado_civil) : 'Sin estado civil cargado';
    case 'hijos': return hijosDe(p.id) ? 'Con hijos' : 'Sin hijos';
    default: return '';
  }
}

export interface Grupo<T> { nombre: string; filas: T[] }

/**
 * Agrupa y ordena: los grupos alfabéticamente, pero «Sin …» al final. Un
 * grupo de los que no tienen el dato cargado no debería encabezar la lista.
 */
export function agruparPersonal<T extends PersonaFiltrable & { id: string }>(
  filas: T[], por: Agrupador, hijosDe: (id: string) => boolean = () => false,
): Grupo<T>[] {
  if (!por) return [{ nombre: '', filas }];
  const mapa = new Map<string, T[]>();
  for (const p of filas) {
    const g = grupoDe(p, por, hijosDe);
    mapa.set(g, [...(mapa.get(g) ?? []), p]);
  }
  return [...mapa.entries()]
    .map(([nombre, fs]) => ({ nombre, filas: fs }))
    .sort((a, b) => {
      const sa = a.nombre.startsWith('Sin ') ? 1 : 0;
      const sb = b.nombre.startsWith('Sin ') ? 1 : 0;
      return sa !== sb ? sa - sb : a.nombre.localeCompare(b.nombre, 'es');
    });
}

/* ───────────────────── Las tarjetas de arriba ───────────────────── */

export interface ResumenPersonal {
  total: number;
  activos: number;
  inactivos: number;
  mujeres: number;
  hombres: number;
  otros: number;
  /** Cuántos no tienen el género cargado: si son muchos, las tarjetas mienten. */
  sinGenero: number;
  conHijos: number;
  /** Edad promedio de los que tienen fecha de nacimiento. `null` si no hay ninguno. */
  edadPromedio: number | null;
}

export function resumenPersonal<T extends PersonaFiltrable & { id: string }>(
  filas: T[], hijosDe: (id: string) => boolean = () => false, hoy?: string,
): ResumenPersonal {
  const out: ResumenPersonal = {
    total: filas.length, activos: 0, inactivos: 0,
    mujeres: 0, hombres: 0, otros: 0, sinGenero: 0, conHijos: 0, edadPromedio: null,
  };
  let sumaEdad = 0;
  let conEdad = 0;
  for (const p of filas) {
    if (p.activo === false) out.inactivos += 1; else out.activos += 1;
    if (p.genero === 'femenino') out.mujeres += 1;
    else if (p.genero === 'masculino') out.hombres += 1;
    else if (p.genero === 'otro') out.otros += 1;
    else out.sinGenero += 1;
    if (hijosDe(p.id)) out.conHijos += 1;
    const e = edadEn(p.fecha_nacimiento, hoy);
    if (e != null) { sumaEdad += e; conEdad += 1; }
  }
  out.edadPromedio = conEdad ? Math.round(sumaEdad / conEdad) : null;
  return out;
}

/** Cuántos hay por departamento, de mayor a menor. */
export function porDepartamento<T extends PersonaFiltrable>(filas: T[]): { nombre: string; cantidad: number }[] {
  const m = new Map<string, number>();
  for (const p of filas) {
    const d = p.departamento || 'Sin departamento';
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([nombre, cantidad]) => ({ nombre, cantidad }))
    .sort((a, b) => (b.cantidad - a.cantidad) || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * El nombre como va impreso en el CARNET: primer nombre + primer apellido.
 *
 * La ficha guarda el nombre completo, que es el legal y el que hace falta para
 * la nómina y el QR. Pero en la credencial «ANGELICA DANIELA SOLIS HERNANDEZ»
 * ocupa dos renglones y obliga a achicar la letra hasta que no se lee de lejos,
 * que es justo para lo que sirve un carnet. Con «ANGELICA SOLIS» entra en uno.
 */
export function nombreDeCarnet(nombre?: string | null, apellido?: string | null): string {
  const primera = (s?: string | null) => (s ?? '').trim().split(/\s+/)[0] ?? '';
  return [primera(nombre), primera(apellido)].filter(Boolean).join(' ');
}
