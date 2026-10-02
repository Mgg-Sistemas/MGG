import { describe, expect, it } from 'vitest';
import { errorHorometro, hiEncadenado, horasTrabajadas, leerMedidor, textoHorometro } from './horometro';

describe('leerMedidor', () => {
  it('toma el número tecleado, con coma o con punto', () => {
    expect(leerMedidor('1512.5')).toBe(1512.5);
    expect(leerMedidor('1512,5')).toBe(1512.5);
    expect(leerMedidor(1512.5)).toBe(1512.5);
    expect(leerMedidor('0')).toBe(0);
  });

  it('vacío, nulo o basura es «no lo cargaron»', () => {
    expect(leerMedidor('')).toBeNull();
    expect(leerMedidor(null)).toBeNull();
    expect(leerMedidor(undefined)).toBeNull();
    expect(leerMedidor('abc')).toBeNull();
  });
});

describe('horasTrabajadas', () => {
  it('son HF menos HI, con dos decimales', () => {
    expect(horasTrabajadas('1500', '1512.5')).toBe(12.5);
    expect(horasTrabajadas(1500, 1508)).toBe(8);
    expect(horasTrabajadas('1500,25', '1512,75')).toBe(12.5);
  });

  it('no inventa el resultado de un decimal binario', () => {
    expect(horasTrabajadas('0.1', '0.3')).toBe(0.2);
  });

  it('con un medidor sin cargar no afirma nada', () => {
    expect(horasTrabajadas('1500', '')).toBeNull();
    expect(horasTrabajadas('', '1512')).toBeNull();
    expect(horasTrabajadas('', '')).toBeNull();
  });

  it('el equipo que no trabajó da cero, no null', () => {
    expect(horasTrabajadas('1500', '1500')).toBe(0);
  });

  it('el retroceso se devuelve negativo, para poder mostrarlo', () => {
    expect(horasTrabajadas('1500', '1490')).toBe(-10);
  });
});

describe('errorHorometro', () => {
  it('rechaza el HF menor que el HI, porque es el HI del próximo surtido', () => {
    expect(errorHorometro('1500', '1490')).toMatch(/no puede ser menor/i);
    expect(errorHorometro('1500', '1490')).toMatch(/próximo surtido/i);
  });

  it('acepta el avance normal y el equipo que no trabajó', () => {
    expect(errorHorometro('1500', '1512')).toBeNull();
    expect(errorHorometro('1500', '1500')).toBeNull();
  });

  it('no estorba mientras falte cargar un medidor', () => {
    expect(errorHorometro('1500', '')).toBeNull();
    expect(errorHorometro('', '')).toBeNull();
  });
});

describe('textoHorometro', () => {
  it('muestra el tramo y las horas del movimiento guardado', () => {
    expect(textoHorometro(1500, 1512.5)).toBe('1500 → 1512.5 · 12.5 h');
  });

  it('con un solo extremo muestra el tramo sin horas', () => {
    expect(textoHorometro(1500, null)).toBe('1500 → —');
    expect(textoHorometro(null, 1512)).toBe('— → 1512');
  });

  it('sin horómetros no hay nada que mostrar', () => {
    expect(textoHorometro(null, null)).toBeNull();
  });

  it('usa el formateador del sistema cuando se lo pasan', () => {
    expect(textoHorometro(1500, 1512.5, (n) => n.toLocaleString('es-VE'))).toBe('1.500 → 1.512,5 · 12,5 h');
  });
});

describe('hiEncadenado · el HF anterior es el HI del próximo (al guardar)', () => {
  it('HI vacío toma el último HF del equipo', () => {
    expect(hiEncadenado(null, 1142.1)).toBe(1142.1);
  });
  it('si el HI vino escrito, se respeta', () => {
    expect(hiEncadenado(900, 1142.1)).toBe(900);
  });
  it('primer surtido del equipo sin HI: queda vacío', () => {
    expect(hiEncadenado(null, null)).toBeNull();
  });
});
