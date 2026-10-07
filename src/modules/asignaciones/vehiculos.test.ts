import { describe, expect, it } from 'vitest';
import { errorVehiculo, filtrarVehiculos, normalizarPlaca, textoVehiculo } from './vehiculos';

describe('vehículos del catálogo', () => {
  it('normaliza la placa', () => {
    expect(normalizarPlaca(' ab-123 cd ')).toBe('AB123CD');
  });
  it('nombra el vehículo con marca, modelo, año, color y placa', () => {
    expect(textoVehiculo({ placa: 'ab123cd', marca: 'Toyota', modelo: 'Hilux', anio: 2019, color: 'blanco' }))
      .toBe('TOYOTA HILUX 2019 · BLANCO · PLACA AB123CD');
    expect(textoVehiculo({ placa: 'XY1', tipo: 'moto' })).toBe('MOTO · PLACA XY1');
  });
  it('valida lo mínimo', () => {
    expect(errorVehiculo({ placa: '', marca: 'Toyota' })).toMatch(/placa/);
    expect(errorVehiculo({ placa: 'AB1', marca: '', modelo: '' })).toMatch(/marca o el modelo/);
    expect(errorVehiculo({ placa: 'AB1', marca: 'Bera', anio: 1800 })).toMatch(/año/);
    expect(errorVehiculo({ placa: 'AB1', marca: 'Bera', anio: 2022 })).toBeNull();
  });
  it('busca por cualquier dato, sin acentos y sin guiones en la placa', () => {
    const lista = [
      { placa: 'AB-123CD', marca: 'Toyota', modelo: 'Hilux', anio: 2019, color: 'Blanco' },
      { placa: 'MT55X', marca: 'Bera', modelo: 'SBR', anio: 2022, color: 'Rojo', tipo: 'moto' },
    ];
    expect(filtrarVehiculos(lista, 'ab123').map((v) => v.marca)).toEqual(['Toyota']);
    expect(filtrarVehiculos(lista, 'moto roja')).toHaveLength(0);
    expect(filtrarVehiculos(lista, 'moto rojo')).toHaveLength(1);
    expect(filtrarVehiculos(lista, '')).toHaveLength(2);
  });
});
