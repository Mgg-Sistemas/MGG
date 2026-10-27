import { describe, expect, it } from 'vitest';
import {
  ENCUADRE_NEUTRO, ZOOM_MAX, ZOOM_MIN,
  esNeutro, moverFoco, normalizarEncuadre, recorteDeEncuadre,
} from './encuadreFoto';

describe('normalizarEncuadre', () => {
  it('sin nada, devuelve el de siempre: centrado y sin acercar', () => {
    expect(normalizarEncuadre(null)).toEqual(ENCUADRE_NEUTRO);
    expect(normalizarEncuadre(undefined)).toEqual(ENCUADRE_NEUTRO);
    expect(normalizarEncuadre({})).toEqual(ENCUADRE_NEUTRO);
  });

  it('acota el zoom a lo posible', () => {
    expect(normalizarEncuadre({ zoom: 0.1 }).zoom).toBe(ZOOM_MIN);
    expect(normalizarEncuadre({ zoom: 99 }).zoom).toBe(ZOOM_MAX);
  });

  it('acota el foco al cuadro de la foto', () => {
    expect(normalizarEncuadre({ x: -3, y: 7 })).toMatchObject({ x: 0, y: 1 });
  });

  it('un dato roto no rompe: vuelve al centro', () => {
    expect(normalizarEncuadre({ x: NaN, y: Infinity, zoom: NaN })).toEqual(ENCUADRE_NEUTRO);
  });
});

describe('recorteDeEncuadre · sin encuadre se comporta como antes', () => {
  // Esto es lo importante de todo el cambio: las fotos que nadie tocó tienen
  // que seguir viéndose EXACTAMENTE igual que cuando se dibujaban con «cubrir
  // y centrar». Si esto falla, cambiaron todos los carnets ya impresos.
  it('foto apaisada en un recuadro vertical: recorta los lados y toma el centro', () => {
    const r = recorteDeEncuadre(1000, 500, 260, 312, null);
    expect(r.sh).toBe(500);                       // usa todo el alto
    expect(r.sw).toBeCloseTo(500 * (260 / 312));  // y el ancho que corresponde
    expect(r.sx).toBeCloseTo((1000 - r.sw) / 2);  // centrado
    expect(r.sy).toBe(0);
  });

  it('foto vertical en un recuadro vertical más ancho: recorta arriba y abajo', () => {
    const r = recorteDeEncuadre(400, 1200, 260, 312, null);
    expect(r.sw).toBe(400);
    expect(r.sh).toBeCloseTo(400 / (260 / 312));
    expect(r.sy).toBeCloseTo((1200 - r.sh) / 2);
  });

  it('cuando la foto ya tiene la proporción del recuadro, se usa entera', () => {
    const r = recorteDeEncuadre(260, 312, 260, 312, null);
    expect(r).toMatchObject({ sx: 0, sy: 0, sw: 260, sh: 312 });
  });
});

describe('recorteDeEncuadre · el zoom', () => {
  it('acercar al doble toma la mitad de foto', () => {
    const sin = recorteDeEncuadre(1000, 1000, 100, 100, { zoom: 1 });
    const con = recorteDeEncuadre(1000, 1000, 100, 100, { zoom: 2 });
    expect(con.sw).toBeCloseTo(sin.sw / 2);
    expect(con.sh).toBeCloseTo(sin.sh / 2);
  });

  it('acercado y centrado, el recorte sigue estando en el medio', () => {
    const r = recorteDeEncuadre(1000, 1000, 100, 100, { zoom: 2 });
    expect(r.sx).toBeCloseTo(250);
    expect(r.sy).toBeCloseTo(250);
  });
});

describe('recorteDeEncuadre · el foco no deja huecos', () => {
  it('llevado al extremo izquierdo, el recorte pega contra el borde', () => {
    const r = recorteDeEncuadre(1000, 1000, 100, 100, { zoom: 2, x: 0, y: 0.5 });
    expect(r.sx).toBe(0);
  });

  it('llevado al extremo derecho, tampoco se pasa', () => {
    const r = recorteDeEncuadre(1000, 1000, 100, 100, { zoom: 2, x: 1, y: 0.5 });
    expect(r.sx + r.sw).toBeCloseTo(1000);
    expect(r.sx).toBeLessThanOrEqual(1000 - r.sw);
  });

  it('el recorte SIEMPRE queda dentro de la foto, se pida lo que se pida', () => {
    for (const zoom of [1, 1.5, 2, 3, 4]) {
      for (const x of [0, 0.25, 0.5, 0.75, 1]) {
        for (const y of [0, 0.5, 1]) {
          const r = recorteDeEncuadre(800, 1200, 260, 312, { zoom, x, y });
          expect(r.sx).toBeGreaterThanOrEqual(0);
          expect(r.sy).toBeGreaterThanOrEqual(0);
          expect(r.sx + r.sw).toBeLessThanOrEqual(800 + 0.001);
          expect(r.sy + r.sh).toBeLessThanOrEqual(1200 + 0.001);
        }
      }
    }
  });
});

describe('recorteDeEncuadre · datos imposibles', () => {
  it('una imagen sin tamaño no rompe: devuelve un recorte vacío', () => {
    expect(recorteDeEncuadre(0, 0, 100, 100, null)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(recorteDeEncuadre(100, 100, 0, 0, null)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('moverFoco · arrastrar', () => {
  const IMG_W = 1000;
  const IMG_H = 1000;
  const D_W = 200;
  const D_H = 200;

  it('arrastrar a la derecha corre el foco a la izquierda', () => {
    const e = moverFoco({ zoom: 2, x: 0.5, y: 0.5 }, 20, 0, IMG_W, IMG_H, D_W, D_H);
    expect(e.x).toBeLessThan(0.5);
    expect(e.y).toBe(0.5);
  });

  it('arrastrar hacia abajo corre el foco hacia arriba', () => {
    const e = moverFoco({ zoom: 2, x: 0.5, y: 0.5 }, 0, 20, IMG_W, IMG_H, D_W, D_H);
    expect(e.y).toBeLessThan(0.5);
  });

  it('con más zoom, el mismo gesto mueve MENOS: se ve menos foto', () => {
    const poco = moverFoco({ zoom: 1.5, x: 0.5, y: 0.5 }, 30, 0, IMG_W, IMG_H, D_W, D_H);
    const mucho = moverFoco({ zoom: 4, x: 0.5, y: 0.5 }, 30, 0, IMG_W, IMG_H, D_W, D_H);
    expect(0.5 - mucho.x).toBeLessThan(0.5 - poco.x);
  });

  it('no se puede arrastrar más allá del borde', () => {
    const e = moverFoco({ zoom: 2, x: 0.5, y: 0.5 }, 99999, 99999, IMG_W, IMG_H, D_W, D_H);
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
  });

  it('no moverse no cambia nada', () => {
    const inicial = { zoom: 2, x: 0.4, y: 0.6 };
    expect(moverFoco(inicial, 0, 0, IMG_W, IMG_H, D_W, D_H)).toEqual(inicial);
  });

  it('una imagen sin tamaño devuelve el encuadre tal cual', () => {
    const inicial = { zoom: 2, x: 0.4, y: 0.6 };
    expect(moverFoco(inicial, 10, 10, 0, 0, D_W, D_H)).toEqual(inicial);
  });
});

describe('esNeutro · para no guardar un dato que no dice nada', () => {
  it('el de siempre es neutro', () => {
    expect(esNeutro(ENCUADRE_NEUTRO)).toBe(true);
  });
  it('cualquier ajuste deja de serlo', () => {
    expect(esNeutro({ zoom: 1.2, x: 0.5, y: 0.5 })).toBe(false);
    expect(esNeutro({ zoom: 1, x: 0.4, y: 0.5 })).toBe(false);
    expect(esNeutro({ zoom: 1, x: 0.5, y: 0.7 })).toBe(false);
  });
});
