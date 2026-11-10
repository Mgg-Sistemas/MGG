import { describe, it, expect } from 'vitest';
import {
  CALIDAD_LABELS,
  validarArchivoFactura,
  calcularPuntualidadAutomatica,
  LIMITE_FACTURA_BYTES,
} from './finalizarPedidoEvaluacion';

describe('finalizarPedidoEvaluacion', () => {
  describe('CALIDAD_LABELS', () => {
    it('tiene etiquetas descriptivas para las 5 estrellas', () => {
      expect(CALIDAD_LABELS[5]).toBe('5 estrellas · Excelente');
      expect(CALIDAD_LABELS[4]).toBe('4 estrellas · Buena');
      expect(CALIDAD_LABELS[3]).toBe('3 estrellas · Aceptable');
      expect(CALIDAD_LABELS[2]).toBe('2 estrellas · Deficiente');
      expect(CALIDAD_LABELS[1]).toBe('1 estrella · Muy mala');
    });
  });

  describe('validarArchivoFactura', () => {
    it('permite archivo nulo o indefinido', () => {
      expect(validarArchivoFactura(null)).toBeNull();
      expect(validarArchivoFactura(undefined)).toBeNull();
    });

    it('permite archivos de hasta 10 MB', () => {
      expect(validarArchivoFactura({ size: LIMITE_FACTURA_BYTES })).toBeNull();
      expect(validarArchivoFactura({ size: 1024 * 500 })).toBeNull();
    });

    it('rechaza archivos que superen 10 MB', () => {
      const resultado = validarArchivoFactura({ size: LIMITE_FACTURA_BYTES + 1 });
      expect(resultado).toBe('La factura no puede superar 10 MB.');
    });
  });

  describe('calcularPuntualidadAutomatica', () => {
    it('retorna 0 si no hay fecha prometida', () => {
      expect(calcularPuntualidadAutomatica('', '2026-11-10')).toBe(0);
      expect(calcularPuntualidadAutomatica(null, '2026-11-10')).toBe(0);
      expect(calcularPuntualidadAutomatica(undefined, '2026-11-10')).toBe(0);
    });

    it('retorna 0 si se recibió exactamente el mismo día prometido', () => {
      expect(calcularPuntualidadAutomatica('2026-11-10', '2026-11-10')).toBe(0);
    });

    it('retorna positivo si se recibió antes (adelantado)', () => {
      // Prometida 15-nov, recibido 10-nov -> 5 días antes
      expect(calcularPuntualidadAutomatica('2026-11-15', '2026-11-10')).toBe(5);
    });

    it('retorna negativo si se recibió después (atrasado)', () => {
      // Prometida 08-nov, recibido 10-nov -> 2 días después
      expect(calcularPuntualidadAutomatica('2026-11-08', '2026-11-10')).toBe(-2);
    });

    it('tolera timestamps ISO completos', () => {
      expect(calcularPuntualidadAutomatica('2026-11-12T14:30:00Z', '2026-11-10T08:00:00Z')).toBe(2);
    });
  });
});
