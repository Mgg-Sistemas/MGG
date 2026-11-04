import { describe, expect, it } from 'vitest';
import { leerCoordenadas } from './coordenadas';

describe('leerCoordenadas (03-11-2026)', () => {
  it('lee el par escrito con coma, punto y coma o espacio', () => {
    expect(leerCoordenadas('8.2869, -62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(leerCoordenadas(' 8.2869;-62.7467 ')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(leerCoordenadas('8.2869 -62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
  });
  it('lee enlaces de Google Maps', () => {
    expect(leerCoordenadas('https://www.google.com/maps/place/X/@8.29,-62.75,17z/data=!3d8.2905!4d-62.829')).toEqual({ lat: 8.2905, lng: -62.829 });
    expect(leerCoordenadas('https://www.google.com/maps/@8.29,-62.75,17z')).toEqual({ lat: 8.29, lng: -62.75 });
    expect(leerCoordenadas('https://maps.google.com/?q=8.3,-62.7')).toEqual({ lat: 8.3, lng: -62.7 });
  });
  it('rechaza lo que no es un par válido', () => {
    expect(leerCoordenadas('')).toBeNull();
    expect(leerCoordenadas('Puerto Ordaz')).toBeNull();
    expect(leerCoordenadas('95, 10')).toBeNull();
  });
});
