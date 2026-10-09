import { describe, it, expect } from 'vitest';
import { armarHistoricoSalarial, cargosDelHistorico, filtrarHistorico, textoPct, textoRangoHistorico } from './historicoSalarial';
import type { CambioSueldoRegistro } from './personal.repository';
import { variacionSueldo } from './cambioSueldo';

const cambio = (o: Partial<CambioSueldoRegistro> & { id: string; personalId: string }): CambioSueldoRegistro => ({
  sueldoAnterior: 0, sueldoNuevo: 0, vigenteDesde: '2026-01-01', motivo: '', tipo: null, actor: null, actorName: null, createdAt: '2026-01-01T12:00:00Z', ...o,
});
const personal = [
  { id: 'p1', nombre: 'Ana', apellido: 'Pérez', cedula: 'V-1', cargo: 'CONDUCTOR' },
  { id: 'p2', nombre: 'Luis', apellido: 'Gómez', cedula: 'V-2', cargo: 'Vigilante' },
];

describe('armar el histórico', () => {
  const filas = armarHistoricoSalarial([
    cambio({ id: 'a', personalId: 'p1', sueldoAnterior: 400, sueldoNuevo: 500, motivo: 'Aumento', tipo: 'aumento', actorName: 'RRHH', vigenteDesde: '2026-03-01' }),
    cambio({ id: 'b', personalId: 'p2', sueldoAnterior: 0, sueldoNuevo: 200, tipo: 'inicial', actor: 'x@mgg.com', vigenteDesde: '2026-02-01' }),
    cambio({ id: 'c', personalId: 'nadie', sueldoAnterior: 100, sueldoNuevo: 90, vigenteDesde: '2026-04-01' }),
  ], personal);

  it('une con la ficha', () => {
    expect(filas[0].empleado).toBe('Ana Pérez');
    expect(filas[0].cedula).toBe('V-1');
    expect(filas[0].cargo).toBe('CONDUCTOR');
    expect(filas[0].variacion.pct).toBe(25);
    expect(filas[0].tipo).toBe('Aumento');
    expect(filas[0].cambiadoPor).toBe('RRHH');
  });
  it('sin nombre del actor usa el correo', () => {
    expect(filas[1].cambiadoPor).toBe('x@mgg.com');
    expect(filas[1].tipo).toBe('Carga inicial');
  });
  it('ficha que ya no existe: lo dice, no inventa', () => {
    expect(filas[2].empleado).toBe('(ficha eliminada)');
    expect(filas[2].variacion.direccion).toBe('rebaja');
  });

  describe('filtros', () => {
    it('por texto sin acentos', () => {
      expect(filtrarHistorico(filas, { texto: 'perez' }).map((f) => f.id)).toEqual(['a']);
      expect(filtrarHistorico(filas, { texto: 'ana conductor' }).map((f) => f.id)).toEqual(['a']);
    });
    it('por cargo normalizado', () => {
      expect(filtrarHistorico(filas, { cargo: 'vigilante' }).map((f) => f.id)).toEqual(['b']);
    });
    it('por rango de vigencia, inclusivo', () => {
      expect(filtrarHistorico(filas, { desde: '2026-03-01', hasta: '2026-04-01' }).map((f) => f.id)).toEqual(['a', 'c']);
      expect(filtrarHistorico(filas, { hasta: '2026-02-01' }).map((f) => f.id)).toEqual(['b']);
    });
    it('sin filtros devuelve todo', () => {
      expect(filtrarHistorico(filas, {})).toHaveLength(3);
    });
  });

  it('cargos del histórico, únicos y ordenados', () => {
    expect(cargosDelHistorico(filas)).toEqual(['CONDUCTOR', 'VIGILANTE']);
  });
});

describe('variación en porcentaje', () => {
  it('sube', () => expect(textoPct(variacionSueldo(400, 500))).toBe('+25 %'));
  it('baja con un decimal', () => expect(textoPct(variacionSueldo(400, 350))).toBe('-12,5 %'));
  it('sin sueldo anterior no hay porcentaje', () => expect(textoPct(variacionSueldo(0, 500))).toBe('—'));
  it('igual no hay porcentaje', () => expect(textoPct(variacionSueldo(500, 500))).toBe('—'));
});

describe('texto del rango', () => {
  it('todo', () => expect(textoRangoHistorico({})).toBe('Todos los cambios'));
  it('desde y hasta', () => expect(textoRangoHistorico({ desde: '2026-01-01', hasta: '2026-03-31' })).toBe('vigentes del 01/01/2026 al 31/03/2026'));
  it('con cargo y búsqueda', () => {
    expect(textoRangoHistorico({ desde: '2026-01-01', cargo: 'conductor', texto: 'ana' }))
      .toBe('vigentes desde el 01/01/2026 · cargo CONDUCTOR · búsqueda «ana»');
  });
});
