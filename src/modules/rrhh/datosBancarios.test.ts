import { describe, expect, it } from 'vitest';
import { cuentaValida, direccionTronValida, errorCuenta, leerCuentas, telefonoValido, textoCuenta } from './datosBancarios';

describe('datos bancarios del trabajador', () => {
  it('teléfono de pago móvil 04xx', () => {
    expect(telefonoValido('0414-1234567')).toBe(true);
    expect(telefonoValido('+58 412 1234567')).toBe(true);
    expect(telefonoValido('0212-1234567')).toBe(false);
    expect(telefonoValido('0414123')).toBe(false);
  });

  it('cuenta de 20 dígitos que empieza por el banco', () => {
    expect(cuentaValida('0134-0000-00-0000000000', '0134')).toBe(true);
    expect(cuentaValida('0102000000000000000000', '0134')).toBe(false);
    expect(cuentaValida('013400000', '0134')).toBe(false);
  });

  it('dirección TRON', () => {
    expect(direccionTronValida('TJYeasTPa6gpEEfYqNnAXTqKMJdkzYvZPh')).toBe(true);
    expect(direccionTronValida('0xabc')).toBe(false);
    expect(direccionTronValida('TJYeasTPa6gpEEfYqNnAXTqKMJdkzYvZP0')).toBe(false); // 0 no es base58
  });

  it('errores por tipo', () => {
    expect(errorCuenta({ id: '1', tipo: 'pago_movil', banco: '0134', telefono: '04141234567', cedula: 'V-12345678' })).toBeNull();
    expect(errorCuenta({ id: '1', tipo: 'pago_movil', banco: '0134', telefono: '123', cedula: 'V-12345678' })).toMatch(/04xx/);
    expect(errorCuenta({ id: '2', tipo: 'binance', usuario: '' })).toMatch(/Binance/);
    expect(errorCuenta({ id: '3', tipo: 'trc20', direccion: 'TJYeasTPa6gpEEfYqNnAXTqKMJdkzYvZPh' })).toBeNull();
  });

  it('lee datos viejos o vacíos sin fallar', () => {
    expect(leerCuentas(null)).toEqual([]);
    expect(leerCuentas({})).toEqual([]);
    expect(leerCuentas({ cuentas: [{ id: 'a', tipo: 'binance', usuario: 'juan' }, 5, null] })).toHaveLength(1);
  });

  it('texto para copiar', () => {
    const t = textoCuenta({ id: '1', tipo: 'pago_movil', banco: '0134', telefono: '0414-1234567', cedula: 'V-12345678' });
    expect(t).toContain('Pago móvil (Bs)');
    expect(t).toContain('Banco: 0134 · Banesco');
    expect(t).toContain('Teléfono: 0414-1234567');
  });
});
