/* ============================================================
   Golden Touch · RRHH · Encuadre de la foto del personal

   PROBLEMA. La foto se dibujaba siempre con «cubrir y centrar»: se recorta lo
   que sobra por el lado largo y se toma el centro geométrico. Con una foto de
   cuerpo entero, o con la persona corrida a un costado, eso deja una cara
   diminuta o cortada al medio, y la única salida era volver a sacar la foto.

   SOLUCIÓN. Se guardan tres números junto a la persona: cuánto se acerca
   (`zoom`) y dónde está el punto que tiene que quedar centrado (`x`, `y`).
   El archivo original NO se toca: se puede reencuadrar cuantas veces haga
   falta, y si mañana el carnet cambia de proporción el mismo encuadre sigue
   sirviendo.

   POR QUÉ EL FOCO VA DE 0 A 1. Guardar píxeles ataría el encuadre al tamaño
   de ESA foto y a la forma del recuadro donde se dibuja. Un punto relativo
   (0,5 / 0,5 = el centro) vale para cualquier foto y para cualquier recuadro:
   el carnet es vertical y la ficha técnica casi cuadrada, y los dos leen el
   mismo dato.

   Piezas puras: se prueban sin canvas ni navegador.
   ============================================================ */

/** Cuánto se puede acercar. Más de 4× sobre una foto de carnet ya es un borrón. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

/** El encuadre por defecto: sin acercar y centrado, que es lo que se hacía antes. */
export const ENCUADRE_NEUTRO: Encuadre = { zoom: 1, x: 0.5, y: 0.5 };

export interface Encuadre {
  /** 1 = la foto entra completa por su lado corto; 2 = el doble de cerca. */
  zoom: number;
  /** Punto que queda centrado, de 0 (izquierda) a 1 (derecha). */
  x: number;
  /** Punto que queda centrado, de 0 (arriba) a 1 (abajo). */
  y: number;
}

/** Recorte de la imagen ORIGEN que hay que dibujar, en píxeles de la foto. */
export interface Recorte {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Deja un encuadre dentro de lo posible, venga de donde venga (base, URL, un dedo). */
export function normalizarEncuadre(e?: Partial<Encuadre> | null): Encuadre {
  return {
    zoom: acotar(Number(e?.zoom) || 1, ZOOM_MIN, ZOOM_MAX),
    x: acotar(Number.isFinite(Number(e?.x)) ? Number(e?.x) : 0.5, 0, 1),
    y: acotar(Number.isFinite(Number(e?.y)) ? Number(e?.y) : 0.5, 0, 1),
  };
}

/** ¿Es el encuadre de siempre? Sirve para no guardar un dato que no dice nada. */
export function esNeutro(e: Encuadre): boolean {
  return e.zoom === 1 && e.x === 0.5 && e.y === 0.5;
}

/**
 * Qué pedazo de la foto hay que dibujar para llenar un recuadro de `destW × destH`.
 *
 * Con `zoom` 1 el resultado es exactamente el «cubrir y centrar» de siempre, así
 * que las fotos que nadie encuadró se siguen viendo igual que antes.
 *
 * El recorte se ACOTA a los bordes: por más que se arrastre, no se puede sacar
 * la foto fuera del recuadro y dejar una franja vacía.
 */
export function recorteDeEncuadre(
  imgW: number, imgH: number, destW: number, destH: number, encuadre?: Partial<Encuadre> | null,
): Recorte {
  const e = normalizarEncuadre(encuadre);
  if (!(imgW > 0 && imgH > 0 && destW > 0 && destH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };

  // Lado a tomar de la foto para cubrir el destino, antes de acercar.
  const razonDest = destW / destH;
  let sw: number;
  let sh: number;
  if (imgW / imgH > razonDest) {
    sh = imgH;
    sw = imgH * razonDest;
  } else {
    sw = imgW;
    sh = imgW / razonDest;
  }

  // Acercar es tomar MENOS foto para el mismo recuadro.
  sw /= e.zoom;
  sh /= e.zoom;

  // El foco manda dónde queda el centro del recorte, sin salirse de la imagen.
  const sx = acotar(e.x * imgW - sw / 2, 0, Math.max(0, imgW - sw));
  const sy = acotar(e.y * imgH - sh / 2, 0, Math.max(0, imgH - sh));

  return { sx, sy, sw, sh };
}

/**
 * Mueve el foco por un arrastre de `dxPx, dyPx` píxeles SOBRE EL RECUADRO.
 *
 * Se traduce a coordenadas de la foto para que arrastrar se sienta igual de
 * rápido esté como esté el zoom: con más zoom se ve menos foto, así que el
 * mismo gesto tiene que mover menos.
 */
export function moverFoco(
  encuadre: Encuadre, dxPx: number, dyPx: number,
  imgW: number, imgH: number, destW: number, destH: number,
): Encuadre {
  const { sw, sh } = recorteDeEncuadre(imgW, imgH, destW, destH, encuadre);
  if (!(sw > 0 && sh > 0 && imgW > 0 && imgH > 0)) return encuadre;
  // Arrastrar la foto hacia la derecha mueve el foco hacia la IZQUIERDA.
  return normalizarEncuadre({
    zoom: encuadre.zoom,
    x: encuadre.x - (dxPx / destW) * (sw / imgW),
    y: encuadre.y - (dyPx / destH) * (sh / imgH),
  });
}
