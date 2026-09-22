import type { SolicitudSalida } from '@/shared/lib/types';
import { SOL_COLS, claveColDe, type SolColKey } from './columnasSalida';

/**
 * Cuántas tarjetas muestra cada columna del tablero.
 *
 * El tablero es para TRABAJAR: lo que hay que aprobar, lo que hay que ejecutar,
 * lo que acaba de pasar. Con 186 tarjetas en una sola columna deja de servir
 * para eso —nadie baja 186 tarjetas— y encima el navegador tiene que dibujarlas
 * todas. Las demás no se pierden: pasan al histórico, que sí está hecho para
 * buscar. Diez es lo que entra en la columna sin tener que rodar mucho.
 */
export const TOPE_COLUMNA = 10;

/** Una cosa que alguien le hizo a la solicitud: crearla, aprobarla, ejecutarla… */
export interface AccionSolicitud {
  /** Tal como quedó escrito en el historial ('creada', 'aprobada', …). */
  evento: string;
  /** Correo de quien la hizo. */
  actor: string;
  /** Cuándo (ISO). Puede venir vacío en filas viejas. */
  at: string;
}

const limpio = (v: string | null | undefined): string => (v ?? '').trim();
const correo = (v: string | null | undefined): string => limpio(v).toLowerCase();

/**
 * Todo lo que se le hizo a la solicitud, de lo más viejo a lo más nuevo.
 *
 * El historial es la fuente buena, pero las solicitudes viejas se guardaron
 * antes de que existiera y solo tienen las columnas sueltas (actor,
 * aprobada_por, ejecutada_por). Se completan con esas SIN duplicar lo que el
 * historial ya cuenta: si no, el mismo «aprobada» saldría dos veces y el
 * filtro por persona contaría doble.
 */
export function accionesDe(s: SolicitudSalida): AccionSolicitud[] {
  const out: AccionSolicitud[] = (s.historial ?? [])
    .filter((e) => limpio(e?.actor))
    .map((e) => ({ evento: limpio(e.evento), actor: limpio(e.actor), at: limpio(e.at) }));

  const yaEsta = (evento: string, actor: string) =>
    out.some((a) => a.evento.startsWith(evento) && correo(a.actor) === correo(actor));
  const completar = (evento: string, actor: string | null | undefined, at: string | null | undefined) => {
    const quien = limpio(actor);
    if (!quien || yaEsta(evento, quien)) return;
    out.push({ evento, actor: quien, at: limpio(at) });
  };
  completar('creada', s.actor, s.created_at);
  completar('aprobada', s.aprobada_por, s.aprobada_en);
  completar('ejecutada', s.ejecutada_por, s.ejecutada_en);

  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Correos (en minúscula) de todos los que tocaron la solicitud. */
export function actoresDe(s: SolicitudSalida): string[] {
  const set = new Set<string>();
  for (const a of accionesDe(s)) set.add(correo(a.actor));
  return Array.from(set);
}

/** ¿Esta persona hizo ALGO en esta solicitud? (crearla, aprobarla, ejecutarla, cancelarla…) */
export function hizoAlgo(s: SolicitudSalida, email: string): boolean {
  const q = correo(email);
  return !!q && actoresDe(s).includes(q);
}

/** La última acción de la solicitud: lo que la dejó como está. */
export function ultimaAccion(s: SolicitudSalida): AccionSolicitud | null {
  const acc = accionesDe(s);
  return acc.length ? acc[acc.length - 1] : null;
}

/**
 * El evento, en corto y con mayúscula.
 * El historial guarda frases largas («cerrada sin descontar (descuento manual
 * por fuera)»); en una celda de tabla no entra y tampoco hace falta.
 */
export function etiquetaEvento(evento: string): string {
  const e = limpio(evento).toLowerCase();
  if (!e) return '—';
  const corto = e.startsWith('cerrada sin descontar') ? 'cerrada sin descontar' : e;
  return corto.charAt(0).toUpperCase() + corto.slice(1);
}

/**
 * El evento en voz de quien lo hizo: «Creó», «Aprobó», «Ejecutó»…
 * En la columna de personas se lee «Aprobó · LEYDIS», que es la frase que
 * alguien diría; «aprobada · LEYDIS» no la dice nadie.
 */
export function verboEvento(evento: string): string {
  const e = limpio(evento).toLowerCase();
  if (e.startsWith('cerrada sin descontar')) return 'Cerró sin descontar';
  if (e.startsWith('nota editada')) return 'Editó la nota';
  const verbos: Record<string, string> = {
    creada: 'Creó', aprobada: 'Aprobó', ejecutada: 'Ejecutó',
    cancelada: 'Canceló', editada: 'Editó',
  };
  return verbos[e] ?? etiquetaEvento(evento);
}

/** Cuántas filas del histórico se muestran de una vez (el resto, con «ver más»). */
export const PAGINA_HISTORICO = 50;

/** Correo → nombre para mostrar, juntando lo que traigan todas las solicitudes. */
export function directorioDeActores(sols: SolicitudSalida[]): Map<string, string> {
  const dir = new Map<string, string>();
  for (const s of sols) {
    const email = correo(s.actor);
    const nombre = limpio(s.actor_name);
    if (email && nombre) dir.set(email, nombre);
  }
  return dir;
}

/** Nombre de la persona; si no lo sabemos, el correo sin el dominio (KELVIN, no kelvin@…). */
export function nombreDeActor(email: string | null | undefined, dir?: Map<string, string>): string {
  const e = correo(email);
  if (!e) return '—';
  return dir?.get(e) ?? e.split('@')[0];
}

/** Todas las personas que aparecen en el histórico, ordenadas por nombre. */
export function personasDelHistorico(sols: SolicitudSalida[]): Array<[email: string, nombre: string]> {
  const dir = directorioDeActores(sols);
  const set = new Set<string>();
  for (const s of sols) for (const a of actoresDe(s)) set.add(a);
  return Array.from(set)
    .map((e) => [e, nombreDeActor(e, dir)] as [string, string])
    .sort((x, y) => x[1].localeCompare(y[1]));
}

export interface FiltroHistorico {
  /** Busca en código, N°, material, origen/destino, solicitante y motivo. */
  texto?: string;
  /** Clave de columna ('' = todas). */
  columna?: SolColKey | '';
  /** Correo de quien hizo ALGUNA acción ('' = todos). */
  persona?: string;
  solicitante?: string;
  /** Fechas de creación, aaaa-mm-dd inclusive. */
  desde?: string;
  hasta?: string;
}

/** El texto de una solicitud donde tiene sentido buscar. */
function textoBuscable(s: SolicitudSalida): string {
  const partes = [
    s.codigo,
    s.num_usuario != null ? String(s.num_usuario).padStart(3, '0') : '',
    s.producto_nombre, s.almacen_origen, s.almacen_destino, s.destino, s.sede_destino,
    s.solicitante, s.motivo, s.actor_name, s.cliente_nombre, s.chofer, s.vehiculo,
    ...(s.items ?? []).map((i) => i.producto_nombre ?? ''),
  ];
  return partes.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Filtra el histórico. Cada filtro vacío NO filtra; se combinan con «y».
 * La persona se busca en TODO el historial, no solo en quien la creó: la
 * pregunta que se hace de verdad es «qué tocó Kelvin», y Kelvin a veces
 * ejecuta lo que pidió otro.
 */
export function filtrarHistorico(sols: SolicitudSalida[], f: FiltroHistorico): SolicitudSalida[] {
  const q = limpio(f.texto).toLowerCase();
  const persona = correo(f.persona);
  const solicitante = limpio(f.solicitante);
  const desde = limpio(f.desde);
  const hasta = limpio(f.hasta);
  return sols.filter((s) => {
    if (f.columna && claveColDe(s) !== f.columna) return false;
    if (persona && !hizoAlgo(s, persona)) return false;
    if (solicitante && limpio(s.solicitante) !== solicitante) return false;
    const dia = limpio(s.created_at).slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (q && !textoBuscable(s).includes(q)) return false;
    return true;
  });
}

/**
 * Parte una columna en lo que se ve y lo que se va al histórico.
 * Las solicitudes llegan ya ordenadas de la más nueva a la más vieja, así que
 * arriba quedan las últimas, que es lo que se está trabajando.
 */
export function recorteDeColumna<T>(items: T[], tope = TOPE_COLUMNA): { visibles: T[]; enHistorico: number } {
  const n = Math.max(0, tope);
  return { visibles: items.slice(0, n), enHistorico: Math.max(0, items.length - n) };
}

/** Cuenta por columna, para los chips del tablero (el conteo es del total, no del recorte). */
export function conteoPorColumna(sols: SolicitudSalida[]): Record<SolColKey, number> {
  const out = {} as Record<SolColKey, number>;
  for (const c of SOL_COLS) out[c.key] = sols.filter(c.match).length;
  return out;
}
