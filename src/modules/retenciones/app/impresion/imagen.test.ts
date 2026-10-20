import { describe, expect, it } from 'vitest';
import { nombreImagenComprobante, nombreImagenRelacion, nombresImagenes } from './imagen';

describe('los nombres de las imágenes (PNG) de las hojas', () => {
  it('el comprobante: comprobante-<IMP>-<numero>.png', () => {
    expect(nombreImagenComprobante('iva', '20260900000011')).toBe('comprobante-IVA-20260900000011');
    expect(nombreImagenComprobante('isae', '')).toBe('comprobante-ISAE-sin-numero');
  });
  it('la relación: relacion-<IMP>-<AAAAMM del desde>', () => {
    expect(nombreImagenRelacion('iva', '2026-09-01')).toBe('relacion-IVA-202609');
  });
  it('una imagen: el nombre tal cual; varias: una por hoja de columnas', () => {
    expect(nombresImagenes('comprobante-IVA-1', 1)).toEqual(['comprobante-IVA-1.png']);
    expect(nombresImagenes('relacion-IVA-202609', 2)).toEqual(['relacion-IVA-202609-hoja-1.png', 'relacion-IVA-202609-hoja-2.png']);
  });
});
