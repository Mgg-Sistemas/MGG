import { describe, it, expect } from 'vitest';
import {
  resolverSoporteFisicoClave,
  type SoportesFisicosMap,
} from './soporteFisico.repository';

describe('soporteFisico.repository', () => {
  const mapaEjemplo: SoportesFisicosMap = {
    'item-1': {
      recibido: true,
      tipo: 'original',
      entregadoPor: 'Carlos chofer',
      recibidoEn: '2026-11-26T10:00:00Z',
    },
    'item-2': {
      recibido: true,
      tipo: 'copia',
      entregadoPor: 'Foto WhatsApp',
      recibidoEn: '2026-11-26T11:00:00Z',
    },
    'orden-100': {
      recibido: true,
      tipo: 'original',
      entregadoPor: 'Almacén',
    },
  };

  it('resuelve soporte físico por ID directo', () => {
    const res = resolverSoporteFisicoClave('item-1', null, mapaEjemplo);
    expect(res).toBeDefined();
    expect(res?.recibido).toBe(true);
    expect(res?.tipo).toBe('original');
    expect(res?.entregadoPor).toBe('Carlos chofer');
  });

  it('resuelve soporte físico tipo copia', () => {
    const res = resolverSoporteFisicoClave('item-2', null, mapaEjemplo);
    expect(res).toBeDefined();
    expect(res?.recibido).toBe(true);
    expect(res?.tipo).toBe('copia');
  });

  it('resuelve por ordenId fallback cuando ID directo no existe', () => {
    const res = resolverSoporteFisicoClave('item-inexistente', '100', mapaEjemplo);
    expect(res).toBeDefined();
    expect(res?.entregadoPor).toBe('Almacén');
  });

  it('devuelve undefined si mapa no existe o no se encuentra', () => {
    expect(resolverSoporteFisicoClave('desconocido', null, mapaEjemplo)).toBeUndefined();
    expect(resolverSoporteFisicoClave('item-1', null, null)).toBeUndefined();
  });
});
