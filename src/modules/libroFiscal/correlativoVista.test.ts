import { describe, expect, it } from 'vitest';
import { vistaCorrelativoCero } from './correlativoVista';
import type { CorrelativoEstimado } from './retencionesFiscal.repository';

const estimado = { numero: 7, comprobante: '20261100000007', formato: 'iva', explicacion: 'IVA · 2026-11' } as unknown as CorrelativoEstimado;

describe('vistaCorrelativoCero', () => {
  it('explica que no se consume serie y muestra el siguiente estimado', () => {
    const vista = vistaCorrelativoCero(estimado);
    expect(vista.valor).toContain('Sin comprobante');
    expect(vista.valor).toContain('20261100000007');
    expect(vista.valor).toContain('(#7)');
    expect(vista.titulo).toContain('no se consume la serie');
    expect(vista.hint).toContain('aunque el % sea mayor');
    expect(vista.hint).toContain('estimado');
  });

  it('no inventa un número cuando aún no se pudo calcular', () => {
    const vista = vistaCorrelativoCero(null);
    expect(vista.valor).toContain('Calculando');
    expect(vista.valor).not.toContain('#1');
  });
});
