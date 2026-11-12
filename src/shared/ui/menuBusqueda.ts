/* MGG · Buscador del menú lateral (12-11-2026): ¿un módulo coincide con lo escrito? */

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Sin importar acentos ni mayúsculas; con varias palabras, todas deben aparecer. */
export function coincideMenu(label: string, q: string): boolean {
  const n = normalizar(q);
  if (!n) return true;
  const l = normalizar(label);
  return n.split(/\s+/).every((w) => l.includes(w));
}
