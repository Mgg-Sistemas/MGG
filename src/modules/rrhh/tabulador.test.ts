import { describe, it, expect } from 'vitest';
import {
  diffAplicarTabulador, filaAplicable, filtrarHistorialPorCargo, labelAccionTabulador, motivoTabulador,
  normalizarCargo, resumenAplicacion, validarFilaTabulador, type FilaTabulador, type PersonaParaTabulador,
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
