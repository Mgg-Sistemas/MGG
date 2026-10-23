import { describe, it, expect } from 'vitest';
import { MOTIVOS_IVA_CIEN_LISTA } from './SupuestosIvaAcordeon';

describe('SupuestosIvaAcordeon constantes y opciones', () => {
  it('contiene la lista completa de supuestos del art. 5 de la Providencia 0049', () => {
    expect(MOTIVOS_IVA_CIEN_LISTA).toHaveLength(5);
    const codigos = MOTIVOS_IVA_CIEN_LISTA.map(([k]) => k);
    expect(codigos).toContain('ivaNoDiscriminado');
    expect(codigos).toContain('facturaNoCumple');
    expect(codigos).toContain('proveedorNoInscrito');
    expect(codigos).toContain('proveedorNoDomiciliado');
    expect(codigos).toContain('metalesPreciosos');
  });

  it('los textos son descriptivos y claros para el usuario fiscal', () => {
    const textos = MOTIVOS_IVA_CIEN_LISTA.map(([_, txt]) => txt);
    expect(textos.some((t) => t.includes('IVA no está discriminado'))).toBe(true);
    expect(textos.some((t) => t.includes('requisitos de facturación'))).toBe(true);
    expect(textos.some((t) => t.includes('Portal Fiscal'))).toBe(true);
  });
});
