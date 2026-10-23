import { describe, expect, it } from 'vitest';
import type { PeriodoRetencion } from '../datos/periodos';
import { leerUmbrales, UMBRALES_DEFECTO, type AvisoVencimiento } from '../datos/vencimientos';
import { resumenVencimientos, textoVence, vencimientos } from './modeloVencimientos';

const HOY = '2026-10-20';
const per = (x: Partial<PeriodoRetencion>): PeriodoRetencion => ({
  id: 'p', tipo: 'iva', periodo: '202609', tramo: 2, desde: '2026-09-16', hasta: '2026-09-30', vence: '2026-10-08', estado: 'vencido',
  diasParaVencer: null, declara: 'mgg', declaradoEn: null, declaradoPor: null, declaradoRegistradoEn: null, planilla: null,
  numeroDeclaracion: null, montoEnterado: null, observacion: null, reabiertoPor: null, reabiertoEn: null, reabiertoMotivo: null,
  retencionesVigentes: 3, retenidoBs: 100, retenidoUsd: 0, ...x,
});
const av = (x: Partial<AvisoVencimiento>): AvisoVencimiento => ({ aviso: 'licencia_proveedor', proveedorId: 'p1', nombre: 'Alfa', rif: 'J-000000001', detalle: 'L-1', vence: '2026-11-01', ...x });

describe('los vencimientos', () => {
  it('lee los umbrales del interruptor, con los de la maqueta si faltan', () => {
    expect(leerUmbrales({ declaraciones: [5], licencias: [45, 10], actividades_hasta: [15] })).toEqual({ declaraciones: 5, licencias: 45, licenciasPronto: 10, actividades: 15 });
    expect(leerUmbrales(null)).toEqual(UMBRALES_DEFECTO);
    expect(leerUmbrales({ declaraciones: ['x'] }).declaraciones).toBe(7);
  });

  it('agrupa licencias, declaraciones y actividades, los más próximos primero', () => {
    const xs = vencimientos(
      [per({})],
      [av({}), av({ aviso: 'licencia_empresa', proveedorId: null, nombre: 'Empresa', vence: '2027-03-01' }),
        av({ aviso: 'actividad_proveedor', detalle: '2105', vence: '2026-10-25' }), av({ aviso: 'actividad_proveedor', vence: '2026-08-01' })],
      ['iva'], HOY, UMBRALES_DEFECTO);
    expect(xs.map((x) => x.grupo)).toEqual(['vencido', 'por_vencer', 'por_vencer', 'al_dia']);
    expect(xs[0].que).toBe('Declaración de IVA · 2.ª quincena de septiembre de 2026');
    expect(xs[1]).toMatchObject({ que: 'Actividad 2105 de Alfa', pronto: true });
    expect(xs[2].que).toBe('Licencia de Alfa (L-1)');
    expect(xs[3].ficha).toEqual({ tipo: 'empresa' });
    expect(resumenVencimientos(xs)).toEqual({ vencido: 1, porVencer: 2 });
  });

  it('dice cuándo vence', () => {
    expect(textoVence({ fecha: '2026-10-18', dias: -2 })).toBe('Venció el 18/10/2026 (hace 2 días)');
    expect(textoVence({ fecha: '2026-10-20', dias: 0 })).toBe('Vence hoy (20/10/2026)');
    expect(textoVence({ fecha: '2026-10-25', dias: 5 })).toBe('Vence el 25/10/2026 (en 5 días)');
  });
});
