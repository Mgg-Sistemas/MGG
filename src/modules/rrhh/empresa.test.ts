import { describe, it, expect } from 'vitest';
import {
  EMPRESA_POR_DEFECTO, MGG, DATOS_EMPRESA_VACIOS,
  definicionEmpresa, normalizarEmpresa, normalizarCodigoEmpresa, registrarEmpresas, empresasRegistradas,
  validarEmpresa, datosEmpresaLimpios, modoSelectorEmpresas, empresaVigente, empresaGuardada,
  destinosDeTransferencia, errorDeshabilitarEmpresa, type DefinicionEmpresa,
} from './empresa';

const MTO: DefinicionEmpresa = { key: 'MTO', label: 'MTO', razonSocial: 'Mantenimiento Oriente C.A.', rif: 'J-123456789', icono: '🔧', color: '#3366ff', orden: 1, activa: true };
const VIEJA: DefinicionEmpresa = { ...MTO, key: 'GOMETAL', label: 'GoMetal', razonSocial: 'GoMetales C.A.', orden: 2, activa: false };

describe('empresas de la nómina (14-10-2026)', () => {
  it('MGG es la de siempre y nunca falta en el registro', () => {
    expect(EMPRESA_POR_DEFECTO).toBe('MGG');
    expect(MGG.razonSocial).toBe('Mineral Group Guayana C.A.');
    expect(MGG.rif).toBe('J-50221930-7');
    registrarEmpresas([MTO]);
    expect(empresasRegistradas().map((e) => e.key)).toEqual(['MGG', 'MTO']);
  });

  it('normaliza el código: mayúsculas, solo letras y números, vacío cae en MGG', () => {
    expect(normalizarCodigoEmpresa(' mto ')).toBe('MTO');
    expect(normalizarCodigoEmpresa('go-metal 2')).toBe('GOMETAL2');
    expect(normalizarEmpresa('mto')).toBe('MTO');
    expect(normalizarEmpresa(null)).toBe('MGG');
    expect(normalizarEmpresa('')).toBe('MGG');
    expect(normalizarEmpresa(123)).toBe('MGG');
  });

  it('definicionEmpresa busca en el registro y no rompe con un código desconocido', () => {
    registrarEmpresas([MGG, MTO, VIEJA]);
    expect(definicionEmpresa('mto').razonSocial).toBe('Mantenimiento Oriente C.A.');
    expect(definicionEmpresa(null).key).toBe('MGG');
    const x = definicionEmpresa('ZZZ');
    expect(x.key).toBe('ZZZ');
    expect(x.razonSocial).toBe('ZZZ');
    // Las deshabilitadas siguen en el registro (sus fichas viejas se leen igual), pero no entre las activas.
    expect(empresasRegistradas().map((e) => e.key)).toEqual(['MGG', 'MTO']);
    expect(empresasRegistradas(false).map((e) => e.key)).toEqual(['MGG', 'MTO', 'GOMETAL']);
  });

  it('valida el alta: código, nombre, razón social, RIF y color; no repite código', () => {
    const base = { ...DATOS_EMPRESA_VACIOS, codigo: 'MTO', nombre: 'MTO', razonSocial: 'Mantenimiento Oriente C.A.' };
    expect(validarEmpresa(base, [MGG])).toBeNull();
    expect(validarEmpresa({ ...base, codigo: 'M' }, [MGG])).toMatch(/código/);
    expect(validarEmpresa(base, [MGG, MTO])).toMatch(/Ya existe/);
    expect(validarEmpresa(base, [MGG, MTO], 'MTO')).toBeNull();
    expect(validarEmpresa({ ...base, nombre: '' }, [MGG])).toMatch(/nombre corto/);
    expect(validarEmpresa({ ...base, razonSocial: 'ab' }, [MGG])).toMatch(/razón social/);
    expect(validarEmpresa({ ...base, rif: 'J-' }, [MGG])).toMatch(/RIF/);
    expect(validarEmpresa({ ...base, color: 'naranja' }, [MGG])).toMatch(/color/);
  });

  it('manda a la base los datos en limpio (código en mayúsculas, RIF normalizado)', () => {
    const x = datosEmpresaLimpios({ codigo: 'mto', nombre: ' MTO ', razonSocial: ' Mantenimiento Oriente C.A. ', rif: 'j 12.345.678-9', icono: '', color: '#FF8A00' });
    expect(x).toEqual({ codigo: 'MTO', nombre: 'MTO', razonSocial: 'Mantenimiento Oriente C.A.', rif: 'J-123456789', icono: '🏢', color: '#ff8a00' });
  });

  it('hasta dos nóminas son pastillas; de tres en adelante, lista buscable', () => {
    expect(modoSelectorEmpresas(1)).toBe('pastillas');
    expect(modoSelectorEmpresas(2)).toBe('pastillas');
    expect(modoSelectorEmpresas(3)).toBe('lista');
    expect(modoSelectorEmpresas(7)).toBe('lista');
  });

  it('la nómina abierta tiene que estar activa; si no, cae en la primera', () => {
    expect(empresaVigente('MTO', [MGG, MTO])).toBe('MTO');
    expect(empresaVigente('GOMETAL', [MGG, MTO])).toBe('MGG');
    expect(empresaVigente('MTO', [])).toBe('MTO');
    expect(empresaGuardada(() => 'mto')).toBe('MTO');
    expect(empresaGuardada(() => null)).toBe('MGG');
  });

  it('transferir: solo a las activas distintas de la suya; deshabilitar: ni MGG ni con gente', () => {
    expect(destinosDeTransferencia('MGG', [MGG, MTO, VIEJA]).map((e) => e.key)).toEqual(['MTO']);
    expect(destinosDeTransferencia('mto', [MGG, MTO]).map((e) => e.key)).toEqual(['MGG']);
    expect(destinosDeTransferencia(null, [MGG, MTO]).map((e) => e.key)).toEqual(['MTO']);
    expect(errorDeshabilitarEmpresa(MGG, 0)).toMatch(/principal/);
    expect(errorDeshabilitarEmpresa(MTO, 3)).toMatch(/3 persona/);
    expect(errorDeshabilitarEmpresa(MTO, 0)).toBeNull();
  });
});
