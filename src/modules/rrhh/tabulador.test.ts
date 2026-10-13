import { describe, it, expect } from 'vitest';
import {
  anteriorPorCargo, armarTabuladorDesdeCargos, cambiosArmado, diffAplicarTabulador, filaAplicable, filasExportArmado,
  filasExportTabulador, filtrarHistorialPorCargo, labelAccionTabulador, motivoTabulador,
  normalizarCargo, resumenAplicacion, validarFilaTabulador, type FilaTabulador, type HistorialTabulador, type PersonaParaTabulador,
} from './tabulador';

const fila = (cargo: string, sueldoBase: number, activo = true): FilaTabulador => ({
  id: cargo, cargo, sueldoBase, vigenteDesde: '2026-10-01', activo, updatedAt: '', actualizadoPor: null, actualizadoPorNombre: null,
});
const persona = (id: string, cargo: string | null, sueldo: number, activo = true): PersonaParaTabulador => ({
  id, nombre: id, apellido: '', cedula: null, cargo, sueldo_base: sueldo, activo,
});

describe('el cargo se compara sin mayúsculas ni espacios de más', () => {
  it('normaliza', () => {
    expect(normalizarCargo(' conductor ')).toBe('CONDUCTOR');
    expect(normalizarCargo('Analista   de  Sistemas')).toBe('ANALISTA DE SISTEMAS');
    expect(normalizarCargo(null)).toBe('');
  });
});

describe('qué fila se aplica', () => {
  it('con monto y activa, sí', () => expect(filaAplicable({ sueldoBase: 300, activo: true })).toBe(true));
  it('sin definir (0), no', () => expect(filaAplicable({ sueldoBase: 0, activo: true })).toBe(false));
  it('desactivada, no', () => expect(filaAplicable({ sueldoBase: 300, activo: false })).toBe(false));
});

describe('validar una fila del tabulador', () => {
  it('sin cargo reclama', () => {
    expect(validarFilaTabulador({ cargo: ' ', sueldoBase: 300, motivo: 'Alta' })).toMatch(/cargo/i);
  });
  it('sin motivo reclama, también en el alta', () => {
    expect(validarFilaTabulador({ cargo: 'CONDUCTOR', sueldoBase: 300 })).toMatch(/motivo/i);
    expect(validarFilaTabulador({ cargo: 'CONDUCTOR', sueldoBase: 300, motivo: 'ok' })).toMatch(/motivo/i);
  });
  it('negativo reclama', () => {
    expect(validarFilaTabulador({ cargo: 'CONDUCTOR', sueldoBase: -1, motivo: 'Ajuste' })).toMatch(/negativo/i);
  });
  it('fecha rota reclama', () => {
    expect(validarFilaTabulador({ cargo: 'CONDUCTOR', sueldoBase: 300, motivo: 'Ajuste', vigenteDesde: '10/10/2026' })).toMatch(/fecha/i);
  });
  it('completa pasa', () => {
    expect(validarFilaTabulador({ cargo: 'CONDUCTOR', sueldoBase: 300, motivo: 'Ajuste', vigenteDesde: '2026-10-10' })).toBeNull();
  });
});

describe('a quién le cambia el sueldo al aplicar', () => {
  const tabulador = [fila('CONDUCTOR', 500), fila('VIGILANTE', 0), fila('COCINERO', 400, false), fila('ALMACENISTA', 300)];
  const personal = [
    persona('a', 'conductor', 400),          // sube a 500
    persona('b', 'CONDUCTOR', 500),          // ya cobra lo del tabulador
    persona('c', 'CONDUCTOR', 1300, false),  // inactivo: no se toca
    persona('d', 'VIGILANTE', 200),          // tabulador sin definir
    persona('e', 'COCINERO', 250),           // fila desactivada
    persona('f', null, 499),                 // sin cargo
    persona('g', 'ALMACENISTA', 300.004),    // mismo sueldo a centavos
    persona('h', 'GERENTE', 1500),           // cargo que no está
  ];
  const d = diffAplicarTabulador(personal, tabulador);

  it('solo cambia quien cobra distinto y tiene fila aplicable', () => {
    expect(d.cambios.map((c) => c.persona.id)).toEqual(['a']);
    expect(d.cambios[0].anterior).toBe(400);
    expect(d.cambios[0].nuevo).toBe(500);
    expect(d.cambios[0].variacion.pct).toBe(25);
    expect(d.cambios[0].variacion.direccion).toBe('aumento');
  });
  it('sin cambio: los que ya cobran lo del tabulador (a centavos)', () => {
    expect(d.sinCambio.map((p) => p.id).sort()).toEqual(['b', 'g']);
  });
  it('fuera del tabulador: sin definir, desactivado o cargo ausente', () => {
    expect(d.sinTabulador.map((p) => p.id).sort()).toEqual(['d', 'e', 'h']);
  });
  it('sin cargo aparte, inactivos ignorados', () => {
    expect(d.sinCargo.map((p) => p.id)).toEqual(['f']);
    const todos = [...d.cambios.map((c) => c.persona.id), ...d.sinCambio, ...d.sinTabulador, ...d.sinCargo].length;
    expect(todos).toBe(7);
  });
  it('una rebaja también cuenta como cambio, con porcentaje negativo', () => {
    const r = diffAplicarTabulador([persona('x', 'CONDUCTOR', 1000)], [fila('CONDUCTOR', 800)]);
    expect(r.cambios[0].variacion.pct).toBe(-20);
    expect(r.cambios[0].variacion.direccion).toBe('rebaja');
  });
  it('el resumen cuenta bien', () => {
    expect(resumenAplicacion(d)).toBe('1 persona cambia de sueldo · 2 ya cobran lo del tabulador · 3 con cargo fuera del tabulador (no se tocan)');
  });
});

describe('motivo e historial', () => {
  it('el motivo lleva la fecha como la escribe la base', () => {
    expect(motivoTabulador('2026-10-09')).toBe('Tabulador aplicado · 09-10-2026');
  });
  it('etiquetas de acción', () => {
    expect(labelAccionTabulador('alta')).toBe('Alta');
    expect(labelAccionTabulador('baja')).toBe('Desactivado');
    expect(labelAccionTabulador(null)).toBe('—');
  });
  it('filtra por cargo normalizado', () => {
    const h = [{ cargo: 'CONDUCTOR' }, { cargo: 'Conductor' }, { cargo: 'VIGILANTE' }];
    expect(filtrarHistorialPorCargo(h, ' conductor')).toHaveLength(2);
    expect(filtrarHistorialPorCargo(h, '')).toHaveLength(3);
  });
});

describe('armar el tabulador desde los cargos que existen', () => {
  const tab = [fila('CONDUCTOR', 300), fila('AYUDANTE', 0)];
  const gente = [
    persona('a', 'Conductor', 300), persona('b', 'conductor', 300),
    persona('c', 'Ayudante', 150), persona('d', 'AYUDANTE', 180),
    persona('e', 'Soldador', 420), persona('f', 'Soldador', 420),
    persona('g', 'Vigilante', 200, false), // inactivo: su cargo no entra por él
  ];
  const renglones = armarTabuladorDesdeCargos(['Analista', 'conductor '], gente, tab);

  it('junta catálogo, fichas activas y tabulador, sin repetir y ordenado', () => {
    expect(renglones.map((r) => r.cargo)).toEqual(['ANALISTA', 'AYUDANTE', 'CONDUCTOR', 'SOLDADOR']);
  });
  it('el sueldo actual sale del tabulador; si no está, de la ficha cuando todos cobran igual', () => {
    const por = Object.fromEntries(renglones.map((r) => [r.cargo, r]));
    expect(por.CONDUCTOR).toMatchObject({ sueldoActual: 300, referencia: 'tabulador', activos: 2 });
    expect(por.SOLDADOR).toMatchObject({ sueldoActual: 420, referencia: 'personal', activos: 2, fila: null });
    expect(por.AYUDANTE).toMatchObject({ sueldoActual: null, referencia: 'varios', sueldosPersonal: [150, 180] });
    expect(por.ANALISTA).toMatchObject({ sueldoActual: null, referencia: 'ninguna', activos: 0 });
  });
  it('solo se guardan las altas con monto y los cambios de monto', () => {
    const cambios = cambiosArmado(renglones, { SOLDADOR: 420, CONDUCTOR: 300, AYUDANTE: 170, ANALISTA: null });
    expect(cambios.map((c) => `${c.accion}:${c.cargo}:${c.anterior}>${c.nuevo}`)).toEqual(['cambio:AYUDANTE:0>170', 'alta:SOLDADOR:420>420']);
    expect(cambiosArmado(renglones, { CONDUCTOR: 350 })[0]).toMatchObject({ accion: 'cambio', anterior: 300, nuevo: 350, variacion: { pct: 16.7 } });
    expect(cambiosArmado(renglones, { ANALISTA: 0 })[0]).toMatchObject({ accion: 'alta', nuevo: 0 });
    expect(cambiosArmado(renglones, { CONDUCTOR: -5 })).toEqual([]);
  });
  it('la propuesta impresa lleva anterior y nuevo por cargo, y la vigencia solo donde cambia', () => {
    const exp = filasExportArmado(renglones, { CONDUCTOR: 350, AYUDANTE: 170 }, '2026-11-01');
    const por = Object.fromEntries(exp.map((f) => [f.cargo, f]));
    expect(por.CONDUCTOR).toEqual({ cargo: 'CONDUCTOR', activos: 2, anterior: 300, nuevo: 350, vigenteDesde: '2026-11-01' });
    expect(por.SOLDADOR).toEqual({ cargo: 'SOLDADOR', activos: 2, anterior: 420, nuevo: 420, vigenteDesde: null });
    expect(por.AYUDANTE).toMatchObject({ anterior: null, nuevo: 170, vigenteDesde: '2026-11-01' });
  });
});

describe('el tabulador vigente impreso: anterior desde el historial', () => {
  const h = (cargo: string, accion: string, sueldoAnterior: number, sueldoNuevo: number, createdAt: string): HistorialTabulador => ({
    id: `${cargo}-${createdAt}`, tabuladorId: null, cargo, accion, sueldoAnterior, sueldoNuevo, vigenteDesde: null, motivo: 'x', cambiadoPor: null, cambiadoPorNombre: null, createdAt,
  });
  // del más nuevo al más viejo, como lo devuelve la base
  const historial = [
    h('CONDUCTOR', 'cambio', 350, 350, '2026-10-12'), // solo vigencia: no cuenta
    h('CONDUCTOR', 'cambio', 300, 350, '2026-10-10'),
    h('CONDUCTOR', 'alta', 0, 300, '2026-10-09'),
    h('AYUDANTE', 'baja', 150, 150, '2026-10-11'),
    h('AYUDANTE', 'alta', 0, 150, '2026-10-09'),
  ];
  it('toma el anterior del último cambio de monto', () => {
    const m = anteriorPorCargo(historial);
    expect(m.get('CONDUCTOR')).toBe(300);
    expect(m.get('AYUDANTE')).toBe(0);
  });
  it('arma las filas con personas activas y sin los desactivados salvo que se pidan', () => {
    const filas = [fila('CONDUCTOR', 350), fila('AYUDANTE', 150, false)];
    const gente = [persona('a', 'conductor', 350), persona('b', 'Conductor', 300), persona('c', 'ayudante', 150)];
    expect(filasExportTabulador(filas, historial, gente)).toEqual([{ cargo: 'CONDUCTOR', activos: 2, anterior: 300, nuevo: 350, vigenteDesde: '2026-10-01' }]);
    expect(filasExportTabulador(filas, historial, gente, true).map((f) => f.cargo)).toEqual(['AYUDANTE', 'CONDUCTOR']);
    expect(filasExportTabulador(filas, historial, gente, true)[0].anterior).toBeNull();
  });
});
