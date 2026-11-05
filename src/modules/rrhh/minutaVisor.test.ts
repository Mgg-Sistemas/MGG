import { describe, expect, it } from 'vitest';
import {
  ESCALA_MAX, ESCALA_MIN, escalaSiguiente, esImagenAdjunto, giroSiguiente, repartirTanda, dimensionesVisor,
} from './minutaVisor';

describe('escalaSiguiente', () => {
  it('sube y baja de a 0,25', () => {
    expect(escalaSiguiente(1, 1)).toBe(1.25);
    expect(escalaSiguiente(1, -1)).toBe(0.75);
  });
  it('no pasa de 0,5 ni de 4', () => {
    expect(escalaSiguiente(0.5, -1)).toBe(0.5);
    expect(escalaSiguiente(4, 1)).toBe(4);
    expect(ESCALA_MIN).toBe(0.5);
    expect(ESCALA_MAX).toBe(4);
  });
  it('no arrastra decimales tras muchos pasos', () => {
    let e = 1;
    for (let i = 0; i < 20; i++) e = escalaSiguiente(e, 1);
    expect(e).toBe(4);
  });
});

describe('giroSiguiente', () => {
  it('suma 90 y da la vuelta a los 360', () => {
    expect(giroSiguiente(0)).toBe(90);
    expect(giroSiguiente(270)).toBe(0);
  });
});

describe('dimensionesVisor', () => {
  // Apaisada 400x200 a ancho base 300 y escala 2: imagen de 600x300.
  const apaisada = (giro: number) => dimensionesVisor(giro, 2, 300, 400, 200);
  it('con 0 y 180 la caja es del tamaño de la imagen', () => {
    for (const g of [0, 180]) expect(apaisada(g).caja).toEqual({ w: 600, h: 300 });
  });
  it('con 90 y 270 la caja intercambia ancho y alto', () => {
    for (const g of [90, 270]) expect(apaisada(g).caja).toEqual({ w: 300, h: 600 });
  });
  it('la imagen mantiene su tamaño sin girar en cualquier giro', () => {
    for (const g of [0, 90, 180, 270]) expect(apaisada(g).img).toEqual({ w: 600, h: 300 });
  });
  it('vertical 200x400 a escala 1 y base 300: 300x600, y girada 600x300', () => {
    expect(dimensionesVisor(0, 1, 300, 200, 400).caja).toEqual({ w: 300, h: 600 });
    expect(dimensionesVisor(90, 1, 300, 200, 400).caja).toEqual({ w: 600, h: 300 });
  });
  it('acepta giros fuera de rango sin romperse', () => {
    expect(dimensionesVisor(450, 1, 100, 200, 100).caja).toEqual({ w: 50, h: 100 });
  });
});

describe('esImagenAdjunto', () => {
  it('distingue imágenes de PDF', () => {
    expect(esImagenAdjunto('image/png')).toBe(true);
    expect(esImagenAdjunto('application/pdf')).toBe(false);
    expect(esImagenAdjunto(null)).toBe(false);
  });
});

describe('repartirTanda', () => {
  it('un archivo malo no saca a los demás', () => {
    const r = repartirTanda([{ name: 'a.png' }, { name: 'b.exe' }, { name: 'c.pdf' }],
      (f) => (f.name.endsWith('.exe') ? 'tipo no permitido' : null));
    expect(r.validos.map((f) => f.name)).toEqual(['a.png', 'c.pdf']);
    expect(r.rechazados).toEqual([{ nombre: 'b.exe', motivo: 'tipo no permitido' }]);
  });
});
