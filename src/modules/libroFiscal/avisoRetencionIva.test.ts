import { describe, expect, it } from 'vitest';
import { obtenerInfoAvisoIva } from './avisoRetencionIva';

describe('obtenerInfoAvisoIva', () => {
  it('sin motivos marcados aplica alícuota general (75%) y calcula monto sugerido', () => {
    const r = obtenerInfoAvisoIva({ ivaFactura: 160, pctGeneral: 75, moneda: 'Bs' });
    expect(r.porcentaje).toBe(75);
    expect(r.esCien).toBe(false);
    expect(r.montoSugerido).toBe(120);
    expect(r.mensajeDetallado).toContain('75% del IVA facturado');
    expect(r.mensajeDetallado).toContain('120,00');
  });

  it('con motivo de Artículo 5 aplica 100% y muestra el texto legal', () => {
    const r = obtenerInfoAvisoIva({
      ivaFactura: 200,
      pctGeneral: 75,
      pctEspecial: 100,
      motivos: { proveedorNoInscrito: true },
      moneda: 'USD',
    });
    expect(r.porcentaje).toBe(100);
    expect(r.esCien).toBe(true);
    expect(r.montoSugerido).toBe(200);
    expect(r.motivoTexto).toContain('Portal Fiscal');
    expect(r.mensajeDetallado).toContain('Retención del 100%');
    expect(r.mensajeDetallado).toContain('Artículo 5');
    expect(r.mensajeDetallado).toContain('200,00');
  });

  it('con facturaNoCumple detalla el motivo de requisitos de facturación', () => {
    const r = obtenerInfoAvisoIva({
      ivaFactura: 50,
      motivos: { facturaNoCumple: true },
    });
    expect(r.porcentaje).toBe(100);
    expect(r.esCien).toBe(true);
    expect(r.montoSugerido).toBe(50);
    expect(r.motivoTexto).toContain('requisitos de la normativa de facturación');
  });

  it('con supuesto dinámico prioriza el porcentaje y texto del supuesto', () => {
    const r = obtenerInfoAvisoIva({
      ivaFactura: 100,
      supuestoPct: 100,
      supuestoTexto: 'Proveedor en lista de 100%',
    });
    expect(r.porcentaje).toBe(100);
    expect(r.montoSugerido).toBe(100);
    expect(r.mensajeDetallado).toContain('Proveedor en lista de 100%');
  });
});

