import { describe, it, expect } from 'vitest';
import { esCategoriaMercado , coincideConBusqueda } from './SolicitudMercadoModal';

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

describe('coincideConBusqueda · el buscador dentro de la lista', () => {
  const p = { nombre: 'ADOBO COMPLETO IBERIA 40G', sku: 'VIV-060', categoria: 'VIVERES' };

  it('sin texto muestra todo', () => {
    expect(coincideConBusqueda(p, '')).toBe(true);
    expect(coincideConBusqueda(p, '   ')).toBe(true);
  });

  it('busca por nombre, sin importar mayúsculas', () => {
    expect(coincideConBusqueda(p, 'adobo')).toBe(true);
    expect(coincideConBusqueda(p, 'IBERIA')).toBe(true);
  });

  it('busca por código y por categoría', () => {
    expect(coincideConBusqueda(p, 'viv-060')).toBe(true);
    expect(coincideConBusqueda(p, 'viveres')).toBe(true);
  });

  it('ignora los acentos en los dos sentidos', () => {
    const q = { nombre: 'PLÁTANO VERDE', sku: 'HTL-009', categoria: 'HORTALIZAS Y LEGUMBRES' };
    expect(coincideConBusqueda(q, 'platano')).toBe(true);
    expect(coincideConBusqueda(q, 'plátano')).toBe(true);
  });

  it('descarta lo que no coincide', () => {
    expect(coincideConBusqueda(p, 'arroz')).toBe(false);
  });

  it('tolera una ficha con campos vacíos sin romperse', () => {
    expect(coincideConBusqueda({ nombre: null, sku: null, categoria: null }, 'algo')).toBe(false);
    expect(coincideConBusqueda({}, '')).toBe(true);
  });
});
