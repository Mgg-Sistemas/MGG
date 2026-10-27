import { describe, it, expect } from 'vitest';
import { avisoDeEquipo, textoAviso, tonoAviso } from './avisoEquipo';
import { FRECUENCIA_HRS_DEFAULT } from './flota';

describe('avisoDeEquipo (regla única del catálogo)', () => {
  it('sin frecuencia cargada usa la de la empresa (250 h) y avisa vencido al pasarla desde la base', () => {
    const r = avisoDeEquipo({ mantenimiento_cada_hrs: null, mantenimiento_base_hrs: 1000 }, { horometro: 1260, kilometraje: null });
    expect(r.frecuenciaH).toBe(FRECUENCIA_HRS_DEFAULT);
    expect(r.avisoK).toBeNull();
    expect(r.aviso?.nivel).toBe('vencido');
    expect(r.aviso?.restante).toBe(-10);
    expect(r.aviso?.unidad).toBe('h');
  });

  it('sin lectura no hay aviso (ni OK ni alerta)', () => {
    expect(avisoDeEquipo({ mantenimiento_cada_hrs: 250 }, null).aviso).toBeNull();
    expect(avisoDeEquipo({ mantenimiento_cada_hrs: 250 }, { horometro: null, kilometraje: null }).aviso).toBeNull();
  });

  it('entre horas y km manda el más urgente', () => {
    const r = avisoDeEquipo(
      { mantenimiento_cada_hrs: 250, mantenimiento_base_hrs: 1000, mantenimiento_cada_km: 5000, mantenimiento_base_km: 10000 },
      { horometro: 1100, kilometraje: 14800 }, // horas OK (faltan 150), km próximo (faltan 200 ≤ 10 %)
    );
    expect(r.avisoH?.nivel).toBe('ok');
    expect(r.avisoK?.nivel).toBe('proximo');
    expect(r.aviso?.unidad).toBe('km');
  });

  it('texto y color iguales a los del catálogo', () => {
    const ok = avisoDeEquipo({ mantenimiento_cada_hrs: 250, mantenimiento_base_hrs: 0 }, { horometro: 100, kilometraje: null }).aviso;
    const prox = avisoDeEquipo({ mantenimiento_cada_hrs: 250, mantenimiento_base_hrs: 0 }, { horometro: 238, kilometraje: null }).aviso;
    const venc = avisoDeEquipo({ mantenimiento_cada_hrs: 250, mantenimiento_base_hrs: 0 }, { horometro: 305, kilometraje: null }).aviso;
    expect([textoAviso(ok), tonoAviso(ok)]).toEqual(['OK', 'success']);
    expect(textoAviso(prox)).toBe('Próximo · faltan 12 h');
    expect(tonoAviso(prox)).toBe('warning');
    expect(textoAviso(venc)).toBe('Vencido · pasado por 55 h');
    expect(tonoAviso(venc)).toBe('danger');
    expect([textoAviso(null), tonoAviso(null)]).toEqual(['Sin lectura', 'retired']);
  });
});
