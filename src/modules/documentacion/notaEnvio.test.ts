import { describe, expect, it } from 'vitest';
import {
  cantidadTexto, codigoNotaEnvio, errorNotaEnvio, estadoEnvio, filtrarDestinatarios, normalizarNotaEnvio, numeroEnvio,
  renglonesValidos, totalRenglones,
} from './notaEnvio';

const base = {
  fecha: '2026-10-06', razon_social: ' Golden Touch 1127, C.A. ', rif: 'j-501299935', atencion_a: 'Susej',
  condicion: 'Facturas originales', entregado_por: 'Dorianne Pérez', total_etiqueta: 'Facturas',
  items: [
    { descripcion: '  Facturas originales Golden Touch ', cantidad: 296 },
    { descripcion: 'Facturas originales Golden Lion', cantidad: 30 },
    { descripcion: 'Contrato', cantidad: null },
    { descripcion: '   ', cantidad: 4 },
  ],
};

describe('nota de envío', () => {
  it('el correlativo va con 4 dígitos', () => {
    expect(numeroEnvio(1)).toBe('0001');
    expect(numeroEnvio(12345)).toBe('12345');
    expect(numeroEnvio(null)).toBe('0000');
    expect(codigoNotaEnvio(7)).toBe('NE-0007');
  });

  it('descarta renglones sin descripción y limpia espacios', () => {
    expect(renglonesValidos(base.items)).toEqual([
      { descripcion: 'Facturas originales Golden Touch', cantidad: 296 },
      { descripcion: 'Facturas originales Golden Lion', cantidad: 30 },
      { descripcion: 'Contrato', cantidad: null },
    ]);
    expect(totalRenglones(base.items)).toBe(326);
  });

  it('cantidad sin decimales si es entera', () => {
    expect(cantidadTexto(45)).toBe('45');
    expect(cantidadTexto(null)).toBe('');
  });

  it('valida lo mínimo para emitir', () => {
    expect(errorNotaEnvio(base)).toBeNull();
    expect(errorNotaEnvio({ ...base, razon_social: ' ' })).toMatch(/a quién/);
    expect(errorNotaEnvio({ ...base, items: [{ descripcion: '', cantidad: 3 }] })).toMatch(/renglón/);
    expect(errorNotaEnvio({ ...base, fecha: '06/10/2026' })).toMatch(/fecha/);
  });

  it('normaliza y usa la suma salvo que se escriba el total a mano', () => {
    const n = normalizarNotaEnvio(base);
    expect(n.razon_social).toBe('Golden Touch 1127, C.A.');
    expect(n.rif).toBe('J-501299935');
    expect(n.items).toHaveLength(3);
    expect(n.total_cantidad).toBe(326);
    expect(n.total_etiqueta).toBe('Facturas');
    expect(normalizarNotaEnvio({ ...base, total: 330 }).total_cantidad).toBe(330);
    expect(normalizarNotaEnvio({ ...base, total_etiqueta: '' }).total_etiqueta).toBe('Documentos');
  });

  it('el estado sale de la fila: anulada manda, luego recibida, si no enviada', () => {
    expect(estadoEnvio({ estado: 'emitida', recibido_en: null })).toBe('emitido');
    expect(estadoEnvio({ estado: 'emitida', recibido_en: '2026-10-06T10:00:00Z' })).toBe('recibido');
    expect(estadoEnvio({ estado: 'anulada', recibido_en: '2026-10-06T10:00:00Z' })).toBe('anulado');
  });

  it('busca destinatarios por cualquier dato, sin acentos', () => {
    const lista = [
      { razon_social: 'GOLDEN TOUCH 1127, C.A.', rif: 'J-501299935', atencion_a: 'SUSEJ' },
      { razon_social: 'Alcaldía de Caroní', rif: null, atencion_a: null },
    ];
    expect(filtrarDestinatarios(lista, 'susej').map((d) => d.razon_social)).toEqual(['GOLDEN TOUCH 1127, C.A.']);
    expect(filtrarDestinatarios(lista, 'alcaldia caroni')).toHaveLength(1);
    expect(filtrarDestinatarios(lista, '')).toHaveLength(2);
  });
});
