import { describe, it, expect } from 'vitest';
import {
  agruparPersonal, antiguedad, cantidadHijos, edadEn, filtrarPersonal, grupoDe, hijosMenores,
  labelEstadoCivil, labelGenero, labelParentesco, numeroFicha, porDepartamento, resumenPersonal,
  textoEdad, tieneHijos,
} from './fichaPersonal';

const HOY = '2026-09-22';

describe('la edad se calcula, no se guarda', () => {
  it('cuenta los años cumplidos', () => {
    expect(edadEn('1973-10-21', HOY)).toBe(52);
  });

  it('si todavía no fue el cumpleaños, falta un año', () => {
    // Nació en octubre; al 22 de septiembre aún no cumplió.
    expect(edadEn('1973-10-21', '2026-09-22')).toBe(52);
    expect(edadEn('1973-10-21', '2026-10-21')).toBe(53);
    expect(edadEn('1973-10-21', '2026-10-20')).toBe(52);
  });

  it('el día del cumpleaños ya cuenta', () => {
    expect(edadEn('2000-09-22', HOY)).toBe(26);
  });

  it('una fecha futura no da edad negativa: da nada', () => {
    expect(edadEn('2030-01-01', HOY)).toBeNull();
  });

  it('sin fecha no inventa una edad', () => {
    expect(edadEn(null, HOY)).toBeNull();
    expect(edadEn('', HOY)).toBeNull();
    expect(edadEn('21/10/1973', HOY)).toBeNull();
  });

  it('lo dice en palabras', () => {
    expect(textoEdad('1973-10-21', HOY)).toBe('52 años');
    expect(textoEdad('2025-09-22', HOY)).toBe('1 año');
    expect(textoEdad(null, HOY)).toBe('—');
  });
});

describe('la antigüedad no se redondea a años', () => {
  it('los primeros meses importan', () => {
    // Vacaciones y período de prueba se miden en meses.
    expect(antiguedad('2026-07-13', HOY)).toBe('2 meses');
    expect(antiguedad('2026-08-22', HOY)).toBe('1 mes');
  });

  it('años y meses juntos', () => {
    expect(antiguedad('2024-03-22', HOY)).toBe('2 años y 6 meses');
    expect(antiguedad('2024-09-22', HOY)).toBe('2 años');
  });

  it('sin fecha, o con fecha futura, no dice nada', () => {
    expect(antiguedad(null, HOY)).toBe('—');
    expect(antiguedad('2030-01-01', HOY)).toBe('—');
  });
});

describe('el número de ficha', () => {
  it('va a cuatro dígitos', () => {
    expect(numeroFicha(5)).toBe('Ficha 0005');
    expect(numeroFicha(127)).toBe('Ficha 0127');
  });

  it('sin número no inventa uno', () => {
    expect(numeroFicha(null)).toBe('Ficha —');
    expect(numeroFicha(0)).toBe('Ficha —');
  });
});

describe('quién tiene hijos sale de la carga familiar', () => {
  const familia = [
    { parentesco: 'hijo', fecha_nacimiento: '2015-01-01' },
    { parentesco: 'hijo', fecha_nacimiento: '2004-01-01' },
    { parentesco: 'conyuge', fecha_nacimiento: '1985-01-01' },
  ];

  it('no se pregunta aparte: se mira la lista', () => {
    expect(tieneHijos(familia)).toBe(true);
    expect(tieneHijos([{ parentesco: 'conyuge' }])).toBe(false);
    expect(tieneHijos([])).toBe(false);
    expect(tieneHijos(null)).toBe(false);
  });

  it('cuenta solo los hijos, no toda la familia', () => {
    expect(cantidadHijos(familia)).toBe(2);
  });

  it('los menores de 18 se cuentan aparte', () => {
    expect(hijosMenores(familia, HOY)).toBe(1);
  });

  it('cada parentesco tiene su nombre', () => {
    expect(labelParentesco('hijo')).toBe('Hijo/a');
    expect(labelParentesco('conyuge')).toMatch(/cónyuge/i);
    expect(labelParentesco('inventado')).toBe('—');
  });
});

describe('los catálogos', () => {
  it('las mujeres van primero en las tarjetas', () => {
    expect(labelGenero('femenino')).toBe('Femenino');
    expect(labelGenero('masculino')).toBe('Masculino');
    expect(labelGenero(null)).toBe('—');
  });

  it('el estado civil se escribe sin suponer el género', () => {
    expect(labelEstadoCivil('soltero')).toBe('Soltero/a');
    expect(labelEstadoCivil('casado')).toBe('Casado/a');
    expect(labelEstadoCivil(null)).toBe('—');
  });
});

/* ───────── Filtros y agrupación ───────── */

const GENTE = [
  { id: '1', nombre: 'Ana', apellido: 'Pérez', cedula: 'V-111', cargo: 'Analista', departamento: 'Tesorería', genero: 'femenino', estado_civil: 'soltero', fecha_nacimiento: '1996-05-10', activo: true },
  { id: '2', nombre: 'Luis', apellido: 'Díaz', cedula: 'V-222', cargo: 'Supervisor', departamento: 'Electricidad', genero: 'masculino', estado_civil: 'casado', fecha_nacimiento: '1973-10-21', activo: true },
  { id: '3', nombre: 'Rosa', apellido: 'Gil', cedula: 'V-333', cargo: 'Analista', departamento: 'Tesorería', genero: 'femenino', estado_civil: 'casado', fecha_nacimiento: '1988-01-02', activo: false },
  { id: '4', nombre: 'Juan', apellido: 'Soto', cedula: 'V-444', cargo: 'Obrero', departamento: null, genero: null, estado_civil: null, fecha_nacimiento: null, activo: true },
];
const conHijos = (id: string) => id === '2' || id === '3';

describe('filtrar por todo', () => {
  it('por texto busca en nombre, cédula, cargo y departamento', () => {
    expect(filtrarPersonal(GENTE, { texto: 'rosa' }).map((p) => p.id)).toEqual(['3']);
    expect(filtrarPersonal(GENTE, { texto: 'V-222' }).map((p) => p.id)).toEqual(['2']);
    expect(filtrarPersonal(GENTE, { texto: 'analista' }).map((p) => p.id)).toEqual(['1', '3']);
  });

  it('por departamento, cargo, género y estado civil', () => {
    expect(filtrarPersonal(GENTE, { departamento: 'Tesorería' }).map((p) => p.id)).toEqual(['1', '3']);
    expect(filtrarPersonal(GENTE, { cargo: 'Obrero' }).map((p) => p.id)).toEqual(['4']);
    expect(filtrarPersonal(GENTE, { genero: 'femenino' }).map((p) => p.id)).toEqual(['1', '3']);
    expect(filtrarPersonal(GENTE, { estadoCivil: 'casado' }).map((p) => p.id)).toEqual(['2', '3']);
  });

  it('por activo o inactivo', () => {
    expect(filtrarPersonal(GENTE, { estado: 'activos' }).map((p) => p.id)).toEqual(['1', '2', '4']);
    expect(filtrarPersonal(GENTE, { estado: 'inactivos' }).map((p) => p.id)).toEqual(['3']);
    expect(filtrarPersonal(GENTE, { estado: 'todos' })).toHaveLength(4);
  });

  it('por con hijos o sin hijos', () => {
    expect(filtrarPersonal(GENTE, { hijos: 'con' }, conHijos).map((p) => p.id)).toEqual(['2', '3']);
    expect(filtrarPersonal(GENTE, { hijos: 'sin' }, conHijos).map((p) => p.id)).toEqual(['1', '4']);
  });

  it('por rango de edad; sin fecha de nacimiento queda afuera', () => {
    // No se puede afirmar que alguien sin fecha entra en el rango.
    expect(filtrarPersonal(GENTE, { edadDesde: 40 }, conHijos, HOY).map((p) => p.id)).toEqual(['2']);
    expect(filtrarPersonal(GENTE, { edadHasta: 35 }, conHijos, HOY).map((p) => p.id)).toEqual(['1']);
    expect(filtrarPersonal(GENTE, { edadDesde: 0 }, conHijos, HOY).map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('los filtros se acumulan', () => {
    expect(filtrarPersonal(GENTE, { departamento: 'Tesorería', estado: 'activos' }).map((p) => p.id)).toEqual(['1']);
  });

  it('sin filtros no saca a nadie', () => {
    expect(filtrarPersonal(GENTE, {})).toHaveLength(4);
  });
});

describe('agrupar', () => {
  it('sin agrupador devuelve un solo grupo', () => {
    const g = agruparPersonal(GENTE, '');
    expect(g).toHaveLength(1);
    expect(g[0].filas).toHaveLength(4);
  });

  it('agrupa por departamento y manda «Sin …» al final', () => {
    const g = agruparPersonal(GENTE, 'departamento');
    expect(g.map((x) => x.nombre)).toEqual(['Electricidad', 'Tesorería', 'Sin departamento']);
  });

  it('agrupa por con/sin hijos', () => {
    const g = agruparPersonal(GENTE, 'hijos', conHijos);
    expect(g.find((x) => x.nombre === 'Con hijos')?.filas.map((p) => p.id)).toEqual(['2', '3']);
  });

  it('el grupo de cada persona se puede pedir suelto', () => {
    expect(grupoDe(GENTE[0], 'estado_civil')).toBe('Soltero/a');
    expect(grupoDe(GENTE[3], 'genero')).toBe('Sin género cargado');
  });
});

describe('las tarjetas de arriba', () => {
  it('cuenta total, mujeres y hombres', () => {
    const r = resumenPersonal(GENTE, conHijos, HOY);
    expect(r.total).toBe(4);
    expect(r.mujeres).toBe(2);
    expect(r.hombres).toBe(1);
  });

  it('dice cuántos NO tienen el género cargado', () => {
    // Si son muchos, las tarjetas de mujeres y hombres mienten por omisión.
    expect(resumenPersonal(GENTE, conHijos, HOY).sinGenero).toBe(1);
  });

  it('cuenta activos, inactivos y con hijos', () => {
    const r = resumenPersonal(GENTE, conHijos, HOY);
    expect(r.activos).toBe(3);
    expect(r.inactivos).toBe(1);
    expect(r.conHijos).toBe(2);
  });

  it('la edad promedio ignora a quien no tiene fecha', () => {
    // (30 + 52 + 38) / 3 = 40
    expect(resumenPersonal(GENTE, conHijos, HOY).edadPromedio).toBe(40);
  });

  it('sin nadie con fecha, no hay promedio', () => {
    expect(resumenPersonal([GENTE[3]], conHijos, HOY).edadPromedio).toBeNull();
  });

  it('sin gente no rompe', () => {
    const r = resumenPersonal([], conHijos, HOY);
    expect(r.total).toBe(0);
    expect(r.mujeres).toBe(0);
  });

  it('el desglose por departamento va de mayor a menor', () => {
    expect(porDepartamento(GENTE)).toEqual([
      { nombre: 'Tesorería', cantidad: 2 },
      { nombre: 'Electricidad', cantidad: 1 },
      { nombre: 'Sin departamento', cantidad: 1 },
    ]);
  });
});
