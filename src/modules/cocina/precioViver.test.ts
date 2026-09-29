import { describe, it, expect } from 'vitest';
import { precioDelCentro, valorDelCentro } from './precioViver';

describe('precioDelCentro', () => {
  it('usa el costo del almacén, no el precio global del producto', () => {
    // El caso real: la salsa de tomate de Los Pinos está costeada a 13,29 y el
    // precio global es 16,83 porque promedia los galones de los otros centros.
    expect(precioDelCentro([{ stock: 0.5, costo_promedio: 13.29 }], 16.83)).toBe(13.29);
  });

  it('pondera por stock cuando el centro tiene varios almacenes', () => {
    // 10 a $1 y 30 a $2 → (10 + 60) / 40 = 1,75.
    expect(precioDelCentro([
      { stock: 10, costo_promedio: 1 },
      { stock: 30, costo_promedio: 2 },
    ], 99)).toBe(1.75);
  });

  it('ignora las existencias costeadas en cero: no arrastran el promedio', () => {
    // El ajuste de cantidad sin precio no puede hacer desaparecer plata pagada.
    expect(precioDelCentro([
      { stock: 10, costo_promedio: 5 },
      { stock: 10, costo_promedio: 0 },
    ], 99)).toBe(5);
  });

  it('sin stock pero con costo, conserva el costo del centro', () => {
    // El víver se acabó; su ficha todavía dice a cuánto salió.
    expect(precioDelCentro([{ stock: 0, costo_promedio: 7.31 }], 99)).toBe(7.31);
  });

  it('cae al precio global solo cuando el centro no tiene ningún costo', () => {
    expect(precioDelCentro([{ stock: 5, costo_promedio: 0 }], 4.2)).toBe(4.2);
    expect(precioDelCentro([], 4.2)).toBe(4.2);
  });

  it('sin costo en ningún lado da 0, no NaN', () => {
    expect(precioDelCentro([], null)).toBe(0);
    expect(precioDelCentro([{ stock: 3, costo_promedio: null }], undefined)).toBe(0);
  });

  it('aguanta basura en los campos sin romperse', () => {
    expect(precioDelCentro([{ stock: NaN, costo_promedio: 5 }], 1)).toBe(5);
    expect(precioDelCentro([{ stock: 2, costo_promedio: Number.NaN }], 3)).toBe(3);
  });
});

describe('valorDelCentro', () => {
  it('vale lo que el centro pagó, no lo que dice el promedio global', () => {
    // 0,5 galones a 13,29 = 6,65 (con el global daría 8,42: $1,77 inventados).
    expect(valorDelCentro([{ stock: 0.5, costo_promedio: 13.29 }], 16.83)).toBe(6.65);
  });

  it('suma el stock de todos los almacenes del centro', () => {
    expect(valorDelCentro([
      { stock: 10, costo_promedio: 2 },
      { stock: 5, costo_promedio: 2 },
    ], 99)).toBe(30);
  });

  it('un centro vacío vale 0', () => {
    expect(valorDelCentro([], 50)).toBe(0);
    expect(valorDelCentro([{ stock: 0, costo_promedio: 7 }], 50)).toBe(0);
  });
});
