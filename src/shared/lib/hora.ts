/* ============================================================
   MGG · Horas del día (HH:mm)

   Varios campos de producción eran texto libre ("8:30PM", "20:30", "6am").
   Ahora se cargan con el selector de hora del navegador, que guarda "HH:mm".
   Estas funciones leen lo viejo sin perderlo y lo muestran en 12 h.
   ============================================================ */

/** Texto libre → "HH:mm" (24 h). '' si no se reconoce una hora. */
export function aHora24(texto: string | null | undefined): string {
  const s = String(texto ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const sufijo = m[3]?.replace(/\./g, '');
  if (!m[2] && !sufijo) return '';          // "8" solo no es una hora
  if (min > 59) return '';
  if (sufijo) {
    if (h < 1 || h > 12) return '';
    if (sufijo === 'pm' && h !== 12) h += 12;
    if (sufijo === 'am' && h === 12) h = 0;
  } else if (h > 23) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "20:30" → "8:30 pm". Si no se reconoce, devuelve el texto tal cual (datos viejos). */
export function horaLegible(texto: string | null | undefined): string {
  const h24 = aHora24(texto);
  if (!h24) return String(texto ?? '').trim();
  const [h, m] = h24.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
