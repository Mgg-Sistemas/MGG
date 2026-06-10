/* ============================================================
   MGG · Combustible · Cubicación de tanque CILINDRO HORIZONTAL
   Volumen de líquido en un cilindro acostado según el nivel medido con varilla.
   Área del segmento circular × largo del cilindro.
     V(h) = L · [ r²·arccos((r−h)/r) − (r−h)·√(2rh − h²) ]   (cm³ → ÷1000 = litros)
   donde r = radio (cm), h = nivel del líquido desde el fondo (cm), L = largo (cm).
   ============================================================ */

/** Largo del cilindro (cm) derivado de la capacidad y el diámetro: L = V / (π·r²). */
export function longitudDesdeCapacidad(capacidadLitros: number, diametroCm: number): number {
  const r = (Number(diametroCm) || 0) / 2;
  const cap = Number(capacidadLitros) || 0;
  if (r <= 0 || cap <= 0) return 0;
  const cm3 = cap * 1000;
  return Math.round((cm3 / (Math.PI * r * r)) * 10) / 10;
}

/** Litros de líquido para un nivel `h` (cm) en un cilindro horizontal de diámetro y largo dados. */
export function litrosCilindroHorizontal(nivelCm: number, diametroCm: number, longitudCm: number): number {
  const r = (Number(diametroCm) || 0) / 2;
  const L = Number(longitudCm) || 0;
  let h = Number(nivelCm) || 0;
  if (r <= 0 || L <= 0) return 0;
  if (h <= 0) return 0;
  if (h >= 2 * r) return Math.round((Math.PI * r * r * L) / 1000 * 100) / 100; // lleno
  const area = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(2 * r * h - h * h);
  return Math.round((area * L) / 1000 * 100) / 100;
}

/** Capacidad teórica (litros) de un cilindro lleno (Ø y largo en cm). */
export function capacidadCilindro(diametroCm: number, longitudCm: number): number {
  const r = (Number(diametroCm) || 0) / 2;
  const L = Number(longitudCm) || 0;
  if (r <= 0 || L <= 0) return 0;
  return Math.round((Math.PI * r * r * L) / 1000 * 100) / 100;
}

/** Tabla de referencia nivel→litros para CILINDRO (de 0 al diámetro, en pasos). */
export function tablaCubicacion(diametroCm: number, longitudCm: number, paso = 5): Array<{ nivel: number; litros: number }> {
  const D = Number(diametroCm) || 0;
  if (D <= 0 || (Number(longitudCm) || 0) <= 0) return [];
  const filas: Array<{ nivel: number; litros: number }> = [];
  for (let h = 0; h <= D + 0.0001; h += paso) {
    const nivel = Math.min(h, D);
    filas.push({ nivel: Math.round(nivel * 10) / 10, litros: litrosCilindroHorizontal(nivel, D, longitudCm) });
    if (nivel >= D) break;
  }
  return filas;
}

/* ───────────── Tanque RECTANGULAR (prisma) ─────────────
   Volumen lineal: V(h) = largo × ancho × h. Todo en cm → ÷1000 = litros. */

/** Litros de líquido para un nivel `h` (cm) en un tanque rectangular. */
export function litrosRectangular(nivelCm: number, largoCm: number, anchoCm: number, alturaCm: number): number {
  const L = Number(largoCm) || 0, A = Number(anchoCm) || 0, H = Number(alturaCm) || 0;
  let h = Number(nivelCm) || 0;
  if (L <= 0 || A <= 0 || H <= 0) return 0;
  if (h <= 0) return 0;
  if (h > H) h = H;
  return Math.round((L * A * h) / 1000 * 100) / 100;
}

/** Capacidad teórica (litros) de un rectangular lleno (cm). */
export function capacidadRectangular(largoCm: number, anchoCm: number, alturaCm: number): number {
  const L = Number(largoCm) || 0, A = Number(anchoCm) || 0, H = Number(alturaCm) || 0;
  if (L <= 0 || A <= 0 || H <= 0) return 0;
  return Math.round((L * A * H) / 1000 * 100) / 100;
}

/** Tabla de referencia nivel→litros para RECTANGULAR (de 0 a la altura, en pasos). */
export function tablaCubicacionRect(largoCm: number, anchoCm: number, alturaCm: number, paso = 5): Array<{ nivel: number; litros: number }> {
  const H = Number(alturaCm) || 0;
  if (H <= 0 || (Number(largoCm) || 0) <= 0 || (Number(anchoCm) || 0) <= 0) return [];
  const filas: Array<{ nivel: number; litros: number }> = [];
  for (let h = 0; h <= H + 0.0001; h += paso) {
    const nivel = Math.min(h, H);
    filas.push({ nivel: Math.round(nivel * 10) / 10, litros: litrosRectangular(nivel, largoCm, anchoCm, alturaCm) });
    if (nivel >= H) break;
  }
  return filas;
}
