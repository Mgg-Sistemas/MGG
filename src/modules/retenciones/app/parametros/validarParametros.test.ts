import { describe, expect, it } from 'vitest';
import { hayErrores, validarConcepto, validarEmpresa, validarRegimen, type FormConcepto } from './validarParametros';

// Datos inventados.
describe('los campos de la empresa', () => {
  const ok = { razonSocial: 'Empresa de Prueba C.A.', rif: 'J-12345678-4', direccionFiscal: 'Calle 1', municipio: 'Caroní', estado: 'Bolívar' };

  it('completos y bien formados, sin errores', () => {
    expect(hayErrores(validarEmpresa(ok))).toBe(false);
  });

  it('sin razón social o con un RIF mal formado, el error es de la empresa', () => {
    const e = validarEmpresa({ ...ok, razonSocial: '  ', rif: 'X-1' });
    expect(e.razonSocial).toBe('Indique la razón social.');
    expect(e.rif).toContain('de la empresa');
    expect(validarEmpresa({ ...ok, rif: '' }).rif).toBe('Indique el RIF de la empresa.');
  });
});

describe('el régimen y los valores compartidos', () => {
  const ok = { pctIvaGeneral: '75', pctIvaEspecial: '100', valorUt: '43', pctIgtf: '3' };

  it('valores normales, sin errores; acepta la coma decimal', () => {
    expect(hayErrores(validarRegimen({ ...ok, valorUt: '43,50' }))).toBe(false);
  });

  it('la UT en 0 no se acepta: dejaría al ISLR sin mínimo ni sustraendo', () => {
    expect(validarRegimen({ ...ok, valorUt: '0' }).valorUt).toContain('mayor que 0');
  });

  it('un % fuera de 0–100 o con letras, no', () => {
    expect(validarRegimen({ ...ok, pctIvaGeneral: '120' }).pctIvaGeneral).toContain('no puede pasar de 100');
    expect(validarRegimen({ ...ok, pctIgtf: 'tres' }).pctIgtf).toContain('solo números');
    // El IGTF, entre el 2 % y el 8 %, como dice la ley.
    expect(validarRegimen({ ...ok, pctIgtf: '1' }).pctIgtf).toContain('mayor o igual a 2');
    expect(validarRegimen({ ...ok, pctIgtf: '9' }).pctIgtf).toContain('no puede pasar de 8');
  });
});

describe('un concepto del catálogo', () => {
  const ok: FormConcepto = { codigo: '001', nombre: 'Honorarios (ejemplo)', sujeto: 'pn_residente', porcentaje: '3', basePct: '100', baseMinimaUt: '83,3334', aplicaSustraendo: true, fundamento: '', orden: '1' };

  it('completo, sin errores', () => {
    expect(hayErrores(validarConcepto(ok))).toBe(false);
  });

  it('un % en 0 no se acepta: la retención daría 0 sin decirlo', () => {
    expect(validarConcepto({ ...ok, porcentaje: '0' }).porcentaje).toContain('mayor que 0');
  });

  it('sin nombre, con un código largo o un orden con decimales, dice cuál', () => {
    const e = validarConcepto({ ...ok, nombre: '', codigo: '12345678901', orden: '1,5' });
    expect(e.nombre).toBe('Indique el nombre del concepto.');
    expect(e.codigo).toContain('10 caracteres');
    expect(e.orden).toContain('entero');
  });
});
