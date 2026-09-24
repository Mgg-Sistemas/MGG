import { describe, it, expect } from 'vitest';
import {
  agruparPorCategoria, normCategoria, posicionCategoria, rotuloCategoria,
} from './agruparPorCategoria';

const art = (nombre: string, categoria: string | null) => ({ nombre, categoria });
const cat = (x: { categoria: string | null }) => x.categoria;

describe('cómo se normaliza la categoría', () => {
  it('saca tildes, espacios de más y mayúsculas', () => {
    expect(normCategoria(' hortalizas  y   legumbres ')).toBe('HORTALIZAS Y LEGUMBRES');
    expect(normCategoria('Producción')).toBe('PRODUCCION');
  });

  it('NO le quita la S final: la categoría se llama CARNES, no CARNE', () => {
    expect(normCategoria('carnes')).toBe('CARNES');
    expect(normCategoria('PROTEINAS')).toBe('PROTEINAS');
  });

  it('sin categoría no revienta', () => {
    expect(normCategoria(null)).toBe('');
    expect(normCategoria(undefined)).toBe('');
  });
});

describe('el orden en que se cocinan las categorías', () => {
  it('la carne va primera: es lo primero que se piensa en un plato', () => {
    expect(posicionCategoria('CARNES')).toBe(0);
    expect(posicionCategoria('CARNES')).toBeLessThan(posicionCategoria('VIVERES'));
  });

  it('la limpieza va al final: no va en ningún plato', () => {
    expect(posicionCategoria('LIMPIEZA')).toBeGreaterThan(posicionCategoria('ALIMENTOS'));
  });

  it('una categoría desconocida cae al final', () => {
    expect(posicionCategoria('REPUESTO')).toBeGreaterThan(posicionCategoria('MATERIAL DE LIMPIEZA'));
  });
});

describe('cómo se rotula cada grupo', () => {
  it('las conocidas llevan su ícono', () => {
    expect(rotuloCategoria('CARNES')).toBe('🥩 Carnes');
    expect(rotuloCategoria('HORTALIZAS Y LEGUMBRES')).toBe('🥬 Hortalizas y legumbres');
  });

  it('una desconocida se muestra como viene', () => {
    expect(rotuloCategoria('PAPELERIA')).toBe('PAPELERIA');
  });

  it('sin categoría se dice que no tiene', () => {
    expect(rotuloCategoria('')).toBe('Sin categoría');
  });
});

describe('la lista de la comida agrupada', () => {
  const lista = [
    art('ARROZ', 'ALIMENTOS'),
    art('CARNE MECHADA', 'CARNES'),
    art('CEBOLLA', 'HORTALIZAS Y LEGUMBRES'),
    art('CLORO', 'LIMPIEZA'),
    art('CARNE MOLIDA', 'carnes'),
    art('ACEITE', 'VIVERES'),
    art('POLLO BENEFICIADO', 'PROTEINAS'),
  ];

  it('las carnes quedan arriba de todo, que es lo que no se veía', () => {
    const g = agruparPorCategoria(lista, cat);
    expect(g[0].rotulo).toBe('🥩 Carnes');
    expect(g[0].items.map((x) => x.nombre)).toEqual(['CARNE MECHADA', 'CARNE MOLIDA']);
  });

  it('agrupa sin importar cómo esté escrita la categoría', () => {
    const g = agruparPorCategoria(lista, cat);
    expect(g.filter((x) => x.categoria === 'CARNES')).toHaveLength(1);
  });

  it('respeta el orden de cocina de punta a punta', () => {
    expect(agruparPorCategoria(lista, cat).map((x) => x.categoria)).toEqual([
      'CARNES', 'PROTEINAS', 'HORTALIZAS Y LEGUMBRES', 'VIVERES', 'ALIMENTOS', 'LIMPIEZA',
    ]);
  });

  it('dentro del grupo no se reordena nada', () => {
    const g = agruparPorCategoria([art('Z', 'VIVERES'), art('A', 'VIVERES')], cat);
    expect(g[0].items.map((x) => x.nombre)).toEqual(['Z', 'A']);
  });

  it('lo que no tiene categoría se junta al final, no se pierde', () => {
    const g = agruparPorCategoria([art('X', null), art('CARNE', 'CARNES')], cat);
    expect(g.map((x) => x.categoria)).toEqual(['CARNES', '']);
    expect(g[1].items).toHaveLength(1);
  });

  it('una lista vacía da una lista vacía', () => {
    expect(agruparPorCategoria([], cat)).toEqual([]);
  });
});
