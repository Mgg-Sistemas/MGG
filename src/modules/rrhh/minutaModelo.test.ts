import { describe, expect, it } from 'vitest';
import type { Minuta } from '@/shared/lib/types';
import {
  componerBusq, errorMinuta, errorPorcentaje, filaAcuerdoVacia, filaAvanceVacia,
  filaParticipanteVacia, numeroMinuta, tieneAcuerdosPendientes, tieneAcuerdosVencidos, type BorradorMinuta,
} from './minutaModelo';

const base: BorradorMinuta = {
  fecha: '2026-10-01', lugar: 'Sala de juntas', hora_inicio: '09:00',
  objetivo: 'Revisión de avances', orden_dia: ['Presupuesto'],
  participantes: [{ personal_id: null, nombre: 'Ana Pérez', cargo: 'Gerente' }],
  acuerdos: [], otros_asuntos: '', proxima_fecha: null, proximos_puntos: [],
  avances: [], observaciones: '', estado: 'borrador', anexar_adjuntos_pdf: false,
};

describe('filas vacías', () => {
  it('el participante vacío no trae persona ligada', () => {
    expect(filaParticipanteVacia()).toEqual({ personal_id: null, nombre: '', cargo: '' });
  });
  it('el acuerdo vacío no trae fecha', () => {
    expect(filaAcuerdoVacia()).toEqual({ responsable: '', actividad: '', fecha_compromiso: null });
  });
  it('el avance vacío trae los porcentajes en null, no en cero', () => {
    const f = filaAvanceVacia();
    expect(f.pct_inicial).toBeNull();
    expect(f.pct_avance).toBeNull();
  });
});

describe('errorPorcentaje', () => {
  it('acepta los extremos', () => {
    expect(errorPorcentaje(0)).toBeNull();
    expect(errorPorcentaje(100)).toBeNull();
  });
  it('vacío es válido: todavía no se midió', () => {
    expect(errorPorcentaje(null)).toBeNull();
    expect(errorPorcentaje('')).toBeNull();
  });
  it('rechaza fuera de rango', () => {
    expect(errorPorcentaje(-1)).toMatch(/entre 0 y 100/);
    expect(errorPorcentaje(150)).toMatch(/entre 0 y 100/);
  });
  it('acepta la coma decimal venezolana', () => {
    expect(errorPorcentaje('1,5')).toBeNull();
  });
  it('una cadena de solo espacios es vacío, no 0 %', () => {
    expect(errorPorcentaje('   ')).toBeNull();
  });
  it('rechaza lo que no es número (texto pegado de otro lado)', () => {
    expect(errorPorcentaje('ochenta')).toMatch(/número/);
  });
});

describe('errorMinuta', () => {
  it('la minuta base está bien', () => {
    expect(errorMinuta(base)).toBeNull();
  });
  it('sin fecha no se puede guardar: la base la exige', () => {
    expect(errorMinuta({ ...base, fecha: '' })).toMatch(/fecha/i);
  });
  it('sin objetivo tampoco: una minuta sin objetivo no sirve de nada', () => {
    expect(errorMinuta({ ...base, objetivo: '   ' })).toMatch(/objetivo/i);
  });
  it('un pct_inicial inválido también invalida la minuta', () => {
    const avances = [{ ...filaAvanceVacia(), actividad: 'X', pct_inicial: -5 }];
    expect(errorMinuta({ ...base, avances })).toMatch(/entre 0 y 100/);
  });
  it('un porcentaje malo en avances invalida la minuta entera', () => {
    const avances = [{ ...filaAvanceVacia(), actividad: 'X', pct_avance: 150 }];
    expect(errorMinuta({ ...base, avances })).toMatch(/entre 0 y 100/);
  });
});

describe('componerBusq', () => {
  it('junta objetivo, participantes y acuerdos en minúsculas y sin acentos', () => {
    const m: BorradorMinuta = {
      ...base, objetivo: 'Revisión de Presupuesto',
      acuerdos: [{ responsable: 'Luis', actividad: 'Cotizar camión', fecha_compromiso: null }],
    };
    const b = componerBusq(m);
    expect(b).toContain('revision de presupuesto');
    expect(b).toContain('ana perez');
    expect(b).toContain('cotizar camion');
  });
  it('no deja acentos ni mayúsculas, para que la búsqueda los ignore', () => {
    expect(componerBusq(base)).toBe(componerBusq(base).toLowerCase());
    expect(componerBusq({ ...base, objetivo: 'ÁÉÍÓÚÑ' })).toContain('aeioun');
  });
});

describe('participante que ya no está en el personal', () => {
  // La minuta es un documento histórico: guarda el texto, no una referencia viva.
  const ID = 'f3a9c1e2-7b44-4d0e-9a51-0c6d2e8b1a77';
  const m: BorradorMinuta = {
    ...base,
    participantes: [{ personal_id: ID, nombre: 'Ximena Quintero', cargo: 'Jefa de Almacén' }],
  };
  it('el nombre y el cargo guardados siguen en la minuta y son buscables', () => {
    expect(m.participantes[0]).toMatchObject({ nombre: 'Ximena Quintero', cargo: 'Jefa de Almacén' });
    const b = componerBusq(m);
    expect(b).toContain('ximena quintero');
    expect(b).toContain('jefa de almacen');
  });
  it('el personal_id no entra al texto de búsqueda', () => {
    const b = componerBusq(m);
    expect(b).not.toContain(ID.toLowerCase());
    expect(b).not.toContain('f3a9c1e2');
  });
  it('un participante con id inexistente no impide guardar', () => {
    expect(errorMinuta(m)).toBeNull();
  });
});

describe('tieneAcuerdosPendientes', () => {
  const hoy = new Date('2026-10-01T12:00:00Z');
  // `as unknown as Minuta`: la minuta de prueba es parcial a propósito, solo
  // trae lo que la función mira. NO usar `as never`: TypeScript lo rechaza.
  const minutaCon = (acuerdos: Minuta['acuerdos']) =>
    ({ ...base, id: '1', numero: 'MIN-2026-0001', acuerdos } as unknown as Minuta);

  it('un acuerdo con fecha futura está pendiente', () => {
    const m = minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-10-20' }]);
    expect(tieneAcuerdosPendientes(m, hoy)).toBe(true);
  });
  it('un acuerdo ya vencido SIGUE pendiente: nada lo marca como cumplido', () => {
    const m = minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-09-01' }]);
    expect(tieneAcuerdosPendientes(m, hoy)).toBe(true);
  });
  it('un acuerdo con fecha exactamente hoy sigue pendiente', () => {
    const hoyVE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(hoy);
    const m = minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: hoyVE }]);
    expect(tieneAcuerdosPendientes(m, hoy)).toBe(true);
  });
  it('a las 9 p. m. en Caracas, la fecha de ese día sigue siendo hoy', () => {
    const noche = new Date('2026-10-02T01:00:00Z'); // 21:00 en Caracas del 1 de octubre
    const m = minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-10-01' }]);
    expect(tieneAcuerdosPendientes(m, noche)).toBe(true);
  });
  it('un acuerdo sin fecha pero con contenido cuenta como pendiente', () => {
    const m = minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: null }]);
    expect(tieneAcuerdosPendientes(m, hoy)).toBe(true);
  });
  it('un acuerdo vacío (sin actividad ni responsable) no cuenta, aunque tenga fecha', () => {
    const m = minutaCon([{ responsable: ' ', actividad: '', fecha_compromiso: '2026-10-20' }]);
    expect(tieneAcuerdosPendientes(m, hoy)).toBe(false);
  });
  it('sin acuerdos, no hay nada pendiente', () => {
    expect(tieneAcuerdosPendientes(minutaCon([]), hoy)).toBe(false);
  });
});

describe('tieneAcuerdosVencidos', () => {
  const hoy = new Date('2026-10-01T12:00:00Z');
  const minutaCon = (acuerdos: Minuta['acuerdos']) =>
    ({ ...base, id: '1', numero: 'MIN-2026-0001', acuerdos } as unknown as Minuta);

  it('fecha anterior a hoy: vencido', () => {
    expect(tieneAcuerdosVencidos(minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-09-30' }]), hoy)).toBe(true);
  });
  it('fecha de hoy o futura: no vencido', () => {
    expect(tieneAcuerdosVencidos(minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-10-01' }]), hoy)).toBe(false);
    expect(tieneAcuerdosVencidos(minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-10-20' }]), hoy)).toBe(false);
  });
  it('sin fecha, sin contenido o sin acuerdos: no vencido', () => {
    expect(tieneAcuerdosVencidos(minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: null }]), hoy)).toBe(false);
    expect(tieneAcuerdosVencidos(minutaCon([{ responsable: '', actividad: '', fecha_compromiso: '2020-01-01' }]), hoy)).toBe(false);
    expect(tieneAcuerdosVencidos(minutaCon([]), hoy)).toBe(false);
  });
  it('a las 9 p. m. en Caracas, la fecha de ese día aún no venció', () => {
    const noche = new Date('2026-10-02T01:00:00Z');
    expect(tieneAcuerdosVencidos(minutaCon([{ responsable: 'A', actividad: 'X', fecha_compromiso: '2026-10-01' }]), noche)).toBe(false);
  });
});

describe('numeroMinuta', () => {
  it('rellena con ceros a cuatro dígitos', () => {
    expect(numeroMinuta(2026, 1)).toBe('MIN-2026-0001');
    expect(numeroMinuta(2026, 1234)).toBe('MIN-2026-1234');
  });
});
