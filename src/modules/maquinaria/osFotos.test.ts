import { describe, it, expect } from 'vitest';
import {
  MAX_FOTOS_ORDEN, MAX_BYTES_FOTO, avisoCupo, errorFotoLista, errorFotoOriginal, puestoLibre, rutaFotoOrden, tomarHastaCupo,
} from './osFotos';

const MB = 1024 * 1024;

describe('tope de fotos de la orden de servicio', () => {
  it('son 4 por orden', () => {
    expect(MAX_FOTOS_ORDEN).toBe(4);
  });
  it('una orden vacía toma hasta 4 y descarta el resto', () => {
    expect(tomarHastaCupo(0, ['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({ tomar: ['a', 'b', 'c', 'd'], descartadas: 2 });
  });
  it('con 3 fotos solo cabe una más', () => {
    expect(tomarHastaCupo(3, ['a', 'b'])).toEqual({ tomar: ['a'], descartadas: 1 });
  });
  it('una orden llena no toma ninguna', () => {
    expect(tomarHastaCupo(4, ['a'])).toEqual({ tomar: [], descartadas: 1 });
    expect(tomarHastaCupo(7, ['a'])).toEqual({ tomar: [], descartadas: 1 });
  });
  it('el aviso habla en singular o plural, y nada si no sobró', () => {
    expect(avisoCupo(0)).toBeNull();
    expect(avisoCupo(1)).toMatch(/una quedó fuera/);
    expect(avisoCupo(3)).toMatch(/3 quedaron fuera/);
  });
  it('el puesto libre es el primero que falta, o null si está llena', () => {
    expect(puestoLibre([])).toBe(1);
    expect(puestoLibre([1, 2, 4])).toBe(3);
    expect(puestoLibre([1, 2, 3, 4])).toBeNull();
  });
});

describe('archivos de foto', () => {
  it('acepta cualquier imagen antes de comprimir (incluso HEIC del iPhone)', () => {
    expect(errorFotoOriginal({ name: 'IMG_1.HEIC', type: 'image/heic', size: 3 * MB })).toBeNull();
    expect(errorFotoOriginal({ name: 'foto.jpg', type: '', size: MB })).toBeNull();
  });
  it('rechaza lo que no es imagen, lo vacío y lo enorme', () => {
    expect(errorFotoOriginal({ name: 'informe.pdf', type: 'application/pdf', size: MB })).toMatch(/no es una foto/);
    expect(errorFotoOriginal({ name: 'x.jpg', type: 'image/jpeg', size: 0 })).toMatch(/vacía/);
    expect(errorFotoOriginal({ name: 'x.jpg', type: 'image/jpeg', size: 40 * MB })).toMatch(/máximo/);
  });
  it('después de comprimir solo pasa JPG, PNG o WEBP de hasta 2 MB', () => {
    expect(errorFotoLista({ name: 'x.jpg', type: 'image/jpeg', size: 300 * 1024 })).toBeNull();
    expect(errorFotoLista({ name: 'x.heic', type: 'image/heic', size: 300 * 1024 })).toMatch(/formato/);
    expect(errorFotoLista({ name: 'x.jpg', type: 'image/jpeg', size: MAX_BYTES_FOTO + 1 })).toMatch(/máximo/);
  });
  it('la ruta va en la carpeta de la orden, sin acentos ni espacios', () => {
    expect(rutaFotoOrden('ord-1', 'k9', 'Daño del motor.jpg')).toBe('ord-1/k9-Dano_del_motor.jpg');
    expect(rutaFotoOrden('ord-1', 'k9', '')).toBe('ord-1/k9-foto.jpg');
  });
});
