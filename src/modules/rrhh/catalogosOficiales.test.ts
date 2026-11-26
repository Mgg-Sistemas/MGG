import { describe, expect, it } from 'vitest';
import {
  CATALOGO_CIUDADES,
  CATALOGO_MUNICIPIOS,
  CATALOGO_NIVELES_EDUCACION,
  CATALOGO_PARROQUIAS,
  CATALOGO_PAISES,
  CATALOGO_PROFESIONES,
  CATALOGO_TIPOS_CARGO,
  type CatalogoOficialItem,
} from './catalogosOficiales';
import {
  CIUDADES_BANCO,
  MUNICIPIOS_BANCO,
  NIVELES_EDUCACION_BANCO,
  PARROQUIAS_BANCO,
  PAISES_BANCO,
  PROFESIONES_BANCO,
  TIPOS_CARGO_BANCO,
} from './cargaMasivaNomina';

describe('catálogos oficiales del Banco del Tesoro', () => {
  const catalogos: [string, readonly CatalogoOficialItem[], number][] = [
    ['NIVEL DE EDUCACION', CATALOGO_NIVELES_EDUCACION, 7],
    ['PAIS', CATALOGO_PAISES, 223],
    ['MUNICIPIO', CATALOGO_MUNICIPIOS, 137],
    ['PARROQUIA', CATALOGO_PARROQUIAS, 1128],
    ['PROFESION', CATALOGO_PROFESIONES, 184],
    ['TIPO DE CARGO', CATALOGO_TIPOS_CARGO, 79],
    ['CIUDAD', CATALOGO_CIUDADES, 129],
  ];

  it.each(catalogos)('%s trae todas las filas del Excel', (_hoja, items, esperado) => {
    expect(items).toHaveLength(esperado);
    expect(new Set(items.map((x) => x.codigo)).size).toBe(esperado);
    for (const item of items) {
      expect(item.codigo).toBeTruthy();
      expect(item.nombre).toBeTruthy();
      expect(item.etiqueta).toContain(item.codigo);
      expect(item.etiqueta).toContain(item.nombre);
      expect(item.detalle).toBeTypeOf('string');
    }
  });

  it('los niveles de educación salen con su código oficial', () => {
    expect(CATALOGO_NIVELES_EDUCACION.map((x) => [x.codigo, x.nombre])).toEqual([
      ['01', 'PRIMARIA'],
      ['02', 'BACHILLERATO'],
      ['03', 'TECNICO MEDIO'],
      ['04', 'TECNICO SUPERIOR'],
      ['05', 'UNIVERSITARIO'],
      ['06', 'POST GRADO'],
      ['07', 'DOCTORADO'],
    ]);
  });

  it('conserva los códigos que ya usaban las fichas guardadas', () => {
    expect(CATALOGO_PAISES.find((x) => x.codigo === 'VE')?.nombre).toBe('VENEZUELA');
    expect(CATALOGO_MUNICIPIOS.find((x) => x.codigo === '0701')?.nombre).toBe('PUERTO ORDAZ');
    expect(CATALOGO_PARROQUIAS.find((x) => x.codigo === '070106')?.nombre).toBe(
      'UNARE (CIUDAD GUAYANA)',
    );
    expect(CATALOGO_PROFESIONES.find((x) => x.codigo === 'ABOG')).toBeDefined();
    for (const codigo of ['0704', '0705', '0706', '0707', '0708', '0709', '0710', '0711']) {
      expect(CATALOGO_MUNICIPIOS.find((x) => x.codigo === codigo)?.detalle).toBe('BOLIVAR');
    }
  });

  it('los desplegables de la ficha usan los catálogos completos', () => {
    expect(NIVELES_EDUCACION_BANCO).toBe(CATALOGO_NIVELES_EDUCACION);
    expect(PAISES_BANCO).toBe(CATALOGO_PAISES);
    expect(CIUDADES_BANCO).toBe(CATALOGO_CIUDADES);
    expect(MUNICIPIOS_BANCO).toBe(CATALOGO_MUNICIPIOS);
    expect(PARROQUIAS_BANCO).toBe(CATALOGO_PARROQUIAS);
    expect(PROFESIONES_BANCO).toBe(CATALOGO_PROFESIONES);
    expect(TIPOS_CARGO_BANCO).toBe(CATALOGO_TIPOS_CARGO);
  });
});
