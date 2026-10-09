import { describe, it, expect } from 'vitest';
import { armarFilasDescansos, armarFilasVacaciones, nombreMes, textoAlcance, tocaRango, totalDias } from './calendarioRrhh';
import type { RrhhEvento } from '@/shared/lib/types';
import type { Descanso } from './descansos.repository';

const personal = [
  { id: 'p1', nombre: 'Ana', apellido: 'Pérez', cedula: 'V-1', cargo: 'COCINERA', departamento: 'COCINA' },
  { id: 'p2', nombre: 'Luis', apellido: 'Gómez', cedula: 'V-2', cargo: 'CHOFER', departamento: 'LOGÍSTICA' },
];
const OCT = { desde: '2026-10-01', hasta: '2026-10-31' };

const vac = (o: Partial<RrhhEvento> & { id: string; personal_id: string }): RrhhEvento => ({
  tipo: 'vacacion', estado: 'activa', created_at: '2026-09-01T00:00:00Z', ...o,
});

describe('toca el rango', () => {
  it('sin mes, todo entra', () => expect(tocaRango('2020-01-01', '2020-01-02', null)).toBe(true));
  it('se cruza con el mes aunque empiece antes', () => expect(tocaRango('2026-09-28', '2026-10-02', OCT)).toBe(true));
  it('fuera del mes', () => expect(tocaRango('2026-11-01', '2026-11-05', OCT)).toBe(false));
  it('sin fechas no entra', () => expect(tocaRango(null, '2026-10-05', OCT)).toBe(false));
});

describe('vacaciones', () => {
  const eventos = [
    vac({ id: 'a', personal_id: 'p1', fecha_desde: '2026-10-10', fecha_hasta: '2026-10-24', dias: 15, procesada: true, actor_name: 'RRHH' }),
    vac({ id: 'b', personal_id: 'p2', fecha_desde: '2026-10-01', fecha_hasta: '2026-10-05', descripcion: 'Viaje', creado_por: 'x@mgg.com' }),
    vac({ id: 'c', personal_id: 'p1', fecha_desde: '2026-12-01', fecha_hasta: '2026-12-15' }),
    vac({ id: 'd', personal_id: 'nadie', fecha_desde: '2026-10-20', fecha_hasta: '2026-10-21' }),
  ];
  it('del mes, ordenadas por inicio, con días calculados si faltan', () => {
    const f = armarFilasVacaciones(eventos, personal, new Set(['b']), OCT);
    expect(f.map((x) => x.id)).toEqual(['b', 'a', 'd']);
    expect(f[0]).toMatchObject({ empleado: 'Luis Gómez', dias: 5, estado: 'Programada', cruce: true, nota: 'Viaje', cargadoPor: 'x@mgg.com', departamento: 'LOGÍSTICA' });
    expect(f[1]).toMatchObject({ dias: 15, estado: 'Procesada', cruce: false, cargadoPor: 'RRHH' });
    expect(f[2].empleado).toBe('(ficha eliminada)');
  });
  it('todas', () => expect(armarFilasVacaciones(eventos, personal, new Set(), null)).toHaveLength(4));
});

describe('descansos', () => {
  const ds: Descanso[] = [
    { id: 'd1', personal_id: 'p1', desde: '2026-10-05', hasta: '2026-10-11', origen: 'plan', created_at: '', actor_name: 'Sistema' },
    { id: 'd2', personal_id: 'p2', desde: '2026-10-01', hasta: '2026-10-07', origen: 'manual', nota: 'Pedido', created_at: '', created_by: 'y@mgg.com' },
    { id: 'd3', personal_id: 'p1', desde: '2026-11-02', hasta: '2026-11-08', origen: 'plan', created_at: '' },
  ];
  it('solo de las personas visibles y del mes', () => {
    const f = armarFilasDescansos(ds, [personal[0]], OCT);
    expect(f.map((x) => x.id)).toEqual(['d1']);
    expect(f[0]).toMatchObject({ dias: 7, origen: 'Plan', cargadoPor: 'Sistema' });
  });
  it('todas las personas, todo', () => {
    const f = armarFilasDescansos(ds, personal, null);
    expect(f.map((x) => x.id)).toEqual(['d2', 'd1', 'd3']);
    expect(f[0]).toMatchObject({ origen: 'Manual', nota: 'Pedido', cargadoPor: 'y@mgg.com' });
    expect(totalDias(f)).toBe(21);
  });
});

describe('textos', () => {
  it('nombre del mes', () => expect(nombreMes(OCT)).toBe('octubre de 2026'));
  it('alcance', () => {
    expect(textoAlcance({ mes: OCT })).toBe('octubre de 2026');
    expect(textoAlcance({ mes: null, departamento: 'COCINA', texto: 'ana', soloConDescansos: true }))
      .toBe('todo lo cargado · departamento COCINA · búsqueda «ana» · solo con descansos');
  });
});
