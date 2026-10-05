import { describe, expect, it } from 'vitest';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from './pdfMargen';

describe('margen único de los PDF: 2 cm por lado', () => {
  it('2 cm son 56,69 pt', () => {
    expect(MARGEN_PDF).toBeCloseTo(56.69, 2);
  });
  it('la tabla lleva los cuatro márgenes iguales', () => {
    expect(MARGENES_TABLA_PDF).toEqual({ top: MARGEN_PDF, right: MARGEN_PDF, bottom: MARGEN_PDF, left: MARGEN_PDF });
  });
  it('carta vertical: ancho útil y última línea', () => {
    expect(anchoUtilPdf(612)).toBeCloseTo(498.61, 1);
    expect(limiteInferiorPdf(792)).toBeCloseTo(735.31, 1);
  });
});
