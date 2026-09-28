import { describe, expect, it } from 'vitest';
import { alternarVista, vistaEncendida, TARJETAS_VISTA, type Vista } from './vistaMercado';

describe('vistaEncendida', () => {
  it('«ambos» enciende Disponible y Movimientos, no Distribución', () => {
    expect(vistaEncendida('ambos', 'disponible')).toBe(true);
    expect(vistaEncendida('ambos', 'movimientos')).toBe(true);
    expect(vistaEncendida('ambos', 'distribucion')).toBe(false);
  });

  it('cada vista simple enciende solo su llave', () => {
    expect(vistaEncendida('disponible', 'disponible')).toBe(true);
    expect(vistaEncendida('disponible', 'movimientos')).toBe(false);
    expect(vistaEncendida('movimientos', 'movimientos')).toBe(true);
    expect(vistaEncendida('movimientos', 'disponible')).toBe(false);
    expect(vistaEncendida('distribucion', 'distribucion')).toBe(true);
    expect(vistaEncendida('distribucion', 'disponible')).toBe(false);
  });

  it('siempre hay al menos una llave encendida', () => {
    for (const v of ['disponible', 'movimientos', 'ambos', 'distribucion'] as Vista[]) {
      expect(TARJETAS_VISTA.some((t) => vistaEncendida(v, t.llave))).toBe(true);
    }
  });
});

describe('alternarVista', () => {
  it('encender la segunda llave deja las dos', () => {
    expect(alternarVista('disponible', 'movimientos')).toBe('ambos');
    expect(alternarVista('movimientos', 'disponible')).toBe('ambos');
  });

  it('apagar una de las dos deja la otra', () => {
    expect(alternarVista('ambos', 'disponible')).toBe('movimientos');
    expect(alternarVista('ambos', 'movimientos')).toBe('disponible');
  });

  it('tocar la única encendida no apaga nada', () => {
    expect(alternarVista('disponible', 'disponible')).toBe('disponible');
    expect(alternarVista('movimientos', 'movimientos')).toBe('movimientos');
    expect(alternarVista('distribucion', 'distribucion')).toBe('distribucion');
  });

  it('Distribución apaga a las otras dos, y cualquiera de ellas la apaga a ella', () => {
    expect(alternarVista('ambos', 'distribucion')).toBe('distribucion');
    expect(alternarVista('disponible', 'distribucion')).toBe('distribucion');
    expect(alternarVista('distribucion', 'disponible')).toBe('disponible');
    expect(alternarVista('distribucion', 'movimientos')).toBe('movimientos');
  });

  it('nunca deja las tres apagadas', () => {
    for (const v of ['disponible', 'movimientos', 'ambos', 'distribucion'] as Vista[]) {
      for (const t of TARJETAS_VISTA) {
        const next = alternarVista(v, t.llave);
        expect(TARJETAS_VISTA.some((x) => vistaEncendida(next, x.llave))).toBe(true);
      }
    }
  });
});
