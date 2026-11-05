/* ============================================================
   MGG · ¿La hora del equipo está bien? (05-11-2026)

   Si el reloj de la PC está adelantado o atrasado, el sistema cree que la
   sesión ya venció apenas se entra, la renueva sin parar, Supabase corta por
   exceso de pedidos (429) y devuelve a la pantalla de entrada (pasó el 05-11
   desde una PC de la oficina). Se compara la hora del equipo con la del
   servidor —el encabezado `Date` de /version.json, del mismo sitio— y se
   avisa para que corrijan la hora de Windows.
   ============================================================ */

/** A partir de cuánto desfase se avisa (la sesión tolera poco más). */
export const DESFASE_AVISO_MS = 3 * 60 * 1000;

/** Desfase del equipo respecto del servidor (positivo = el equipo va ADELANTADO). null = no se pudo medir. */
export function desfaseDesdeEncabezado(fechaServidor: string | null | undefined, enviado: number, recibido: number): number | null {
  const srv = Date.parse(fechaServidor ?? '');
  if (!Number.isFinite(srv)) return null;
  // La hora local al momento de la respuesta: el punto medio del viaje.
  const local = enviado + (recibido - enviado) / 2;
  return Math.round(local - srv);
}

/** «adelantada 2 h 5 min» / «atrasada 12 min». */
export function textoDesfase(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(min / 60);
  const resto = min % 60;
  const cuanto = h ? `${h} h${resto ? ` ${resto} min` : ''}` : `${min} min`;
  return `${ms > 0 ? 'adelantada' : 'atrasada'} ${cuanto}`;
}

let medido: Promise<number | null> | null = null;

/** Mide el desfase una vez por carga de la página. */
export function medirDesfaseReloj(): Promise<number | null> {
  if (medido) return medido;
  medido = (async () => {
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
      const enviado = Date.now();
      const r = await fetch(`${base}version.json?reloj=${enviado}`, { cache: 'no-store' });
      const recibido = Date.now();
      return desfaseDesdeEncabezado(r.headers.get('date'), enviado, recibido);
    } catch { return null; }
  })();
  return medido;
}
