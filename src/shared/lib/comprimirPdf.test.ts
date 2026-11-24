import { describe, it, expect } from 'vitest';
import {
  convieneOptimizarPdf,
  comprimirPdf,
  UMBRAL_BYTES_PDF,
  MAX_TAMANO_PDF_BYTES,
} from './comprimirPdf';

describe('comprimirPdf', () => {
  it('convieneOptimizarPdf detecta correctamente PDFs que superan el umbral de 2.5 MB', () => {
    // Archivo liviano (1 MB) -> no conviene
    expect(convieneOptimizarPdf('application/pdf', 1024 * 1024, 'documento.pdf')).toBe(false);

    // Archivo de 2.4 MB -> no conviene
    expect(convieneOptimizarPdf('application/pdf', 2.4 * 1024 * 1024, 'acta.pdf')).toBe(false);

    // Archivo de 25 MB -> sí conviene
    expect(convieneOptimizarPdf('application/pdf', 25 * 1024 * 1024, 'rupdae.pdf')).toBe(true);

    // Archivo de 50 MB con extensión sin tipo MIME explícito -> sí conviene
    expect(convieneOptimizarPdf('', 50 * 1024 * 1024, 'expediente_legal.PDF')).toBe(true);

    // Imagen u otro tipo -> no corresponde a optimizador PDF
    expect(convieneOptimizarPdf('image/png', 30 * 1024 * 1024, 'foto.png')).toBe(false);
  });

  it('devuelve el archivo intacto en entorno Node/test o si no amerita compresión', async () => {
    const fakeFile = {
      name: 'rupdae_pesado.pdf',
      type: 'application/pdf',
      size: 40 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(100),
    } as unknown as File;

    const res = await comprimirPdf(fakeFile);
    expect(res).toBe(fakeFile);
  });

  it('exporta constantes coherentes de umbral y tope máximo', () => {
    expect(UMBRAL_BYTES_PDF).toBe(2.5 * 1024 * 1024);
    expect(MAX_TAMANO_PDF_BYTES).toBeGreaterThanOrEqual(150 * 1024 * 1024);
  });
});
