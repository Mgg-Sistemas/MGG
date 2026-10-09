import { describe, it, expect } from 'vitest';
import {
  MOTIVO_HISTORICO_POR_DEFECTO, esRenglonHistorico, sueldoPorAnio, sugerirSueldoAnterior, validarSueldoHistorico, vigenciaSueldoActual,
} from './sueldoHistorico';
import { labelTipoCambio } from './cambioSueldo';

const HOY = '2026-10-09';
const historial = [
  { sueldoNuevo: 500, vigenteDesde: '2026-01-15', tipo: 'inicial' },
  { sueldoNuevo: 300, vigenteDesde: '2024-03-01', tipo: 'historico' },
  { sueldoNuevo: 200, vigenteDesde: '2023-01-01', tipo: 'historico' },
];

describe('vigencia del sueldo actual', () => {
  it('es la del último renglón que no sea histórico', () => {
    expect(vigenciaSueldoActual(historial)).toBe('2026-01-15');
  });
  it('los históricos no cuentan, aunque sean más nuevos', () => {
    expect(vigenciaSueldoActual([{ sueldoNuevo: 1, vigenteDesde: '2026-09-01', tipo: 'historico' }, ...historial])).toBe('2026-01-15');
  });
  it('sin renglones reales no hay vigencia', () => {
    expect(vigenciaSueldoActual([])).toBeNull();
    expect(vigenciaSueldoActual([{ sueldoNuevo: 1, vigenteDesde: '2020-01-01', tipo: 'historico' }])).toBeNull();
  });
});

describe('sueldo anterior sugerido', () => {
  it('toma el renglón inmediatamente anterior', () => {
    expect(sugerirSueldoAnterior(historial, '2025-06-01')).toBe(300);
    expect(sugerirSueldoAnterior(historial, '2024-01-01')).toBe(200);
  });
  it('sin nada antes es 0', () => {
    expect(sugerirSueldoAnterior(historial, '2022-01-01')).toBe(0);
    expect(sugerirSueldoAnterior(historial, '')).toBe(0);
  });
  it('la misma fecha no cuenta como anterior', () => {
    expect(sugerirSueldoAnterior(historial, '2024-03-01')).toBe(200);
  });
});

describe('validar un sueldo viejo', () => {
  const base = { vigenteDesde: '2025-06-01', sueldoNuevo: 400, sueldoAnterior: 300, motivo: MOTIVO_HISTORICO_POR_DEFECTO, hoy: HOY, vigenciaActual: '2026-01-15', historial };
  it('todo bien', () => expect(validarSueldoHistorico(base)).toBeNull());
  it('sin fecha', () => expect(validarSueldoHistorico({ ...base, vigenteDesde: '' })).toMatch(/fecha/));
  it('a futuro', () => expect(validarSueldoHistorico({ ...base, vigenteDesde: '2026-12-01', vigenciaActual: null })).toMatch(/futuro/));
  it('igual o después del sueldo actual', () => {
    expect(validarSueldoHistorico({ ...base, vigenteDesde: '2026-01-15' })).toMatch(/15\/01\/2026/);
    expect(validarSueldoHistorico({ ...base, vigenteDesde: '2026-05-01' })).toMatch(/cambiar sueldo/);
  });
  it('sin vigencia actual cualquier fecha pasada vale', () => {
    expect(validarSueldoHistorico({ ...base, vigenciaActual: null, historial: [] })).toBeNull();
  });
  it('monto vacío o negativo', () => {
    expect(validarSueldoHistorico({ ...base, sueldoNuevo: '' })).toMatch(/sueldo mensual/);
    expect(validarSueldoHistorico({ ...base, sueldoNuevo: -1 })).toMatch(/negativo/);
    expect(validarSueldoHistorico({ ...base, sueldoAnterior: -1 })).toMatch(/anterior/);
  });
  it('cero vale (no cobraba)', () => expect(validarSueldoHistorico({ ...base, sueldoNuevo: 0 })).toBeNull());
  it('motivo corto', () => expect(validarSueldoHistorico({ ...base, motivo: 'ok' })).toMatch(/motivo/));
  it('misma vigencia que un renglón ya cargado', () => {
    expect(validarSueldoHistorico({ ...base, vigenteDesde: '2024-03-01' })).toMatch(/Ya hay un renglón/);
  });
});

describe('etiquetas y años', () => {
  it('el tipo histórico se ve como carga manual', () => {
    expect(labelTipoCambio('historico')).toBe('Histórico (carga manual)');
    expect(esRenglonHistorico({ tipo: 'historico' })).toBe(true);
    expect(esRenglonHistorico({ tipo: 'inicial' })).toBe(false);
  });
  it('sueldo por año: el último que rigió cada año', () => {
    expect(sueldoPorAnio([...historial, { sueldoNuevo: 250, vigenteDesde: '2023-07-01', tipo: 'historico' }])).toEqual([
      { anio: 2023, sueldo: 250, cambios: 2 },
      { anio: 2024, sueldo: 300, cambios: 1 },
      { anio: 2026, sueldo: 500, cambios: 1 },
    ]);
  });
});
