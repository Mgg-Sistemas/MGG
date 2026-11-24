import { describe, it, expect } from 'vitest';
import { faltaEnEmpresa, type EmpresaReceptoraInput } from './empresasReceptoras.repository';

const base: EmpresaReceptoraInput = {
  nombre: 'Minería Tin Oxide, C.A.', rif: 'V-12345678-1', colorBadge: '#000', activo: true,
  pctIvaGeneral: 75, pctIvaEspecial: 100, pctIgtf: 3, ivaAlicuota: 16,
};

describe('faltaEnEmpresa · validación de la config fiscal por empresa', () => {
  it('una ficha fiscal correcta se puede guardar', () => {
    expect(faltaEnEmpresa(base)).toBeNull();
  });

  it('el % de IVA va de 0 a 100', () => {
    expect(faltaEnEmpresa({ ...base, pctIvaGeneral: 120 })).toMatch(/0 a 100/);
    expect(faltaEnEmpresa({ ...base, pctIvaEspecial: 120 })).toMatch(/0 a 100/);
    expect(faltaEnEmpresa({ ...base, pctIvaGeneral: 100 })).toBeNull();
  });

  it('las alícuotas van de 0 a 100', () => {
    expect(faltaEnEmpresa({ ...base, pctIgtf: 150 })).toContain('IGTF');
    expect(faltaEnEmpresa({ ...base, ivaAlicuota: -1 })).toContain('general del IVA');
    expect(faltaEnEmpresa({ ...base, alicuotaMunicipal: 200 })).toContain('ISAE');
  });

  it('la alícuota del ISAE puede quedar vacía (usa la global)', () => {
    expect(faltaEnEmpresa({ ...base, alicuotaMunicipal: undefined })).toBeNull();
  });
});
