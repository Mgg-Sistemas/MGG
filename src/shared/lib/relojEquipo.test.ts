import { describe, expect, it } from 'vitest';
import { DESFASE_AVISO_MS, desfaseDesdeEncabezado, textoDesfase } from './relojEquipo';

describe('hora del equipo (05-11-2026)', () => {
  const srv = 'Thu, 05 Nov 2026 15:45:48 GMT';
  const t = Date.parse(srv);
  it('mide el desfase con el punto medio del viaje', () => {
    expect(desfaseDesdeEncabezado(srv, t - 100, t + 100)).toBe(0);
    expect(desfaseDesdeEncabezado(srv, t + 2 * 3600e3, t + 2 * 3600e3)).toBe(2 * 3600e3);
    expect(desfaseDesdeEncabezado('', t, t)).toBeNull();
  });
  it('lo dice en palabras', () => {
    expect(textoDesfase(2 * 3600e3 + 5 * 60e3)).toBe('adelantada 2 h 5 min');
    expect(textoDesfase(-12 * 60e3)).toBe('atrasada 12 min');
    expect(DESFASE_AVISO_MS).toBe(180000);
  });
});
