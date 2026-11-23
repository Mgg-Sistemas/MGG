// MGG · Helper compartido: Calendario Bancario SUDEBAN (Venezuela)
// Deno / Edge Functions

export const FERIADOS_BANCARIOS_VE: Record<string, string> = {
  // ─── 2026 (Año Actual) ──────────────────────────────
  '2026-01-01': 'Año Nuevo (Feriado Nacional)',
  '2026-01-12': 'Día de Reyes (Lunes Bancario)',
  '2026-02-16': 'Lunes de Carnaval (Feriado Nacional)',
  '2026-02-17': 'Martes de Carnaval (Feriado Nacional)',
  '2026-03-23': 'Día de San José (Lunes Bancario)',
  '2026-04-02': 'Jueves Santo (Feriado Nacional)',
  '2026-04-03': 'Viernes Santo (Feriado Nacional)',
  '2026-04-19': 'Declaración de la Independencia (Feriado Nacional)',
  '2026-05-01': 'Día del Trabajador (Feriado Nacional)',
  '2026-05-18': 'Ascensión del Señor (Lunes Bancario)',
  '2026-06-08': 'Corpus Christi (Lunes Bancario)',
  '2026-06-15': 'Día de San Antonio (Lunes Bancario)',
  '2026-06-24': 'Batalla de Carabobo (Feriado Nacional)',
  '2026-06-29': 'Día de San Pedro y San Pablo (Lunes Bancario)',
  '2026-07-05': 'Día de la Independencia (Feriado Nacional)',
  '2026-07-24': 'Natalicio de Simón Bolívar (Feriado Nacional)',
  '2026-08-17': 'Asunción de Nuestra Señora (Lunes Bancario)',
  '2026-09-14': 'Día de la Virgen del Valle (Lunes Bancario)',
  '2026-10-12': 'Día de la Resistencia Indígena (Feriado Nacional)',
  '2026-10-26': 'Día del Dr. José Gregorio Hernández (Lunes Bancario)',
  '2026-11-02': 'Día de Todos los Santos (Lunes Bancario)',
  '2026-11-23': 'Día de la Virgen del Rosario de Chiquinquirá (Lunes Bancario)',
  '2026-12-14': 'Día de la Inmaculada Concepción (Lunes Bancario)',
  '2026-12-24': 'Feriado Bancario (Víspera de Navidad)',
  '2026-12-25': 'Natividad de Nuestro Señor (Feriado Nacional)',
  '2026-12-31': 'Feriado Bancario (Fin de Año)',
};

export function esFeriadoBancario(fechaISO: string): boolean {
  const f = fechaISO.slice(0, 10);
  return Boolean(FERIADOS_BANCARIOS_VE[f]);
}

export function motivoFeriadoBancario(fechaISO: string): string | null {
  const f = fechaISO.slice(0, 10);
  return FERIADOS_BANCARIOS_VE[f] || null;
}

export function esFinDeSemana(fechaISO: string): boolean {
  const parts = fechaISO.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return false;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay();
  return day === 0 || day === 6;
}

export function esDiaNoBancario(fechaISO: string): boolean {
  return esFinDeSemana(fechaISO) || esFeriadoBancario(fechaISO);
}

export function proximoDiaHabilBancario(fechaISO: string): string {
  const parts = fechaISO.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return fechaISO;
  const [y, m, d] = parts;
  const cur = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  for (let i = 0; i < 15; i++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const iso = cur.toISOString().slice(0, 10);
    if (!esDiaNoBancario(iso)) return iso;
  }
  return fechaISO;
}

export function fechaEfectivaBcv(fechaISO: string): { fecha: string; esBancario: boolean; motivo: string | null } {
  const f = fechaISO.slice(0, 10);
  const finSemana = esFinDeSemana(f);
  const feriado = esFeriadoBancario(f);
  const esNoBanc = finSemana || feriado;
  const motivo = motivoFeriadoBancario(f) ?? (finSemana ? 'Fin de semana' : null);
  const fechaEfectiva = esNoBanc ? proximoDiaHabilBancario(f) : f;
  return { fecha: fechaEfectiva, esBancario: esNoBanc, motivo };
}
