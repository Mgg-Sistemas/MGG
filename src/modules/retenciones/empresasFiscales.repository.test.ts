import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  EMPRESAS_FISCALES_DEFECTO,
  listEmpresasFiscales,
  getDatosFiscalesEmpresa,
  guardarDatosFiscalesEmpresa,
  crearEmpresaFiscal,
} from './empresasFiscales.repository';
import { supabase } from '@/shared/lib/supabase';

describe('empresasFiscales.repository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('contiene las semillas fiscales de MGG, Golden Touch y MineriaTs', () => {
    const codigos = EMPRESAS_FISCALES_DEFECTO.map((e) => e.codigo);
    expect(codigos).toContain('MGG');
    expect(codigos).toContain('GOLDEN');
    expect(codigos).toContain('MINERIATS');

    const golden = EMPRESAS_FISCALES_DEFECTO.find((e) => e.codigo === 'GOLDEN');
    expect(golden?.rif).toBe('J-50129993-5');
    expect(golden?.razonSocial).toBe('Golden Touch 1127 C.A.');
    expect(golden?.esContribuyenteEspecial).toBe(true);
    expect(golden?.esAgenteRetencionIva).toBe(true);

    const mto = EMPRESAS_FISCALES_DEFECTO.find((e) => e.codigo === 'MINERIATS');
    expect(mto?.rif).toBe('J-41234567-8');
  });

  it('devuelve una estructura por defecto cuando se consulta una empresa desconocida', async () => {
    const emp = await getDatosFiscalesEmpresa('INVERSIONES_SUR');
    expect(emp.codigo).toBe('INVERSIONES_SUR');
    expect(emp.razonSocial).toBe('INVERSIONES_SUR');
    expect(emp.activa).toBe(true);
  });

  it('rechaza guardar empresa sin código o con razón social menor a 3 caracteres', async () => {
    await expect(
      guardarDatosFiscalesEmpresa({
        codigo: '',
        razonSocial: 'Empresa Test C.A.',
        rif: 'J-12345678-0',
        direccionFiscal: null,
        ciudad: null,
        municipio: null,
        estado: null,
        esContribuyenteEspecial: false,
        esAgenteRetencionIva: false,
        pctIvaGeneral: 75,
        pctIvaEspecial: 100,
        activa: true,
      })
    ).rejects.toThrow(/código/i);

    await expect(
      guardarDatosFiscalesEmpresa({
        codigo: 'TEST',
        razonSocial: 'AB',
        rif: 'J-12345678-0',
        direccionFiscal: null,
        ciudad: null,
        municipio: null,
        estado: null,
        esContribuyenteEspecial: false,
        esAgenteRetencionIva: false,
        pctIvaGeneral: 75,
        pctIvaEspecial: 100,
        activa: true,
      })
    ).rejects.toThrow(/razón social/i);
  });

  it('rechaza guardar empresa con RIF inválido para el SENIAT', async () => {
    await expect(
      guardarDatosFiscalesEmpresa({
        codigo: 'TEST',
        razonSocial: 'Empresa Test C.A.',
        rif: 'X-INVALID-RIF',
        direccionFiscal: null,
        ciudad: null,
        municipio: null,
        estado: null,
        esContribuyenteEspecial: false,
        esAgenteRetencionIva: false,
        pctIvaGeneral: 75,
        pctIvaEspecial: 100,
        activa: true,
      })
    ).rejects.toThrow(/no es válido según el formato SENIAT/i);
  });

  it('crearEmpresaFiscal valida el RIF y la razón social', async () => {
    await expect(
      crearEmpresaFiscal({
        codigo: 'MINERA',
        razonSocial: 'Minera',
        rif: 'RIF-FALSO',
      })
    ).rejects.toThrow(/no es válido/i);
  });
});
