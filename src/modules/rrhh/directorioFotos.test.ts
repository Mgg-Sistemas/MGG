import { describe, it, expect } from 'vitest';
import { encuadreFoto, inicialesDe, nombreCompleto, ordenarDirectorio, personaDirectorio, resumenDirectorio, textoCargo } from './directorioFotos';
import type { Personal } from '@/shared/lib/types';

const base = { id: 'p1', nombre: 'José', apellido: 'Rondón', numero_ficha: '014', cedula: 'V-27514395', cargo: 'Chofer', departamento: 'Transporte', fecha_ingreso: '2025-03-01' } as unknown as Personal;

describe('directorio de fotos (14-10-2026)', () => {
  it('encuadra la foto como el carnet: cubre el marco, zoom y posición', () => {
    // Imagen apaisada 400×200 en marco 100×120: la escala la fija el alto (0,6), zoom 1.
    const e = encuadreFoto({ width: 400, height: 200 }, 100, 120, { foto_zoom: 1, foto_pos_x: 0.5, foto_pos_y: 0.5 });
    expect(e.dw).toBe(240); expect(e.dh).toBe(120);
    expect(e.x).toBe(-70); expect(e.y).toBe(-0);
    // Posición 0 = borde izquierdo; zoom 2 duplica.
    const z = encuadreFoto({ width: 400, height: 200 }, 100, 120, { foto_zoom: 2, foto_pos_x: 0, foto_pos_y: 1 });
    expect(z.dw).toBe(480); expect(z.x).toBe(-0); expect(z.y).toBe(-120);
    // Sin encuadre guardado: centrado y zoom 1; el zoom se acota entre 1 y 4.
    const s = encuadreFoto({ width: 100, height: 100 }, 100, 100, { foto_zoom: 9, foto_pos_x: null, foto_pos_y: null });
    expect(s.dw).toBe(400); expect(s.x).toBe(-150);
  });

  it('nombre, iniciales y cargo', () => {
    expect(nombreCompleto(base)).toBe('José Rondón');
    expect(inicialesDe(base)).toBe('JR');
    expect(inicialesDe({ nombre: '', apellido: '' })).toBe('·');
    expect(textoCargo(base)).toBe('Chofer · Transporte');
    expect(textoCargo({ cargo: '', departamento: null })).toBe('Sin cargo');
  });

  it('arma la persona del directorio y la ordena por departamento y nombre', () => {
    const p = personaDirectorio(base);
    expect(p).toEqual({ id: 'p1', ficha: '014', nombre: 'José Rondón', cargo: 'Chofer', departamento: 'Transporte', cedula: 'V-27514395', fechaIngreso: '2025-03-01' });
    const lista = ordenarDirectorio([
      { departamento: 'Transporte', nombre: 'Zoila' }, { departamento: '', nombre: 'Ana' }, { departamento: 'Administración', nombre: 'Luis' }, { departamento: 'Transporte', nombre: 'Carlos' },
    ]);
    expect(lista.map((x) => x.nombre)).toEqual(['Luis', 'Carlos', 'Zoila', 'Ana']);
  });

  it('resumen del encabezado', () => {
    expect(resumenDirectorio(48, 48)).toBe('48 personas · todo el personal del listado');
    expect(resumenDirectorio(1, 48)).toBe('1 persona de 48 · con el filtro de la lista');
  });
});
