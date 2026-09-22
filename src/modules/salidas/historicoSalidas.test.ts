import { describe, it, expect } from 'vitest';
import type { SolicitudSalida } from '@/shared/lib/types';
import {
  TOPE_COLUMNA, accionesDe, actoresDe, hizoAlgo, ultimaAccion, etiquetaEvento,
  directorioDeActores, nombreDeActor, personasDelHistorico, filtrarHistorico,
  recorteDeColumna, conteoPorColumna, verboEvento,
} from './historicoSalidas';

/** Una solicitud mínima; cada prueba cambia solo lo que le importa. */
function sol(p: Partial<SolicitudSalida> = {}): SolicitudSalida {
  return {
    id: p.id ?? 'id-1',
    codigo: 'SAL-2026-0001',
    scope: 'salida',
    tipo: 'material',
    estado: 'por_aprobar',
    solicitante: 'ALMACEN',
    historial: [],
    created_at: '2026-09-01T10:00:00.000Z',
    ...p,
  } as SolicitudSalida;
}

describe('quién hizo qué en una solicitud', () => {
  it('lee el historial en orden, del primer evento al último', () => {
    const s = sol({
      historial: [
        { at: '2026-09-01T10:00:00Z', evento: 'creada', actor: 'kelvin@mgg.com' },
        { at: '2026-09-02T09:00:00Z', evento: 'aprobada', actor: 'leydis@mgg.com' },
        { at: '2026-09-03T08:00:00Z', evento: 'ejecutada', actor: 'kelvin@mgg.com' },
      ],
    });
    expect(accionesDe(s).map((a) => a.evento)).toEqual(['creada', 'aprobada', 'ejecutada']);
  });

  it('ordena aunque el historial venga desordenado', () => {
    const s = sol({
      historial: [
        { at: '2026-09-03T08:00:00Z', evento: 'ejecutada', actor: 'kelvin@mgg.com' },
        { at: '2026-09-01T10:00:00Z', evento: 'creada', actor: 'kelvin@mgg.com' },
      ],
    });
    expect(accionesDe(s).map((a) => a.evento)).toEqual(['creada', 'ejecutada']);
  });

  it('las filas viejas sin historial se reconstruyen con sus columnas sueltas', () => {
    const s = sol({
      historial: [],
      actor: 'isner@mgg.com', created_at: '2026-08-01T10:00:00Z',
      aprobada_por: 'leydis@mgg.com', aprobada_en: '2026-08-02T10:00:00Z',
      ejecutada_por: 'isner@mgg.com', ejecutada_en: '2026-08-03T10:00:00Z',
      estado: 'ejecutada',
    });
    expect(accionesDe(s)).toEqual([
      { evento: 'creada', actor: 'isner@mgg.com', at: '2026-08-01T10:00:00Z' },
      { evento: 'aprobada', actor: 'leydis@mgg.com', at: '2026-08-02T10:00:00Z' },
      { evento: 'ejecutada', actor: 'isner@mgg.com', at: '2026-08-03T10:00:00Z' },
    ]);
  });

  it('NO duplica lo que el historial ya cuenta', () => {
    const s = sol({
      historial: [{ at: '2026-09-02T09:00:00Z', evento: 'aprobada', actor: 'leydis@mgg.com' }],
      aprobada_por: 'leydis@mgg.com', aprobada_en: '2026-09-02T09:00:00Z',
    });
    expect(accionesDe(s).filter((a) => a.evento === 'aprobada')).toHaveLength(1);
  });

  it('el cierre sin descontar cuenta como ejecución de quien lo cerró', () => {
    const s = sol({
      historial: [{ at: '2026-09-02T09:00:00Z', evento: 'cerrada sin descontar (descuento manual por fuera)', actor: 'isner@mgg.com' }],
      ejecutada_por: 'isner@mgg.com', ejecutada_en: '2026-09-02T09:00:00Z',
      estado: 'ejecutada', mov_ref: 'manual_externo',
    });
    // Se completa con 'ejecutada' igual, pero la persona no se cuenta dos veces.
    expect(actoresDe(s)).toEqual(['isner@mgg.com']);
  });

  it('ignora eventos sin actor', () => {
    const s = sol({ historial: [{ at: '2026-09-01T10:00:00Z', evento: 'creada', actor: '   ' }], actor: null });
    expect(accionesDe(s)).toEqual([]);
    expect(actoresDe(s)).toEqual([]);
  });

  it('la última acción es la que dejó la solicitud como está', () => {
    const s = sol({
      historial: [
        { at: '2026-09-01T10:00:00Z', evento: 'creada', actor: 'kelvin@mgg.com' },
        { at: '2026-09-05T10:00:00Z', evento: 'cancelada', actor: 'leydis@mgg.com' },
      ],
    });
    expect(ultimaAccion(s)).toMatchObject({ evento: 'cancelada', actor: 'leydis@mgg.com' });
    expect(ultimaAccion(sol({ actor: null }))).toBeNull();
  });
});

describe('las personas', () => {
  it('junta a todos los que tocaron la solicitud, sin repetir', () => {
    const s = sol({
      historial: [
        { at: '2026-09-01T10:00:00Z', evento: 'creada', actor: 'Kelvin@MGG.com' },
        { at: '2026-09-02T10:00:00Z', evento: 'editada', actor: 'kelvin@mgg.com' },
        { at: '2026-09-03T10:00:00Z', evento: 'aprobada', actor: 'leydis@mgg.com' },
      ],
    });
    expect(actoresDe(s).sort()).toEqual(['kelvin@mgg.com', 'leydis@mgg.com']);
  });

  it('hizoAlgo no distingue mayúsculas ni espacios', () => {
    const s = sol({ actor: 'kelvin@mgg.com' });
    expect(hizoAlgo(s, '  KELVIN@MGG.COM ')).toBe(true);
    expect(hizoAlgo(s, 'otro@mgg.com')).toBe(false);
    expect(hizoAlgo(s, '')).toBe(false);
  });

  it('usa el nombre cuando se conoce y el correo sin dominio cuando no', () => {
    const dir = directorioDeActores([sol({ actor: 'kelvin@mgg.com', actor_name: 'KELVIN' })]);
    expect(nombreDeActor('kelvin@mgg.com', dir)).toBe('KELVIN');
    expect(nombreDeActor('isner@mgg.com', dir)).toBe('isner');
    expect(nombreDeActor(null, dir)).toBe('—');
  });

  it('lista las personas del histórico ordenadas por nombre', () => {
    const sols = [
      sol({ id: 'a', actor: 'kelvin@mgg.com', actor_name: 'KELVIN' }),
      sol({ id: 'b', actor: 'isner@mgg.com', actor_name: 'ISNER', aprobada_por: 'leydis@mgg.com', aprobada_en: '2026-09-02T10:00:00Z' }),
    ];
    expect(personasDelHistorico(sols)).toEqual([
      ['isner@mgg.com', 'ISNER'],
      ['kelvin@mgg.com', 'KELVIN'],
      ['leydis@mgg.com', 'leydis'],
    ]);
  });
});

describe('etiqueta del evento', () => {
  it('acorta el cierre sin descontar y pone mayúscula', () => {
    expect(etiquetaEvento('cerrada sin descontar (descuento manual por fuera)')).toBe('Cerrada sin descontar');
    expect(etiquetaEvento('aprobada')).toBe('Aprobada');
    expect(etiquetaEvento('')).toBe('—');
  });

  it('en la columna de personas el evento se lee como lo diría alguien', () => {
    expect(verboEvento('creada')).toBe('Creó');
    expect(verboEvento('aprobada')).toBe('Aprobó');
    expect(verboEvento('ejecutada')).toBe('Ejecutó');
    expect(verboEvento('cancelada')).toBe('Canceló');
    expect(verboEvento('editada')).toBe('Editó');
    expect(verboEvento('nota editada')).toBe('Editó la nota');
    expect(verboEvento('cerrada sin descontar (descuento manual por fuera)')).toBe('Cerró sin descontar');
  });

  it('un evento nuevo que nadie previó no rompe nada: se muestra tal cual', () => {
    expect(verboEvento('devuelta al almacén')).toBe('Devuelta al almacén');
  });
});

describe('filtros del histórico', () => {
  const sols = [
    sol({
      id: 'a', codigo: 'SAL-2026-0216', num_usuario: 142, estado: 'ejecutada',
      producto_nombre: 'ELECTRODO AWS E6013 5KG', solicitante: 'SERVICIOS GENERALES',
      actor: 'kelvin@mgg.com', actor_name: 'KELVIN', created_at: '2026-09-22T14:07:00Z',
    }),
    sol({
      id: 'b', codigo: 'SAL-2026-0202', num_usuario: 58, estado: 'ejecutada', mov_ref: 'manual_externo',
      producto_nombre: 'CEBOLLA', solicitante: 'CENTRO DE ACOPIO LA ESPERANZA',
      actor: 'isner@mgg.com', actor_name: 'ISNER', created_at: '2026-09-21T10:39:00Z',
    }),
    sol({
      id: 'c', codigo: 'SAL-2026-0152', num_usuario: 97, estado: 'cancelada',
      producto_nombre: 'DISCO DE CORTE 7"', solicitante: 'ALMACEN',
      actor: 'kelvin@mgg.com', actor_name: 'KELVIN', created_at: '2026-08-27T11:51:00Z',
      historial: [
        { at: '2026-08-27T11:51:00Z', evento: 'creada', actor: 'kelvin@mgg.com' },
        { at: '2026-08-28T09:00:00Z', evento: 'cancelada', actor: 'leydis@mgg.com' },
      ],
    }),
  ];

  it('sin filtros devuelve todo', () => {
    expect(filtrarHistorico(sols, {})).toHaveLength(3);
  });

  it('separa «ejecutada» de «cerrada sin descontar»', () => {
    expect(filtrarHistorico(sols, { columna: 'ejecutada' }).map((s) => s.id)).toEqual(['a']);
    expect(filtrarHistorico(sols, { columna: 'ejecutada_sin_descuento' }).map((s) => s.id)).toEqual(['b']);
    expect(filtrarHistorico(sols, { columna: 'cancelada' }).map((s) => s.id)).toEqual(['c']);
  });

  it('la persona se busca en TODO el historial, no solo en quien la creó', () => {
    // Leydis no creó ninguna: solo canceló la «c».
    expect(filtrarHistorico(sols, { persona: 'leydis@mgg.com' }).map((s) => s.id)).toEqual(['c']);
    expect(filtrarHistorico(sols, { persona: 'kelvin@mgg.com' }).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('busca por código, por N° y por material', () => {
    expect(filtrarHistorico(sols, { texto: '0202' }).map((s) => s.id)).toEqual(['b']);
    expect(filtrarHistorico(sols, { texto: '142' }).map((s) => s.id)).toEqual(['a']);
    expect(filtrarHistorico(sols, { texto: 'cebolla' }).map((s) => s.id)).toEqual(['b']);
    expect(filtrarHistorico(sols, { texto: 'ELECTRODO' }).map((s) => s.id)).toEqual(['a']);
  });

  it('busca en los materiales de una solicitud de varias líneas', () => {
    const multi = sol({ id: 'm', producto_nombre: 'ACEITE', items: [
      { producto_id: '1', producto_nombre: 'ACEITE', cantidad: 1 },
      { producto_id: '2', producto_nombre: 'HARINA PAN', cantidad: 2 },
    ] });
    expect(filtrarHistorico([multi], { texto: 'harina' })).toHaveLength(1);
  });

  it('filtra por rango de fechas, incluyendo los extremos', () => {
    expect(filtrarHistorico(sols, { desde: '2026-09-21' }).map((s) => s.id)).toEqual(['a', 'b']);
    expect(filtrarHistorico(sols, { hasta: '2026-08-27' }).map((s) => s.id)).toEqual(['c']);
    expect(filtrarHistorico(sols, { desde: '2026-09-21', hasta: '2026-09-21' }).map((s) => s.id)).toEqual(['b']);
  });

  it('combina filtros con «y»', () => {
    expect(filtrarHistorico(sols, { persona: 'kelvin@mgg.com', columna: 'cancelada' }).map((s) => s.id)).toEqual(['c']);
    expect(filtrarHistorico(sols, { persona: 'isner@mgg.com', columna: 'cancelada' })).toHaveLength(0);
  });

  it('filtra por solicitante exacto', () => {
    expect(filtrarHistorico(sols, { solicitante: 'ALMACEN' }).map((s) => s.id)).toEqual(['c']);
  });

  it('los filtros vacíos no filtran', () => {
    expect(filtrarHistorico(sols, { texto: '  ', persona: '', solicitante: '', desde: '', hasta: '' })).toHaveLength(3);
  });
});

describe('recorte de la columna del tablero', () => {
  const muchas = Array.from({ length: 186 }, (_, i) => `sol-${i}`);

  it('deja las primeras y manda el resto al histórico', () => {
    const { visibles, enHistorico } = recorteDeColumna(muchas);
    expect(visibles).toHaveLength(TOPE_COLUMNA);
    expect(visibles[0]).toBe('sol-0');
    expect(enHistorico).toBe(186 - TOPE_COLUMNA);
  });

  it('si caben todas, no manda nada al histórico', () => {
    expect(recorteDeColumna(['a', 'b'])).toEqual({ visibles: ['a', 'b'], enHistorico: 0 });
    expect(recorteDeColumna([])).toEqual({ visibles: [], enHistorico: 0 });
  });

  it('justo en el tope no sobra ninguna', () => {
    const justas = muchas.slice(0, TOPE_COLUMNA);
    expect(recorteDeColumna(justas)).toEqual({ visibles: justas, enHistorico: 0 });
  });
});

describe('conteo de los chips', () => {
  it('cuenta el TOTAL de cada columna, no lo que se ve en el tablero', () => {
    const sols = [
      ...Array.from({ length: 12 }, (_, i) => sol({ id: `e${i}`, estado: 'ejecutada' })),
      sol({ id: 'x', estado: 'cancelada' }),
    ];
    const c = conteoPorColumna(sols);
    expect(c.ejecutada).toBe(12);
    expect(c.cancelada).toBe(1);
    expect(c.por_aprobar).toBe(0);
    expect(c.ejecutada_sin_descuento).toBe(0);
  });
});
