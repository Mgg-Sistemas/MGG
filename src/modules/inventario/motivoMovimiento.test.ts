import { describe, it, expect } from 'vitest';
import { errorMotivo, requiereMotivo, motivosSugeridos, MOTIVO_MINIMO } from './motivoMovimiento';

describe('requiereMotivo', () => {
  it('exige motivo en los cuatro tipos que se cargan a mano y mueven stock', () => {
    for (const t of ['entrada', 'salida', 'ajuste', 'consumo'] as const) {
      expect(requiereMotivo(t, 'manual')).toBe(true);
    }
  });

  it('no exige motivo en un traslado ni al dar de alta el producto: esos lo escriben solos', () => {
    expect(requiereMotivo('transferencia', 'manual')).toBe(false);
    expect(requiereMotivo('creacion', 'manual')).toBe(false);
  });

  it('no exige motivo al marcar o liberar fundición: no mueven stock', () => {
    expect(requiereMotivo('fundicion', 'manual')).toBe(false);
    expect(requiereMotivo('fin_fundicion', 'manual')).toBe(false);
  });

  it('no toca los movimientos que vienen de otro módulo con su documento', () => {
    expect(requiereMotivo('entrada', 'orden')).toBe(false);
    expect(requiereMotivo('salida', 'cocina')).toBe(false);
    expect(requiereMotivo('entrada', 'compra_directa')).toBe(false);
    expect(requiereMotivo('ajuste', 'valuacion')).toBe(false);
  });

  it('sin ref_tipo se asume cargado a mano, que es el caso peligroso', () => {
    expect(requiereMotivo('ajuste', null)).toBe(true);
    expect(requiereMotivo('ajuste', undefined)).toBe(true);
    expect(requiereMotivo('ajuste', '  ')).toBe(true);
  });
});

describe('errorMotivo', () => {
  it('acepta un motivo escrito de verdad', () => {
    expect(errorMotivo('ajuste', 'Conteo físico del 9 de septiembre', 'manual')).toBeNull();
    expect(errorMotivo('salida', 'Entrega a personal', 'manual')).toBeNull();
    expect(errorMotivo('ajuste', 'Merma', 'manual')).toBeNull();
    expect(errorMotivo('ajuste', 'Rotura', 'manual')).toBeNull();
  });

  it('rechaza el motivo vacío y el que son solo espacios', () => {
    expect(errorMotivo('entrada', '', 'manual')).toMatch(/Escribí el motivo/);
    expect(errorMotivo('entrada', null, 'manual')).toMatch(/Escribí el motivo/);
    expect(errorMotivo('entrada', '     ', 'manual')).toMatch(/Escribí el motivo/);
  });

  it('rechaza el motivo demasiado corto', () => {
    expect(errorMotivo('salida', 'ok', 'manual')).toMatch(/muy corto/);
    expect(errorMotivo('salida', 'x', 'manual')).toMatch(/muy corto/);
    expect('Merma'.length).toBe(MOTIVO_MINIMO);
  });

  it('rechaza el relleno sin palabras', () => {
    expect(errorMotivo('ajuste', '12345', 'manual')).toMatch(/en palabras/);
    expect(errorMotivo('ajuste', '------', 'manual')).toMatch(/en palabras/);
  });

  it('nombra el tipo de movimiento en el mensaje, para que se entienda qué falta', () => {
    expect(errorMotivo('entrada', '', 'manual')).toMatch(/entrada/);
    expect(errorMotivo('ajuste', '', 'manual')).toMatch(/corrección de stock/);
    expect(errorMotivo('consumo', '', 'manual')).toMatch(/consumo/);
  });

  it('deja pasar sin motivo lo que no lo exige', () => {
    expect(errorMotivo('transferencia', '', 'manual')).toBeNull();
    expect(errorMotivo('entrada', '', 'orden')).toBeNull();
    expect(errorMotivo('fundicion', '', 'manual')).toBeNull();
  });
});

describe('motivosSugeridos', () => {
  it('ofrece atajos en los tipos que exigen motivo', () => {
    for (const t of ['entrada', 'salida', 'ajuste', 'consumo'] as const) {
      expect(motivosSugeridos(t).length).toBeGreaterThan(0);
    }
  });

  it('cada sugerencia pasa su propia validación', () => {
    for (const t of ['entrada', 'salida', 'ajuste', 'consumo'] as const) {
      for (const s of motivosSugeridos(t)) expect(errorMotivo(t, s, 'manual')).toBeNull();
    }
  });

  it('no ofrece atajos donde no hace falta', () => {
    expect(motivosSugeridos('transferencia')).toEqual([]);
  });
});
