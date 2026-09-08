import { describe, it, expect } from 'vitest';
import { esCategoriaMercado } from './SolicitudMercadoModal';

describe('esCategoriaMercado · qué entra a la Solicitud de Mercado', () => {
  it('los víveres, escritos como se escriban', () => {
    expect(esCategoriaMercado('VIVERES Y ART. LIMPIEZA')).toBe(true);
    expect(esCategoriaMercado('Víveres y Art. de Limpieza')).toBe(true);
    expect(esCategoriaMercado('viveres')).toBe(true);
  });

  it('las hortalizas y legumbres, que es lo que faltaba', () => {
    // MONTE SURTIDO (HTL-006) se compra en el mismo mercado y la cocina lo
    // consume, pero la lista solo miraba «viveres» y lo dejaba afuera.
    expect(esCategoriaMercado('HORTALIZAS Y LEGUMBRES')).toBe(true);
    expect(esCategoriaMercado('Hortalizas')).toBe(true);
  });

  it('lo que no se compra en el mercado queda afuera', () => {
    expect(esCategoriaMercado('REPUESTOS')).toBe(false);
    expect(esCategoriaMercado('MP')).toBe(false);
    expect(esCategoriaMercado('LIMPIEZA')).toBe(false);   // la de galpón, no la de cocina
    expect(esCategoriaMercado('CARNES')).toBe(false);
  });

  it('sin categoría no rompe', () => {
    expect(esCategoriaMercado(null)).toBe(false);
    expect(esCategoriaMercado('')).toBe(false);
    expect(esCategoriaMercado(undefined)).toBe(false);
  });
});
