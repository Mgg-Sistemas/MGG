/* El conversor $ ↔ Real brasileño de la nómina y la matemática de las tasas del Real. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/shared/lib/pdfLogo', () => ({ loadLogoDataUrl: () => Promise.resolve(null) }));

import { aDolaresDesdeReal, aReal, round4 } from '@/modules/tesoreria/tasas.repository';
import { convertirReal } from './ConversorReal';
import { reales, tasaRealTexto } from './nominaReciboPdf';

describe('Real brasileño', () => {
  it('20 $ a 5,0428 son R$ 100,86, y a la inversa', () => {
    expect(aReal(20, 5.0428)).toBe(100.86);
    expect(aDolaresDesdeReal(100.86, 5.0428)).toBe(20);
    expect(aDolaresDesdeReal(3000, 5)).toBe(600);
  });
  it('sin tasa no inventa montos', () => {
    expect(aReal(20, 0)).toBe(0);
    expect(aDolaresDesdeReal(100, 0)).toBe(0);
  });
  it('la tasa del Real lleva 4 decimales (con 2 se perdería más del 1 %)', () => {
    expect(round4(5.04276)).toBe(5.0428);
    expect(round4(5.0428)).toBe(5.0428);
    // 1.000 $ con la tasa a 4 decimales vs. redondeada a 2: 5,0428 → R$ 5.042,80 ; 5,04 → R$ 5.040,00
    expect(aReal(1000, round4(5.0428))).toBe(5042.8);
  });
  it('convertirReal: monto · dirección · tasa, o null si falta algo', () => {
    expect(convertirReal(20, 5.0428, 'usd_a_brl')).toBe(100.86);
    expect(convertirReal(100.86, 5.0428, 'brl_a_usd')).toBe(20);
    expect(convertirReal(0, 5.0428, 'usd_a_brl')).toBeNull();
    expect(convertirReal(20, 0, 'usd_a_brl')).toBeNull();
  });
  it('los textos: R$ con coma decimal y la tasa con sus decimales', () => {
    expect(reales(1488.7)).toBe('R$ 1.488,70');
    expect(reales(null)).toBe('R$ 0,00');
    expect(tasaRealTexto(5.0428)).toBe('5,0428');
    expect(tasaRealTexto(5)).toBe('5,00');
  });
});
