import { describe, it, expect } from 'vitest';
import { MAX_FOTOS_EQUIPO, avisoCupoFotos, cupoFotos, ordenarFotos, ordenesAlHacerPortada, rutaFotoEquipo } from './fotosEquipo';

const f = (id: string, orden: number, created_at: string) => ({ id, orden, created_at });

describe('Maquinaria · fotos del equipo (16-10-2026)', () => {
  it('la ruta va en la carpeta fotos/<equipo>/ con el nombre limpio', () => {
    expect(rutaFotoEquipo('e1', 'abc', 'Montacarga Ñandú (1).jpeg')).toBe('fotos/e1/abc-Montacarga_Nandu_1_.jpeg');
    expect(rutaFotoEquipo('e1', 'abc', '')).toBe('fotos/e1/abc-foto.jpg');
  });

  it('la portada (orden 0) va primero y después por orden y fecha', () => {
    const r = ordenarFotos([f('b', 2, '2026-10-01'), f('c', 1, '2026-10-05'), f('a', 0, '2026-10-09'), f('d', 1, '2026-10-02')]);
    expect(r.map((x) => x.id)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('el cupo es de 8 por equipo y avisa cuántas se descartan', () => {
    const { tomar, descartadas } = cupoFotos(6, ['x', 'y', 'z']);
    expect(tomar).toEqual(['x', 'y']);
    expect(descartadas).toBe(1);
    expect(avisoCupoFotos(1)).toContain(`hasta ${MAX_FOTOS_EQUIPO}`);
    expect(avisoCupoFotos(0)).toBeNull();
    expect(cupoFotos(8, ['x']).tomar).toEqual([]);
  });

  it('hacer portada deja esa en 0 y corre las demás sin cambiar las que ya están bien', () => {
    const fotos = [f('a', 0, '2026-10-01'), f('b', 1, '2026-10-02'), f('c', 2, '2026-10-03')];
    expect(ordenesAlHacerPortada(fotos, 'c')).toEqual([{ id: 'c', orden: 0 }, { id: 'a', orden: 1 }, { id: 'b', orden: 2 }]);
    expect(ordenesAlHacerPortada(fotos, 'a')).toEqual([]);
  });
});
