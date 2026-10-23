/* Atajos de rango de fechas para los filtros (AAAA-MM-DD, hora de Venezuela). */
export type RangoRapido = 'mes' | 'mesPasado' | 'ult90' | 'anio';

export const RANGOS_RAPIDOS: { valor: RangoRapido; label: string }[] = [
  { valor: 'mes', label: 'Este mes' },
  { valor: 'mesPasado', label: 'Mes pasado' },
  { valor: 'ult90', label: 'Últimos 90 días' },
  { valor: 'anio', label: 'Este año' },
];

export function hoyVenezuela(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function rangoRapido(r: RangoRapido, hoy: string = hoyVenezuela()): { desde: string; hasta: string } {
  const [y, m, d] = hoy.split('-').map(Number);
  switch (r) {
    case 'mes': return { desde: iso(new Date(Date.UTC(y, m - 1, 1))), hasta: hoy };
    case 'mesPasado': return { desde: iso(new Date(Date.UTC(y, m - 2, 1))), hasta: iso(new Date(Date.UTC(y, m - 1, 0))) };
    case 'ult90': return { desde: iso(new Date(Date.UTC(y, m - 1, d - 89))), hasta: hoy };
    case 'anio': return { desde: `${y}-01-01`, hasta: hoy };
  }
}

/** ¿El rango actual coincide con algún atajo? (para marcar el chip activo) */
export function rangoActivo(desde: string, hasta: string, hoy: string = hoyVenezuela()): RangoRapido | null {
  for (const r of RANGOS_RAPIDOS) {
    const x = rangoRapido(r.valor, hoy);
    if (x.desde === desde && x.hasta === hasta) return r.valor;
  }
  return null;
}
