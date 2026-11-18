import { describe, expect, it, vi } from 'vitest';
import { buscarDireccion, coordsTxt, parsearCoordenadas, parsearNominatim, puedeConsultar, puntoValido, urlNominatim } from './ubicacionProveedor';

describe('Proveedores · ubicación en el mapa', () => {
  it('punto válido: números en rango y distinto de 0,0', () => {
    expect(puntoValido(8.28, -62.74)).toEqual({ lat: 8.28, lng: -62.74 });
    expect(puntoValido('8.28', '-62.74')).toEqual({ lat: 8.28, lng: -62.74 });
    expect(puntoValido(null, -62)).toBeNull();
    expect(puntoValido('', '')).toBeNull();
    expect(puntoValido(0, 0)).toBeNull();
    expect(puntoValido(91, 0)).toBeNull();
    expect(puntoValido(8, 181)).toBeNull();
    expect(puntoValido(Number.NaN, 1)).toBeNull();
  });

  it('coordenadas pegadas o enlace de Google Maps', () => {
    expect(parsearCoordenadas('8.2869, -62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(parsearCoordenadas('8.2869 -62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(parsearCoordenadas('https://www.google.com/maps/place/X/@8.2869,-62.7467,17z')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(parsearCoordenadas('https://maps.google.com/?q=8.2869,-62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(parsearCoordenadas('https://www.google.com/maps/place/data=!3d8.2869!4d-62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
    expect(parsearCoordenadas('Av. Las Américas, Puerto Ordaz')).toBeNull();
    expect(parsearCoordenadas('')).toBeNull();
    expect(parsearCoordenadas('120, 50')).toBeNull();
  });

  it('coordsTxt a 6 decimales', () => {
    expect(coordsTxt({ lat: 8.2869, lng: -62.7467 })).toBe('8.286900, -62.746700');
  });

  it('URL de Nominatim: Venezuela, español, 5 resultados y correo de contacto', () => {
    expect(urlNominatim('ab')).toBeNull();
    const u = new URL(urlNominatim('  Alta Vista, Puerto Ordaz ', 'info@x.com') as string);
    expect(u.origin + u.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(u.searchParams.get('q')).toBe('Alta Vista, Puerto Ordaz');
    expect(u.searchParams.get('countrycodes')).toBe('ve');
    expect(u.searchParams.get('limit')).toBe('5');
    expect(u.searchParams.get('format')).toBe('jsonv2');
    expect(u.searchParams.get('accept-language')).toBe('es');
    expect(u.searchParams.get('email')).toBe('info@x.com');
    expect(new URL(urlNominatim('Alta Vista') as string).searchParams.get('email')).toBeNull();
  });

  it('lee los resultados de Nominatim', () => {
    expect(parsearNominatim(null)).toEqual([]);
    expect(parsearNominatim([
      { lat: '8.29', lon: '-62.75', display_name: 'Alta Vista, Puerto Ordaz' },
      { lat: 'x', lon: '-62' },
      { lat: '8.3', lon: '-62.7' },
    ])).toEqual([
      { nombre: 'Alta Vista, Puerto Ordaz', lat: 8.29, lng: -62.75 },
      { nombre: '8.300000, -62.700000', lat: 8.3, lng: -62.7 },
    ]);
  });

  it('una consulta por segundo como máximo', () => {
    expect(puedeConsultar(null, 5)).toBe(true);
    expect(puedeConsultar(1000, 1500)).toBe(false);
    expect(puedeConsultar(1000, 2200)).toBe(true);
  });

  it('coordenadas pegadas no salen a internet', async () => {
    const f = vi.fn();
    const r = await buscarDireccion('8.2869, -62.7467', null, f as unknown as typeof fetch);
    expect(f).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ lat: 8.2869, lng: -62.7467 });
    await expect(buscarDireccion('ab', null, f as unknown as typeof fetch)).rejects.toThrow(/al menos 3 letras/);
  });
});

describe('Plus Codes de Google Maps (04/11/2026)', () => {
  it('el código corto con la ciudad, el completo y lo que no es código', async () => {
    const { parsearCoordenadas, decodificarPlusCode } = await import('./ubicacionProveedor');
    const corto = parsearCoordenadas('76MV+CR Ciudad Guayana, Bolívar, Venezuela');
    const completo = parsearCoordenadas('67WV76MV+CR');
    expect(corto).not.toBeNull();
    expect(completo).not.toBeNull();
    expect(Math.abs(corto!.lat - completo!.lat)).toBeLessThan(1e-9);
    expect(Math.abs(corto!.lng - completo!.lng)).toBeLessThan(1e-9);
    expect(corto!.lat).toBeGreaterThan(8.2); expect(corto!.lat).toBeLessThan(8.4);
    expect(corto!.lng).toBeGreaterThan(-62.85); expect(corto!.lng).toBeLessThan(-62.6);
    console.log('PLUS', JSON.stringify(corto));
    expect(decodificarPlusCode('PUERTO ORDAZ, REDOMA DE LA PIÑA')).toBeNull();
    expect(parsearCoordenadas('8.2869, -62.7467')).toEqual({ lat: 8.2869, lng: -62.7467 });
  });
});
