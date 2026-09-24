import { describe, it, expect } from 'vitest';
import { desplazamientoPara } from './desplazarLista';

/* Lista de 260 px de alto visible con opciones de 40 px, como el desplegable real. */
const opcion = (i: number, scroll: number) => ({ top: i * 40, alto: 40, scroll, visible: 260 });

describe('la opción resaltada se mantiene a la vista', () => {
  it('si ya se ve, la lista no se mueve', () => {
    expect(desplazamientoPara(opcion(0, 0))).toBe(0);
    expect(desplazamientoPara(opcion(3, 0))).toBe(0);
    // La última que entra entera: ocupa 200..240 de los 260 visibles.
    expect(desplazamientoPara(opcion(5, 0))).toBe(0);
  });

  it('bajando, arrastra la lista lo justo para que entre', () => {
    // La primera que NO entra: va de 240 a 280, con 260 visibles hay que bajar 20.
    expect(desplazamientoPara(opcion(6, 0))).toBe(20);
    expect(desplazamientoPara(opcion(9, 0))).toBe(400 - 260);
  });

  it('subiendo, deja la opción pegada al borde de arriba', () => {
    expect(desplazamientoPara({ top: 120, alto: 40, scroll: 200, visible: 260 })).toBe(120);
  });

  it('la primera opción lleva la lista al principio', () => {
    expect(desplazamientoPara({ top: 0, alto: 40, scroll: 340, visible: 260 })).toBe(0);
  });

  it('una lista más corta que su alto visible nunca se desplaza', () => {
    expect(desplazamientoPara({ top: 0, alto: 40, scroll: 0, visible: 260 })).toBe(0);
    expect(desplazamientoPara({ top: 40, alto: 40, scroll: 0, visible: 260 })).toBe(0);
  });

  it('una opción más alta que la ventana se muestra desde su inicio', () => {
    // Prefiere ver el principio de la opción antes que su final.
    expect(desplazamientoPara({ top: 100, alto: 400, scroll: 0, visible: 260 })).toBe(240);
    expect(desplazamientoPara({ top: 100, alto: 400, scroll: 300, visible: 260 })).toBe(100);
  });
});
