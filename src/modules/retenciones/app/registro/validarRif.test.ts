import { describe, expect, it } from 'vitest';
import { digitoVerificador, revisarRif } from './validarRif';

// RIF inventados. El verificador se calcula a mano con la regla del módulo 11:
// J-12345678 → 3·4 + 1·3 + 2·2 + 3·7 + 4·6 + 5·5 + 6·4 + 7·3 + 8·2 = 12+3+4+21+24+25+24+21+16 = 150;
// 150 % 11 = 7; 11 − 7 = 4 → J-12345678-4.
describe('el RIF de la contraparte', () => {
  it('el verificador sale del módulo 11, con el peso de la letra', () => {
    expect(digitoVerificador('J', '12345678')).toBe(4);
    expect(digitoVerificador('C', '12345678')).toBeNull();
  });

  it('un RIF bien formado y con su verificador pasa limpio, con o sin guiones', () => {
    expect(revisarRif('J-12345678-4')).toEqual({ error: null, aviso: null });
    expect(revisarRif('J123456784')).toEqual({ error: null, aviso: null });
  });

  it('sin RIF, o con una letra inválida, o sin 9 dígitos: no se registra y se dice por qué', () => {
    expect(revisarRif(null).error).toContain('no tiene RIF');
    expect(revisarRif('X-12345678-4').error).toContain('letra que no es válida');
    expect(revisarRif('J-1234567').error).toContain('9 dígitos');
  });

  it('un verificador que no cuadra solo avisa, y dice cuál debería ser', () => {
    const r = revisarRif('J-12345678-0');
    expect(r.error).toBeNull();
    expect(r.aviso).toContain('debería ser 4');
  });

  it('la letra C no tiene peso publicado: pasa sin aviso', () => {
    expect(revisarRif('C-12345678-0')).toEqual({ error: null, aviso: null });
  });
});
