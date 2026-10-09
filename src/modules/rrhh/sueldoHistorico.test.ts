import { describe, it, expect } from 'vitest';
import {
  MOTIVO_HISTORICO_POR_DEFECTO, analizarFilasHistorico, corrigeSemilla, esRenglonHistorico, esRenglonSemilla, normCedula,
  parseFechaExcel, parseMontoExcel, sueldoPorAnio, sugerirSueldoAnterior, validarSueldoHistorico, vigenciaSueldoActual,
} from './sueldoHistorico';
import { labelTipoCambio } from './cambioSueldo';

const HOY = '2026-10-09';
const historial = [
  { sueldoNuevo: 500, vigenteDesde: '2026-01-15', tipo: 'aumento' },
  { sueldoNuevo: 300, vigenteDesde: '2024-03-01', tipo: 'historico' },
  { sueldoNuevo: 200, vigenteDesde: '2023-01-01', tipo: 'historico' },
];
const semilla = { sueldoNuevo: 500, vigenteDesde: '2019-05-01', tipo: 'inicial', actorName: 'Sistema', motivo: 'Sueldo con el que la ficha ya estaba cargada en el sistema, antes de que existiera el historial.' };

describe('vigencia del sueldo actual', () => {
  it('es la del último cambio real', () => {
    expect(vigenciaSueldoActual(historial)).toBe('2026-01-15');
  });
  it('los históricos no cuentan, aunque sean más nuevos', () => {
    expect(vigenciaSueldoActual([{ sueldoNuevo: 1, vigenteDesde: '2026-09-01', tipo: 'historico' }, ...historial])).toBe('2026-01-15');
  });
  it('la semilla de la migración tampoco cuenta', () => {
    expect(esRenglonSemilla(semilla)).toBe(true);
    expect(vigenciaSueldoActual([semilla])).toBeNull();
    // Todo renglón «inicial» es semilla (lo puso el trigger al crear la ficha), sin importar quién creó la ficha.
    expect(vigenciaSueldoActual([{ ...semilla, actorName: 'Ana', motivo: 'Sueldo con el que se creó la ficha.' }])).toBeNull();
  });
  it('sin renglones reales no hay vigencia', () => {
    expect(vigenciaSueldoActual([])).toBeNull();
  });
});

describe('sueldo anterior sugerido', () => {
  it('toma el renglón inmediatamente anterior', () => {
    expect(sugerirSueldoAnterior(historial, '2025-06-01')).toBe(300);
    expect(sugerirSueldoAnterior(historial, '2024-01-01')).toBe(200);
  });
  it('sin nada antes es 0, y la semilla no se sugiere', () => {
    expect(sugerirSueldoAnterior(historial, '2022-01-01')).toBe(0);
    expect(sugerirSueldoAnterior([semilla], '2021-01-01')).toBe(0);
    expect(sugerirSueldoAnterior(historial, '')).toBe(0);
  });
  it('la misma fecha no cuenta como anterior', () => {
    expect(sugerirSueldoAnterior(historial, '2024-03-01')).toBe(200);
  });
});

describe('validar un sueldo viejo', () => {
  const base = { vigenteDesde: '2025-06-01', sueldoNuevo: 400, sueldoAnterior: 300, motivo: MOTIVO_HISTORICO_POR_DEFECTO, hoy: HOY, vigenciaActual: '2026-01-15', historial, sueldoActual: 500 };
  it('todo bien', () => expect(validarSueldoHistorico(base)).toBeNull());
  it('sin fecha', () => expect(validarSueldoHistorico({ ...base, vigenteDesde: '' })).toMatch(/fecha/));
  it('a futuro', () => expect(validarSueldoHistorico({ ...base, vigenteDesde: '2026-12-01', vigenciaActual: null })).toMatch(/futuro/));
  it('igual o después del último cambio real', () => {
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

  describe('con la semilla de la fecha de ingreso', () => {
    const conSemilla = { ...base, vigenciaActual: null, historial: [semilla] };
    it('antes de la semilla entra cualquier sueldo viejo', () => {
      expect(validarSueldoHistorico({ ...conSemilla, vigenteDesde: '2018-01-01', sueldoNuevo: 150 })).toBeNull();
    });
    it('en o después de la semilla solo entra el sueldo de hoy, que la corrige', () => {
      expect(validarSueldoHistorico({ ...conSemilla, vigenteDesde: '2024-03-01', sueldoNuevo: 500 })).toBeNull();
      expect(corrigeSemilla({ ...conSemilla, vigenteDesde: '2024-03-01', sueldoNuevo: 500 })).toBe(true);
      // Misma fecha que la semilla, con el sueldo de hoy: la corrige, no choca por fecha repetida.
      expect(validarSueldoHistorico({ ...conSemilla, vigenteDesde: '2019-05-01', sueldoNuevo: 500 })).toBeNull();
    });
    it('otro sueldo en o después de la semilla pide cargar primero el de hoy', () => {
      expect(validarSueldoHistorico({ ...conSemilla, vigenteDesde: '2019-05-01', sueldoNuevo: 200 })).toMatch(/Cargá primero el sueldo de hoy/);
      expect(validarSueldoHistorico({ ...conSemilla, vigenteDesde: '2022-01-01', sueldoNuevo: 300 })).toMatch(/01\/05\/2019/);
      expect(corrigeSemilla({ ...conSemilla, vigenteDesde: '2022-01-01', sueldoNuevo: 300 })).toBe(false);
    });
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

describe('lectura del Excel', () => {
  it('fechas: dd/mm/aaaa, ISO, mm/aaaa, solo año, serie de Excel y Date', () => {
    expect(parseFechaExcel('05/03/2021')).toBe('2021-03-05');
    expect(parseFechaExcel('2021-03-05')).toBe('2021-03-05');
    expect(parseFechaExcel('03/2021')).toBe('2021-03-01');
    expect(parseFechaExcel('2021')).toBe('2021-01-01');
    expect(parseFechaExcel(2021)).toBe('2021-01-01');
    expect(parseFechaExcel(44256)).toBe('2021-03-01');
    expect(parseFechaExcel(new Date(2021, 2, 5))).toBe('2021-03-05');
    expect(parseFechaExcel('31/02/2021')).toBeNull();
    expect(parseFechaExcel('ayer')).toBeNull();
  });
  it('montos con coma o punto', () => {
    expect(parseMontoExcel('1.250,50')).toBe(1250.5);
    expect(parseMontoExcel('1,250.50')).toBe(1250.5);
    expect(parseMontoExcel('300,5')).toBe(300.5);
    expect(parseMontoExcel('$300')).toBe(300);
    expect(parseMontoExcel(280)).toBe(280);
    expect(parseMontoExcel('')).toBeNull();
  });
  it('cédula solo con dígitos', () => {
    expect(normCedula('V-12.345.678')).toBe('12345678');
    expect(normCedula(12345678)).toBe('12345678');
  });
  it('arma las filas válidas y marca los errores con su número de fila', () => {
    const personas = [{ id: 'p1', cedula: 'V-12.345.678', nombre: 'ANA' }];
    const filas = analizarFilasHistorico([
      { 'Cédula': '12345678', 'Año': 2021, 'Sueldo': '150' },
      { 'Cédula': '12345678', 'Fecha': '01/06/2023', 'Sueldo': 200, 'Motivo': 'Aumento', 'Nota': 'por desempeño' },
      { 'Cédula': '999', 'Fecha': '2022', 'Sueldo': 100 },
      { 'Cédula': '12345678', 'Año': '2021', 'Sueldo': 170 },
      { 'Cédula': '', 'Fecha': '', 'Sueldo': '' },
    ], personas, HOY);
    expect(filas).toHaveLength(4);
    expect(filas[0]).toMatchObject({ fila: 2, fecha: '2021-01-01', sueldo: 150, motivo: MOTIVO_HISTORICO_POR_DEFECTO, error: null });
    expect(filas[1]).toMatchObject({ fila: 3, motivo: 'Aumento', nota: 'por desempeño', error: null });
    expect(filas[2].error).toMatch(/No hay nadie/);
    expect(filas[3].error).toMatch(/repetida/);
  });
});
