import { describe, it, expect } from 'vitest';
import {
  SIN_PAGAR, agruparRecibosPorFecha, alternarGrupo, alternarUno, estadoDelGrupo,
  etiquetaGrupo, fechaDePago, nombreNomina, nombreSugerido, seleccionados,
} from './nominaLote';

/* Un renglón mínimo: para agrupar e imprimir solo importan el id, cuándo se
   pagó y cuánto. */
const r = (id: string, pagada_en: string | null, neto_usd = 100) =>
  ({ id, pagada_en, neto_usd } as { id: string; pagada_en: string | null; neto_usd: number });

const RENGLONES = [
  r('a', '2026-09-18T14:03:00+00:00', 150),
  r('b', null, 200),
  r('c', '2026-09-15T09:00:00+00:00', 120),
  r('d', '2026-09-18T18:40:00+00:00', 80),
  r('e', null, 90),
];

describe('de qué día es cada recibo', () => {
  it('toma el día del pago, sin la hora', () => {
    expect(fechaDePago({ pagada_en: '2026-09-18T14:03:00+00:00' })).toBe('2026-09-18');
  });

  it('lo que no se pagó no tiene día', () => {
    expect(fechaDePago({ pagada_en: null })).toBe(SIN_PAGAR);
    expect(fechaDePago({ pagada_en: '' })).toBe(SIN_PAGAR);
  });

  it('una fecha ilegible no inventa un grupo: cae en «sin pagar»', () => {
    expect(fechaDePago({ pagada_en: 'ayer' })).toBe(SIN_PAGAR);
  });
});

describe('agrupar los recibos por fecha de pago', () => {
  const grupos = agruparRecibosPorFecha(RENGLONES);

  it('junta los del mismo día y suma su total', () => {
    const g18 = grupos.find((g) => g.fecha === '2026-09-18');
    expect(g18?.renglones.map((x) => x.id)).toEqual(['a', 'd']);
    expect(g18?.totalUsd).toBe(230);
  });

  it('va en orden cronológico y deja al final lo que falta pagar', () => {
    expect(grupos.map((g) => g.fecha)).toEqual(['2026-09-15', '2026-09-18', SIN_PAGAR]);
  });

  it('no pierde ni duplica ningún renglón', () => {
    const ids = grupos.flatMap((g) => g.renglones.map((x) => x.id)).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('una nómina recién cargada es un solo grupo sin pagar', () => {
    const g = agruparRecibosPorFecha([r('x', null), r('y', null)]);
    expect(g).toHaveLength(1);
    expect(g[0].fecha).toBe(SIN_PAGAR);
  });

  it('sin renglones no hay grupos', () => {
    expect(agruparRecibosPorFecha([])).toEqual([]);
  });

  it('el título dice el día, o que todavía no se pagó', () => {
    const fmt = (iso: string) => iso.split('-').reverse().join('/');
    expect(etiquetaGrupo('2026-09-18', fmt)).toBe('Pagados el 18/09/2026');
    expect(etiquetaGrupo(SIN_PAGAR, fmt)).toBe('Todavía sin pagar');
  });
});

describe('elegir cuáles se imprimen', () => {
  const grupos = agruparRecibosPorFecha(RENGLONES);

  it('salen en el orden de la pantalla, no en el de los clics', () => {
    // Se marcaron en desorden; el PDF igual sale como se ve.
    const marcados = new Set(['d', 'c', 'a']);
    expect(seleccionados(grupos, marcados).map((x) => x.id)).toEqual(['c', 'a', 'd']);
  });

  it('sin nada marcado no se imprime nada', () => {
    expect(seleccionados(grupos, new Set())).toEqual([]);
  });

  it('la casilla del grupo distingue todos, ninguno y algunos', () => {
    const g18 = grupos.find((g) => g.fecha === '2026-09-18')!;
    expect(estadoDelGrupo(g18, new Set(['a', 'd']))).toBe('todos');
    expect(estadoDelGrupo(g18, new Set(['a']))).toBe('algunos');
    expect(estadoDelGrupo(g18, new Set(['c']))).toBe('ninguno');
  });

  it('tocar un grupo entero lo marca; tocarlo de nuevo lo desmarca', () => {
    const g18 = grupos.find((g) => g.fecha === '2026-09-18')!;
    const puesto = alternarGrupo(g18, new Set(['c']));
    expect([...puesto].sort()).toEqual(['a', 'c', 'd']);
    // No toca los de otros grupos.
    expect(alternarGrupo(g18, puesto).has('c')).toBe(true);
    expect(alternarGrupo(g18, puesto).has('a')).toBe(false);
  });

  it('un grupo a medias se completa, no se vacía', () => {
    const g18 = grupos.find((g) => g.fecha === '2026-09-18')!;
    const r2 = alternarGrupo(g18, new Set(['a']));
    expect([...r2].sort()).toEqual(['a', 'd']);
  });

  it('marcar y desmarcar uno solo', () => {
    expect(alternarUno('a', new Set()).has('a')).toBe(true);
    expect(alternarUno('a', new Set(['a'])).has('a')).toBe(false);
  });

  it('no muta el conjunto que recibe', () => {
    const original = new Set(['a']);
    alternarUno('b', original);
    expect([...original]).toEqual(['a']);
  });
});

describe('cómo se llama la nómina', () => {
  it('se muestra el nombre si lo tiene', () => {
    expect(nombreNomina({ nombre: 'Quincena 1', codigo: 'NOM-2026-0001' })).toBe('Quincena 1');
  });

  it('las viejas no tienen nombre: se muestra el código', () => {
    expect(nombreNomina({ nombre: null, codigo: 'NOM-2026-0001' })).toBe('NOM-2026-0001');
    expect(nombreNomina({ nombre: '   ', codigo: 'NOM-2026-0001' })).toBe('NOM-2026-0001');
  });

  it('sin nombre ni código no queda una celda vacía', () => {
    expect(nombreNomina({})).toBe('Sin nombre');
  });
});

describe('el nombre que se sugiere al cargarla', () => {
  it('la quincena sale de qué mitad del mes es', () => {
    expect(nombreSugerido('quincena', '2026-09-10')).toBe('Primera quincena de septiembre 2026');
    expect(nombreSugerido('quincena', '2026-09-15')).toBe('Primera quincena de septiembre 2026');
    expect(nombreSugerido('quincena', '2026-09-16')).toBe('Segunda quincena de septiembre 2026');
  });

  it('los otros tipos llevan el día', () => {
    expect(nombreSugerido('liquidacion', '2026-01-03')).toBe('Liquidacion · 3 de enero 2026');
  });

  it('sin fecha válida no inventa nada raro', () => {
    expect(nombreSugerido('quincena', '')).toBe('Quincena');
  });
});
