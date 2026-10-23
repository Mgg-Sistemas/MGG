import { describe, expect, it } from 'vitest';
import { sujetoDesdePersona, sugerirSujetoPorRif, labelResidencia } from './residenciaSujeto';

describe('sujetoDesdePersona', () => {
  it('natural residente → pn_residente', () => {
    expect(sujetoDesdePersona('natural', 'residente')).toBe('pn_residente');
  });

  it('natural no residente → pn_no_residente', () => {
    expect(sujetoDesdePersona('natural', 'no_residente')).toBe('pn_no_residente');
  });

  it('juridica residente → pj_domiciliada', () => {
    expect(sujetoDesdePersona('juridica', 'residente')).toBe('pj_domiciliada');
  });

  it('juridica no residente → pj_no_domiciliada', () => {
    expect(sujetoDesdePersona('juridica', 'no_residente')).toBe('pj_no_domiciliada');
  });
});

describe('sugerirSujetoPorRif', () => {
  it('J → juridica domiciliada con confianza alta', () => {
    const r = sugerirSujetoPorRif('J-12345678-9');
    expect(r).not.toBeNull();
    expect(r!.sujeto).toBe('pj_domiciliada');
    expect(r!.confianza).toBe('alta');
  });

  it('V → natural residente con confianza alta', () => {
    const r = sugerirSujetoPorRif('V-12345678');
    expect(r).not.toBeNull();
    expect(r!.sujeto).toBe('pn_residente');
    expect(r!.confianza).toBe('alta');
  });

  it('E → natural no residente con confianza media', () => {
    const r = sugerirSujetoPorRif('E-87654321');
    expect(r).not.toBeNull();
    expect(r!.sujeto).toBe('pn_no_residente');
    expect(r!.confianza).toBe('media');
  });

  it('G → juridica domiciliada (gobierno)', () => {
    const r = sugerirSujetoPorRif('G-20000001-0');
    expect(r).not.toBeNull();
    expect(r!.sujeto).toBe('pj_domiciliada');
  });

  it('null → null', () => {
    expect(sugerirSujetoPorRif(null)).toBeNull();
  });

  it('vacío → null', () => {
    expect(sugerirSujetoPorRif('')).toBeNull();
  });

  it('letra desconocida → null', () => {
    expect(sugerirSujetoPorRif('X-123')).toBeNull();
  });
});

describe('labelResidencia', () => {
  it('natural residente → Residente', () => {
    expect(labelResidencia('residente', 'natural')).toBe('Residente');
  });

  it('juridica residente → Domiciliada', () => {
    expect(labelResidencia('residente', 'juridica')).toBe('Domiciliada');
  });
});
