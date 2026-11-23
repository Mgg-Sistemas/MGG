/* ============================================================================
   MGG & GT · Calendario Bancario Oficial SUDEBAN (Venezuela)
   - Días feriados bancarios y nacionales no laborables según normativa SUDEBAN.
   - Manejo automático de «Lunes Bancarios» y feriados religiosos trasladados.
   - Cálculo del siguiente día hábil bancario (Fecha Valor BCV).
   - En feriado bancario (ej. lunes bancario), la tasa oficial del BCV que rige
     es la del siguiente día hábil (martes), la cual es publicada el día viernes.
   ============================================================================ */

export interface FeriadoBancario {
  fecha: string; // YYYY-MM-DD
  motivo: string;
  tipo: 'bancario' | 'nacional';
  trasladadoDesde?: string;
}

/**
 * Calendario oficial SUDEBAN de feriados bancarios y nacionales para Venezuela.
 * Incluye los calendarios 2025, 2026 y 2027 oficiales.
 */
export const FERIADOS_SUDEBAN: FeriadoBancario[] = [
  // ── 2025 ──
  { fecha: '2025-01-01', motivo: 'Año Nuevo', tipo: 'nacional' },
  { fecha: '2025-01-06', motivo: 'Día de Reyes', tipo: 'bancario' },
  { fecha: '2025-01-20', motivo: 'Día de la Divina Pastora', tipo: 'bancario', trasladadoDesde: '2025-01-14' },
  { fecha: '2025-03-03', motivo: 'Carnaval', tipo: 'nacional' },
  { fecha: '2025-03-04', motivo: 'Carnaval', tipo: 'nacional' },
  { fecha: '2025-03-24', motivo: 'Día de San José', tipo: 'bancario', trasladadoDesde: '2025-03-19' },
  { fecha: '2025-04-17', motivo: 'Jueves Santo', tipo: 'nacional' },
  { fecha: '2025-04-18', motivo: 'Viernes Santo', tipo: 'nacional' },
  { fecha: '2025-04-19', motivo: 'Proclamación de la Independencia', tipo: 'nacional' },
  { fecha: '2025-05-01', motivo: 'Día del Trabajador', tipo: 'nacional' },
  { fecha: '2025-06-02', motivo: 'Ascensión del Señor', tipo: 'bancario', trasladadoDesde: '2025-05-29' },
  { fecha: '2025-06-23', motivo: 'Corpus Christi', tipo: 'bancario', trasladadoDesde: '2025-06-19' },
  { fecha: '2025-06-24', motivo: 'Batalla de Carabobo', tipo: 'nacional' },
  { fecha: '2025-06-30', motivo: 'San Pedro y San Pablo', tipo: 'bancario', trasladadoDesde: '2025-06-29' },
  { fecha: '2025-07-05', motivo: 'Día de la Independencia', tipo: 'nacional' },
  { fecha: '2025-07-24', motivo: 'Natalicio del Libertador', tipo: 'nacional' },
  { fecha: '2025-08-18', motivo: 'Asunción de Nuestra Señora', tipo: 'bancario', trasladadoDesde: '2025-08-15' },
  { fecha: '2025-09-15', motivo: 'Virgen de Coromoto', tipo: 'bancario', trasladadoDesde: '2025-09-11' },
  { fecha: '2025-10-12', motivo: 'Día de la Resistencia Indígena', tipo: 'nacional' },
  { fecha: '2025-11-24', motivo: 'Día de la Virgen del Rosario de Chiquinquirá', tipo: 'bancario', trasladadoDesde: '2025-11-18' },
  { fecha: '2025-12-08', motivo: 'Día de la Inmaculada Concepción', tipo: 'bancario' },
  { fecha: '2025-12-24', motivo: 'Víspera de Navidad', tipo: 'bancario' },
  { fecha: '2025-12-25', motivo: 'Navidad', tipo: 'nacional' },
  { fecha: '2025-12-31', motivo: 'Fin de Año', tipo: 'bancario' },

  // ── 2026 (Año en curso - Calendario Oficial SUDEBAN) ──
  { fecha: '2026-01-01', motivo: 'Año Nuevo', tipo: 'nacional' },
  { fecha: '2026-01-12', motivo: 'Día de Reyes', tipo: 'bancario', trasladadoDesde: '2026-01-06' },
  { fecha: '2026-01-19', motivo: 'Día de la Divina Pastora', tipo: 'bancario', trasladadoDesde: '2026-01-14' },
  { fecha: '2026-02-16', motivo: 'Carnaval', tipo: 'nacional' },
  { fecha: '2026-02-17', motivo: 'Carnaval', tipo: 'nacional' },
  { fecha: '2026-03-23', motivo: 'Día de San José', tipo: 'bancario', trasladadoDesde: '2026-03-19' },
  { fecha: '2026-04-02', motivo: 'Jueves Santo', tipo: 'nacional' },
  { fecha: '2026-04-03', motivo: 'Viernes Santo', tipo: 'nacional' },
  { fecha: '2026-04-19', motivo: 'Proclamación de la Independencia', tipo: 'nacional' },
  { fecha: '2026-05-01', motivo: 'Día del Trabajador', tipo: 'nacional' },
  { fecha: '2026-05-18', motivo: 'Ascensión del Señor', tipo: 'bancario', trasladadoDesde: '2026-05-14' },
  { fecha: '2026-06-08', motivo: 'Corpus Christi', tipo: 'bancario', trasladadoDesde: '2026-06-04' },
  { fecha: '2026-06-15', motivo: 'Día de San Antonio', tipo: 'bancario', trasladadoDesde: '2026-06-13' },
  { fecha: '2026-06-24', motivo: 'Batalla de Carabobo', tipo: 'nacional' },
  { fecha: '2026-06-29', motivo: 'Día de San Pedro y San Pablo', tipo: 'bancario' },
  { fecha: '2026-07-05', motivo: 'Día de la Independencia', tipo: 'nacional' },
  { fecha: '2026-07-24', motivo: 'Natalicio del Libertador', tipo: 'nacional' },
  { fecha: '2026-08-17', motivo: 'Asunción de Nuestra Señora', tipo: 'bancario', trasladadoDesde: '2026-08-15' },
  { fecha: '2026-09-14', motivo: 'Día de la Virgen de Coromoto', tipo: 'bancario', trasladadoDesde: '2026-09-11' },
  { fecha: '2026-10-12', motivo: 'Día de la Resistencia Indígena', tipo: 'nacional' },
  { fecha: '2026-10-26', motivo: 'Día del Dr. José Gregorio Hernández', tipo: 'bancario' },
  { fecha: '2026-11-02', motivo: 'Día de Todos los Santos', tipo: 'bancario', trasladadoDesde: '2026-11-01' },
  // Lunes Bancario actual (23-11-2026): trasladado desde el 18 de noviembre
  { fecha: '2026-11-23', motivo: 'Día de la Virgen del Rosario de Chiquinquirá', tipo: 'bancario', trasladadoDesde: '2026-11-18' },
  { fecha: '2026-12-14', motivo: 'Día de la Inmaculada Concepción', tipo: 'bancario', trasladadoDesde: '2026-12-08' },
  { fecha: '2026-12-24', motivo: 'Nochebuena', tipo: 'bancario' },
  { fecha: '2026-12-25', motivo: 'Navidad', tipo: 'nacional' },
  { fecha: '2026-12-31', motivo: 'Fin de Año', tipo: 'bancario' },

  // ── 2027 ──
  { fecha: '2027-01-01', motivo: 'Año Nuevo', tipo: 'nacional' },
  { fecha: '2027-01-06', motivo: 'Día de Reyes', tipo: 'bancario' },
  { fecha: '2027-01-18', motivo: 'Día de la Divina Pastora', tipo: 'bancario', trasladadoDesde: '2027-01-14' },
  { fecha: '2027-02-08', motivo: 'Carnaval', tipo: 'nacional' },
  { fecha: '2027-02-09', motivo: 'Carnaval', tipo: 'nacional' },
  { fecha: '2027-03-19', motivo: 'Día de San José', tipo: 'bancario' },
  { fecha: '2027-03-25', motivo: 'Jueves Santo', tipo: 'nacional' },
  { fecha: '2027-03-26', motivo: 'Viernes Santo', tipo: 'nacional' },
  { fecha: '2027-04-19', motivo: 'Proclamación de la Independencia', tipo: 'nacional' },
  { fecha: '2027-05-01', motivo: 'Día del Trabajador', tipo: 'nacional' },
  { fecha: '2027-05-10', motivo: 'Ascensión del Señor', tipo: 'bancario', trasladadoDesde: '2027-05-06' },
  { fecha: '2027-05-31', motivo: 'Corpus Christi', tipo: 'bancario', trasladadoDesde: '2027-05-27' },
  { fecha: '2027-06-24', motivo: 'Batalla de Carabobo', tipo: 'nacional' },
  { fecha: '2027-06-28', motivo: 'San Pedro y San Pablo', tipo: 'bancario', trasladadoDesde: '2027-06-29' },
  { fecha: '2027-07-05', motivo: 'Día de la Independencia', tipo: 'nacional' },
  { fecha: '2027-07-24', motivo: 'Natalicio del Libertador', tipo: 'nacional' },
  { fecha: '2027-08-16', motivo: 'Asunción de Nuestra Señora', tipo: 'bancario', trasladadoDesde: '2027-08-15' },
  { fecha: '2027-09-13', motivo: 'Virgen de Coromoto', tipo: 'bancario', trasladadoDesde: '2027-09-11' },
  { fecha: '2027-10-12', motivo: 'Día de la Resistencia Indígena', tipo: 'nacional' },
  { fecha: '2027-11-22', motivo: 'Día de la Virgen del Rosario de Chiquinquirá', tipo: 'bancario', trasladadoDesde: '2027-11-18' },
  { fecha: '2027-12-08', motivo: 'Día de la Inmaculada Concepción', tipo: 'bancario' },
  { fecha: '2027-12-24', motivo: 'Víspera de Navidad', tipo: 'bancario' },
  { fecha: '2027-12-25', motivo: 'Navidad', tipo: 'nacional' },
  { fecha: '2027-12-31', motivo: 'Fin de Año', tipo: 'bancario' },
];

const MAPA_FERIADOS = new Map<string, FeriadoBancario>(
  FERIADOS_SUDEBAN.map((f) => [f.fecha, f]),
);

/** Normaliza una fecha a YYYY-MM-DD en zona horaria America/Caracas. */
export function ymdCaracas(fecha: string | Date = new Date()): string {
  if (typeof fecha === 'string') {
    const s = fecha.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
}

/** Obtiene el día de la semana (0 = Domingo, 1 = Lunes, ..., 6 = Sábado) en Caracas. */
export function diaSemanaCaracas(fecha: string | Date): number {
  const ymd = ymdCaracas(fecha);
  const [y, m, d] = ymd.split('-').map(Number);
  // Usar mediodía UTC para evitar desplazamientos de huso
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

/** Nombre del día de la semana en español (Lunes, Martes, etc.). */
export const DIAS_SEMANA_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function nombreDiaSemana(fecha: string | Date): string {
  return DIAS_SEMANA_ES[diaSemanaCaracas(fecha)] ?? '';
}

/** ¿La fecha cae sábado o domingo? */
export function esFinDeSemana(fecha: string | Date): boolean {
  const dia = diaSemanaCaracas(fecha);
  return dia === 0 || dia === 6;
}

/** ¿Es un feriado bancario o nacional según SUDEBAN? */
export function esFeriadoBancario(fecha: string | Date): boolean {
  const ymd = ymdCaracas(fecha);
  return MAPA_FERIADOS.has(ymd);
}

/** Información del feriado bancario o nacional si aplica. */
export function infoFeriadoBancario(fecha: string | Date): FeriadoBancario | null {
  const ymd = ymdCaracas(fecha);
  return MAPA_FERIADOS.get(ymd) ?? null;
}

/** ¿Es un día hábil bancario (de lunes a viernes y sin feriado SUDEBAN)? */
export function esDiaHabilBancario(fecha: string | Date): boolean {
  if (esFinDeSemana(fecha)) return false;
  return !esFeriadoBancario(fecha);
}

/** Suma un día a una fecha YYYY-MM-DD. */
export function sumarUnDiaYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const ny = date.getUTCFullYear();
  const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(date.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Calcula el siguiente día hábil bancario.
 * Por ejemplo:
 * - Si hoy es lunes bancario (2026-11-23), devuelve martes (2026-11-24).
 * - Si hoy es viernes (2026-11-20) y el lunes es bancario, devuelve martes (2026-11-24).
 */
export function siguienteDiaHabilBancario(fecha: string | Date): string {
  let curr = ymdCaracas(fecha);
  for (let i = 0; i < 14; i++) {
    curr = sumarUnDiaYmd(curr);
    if (esDiaHabilBancario(curr)) {
      return curr;
    }
  }
  return curr;
}

export interface InfoDiaValorBcv {
  fechaHoy: string;
  esBancario: boolean;
  esFinDeSemana: boolean;
  infoFeriado: FeriadoBancario | null;
  /** Fecha valor efectiva para el cálculo de la tasa oficial del BCV. */
  fechaValor: string;
  /** Nombre del día valor (ej. "Martes"). */
  diaValorNombre: string;
  /** Texto explicativo para chips, modales y reportes. */
  etiquetaValor: string;
  textoExplicativo: string;
}

/**
 * Resuelve la fecha valor del BCV según el calendario bancario SUDEBAN.
 * En feriados bancarios (ej. hoy lunes 23-11-2026):
 * - detecta que es feriado bancario,
 * - toma automáticamente el día siguiente hábil bancario (Martes 24-11-2026),
 * - cuya tasa fue publicada por el BCV el día hábil anterior (viernes).
 */
export function resolverDiaValorBcv(fecha: string | Date = new Date()): InfoDiaValorBcv {
  const hoy = ymdCaracas(fecha);
  const finSemana = esFinDeSemana(hoy);
  const infoFeriado = infoFeriadoBancario(hoy);
  const bancario = Boolean(infoFeriado) || finSemana;

  // Si hoy es feriado bancario o fin de semana, la fecha valor que rige es la del siguiente día hábil (ej. martes)
  const fechaValor = bancario ? siguienteDiaHabilBancario(hoy) : hoy;
  const diaValorNombre = nombreDiaSemana(fechaValor);

  let textoExplicativo = '';
  let etiquetaValor = '';

  if (infoFeriado) {
    etiquetaValor = `Feriado bancario · Tasa ${diaValorNombre}`;
    textoExplicativo = `Hoy es feriado bancario (${infoFeriado.motivo}). Rige la tasa oficial BCV del día ${diaValorNombre} (${fechaValor}), emitida el día viernes.`;
  } else if (finSemana) {
    etiquetaValor = `Fin de semana · Tasa ${diaValorNombre}`;
    textoExplicativo = `Fin de semana. Rige la tasa oficial BCV valor ${diaValorNombre} (${fechaValor}), emitida el día viernes.`;
  } else {
    etiquetaValor = `Tasa del día (${diaValorNombre})`;
    textoExplicativo = `Día hábil bancario. Rige la tasa oficial BCV del día (${hoy}).`;
  }

  return {
    fechaHoy: hoy,
    esBancario: Boolean(infoFeriado),
    esFinDeSemana: finSemana,
    infoFeriado,
    fechaValor,
    diaValorNombre,
    etiquetaValor,
    textoExplicativo,
  };
}

/** Intenta sincronizar o consultar feriados bancarios adicionales vía API pública si está disponible. */
export async function sincronizarCalendarioBancarioApi(anio: number = new Date().getFullYear()): Promise<void> {
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${anio}/VE`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return;
    const data = await res.json() as Array<{ date: string; localName: string; types: string[] }>;
    for (const item of data) {
      if (!MAPA_FERIADOS.has(item.date)) {
        const esBancario = item.types.includes('Bank') || item.types.includes('Public');
        if (esBancario) {
          MAPA_FERIADOS.set(item.date, {
            fecha: item.date,
            motivo: item.localName,
            tipo: item.types.includes('Bank') ? 'bancario' : 'nacional',
          });
        }
      }
    }
  } catch {
    // Si la API externa no está disponible o no hay red, la tabla oficial SUDEBAN preinstalada rige al 100%
  }
}

/** ¿Es un día no hábil para la banca venezolana (fin de semana o feriado bancario)? */
export function esDiaNoBancario(fecha: string | Date): boolean {
  return esFinDeSemana(fecha) || esFeriadoBancario(fecha);
}

/** Alias para siguienteDiaHabilBancario. */
export const proximoDiaHabilBancario = siguienteDiaHabilBancario;

/** Motivo del feriado bancario o null. */
export function motivoFeriadoBancario(fecha: string | Date): string | null {
  return infoFeriadoBancario(fecha)?.motivo ?? null;
}

/** Nombre del día de la semana en minúsculas (ej: 'martes'). */
export function diaSemanaNombre(fecha: string | Date): string {
  return nombreDiaSemana(fecha).toLowerCase();
}

export interface InfoDiaBancario {
  fecha: string;
  esBancario: boolean;
  esFinDeSemana: boolean;
  esFeriado: boolean;
  motivo: string | null;
  fechaEfectivaBcv: string;
}

/** Adaptador compatible para consultas rápidas de estado bancario. */
export function infoDiaBancario(fecha: string | Date): InfoDiaBancario {
  const res = resolverDiaValorBcv(fecha);
  return {
    fecha: res.fechaHoy,
    esBancario: res.esBancario || res.esFinDeSemana,
    esFinDeSemana: res.esFinDeSemana,
    esFeriado: res.esBancario,
    motivo: res.infoFeriado?.motivo ?? (res.esFinDeSemana ? 'Fin de semana' : null),
    fechaEfectivaBcv: res.fechaValor,
  };
}

