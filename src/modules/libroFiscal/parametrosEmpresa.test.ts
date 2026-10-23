import { describe, expect, it } from 'vitest';
import { faltaEnPctConcepto, faltaEnValoresSinR3, rifEmpresaParaGuardar } from './parametrosEmpresa';
import { rifValido } from '@/shared/lib/rif';

// Datos inventados: un RIF que pasa el dígito verificador.
const RIF = (() => { for (let d = 0; d <= 9; d += 1) if (rifValido(`J-00000001-${d}`)) return `J-00000001-${d}`; throw new Error('sin RIF'); })();

describe('RIF de la empresa antes de guardar (D41, Lote 2)', () => {
  it('se guarda con guiones; sin el dígito verificador, se completa', () => {
    expect(rifEmpresaParaGuardar(RIF.replace(/-/g, '').toLowerCase())).toEqual({ rif: RIF, error: null });
    expect(rifEmpresaParaGuardar('J-00000001')).toEqual({ rif: RIF, error: null });
  });
  it('un RIF sin arreglo bloquea y dice cuál', () => {
    expect(rifEmpresaParaGuardar('S/R').error).toMatch(/«S\/R» no es válido/);
    expect(rifEmpresaParaGuardar('X-123').error).toMatch(/no es válido/);
  });
  it('vacío no bloquea', () => {
    expect(rifEmpresaParaGuardar('  ')).toEqual({ rif: '', error: null });
  });
});

describe('valores sin R3 y % de concepto: con su rango', () => {
  const ok = { valorUt: 43, pctIgtf: 3, municipal: 1.5, estadal: 0.1 };
  it('todo en rango', () => { expect(faltaEnValoresSinR3(ok)).toBeNull(); });
  it('UT > 0; % de 0 a 100', () => {
    expect(faltaEnValoresSinR3({ ...ok, valorUt: 0 })).toMatch(/UT/);
    expect(faltaEnValoresSinR3({ ...ok, pctIgtf: 101 })).toMatch(/IGTF/);
    expect(faltaEnValoresSinR3({ ...ok, municipal: -1 })).toMatch(/municipal/);
    expect(faltaEnValoresSinR3({ ...ok, estadal: 150 })).toMatch(/estadal/);
  });
  it('% de concepto del ISLR', () => {
    expect(faltaEnPctConcepto(3)).toBeNull();
    expect(faltaEnPctConcepto(150)).toMatch(/0 a 100/);
  });
});
