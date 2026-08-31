/* ============================================================
   MGG · Combustible ↔ Maquinaria · el vínculo por nombre de equipo
   Maquinaria lee el horómetro, el kilometraje y el gasoil de un equipo
   cruzando TEXTO: `maquinaria_equipos.combustible_equipo` contra
   `combustible_vehiculos.nombre` y `combustible_tanque_movimientos.equipo`.
   El cruce era por igualdad exacta, así que cualquier diferencia de
   mayúsculas, acentos o espacios rompía el vínculo en silencio; y al
   renombrar un vehículo el nombre viejo quedaba huérfano en los
   movimientos y en la ficha del equipo.
   En producción eso dejó a 7 de 14 equipos sin ver su combustible.
   Acá viven las piezas puras del cruce: se testean sin base.
   ============================================================ */

/** Umbral de aviso de mantenimiento por horómetro. Uno solo para todo el sistema:
 *  estaba en 30 h en Control de Maquinaria y en 250 h en Servicio de Mantenimiento,
 *  así que el mismo equipo aparecía «en alerta» en una pantalla y no en la otra. */
export const UMBRAL_ALERTA_HRS = 30;

/** Umbral de aviso por kilometraje (km antes del objetivo). */
export const UMBRAL_ALERTA_KM = 1000;

/**
 * Clave con la que se cruzan los nombres de equipo entre los dos módulos: sin
 * acentos, en mayúsculas y con los espacios colapsados. «Camión NHR» y
 * «CAMION  NHR» son el mismo equipo.
 */
export function claveEquipo(nombre: string | null | undefined): string {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().trim().replace(/\s+/g, ' ');
}

/** Palabras que no distinguen a un equipo y solo ensucian la comparación. */
const RUIDO = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'MGG', 'GT', 'CAMION', 'CAMIÓN', 'GANDOLA', 'BUS']);

/** Tokens significativos de un nombre (para sugerir a qué vehículo se parece). */
function tokens(nombre: string | null | undefined): string[] {
  return claveEquipo(nombre).split(' ').filter((t) => t.length > 1 && !RUIDO.has(t));
}

/**
 * Parecido entre dos nombres: proporción de tokens significativos compartidos
 * (0 = nada que ver, 1 = mismos tokens). «GT Camión Pitman Astra» y «PITMAN ASTRA»
 * comparten PITMAN y ASTRA, así que dan 1.
 */
export function parecido(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const comunes = ta.filter((t) => setB.has(t)).length;
  return comunes / Math.min(ta.length, tb.length);
}

export interface EquipoVinculable {
  id: string;
  equipo: string;
  combustible_equipo?: string | null;
  activo?: boolean | null;
}

export interface VinculoRoto {
  equipo: EquipoVinculable;
  /** Lo que tiene guardado hoy (null si nunca se vinculó). */
  guardado: string | null;
  /** Motivo: nunca se vinculó, o apunta a un vehículo que ya no existe. */
  motivo: 'sin_vincular' | 'no_existe';
  /** Vehículos de Combustible que se le parecen, del más parecido al menos. */
  candidatos: string[];
}

/**
 * Equipos de Maquinaria que hoy NO pueden leer su combustible: los que no tienen
 * vínculo y los que apuntan a un vehículo inexistente. Para cada uno sugiere los
 * vehículos parecidos, para que Almacén los confirme (nunca se corrigen solos:
 * adivinar el vínculo reescribiría el historial de consumo de un equipo).
 */
export function vinculosRotos(equipos: EquipoVinculable[], vehiculos: string[]): VinculoRoto[] {
  // Sin lista de vehículos no se puede afirmar que un vínculo esté roto: si la consulta
  // falló (o el módulo está vacío), acusar a los 14 equipos sería ruido puro. Además la
  // lista tiene que traer TODOS los vehículos, activos y desactivados: un vehículo dado
  // de baja sigue siendo el dueño legítimo del historial y no es un vínculo «inexistente».
  if (!vehiculos.length) return [];
  const existentes = new Map(vehiculos.map((v) => [claveEquipo(v), v]));
  const out: VinculoRoto[] = [];
  for (const e of equipos) {
    if (e.activo === false) continue;
    const guardado = (e.combustible_equipo ?? '').trim() || null;
    if (guardado && existentes.has(claveEquipo(guardado))) continue;   // vínculo sano
    const candidatos = vehiculos
      .map((v) => ({ v, p: Math.max(parecido(guardado ?? e.equipo, v), parecido(e.equipo, v)) }))
      .filter((c) => c.p >= 0.5)
      .sort((a, b) => b.p - a.p)
      .map((c) => c.v)
      .slice(0, 3);
    out.push({ equipo: e, guardado, motivo: guardado ? 'no_existe' : 'sin_vincular', candidatos });
  }
  return out;
}

export interface EstadoServicio {
  /** Horas que faltan para el próximo servicio. Negativo = vencido. `null` si no hay referencia. */
  restantes: number | null;
  /** Horas corridas desde el último servicio registrado. `null` si no hay ninguno. */
  desdeUltimo: number | null;
  /** true si el servicio ya debió hacerse. */
  vencido: boolean;
  /** true si la bitácora no tiene ningún servicio de este equipo: no se puede afirmar nada. */
  sinReferencia: boolean;
}

/**
 * Horómetro del último SERVICIO de un equipo: el más reciente entre el cambio de
 * aceite y el de filtros. No se mira el gasoil: cargar combustible no es un servicio,
 * y tomarlo como referencia daba «vencido» apenas se cargaba el tanque.
 */
export function ultimoServicioHrs(
  u: { aceite?: number | null; filtro?: number | null } | null | undefined,
): number | null {
  const vals = [u?.aceite, u?.filtro]
    .map((x) => (x == null ? NaN : Number(x)))
    .filter((x) => Number.isFinite(x));
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Horas hasta el próximo mantenimiento, contadas desde el ÚLTIMO SERVICIO registrado.
 *
 * Antes se calculaba `frecuencia − (horómetro mod frecuencia)`, que asume que los
 * servicios se hacen SIEMPRE en el múltiplo exacto del horómetro. Con un equipo que
 * ya pasó su servicio el módulo «da la vuelta» y la alerta se apaga justo cuando más
 * hace falta: con frecuencia 250 y horómetro 260, decía «faltan 240».
 *
 * Si la bitácora NO tiene ningún servicio del equipo, no se inventa nada: se devuelve
 * `sinReferencia`. Estimar desde el horómetro absoluto declaraba vencida a toda la
 * flota vieja («vencido hace 12.000 h»), que es ruido, no información.
 */
export function estadoServicio(
  frecuencia: number | null | undefined,
  horometro: number | null | undefined,
  ultimoServicio?: number | null,
): EstadoServicio | null {
  const f = Number(frecuencia) || 0;
  if (f <= 0 || horometro == null) return null;
  const h = Number(horometro) || 0;
  const ult = ultimoServicio == null ? NaN : Number(ultimoServicio);
  if (!Number.isFinite(ult)) {
    return { restantes: null, desdeUltimo: null, vencido: false, sinReferencia: true };
  }
  const desdeUltimo = Math.round((h - ult) * 100) / 100;
  const restantes = Math.round((f - desdeUltimo) * 100) / 100;
  return { restantes, desdeUltimo, vencido: restantes < 0, sinReferencia: false };
}

/** ¿Hay que avisar por este servicio? (vencido o dentro del umbral). */
export function enAlertaServicio(e: EstadoServicio | null): boolean {
  if (!e || e.sinReferencia || e.restantes == null) return false;
  return e.vencido || e.restantes <= UMBRAL_ALERTA_HRS;
}
