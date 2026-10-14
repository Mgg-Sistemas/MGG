import { describe, it, expect } from 'vitest';
import { INTERVALO_ESCANEO_MS, tocaEscanear } from './escaneoStock';

describe('cuándo toca escanear el stock (14-10-2026)', () => {
  const ahora = 1_800_000_000_000;
  it('sin marca, o con una marca rota, toca', () => {
    expect(tocaEscanear(null, ahora)).toBe(true);
    expect(tocaEscanear('', ahora)).toBe(true);
    expect(tocaEscanear('ayer', ahora)).toBe(true);
    expect(tocaEscanear('0', ahora)).toBe(true);
  });
  it('dentro de los 30 minutos no toca; cumplidos, sí', () => {
    expect(tocaEscanear(String(ahora - 5 * 60_000), ahora)).toBe(false);
    expect(tocaEscanear(String(ahora - INTERVALO_ESCANEO_MS + 1), ahora)).toBe(false);
    expect(tocaEscanear(String(ahora - INTERVALO_ESCANEO_MS), ahora)).toBe(true);
    expect(tocaEscanear(String(ahora - 3 * 60 * 60_000), ahora)).toBe(true);
  });
  it('una marca en el futuro (reloj cambiado) no bloquea', () => {
    expect(tocaEscanear(String(ahora + 60_000), ahora)).toBe(true);
  });
});
