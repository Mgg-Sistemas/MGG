import { describe, it, expect } from 'vitest';
import {
  clave, limpiarNombre, sinRepetidos, opcionesInvolucrados, buscar, alternar, desdeTexto,
  type PersonaCatalogo,
} from './involucrados';

const CATALOGO: PersonaCatalogo[] = [
  { id: '1', nombre: 'ANDY RAMOS', cargo: 'Fundidor', estado: 'activo' },
  { id: '2', nombre: 'JUAN RAMONS', cargo: 'Ayudante', estado: 'activo' },
  { id: '3', nombre: 'RICHY HERNANDEZ', cargo: '', estado: 'activo' },
  { id: '4', nombre: 'CARLOS MACHADO', cargo: 'Operador de horno', estado: 'activo' },
  { id: '5', nombre: 'HENRY MUÑOZ', cargo: '', estado: 'inactivo' },
];

describe('comparar nombres de personas', () => {
  it('ignora acentos, mayúsculas y espacios de sobra', () => {
    expect(clave('  Henry  Muñoz ')).toBe(clave('HENRY MUNOZ'));
    expect(clave('José Pérez')).toBe('jose perez');
  });

  it('un nombre escrito a mano se guarda prolijo', () => {
    expect(limpiarNombre('  juan   ramos ')).toBe('JUAN RAMOS');
  });

  it('no se repite a la misma persona escrita distinto', () => {
    expect(sinRepetidos(['ANDY RAMOS', 'andy ramos', '', '  ', 'JUAN RAMONS'])).toEqual(['ANDY RAMOS', 'JUAN RAMONS']);
  });
});

describe('la lista para elegir involucrados', () => {
  it('solo muestra los activos del catálogo', () => {
    const ops = opcionesInvolucrados(CATALOGO, []);
    expect(ops.map((o) => o.nombre)).not.toContain('HENRY MUÑOZ');
    expect(ops).toHaveLength(4);
  });

  it('los elegidos van arriba', () => {
    const ops = opcionesInvolucrados(CATALOGO, ['RICHY HERNANDEZ']);
    expect(ops[0].nombre).toBe('RICHY HERNANDEZ');
    expect(ops[0].elegido).toBe(true);
  });

  it('un nombre viejo que ya no está en el catálogo NO se pierde', () => {
    // La colada la firmó alguien que después se desactivó: el reporte ya lo lleva.
    const ops = opcionesInvolucrados(CATALOGO, ['HENRY MUÑOZ', 'PEDRO QUE YA NO TRABAJA']);
    const henry = ops.find((o) => o.nombre === 'HENRY MUÑOZ');
    const pedro = ops.find((o) => o.nombre === 'PEDRO QUE YA NO TRABAJA');
    expect(henry?.elegido).toBe(true);
    expect(henry?.enCatalogo).toBe(false);
    expect(pedro?.elegido).toBe(true);
    expect(pedro?.enCatalogo).toBe(false);
  });

  it('el mismo nombre escrito distinto no aparece dos veces', () => {
    const ops = opcionesInvolucrados(CATALOGO, ['andy ramos']);
    expect(ops.filter((o) => clave(o.nombre) === clave('ANDY RAMOS'))).toHaveLength(1);
    expect(ops[0].nombre).toBe('ANDY RAMOS');
    expect(ops[0].elegido).toBe(true);
  });

  it('trae el cargo, que es lo que distingue a dos personas parecidas', () => {
    const ops = opcionesInvolucrados(CATALOGO, []);
    expect(ops.find((o) => o.nombre === 'CARLOS MACHADO')?.cargo).toBe('Operador de horno');
  });
});

describe('buscar en la lista', () => {
  const ops = opcionesInvolucrados(CATALOGO, []);

  it('encuentra por parte del nombre, sin importar acentos', () => {
    expect(buscar(ops, 'ram').map((o) => o.nombre)).toEqual(['ANDY RAMOS', 'JUAN RAMONS']);
  });

  it('también encuentra por cargo', () => {
    expect(buscar(ops, 'ayudante').map((o) => o.nombre)).toEqual(['JUAN RAMONS']);
  });

  it('sin texto, la lista entera', () => {
    expect(buscar(ops, '   ')).toHaveLength(4);
  });
});

describe('marcar y desmarcar', () => {
  it('agrega y saca sin duplicar', () => {
    let sel: string[] = [];
    sel = alternar(sel, 'ANDY RAMOS');
    sel = alternar(sel, 'JUAN RAMONS');
    expect(sel).toEqual(['ANDY RAMOS', 'JUAN RAMONS']);
    sel = alternar(sel, 'andy ramos');
    expect(sel).toEqual(['JUAN RAMONS']);
  });

  it('un nombre vacío no entra', () => {
    expect(alternar(['ANDY RAMOS'], '   ')).toEqual(['ANDY RAMOS']);
  });
});

describe('lo que ya estaba escrito a mano', () => {
  it('el cuadro de texto viejo se lee sin perder a nadie', () => {
    expect(desdeTexto('ANDY RAMOS\nJUAN RAMONS\n\nRICHY HERNANDEZ\nCARLOS MACHADO'))
      .toEqual(['ANDY RAMOS', 'JUAN RAMONS', 'RICHY HERNANDEZ', 'CARLOS MACHADO']);
  });

  it('vacío es una lista vacía, no una línea en blanco', () => {
    expect(desdeTexto('')).toEqual([]);
    expect(desdeTexto('\n\n  \n')).toEqual([]);
  });
});
