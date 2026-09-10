import { describe, it, expect } from 'vitest';
import { sinUbicacion, ubicacionAlRecibir, FILTRO_SIN_UBICACION } from './ubicacionProducto';

/** Los productos reales creados desde solicitudes, que quedaron sin almacén. */
const NUEVOS = [
  { sku: 'VIV-127', nombre: 'LENTEJAS', almacen: '' },
  { sku: 'ELE-071', nombre: 'LAMPARA REDONDA DE 8" Y 18 WATTS', almacen: '   ' },
  { sku: 'PIN-045', nombre: 'PINTURA DE ACEITE BLANCA (GALON)', almacen: null },
];
const UBICADO = { sku: 'VIV-122', nombre: 'VINAGRE', almacen: 'Los Pinos' };

describe('ubicación de un producto', () => {
  it('reconoce sin almacén, en blanco o con solo espacios', () => {
    for (const p of NUEVOS) expect(sinUbicacion(p)).toBe(true);
  });

  it('un producto que ya vive en un almacén no está sin ubicación', () => {
    expect(sinUbicacion(UBICADO)).toBe(false);
  });

  it('al recibir, el producto sin casa se queda con el destino elegido', () => {
    expect(ubicacionAlRecibir('', 'Los Pinos')).toBe('Los Pinos');
    expect(ubicacionAlRecibir(null, 'General')).toBe('General');
    expect(ubicacionAlRecibir('  ', '  Los Pinos  ')).toBe('Los Pinos');
  });

  it('recibir en otra sede NO muda a un producto que ya tenía casa', () => {
    expect(ubicacionAlRecibir('Los Pinos', 'General')).toBeNull();
  });

  it('sin destino no se estampa nada, ni siquiera al que no tiene casa', () => {
    expect(ubicacionAlRecibir('', '')).toBeNull();
    expect(ubicacionAlRecibir('', null)).toBeNull();
  });

  it('el valor del filtro no puede chocar con el nombre de un almacén real', () => {
    expect(FILTRO_SIN_UBICACION.startsWith('__')).toBe(true);
    expect(['Los Pinos', 'General', 'La Esperanza']).not.toContain(FILTRO_SIN_UBICACION);
  });
});
