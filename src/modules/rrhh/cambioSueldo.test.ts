import { describe, it, expect } from 'vitest';
import {
  aCentavos, cambioSueldoValido, huboCambioSueldo, labelTipoCambio, sueldoVigenteEn,
  textoVariacion, tipoSugerido, validarCambioSueldo, variacionSueldo,
} from './cambioSueldo';

describe('cuándo hay cambio de sueldo', () => {
  it('el mismo sueldo no es un cambio', () => {
    expect(huboCambioSueldo(500, 500)).toBe(false);
  });

  it('una diferencia de menos de un centavo no es un cambio', () => {
    // Sin esto, el historial se llena de renglones de cero: es ruido.
    expect(huboCambioSueldo(500, 500.004)).toBe(false);
    expect(huboCambioSueldo(500, 500.01)).toBe(true);
  });

  it('pasar de sin sueldo a con sueldo es un cambio', () => {
    expect(huboCambioSueldo(0, 450)).toBe(true);
  });

  it('el redondeo va a centavos', () => {
    expect(aCentavos('500,5')).toBe(0);      // la coma no es decimal en Number()
    expect(aCentavos(500.567)).toBe(500.57);
  });
});

describe('sin motivo no se guarda', () => {
  it('cambió el sueldo y no hay motivo: reclama', () => {
    expect(validarCambioSueldo({ anterior: 500, nuevo: 600 })).toMatch(/por qué/i);
  });

  it('un motivo de dos letras no explica nada', () => {
    expect(validarCambioSueldo({ anterior: 500, nuevo: 600, motivo: 'ok' })).toMatch(/corto/i);
  });

  it('con motivo se puede guardar', () => {
    expect(validarCambioSueldo({ anterior: 500, nuevo: 600, motivo: 'Aumento acordado en junio' })).toBeNull();
    expect(cambioSueldoValido({ anterior: 500, nuevo: 600, motivo: 'Aumento acordado en junio' })).toBe(true);
  });

  it('si el sueldo NO cambia, no se pide motivo', () => {
    // Corregir un teléfono no es un cambio de sueldo.
    expect(validarCambioSueldo({ anterior: 500, nuevo: 500 })).toBeNull();
  });

  it('un sueldo negativo no pasa aunque traiga motivo', () => {
    expect(validarCambioSueldo({ anterior: 500, nuevo: -1, motivo: 'error' })).toMatch(/negativo/i);
  });

  it('una fecha de vigencia rota se rechaza', () => {
    expect(validarCambioSueldo({
      anterior: 500, nuevo: 600, motivo: 'Aumento anual', vigenteDesde: '22/09/2026',
    })).toMatch(/fecha/i);
  });
});

describe('de cuánto a cuánto', () => {
  it('calcula el monto y el porcentaje', () => {
    const v = variacionSueldo(500, 600);
    expect(v.monto).toBe(100);
    expect(v.pct).toBe(20);
    expect(v.direccion).toBe('aumento');
  });

  it('una rebaja da monto y porcentaje negativos', () => {
    const v = variacionSueldo(600, 500);
    expect(v.monto).toBe(-100);
    expect(v.pct).toBeCloseTo(-16.7, 1);
    expect(v.direccion).toBe('rebaja');
  });

  it('desde cero NO hay porcentaje: no es un aumento infinito', () => {
    const v = variacionSueldo(0, 500);
    expect(v.pct).toBeNull();
    expect(textoVariacion(v)).toMatch(/primer sueldo/i);
  });

  it('lo dice en una línea', () => {
    expect(textoVariacion(variacionSueldo(500, 600))).toMatch(/sube/i);
    expect(textoVariacion(variacionSueldo(500, 500))).toMatch(/no cambia/i);
  });
});

describe('el tipo que se sugiere solo', () => {
  it('sube → aumento, baja → rebaja, desde cero → inicial', () => {
    expect(tipoSugerido(500, 600)).toBe('aumento');
    expect(tipoSugerido(600, 500)).toBe('rebaja');
    expect(tipoSugerido(0, 500)).toBe('inicial');
  });

  it('la carga inicial se nombra distinto', () => {
    expect(labelTipoCambio('inicial')).toBe('Carga inicial');
    expect(labelTipoCambio('correccion')).toMatch(/corrección/i);
  });
});

describe('qué sueldo regía en una fecha', () => {
  const hist = [
    { sueldoAnterior: 0, sueldoNuevo: 400, vigenteDesde: '2026-01-01' },
    { sueldoAnterior: 400, sueldoNuevo: 500, vigenteDesde: '2026-05-01' },
    { sueldoAnterior: 500, sueldoNuevo: 650, vigenteDesde: '2026-09-01' },
  ];

  it('toma el último que ya regía', () => {
    expect(sueldoVigenteEn(hist, '2026-06-15')).toBe(500);
    expect(sueldoVigenteEn(hist, '2026-09-22')).toBe(650);
  });

  it('el mismo día en que arranca, ya rige', () => {
    expect(sueldoVigenteEn(hist, '2026-05-01')).toBe(500);
  });

  it('antes del primero no inventa un sueldo', () => {
    expect(sueldoVigenteEn(hist, '2025-12-31')).toBeNull();
  });

  it('el orden en que vengan los renglones no cambia el resultado', () => {
    const revuelto = [hist[2], hist[0], hist[1]];
    expect(sueldoVigenteEn(revuelto, '2026-06-15')).toBe(500);
  });
});
