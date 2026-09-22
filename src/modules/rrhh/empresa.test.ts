import { describe, it, expect } from 'vitest';
import {
  EMPRESAS, EMPRESA_POR_DEFECTO, codigoNomina, contarPorEmpresa, definicionEmpresa,
  empresaDeCodigo, esEmpresa, labelEmpresa, normalizarEmpresa, otraEmpresa, soloDe, tituloRrhh,
} from './empresa';

describe('las dos empresas', () => {
  it('son MGG y GoMetal, en ese orden', () => {
    expect(EMPRESAS.map((e) => e.key)).toEqual(['MGG', 'GOMETAL']);
    expect(labelEmpresa('GOMETAL')).toBe('GoMetal');
    expect(labelEmpresa('MGG')).toBe('MGG');
  });

  it('cada una tiene su color, para no confundirlas de un vistazo', () => {
    expect(definicionEmpresa('MGG').color).not.toBe(definicionEmpresa('GOMETAL').color);
  });

  it('el interruptor tiene exactamente dos lados', () => {
    expect(otraEmpresa('MGG')).toBe('GOMETAL');
    expect(otraEmpresa('GOMETAL')).toBe('MGG');
  });
});

describe('lo que llega de la base', () => {
  it('reconoce las válidas y rechaza las inventadas', () => {
    expect(esEmpresa('MGG')).toBe(true);
    expect(esEmpresa('GOMETAL')).toBe(true);
    expect(esEmpresa('gometal')).toBe(false);
    expect(esEmpresa(null)).toBe(false);
  });

  it('una fila vieja sin empresa es de MGG', () => {
    // La nómina de GoMetal nació después: todo lo anterior era de MGG.
    expect(normalizarEmpresa(null)).toBe('MGG');
    expect(normalizarEmpresa('')).toBe('MGG');
    expect(normalizarEmpresa(undefined)).toBe(EMPRESA_POR_DEFECTO);
  });

  it('tolera cómo esté escrito', () => {
    expect(normalizarEmpresa('gometal')).toBe('GOMETAL');
    expect(normalizarEmpresa('Go Metal')).toBe('GOMETAL');
    expect(normalizarEmpresa('go-metal')).toBe('GOMETAL');
    expect(normalizarEmpresa('GM')).toBe('GOMETAL');
  });

  it('cualquier otra cosa cae en MGG, no rompe', () => {
    expect(normalizarEmpresa('otra empresa')).toBe('MGG');
    expect(normalizarEmpresa(42)).toBe('MGG');
  });
});

describe('el código de nómina', () => {
  it('cada empresa numera la suya desde 1', () => {
    // La nómina 3 de GoMetal no tiene por qué saber cuántas lleva MGG.
    expect(codigoNomina('MGG', 2026, 3)).toBe('NOM-2026-0003');
    expect(codigoNomina('GOMETAL', 2026, 3)).toBe('GM-NOM-2026-0003');
  });

  it('rellena a cuatro dígitos', () => {
    expect(codigoNomina('MGG', 2026, 1)).toBe('NOM-2026-0001');
    expect(codigoNomina('GOMETAL', 2026, 127)).toBe('GM-NOM-2026-0127');
  });

  it('nunca arranca en cero', () => {
    expect(codigoNomina('MGG', 2026, 0)).toBe('NOM-2026-0001');
    expect(codigoNomina('MGG', 2026, -5)).toBe('NOM-2026-0001');
  });

  it('se puede saber de quién es un código mirándolo', () => {
    expect(empresaDeCodigo('GM-NOM-2026-0003')).toBe('GOMETAL');
    expect(empresaDeCodigo('NOM-2026-0003')).toBe('MGG');
    expect(empresaDeCodigo(null)).toBe('MGG');
  });
});

describe('separar lo de cada una', () => {
  const filas = [
    { id: 1, empresa: 'MGG' },
    { id: 2, empresa: 'GOMETAL' },
    { id: 3, empresa: null },        // vieja: cuenta como MGG
    { id: 4, empresa: 'GOMETAL' },
  ];

  it('trae solo las de una empresa', () => {
    expect(soloDe(filas, 'GOMETAL').map((f) => f.id)).toEqual([2, 4]);
    expect(soloDe(filas, 'MGG').map((f) => f.id)).toEqual([1, 3]);
  });

  it('cuenta cuántas hay de cada lado', () => {
    expect(contarPorEmpresa(filas)).toEqual({ MGG: 2, GOMETAL: 2 });
  });

  it('sin filas cuenta cero de las dos, no rompe', () => {
    expect(contarPorEmpresa([])).toEqual({ MGG: 0, GOMETAL: 0 });
    expect(soloDe([], 'MGG')).toEqual([]);
  });
});

describe('la pantalla dice siempre cuál se está mirando', () => {
  it('el título nombra la empresa', () => {
    // Evita el error caro: cargarle un aumento a la persona equivocada
    // porque el interruptor estaba del otro lado.
    expect(tituloRrhh('GOMETAL')).toContain('GoMetal');
    expect(tituloRrhh('MGG')).toContain('MGG');
    expect(tituloRrhh('GOMETAL')).not.toBe(tituloRrhh('MGG'));
  });
});
