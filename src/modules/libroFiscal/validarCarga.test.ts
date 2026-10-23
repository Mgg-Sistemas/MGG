import { describe, expect, it } from 'vitest';
import {
  etiquetaDocumentoRespaldo, faltaEnLaCarga, leerMonto, numeroATexto, textoLeido,
  validarDocumentoRespaldo,
} from './validarCarga';

describe('lo que la carga exige antes de registrar', () => {
  it('sin N° de factura no se registra una retención de IVA, ISLR o municipal', () => {
    for (const tipo of ['iva', 'islr', 'municipal', 'regional'] as const) {
      expect(faltaEnLaCarga({ tipo, facturaNumero: '', facturaFecha: '2026-10-01' })).toContain('N° de factura requerido');
      expect(faltaEnLaCarga({ tipo, facturaNumero: '   ', facturaFecha: '2026-10-01' })).toContain('N° de factura requerido');
    }
  });

  it('con el N° de factura, no falta nada', () => {
    expect(faltaEnLaCarga({ tipo: 'iva', facturaNumero: '000123', facturaFecha: '2026-10-01' })).toBeNull();
  });

  it('el IGTF no pide factura: es una percepción por pago', () => {
    expect(faltaEnLaCarga({ tipo: 'igtf', facturaNumero: '', facturaFecha: '2026-10-01' })).toBeNull();
  });

  it('sin fecha de la factura no se registra: de ella sale el período (y en IVA la quincena)', () => {
    for (const tipo of ['iva', 'islr', 'municipal', 'regional', 'igtf'] as const) {
      expect(faltaEnLaCarga({ tipo, facturaNumero: '000123', facturaFecha: '' })).toContain('Fecha de la factura requerida');
    }
  });

  it('una fecha a medias tampoco sirve', () => {
    expect(faltaEnLaCarga({ tipo: 'islr', facturaNumero: '000123', facturaFecha: '2026-10' })).toContain('Fecha de la factura requerida');
    expect(faltaEnLaCarga({ tipo: 'islr', facturaNumero: '000123', facturaFecha: '2026-13-01' })).toContain('Fecha de la factura requerida');
  });
});

describe('montos escritos a mano', () => {
  it('entiende la coma decimal con y sin punto de miles', () => {
    expect(leerMonto('1.234,56')).toBe(1234.56);
    expect(leerMonto('1234,56')).toBe(1234.56);
    expect(leerMonto('1.234.567,8')).toBe(1234567.8);
  });
  it('entiende el punto decimal (como viene la tasa)', () => {
    expect(leerMonto('879.12')).toBe(879.12);
    expect(leerMonto('151.54')).toBe(151.54);
  });
  it('varios puntos sin coma son miles', () => {
    expect(leerMonto('1.234.567')).toBe(1234567);
  });
  it('formato venezolano: un punto seguido de 3 dígitos, sin coma, son miles (D41, Lote 1)', () => {
    expect(leerMonto('1.234')).toBe(1234);
    expect(leerMonto('36.500')).toBe(36500);
    expect(leerMonto('1.234,56')).toBe(1234.56);
    expect(leerMonto('-1.234')).toBe(-1234);
  });
  it('punto con 1, 2 o 4+ dígitos es decimal; con parte entera 0 también', () => {
    expect(leerMonto('1234.56')).toBe(1234.56);
    expect(leerMonto('879.1')).toBe(879.1);
    expect(leerMonto('36.5432')).toBe(36.5432);
    expect(leerMonto('0.125')).toBe(0.125);
    expect(leerMonto('0,125')).toBe(0.125);
    expect(leerMonto('.125')).toBe(0.125);
    expect(leerMonto('-.5')).toBe(-0.5);
  });
  it('vacío es 0', () => {
    expect(leerMonto('')).toBe(0);
    expect(leerMonto('  ')).toBe(0);
  });
  it('lo que no se entiende no se vuelve 0', () => {
    expect(leerMonto('1,234,56')).toBeNull();
    expect(leerMonto('12a')).toBeNull();
    expect(leerMonto('1.23.4,5')).toBeNull();
  });
});

describe('números que el sistema pone en un campo', () => {
  it('van con coma decimal, para que se lean igual (una tasa de 3 decimales no se vuelve miles)', () => {
    expect(numeroATexto(179.437)).toBe('179,437');
    expect(leerMonto(numeroATexto(179.437))).toBe(179.437);
    expect(numeroATexto(36500)).toBe('36500');
    expect(numeroATexto(null)).toBe('');
    expect(numeroATexto(Number.NaN)).toBe('');
  });
  it('cómo se leyó, para mostrarlo junto al campo', () => {
    expect(textoLeido('36.500')).toBe('36.500,00');
    expect(textoLeido('1234,5')).toBe('1.234,50');
    expect(textoLeido('179,437')).toBe('179,437');
    expect(textoLeido('')).toBeNull();
    expect(textoLeido('12a')).toBeNull();
  });
});

describe('validación de documento de respaldo y Otro documento', () => {
  it('con archivo adjunto exige indicar qué documento es', () => {
    expect(validarDocumentoRespaldo('', '', true)).toContain('Indica qué documento adjuntas');
    expect(validarDocumentoRespaldo('   ', '', true)).toContain('Indica qué documento adjuntas');
  });

  it('si se elige «Otro documento», es obligatorio describirlo para auditoría', () => {
    expect(validarDocumentoRespaldo('Otro documento', '', false)).toContain('Describe qué documento de respaldo es');
    expect(validarDocumentoRespaldo('Otro documento', '   ', true)).toContain('Describe qué documento de respaldo es');
    expect(validarDocumentoRespaldo('Otro documento', 'Recibo de caja chica #412', true)).toBeNull();
    expect(validarDocumentoRespaldo('Otro documento', 'Contrato de comodato', false)).toBeNull();
  });

  it('los tipos conocidos pasan sin requerir detalle extra', () => {
    expect(validarDocumentoRespaldo('Factura del proveedor', '', true)).toBeNull();
    expect(validarDocumentoRespaldo('Comprobante de retención firmado', '', true)).toBeNull();
    expect(validarDocumentoRespaldo('Nota de entrega', '', true)).toBeNull();
  });

  it('formatea la etiqueta descriptiva del documento', () => {
    expect(etiquetaDocumentoRespaldo('Factura del proveedor', '')).toBe('Factura del proveedor');
    expect(etiquetaDocumentoRespaldo('Otro documento', 'Finiquito laboral')).toBe('Otro: Finiquito laboral');
    expect(etiquetaDocumentoRespaldo('Otro documento', '  Recibo de caja chica  ')).toBe('Otro: Recibo de caja chica');
    expect(etiquetaDocumentoRespaldo('Otro documento', '')).toBe('Otro documento');
  });
});

