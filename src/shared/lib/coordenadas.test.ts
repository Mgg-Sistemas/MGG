import { describe, expect, it } from 'vitest';
import { decodificarPlus, leerCoordenadas } from './coordenadas';

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

describe('códigos Plus de Google (04-11-2026)', () => {
  it('completa el código corto con Ciudad Guayana', () => {
    const p = decodificarPlus('77V8+J6F')!;
    expect(p.lat).toBeCloseTo(8.2939, 3);
    expect(p.lng).toBeCloseTo(-62.7344, 3);
  });
  it('lee el código al inicio de la dirección que copia Google', () => {
    const p = leerCoordenadas('77V8+J6F, CARRERA NEKUIMA ENTRE CALLE CAURA Y CALLE CUCHIVERO, CIUDAD GUAYANA 8050, BOLÍVAR, VENEZUELA')!;
    expect(p.lat).toBeCloseTo(8.2939, 3);
  });
  it('decodifica el código completo', () => {
    const p = decodificarPlus('67WV77V8+J6F')!;
    expect(p.lat).toBeCloseTo(8.2939, 3);
    expect(p.lng).toBeCloseTo(-62.7344, 3);
  });
  it('una dirección sin código ni coordenadas no se adivina', () => {
    expect(leerCoordenadas('CENTRO COMERCIAL CIUDAD ALTA VISTA 1, PISO 2')).toBeNull();
  });
});
