import { describe, expect, it } from 'vitest';
import { textoNumeroComprobante } from './numeroComprobante';

describe('el bloque «N° de comprobante» del registro (maqueta, r-v6)', () => {
  it('IVA: lo asigna la base al registrar, el siguiente de la serie con el prefijo del período', () => {
    expect(textoNumeroComprobante('iva', '202610')).toBe('Se asigna al registrar: el siguiente de la serie de IVA, 202610 + 8 dígitos.');
  });

  it('IVA sin fecha todavía: lo dice sin prefijo', () => {
    expect(textoNumeroComprobante('iva', '')).toBe('Se asigna al registrar: el siguiente de la serie de IVA (AAAAMM + 8 dígitos).');
  });

  it('ISLR e ISAE: sin serie propia hoy, la retención queda sin número', () => {
    expect(textoNumeroComprobante('islr', '202610')).toBe('Sin número: la serie de ISLR todavía no está en MGG.');
    expect(textoNumeroComprobante('municipal', '202610')).toBe('Sin número: la serie de ISAE todavía no está en MGG.');
  });
});
