import { describe, expect, it, beforeEach } from 'vitest';
import {
  guardarAliasRepartidor,
  leerAliasesGuardados,
  obtenerDiferenciador,
  PALETA_FLOTA,
} from './deliveryIdentificadores';

// Mock de localStorage en memoria para entorno de testing Node
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => mockStorage[k] ?? null,
  setItem: (k: string, v: string) => { mockStorage[k] = v; },
  removeItem: (k: string) => { delete mockStorage[k]; },
  clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
};

describe('deliveryIdentificadores', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: typeof mockLocalStorage }).localStorage = mockLocalStorage;
    mockLocalStorage.clear();
  });

  it('asigna código y color deterministas a un repartidor', () => {
    const d1 = obtenerDiferenciador('user-123', 'HECTOR ALAGAL', 'delivery', 0);
    expect(d1.codigo).toBe('M-01');
    expect(d1.color).toBe(PALETA_FLOTA[0]);
    expect(d1.icono).toBe('🛵');
    expect(d1.nombreVisible).toBe('HECTOR A.');
  });

  it('asigna prefijo C- para carga pesada', () => {
    const d = obtenerDiferenciador('truck-456', 'CARLOS PEREZ', 'carga_pesada', 2);
    expect(d.codigo).toBe('C-03');
    expect(d.icono).toBe('🚚');
  });

  it('permite guardar y leer alias personalizado para un repartidor', () => {
    guardarAliasRepartidor('rep-999', 'Unidad Halcón');
    expect(leerAliasesGuardados()['rep-999']).toBe('Unidad Halcón');

    const d = obtenerDiferenciador('rep-999', 'PEDRO GOMEZ', 'delivery', 1);
    expect(d.alias).toBe('Unidad Halcón');
    expect(d.nombreVisible).toBe('Unidad Halcón');
  });

  it('maneja correos electrónicos como nombre extrayendo el usuario', () => {
    const d = obtenerDiferenciador('user-mail', 'ortiz.chris@gmail.com', 'delivery', 3);
    expect(d.nombreVisible).toBe('ortiz.chris');
  });
});
