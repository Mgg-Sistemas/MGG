import { describe, it, expect } from 'vitest';
import { ajustePorFila, ajusteAlBorrar, detalleMovimiento } from './casiteritaStock';

describe('el detallado de casiterita mueve el stock', () => {
  it('una fila nueva entra completa', () => {
    // La compra de Los Pinos que quedó sin sumar: 65,85 kg de peso casiterita.
    expect(ajustePorFila(65.85, 0)).toEqual({ delta: 65.85, tipo: 'entrada' });
  });

  it('una fila ya contada no vuelve a sumar', () => {
    expect(ajustePorFila(65.85, 65.85)).toBeNull();
  });

  it('al corregir el peso hacia arriba entra solo la diferencia', () => {
    expect(ajustePorFila(70, 65.85)).toEqual({ delta: 4.15, tipo: 'entrada' });
  });

  it('al corregir el peso hacia abajo sale la diferencia', () => {
    expect(ajustePorFila(60, 65.85)).toEqual({ delta: -5.85, tipo: 'salida' });
  });

  it('una diferencia de menos de un gramo no ensucia el kardex', () => {
    expect(ajustePorFila(65.854, 65.85)).toBeNull();
    expect(ajustePorFila(1234.5, 1234.5)).toBeNull();
  });

  it('borrar una fila devuelve lo que había aportado', () => {
    expect(ajusteAlBorrar(1234.5)).toEqual({ delta: -1234.5, tipo: 'salida' });
  });

  it('borrar una fila que nunca aportó no castiga el stock', () => {
    expect(ajusteAlBorrar(0)).toBeNull();
    expect(ajusteAlBorrar(null)).toBeNull();
  });

  it('un peso ilegible se trata como cero, no rompe', () => {
    expect(ajustePorFila(null, 0)).toBeNull();
    expect(ajustePorFila(Number.NaN, 10)).toEqual({ delta: -10, tipo: 'salida' });
  });

  it('el kardex dice de dónde vino el kilo', () => {
    expect(detalleMovimiento('COMPRA DE MATERIAL LOS PINOS', 'BOLSA DE HIELO', false))
      .toBe('Entrada del inventario detallado (SnO₂) · COMPRA DE MATERIAL LOS PINOS · BOLSA DE HIELO');
    expect(detalleMovimiento('AUTANA', null, true))
      .toBe('Ajuste del inventario detallado (SnO₂) · AUTANA');
  });
});
