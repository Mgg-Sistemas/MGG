import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { accionCorreccion, botonRevisar, cambiosCompra, estadoCompra, reabrible, validarMotivo } from './reabrir';

// Datos inventados.
const r = (over: Partial<RetencionPracticada> = {}) => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', anulada: false, docKind: 'compra_directa', docId: 'c1', docCodigo: 'CD-0001',
  numeroComprobante: '20261000000011', ...over,
}) as RetencionPracticada;

describe('reabrir la retención para corregir la compra (maqueta v8-15, R3-20; 11b)', () => {
  it('se reabre la de IVA practicada de una compra directa, registrada o declarada', () => {
    expect(reabrible(r())).toBe(true);
    expect(reabrible(r({ estado: 'declarada' }))).toBe(true);
    expect(reabrible(r({ docKind: 'oc' }))).toBe(false);
    expect(reabrible(r({ tipo: 'islr' }))).toBe(false);
    expect(reabrible(r({ anulada: true }))).toBe(false);
    expect(reabrible(r({ direccion: 'recibida' }))).toBe(false);
  });
  it('el estado de la compra en la casilla', () => {
    expect(estadoCompra(r(), false)).toBe('Finalizada: lista para declarar. Compras no cambia el IVA, el % ni la moneda sin reabrirla');
    expect(estadoCompra(r({ estado: 'declarada' }), false)).toBe('Declarada: para corregir la compra, primero se reabre el período');
    expect(estadoCompra(r(), true)).toBe('Declarada: para corregir la compra, primero se reabre el período');
  });
  it('el motivo es obligatorio', () => {
    expect(validarMotivo('  ')).toBe('Pendiente: el motivo de la reapertura.');
    expect(validarMotivo('El proveedor corrigió el IVA')).toBeNull();
  });
  it('la regla de la última de su serie', () => {
    expect(accionCorreccion({ numero: 'N1', impresa: false, ultima: false, siguiente: 'N9' })).toEqual({ tipo: 'sitio', texto: 'Se corrige con el mismo N° (todavía no se imprimió).' });
    expect(accionCorreccion({ numero: 'N1', impresa: true, ultima: true, siguiente: 'N9' }))
      .toEqual({ tipo: 'sitio-ultima', texto: 'Se corrige con el mismo N° N1, porque es la última de su serie. Ya estaba impresa: se reimprime y se entrega de nuevo.' });
    expect(accionCorreccion({ numero: 'N1', impresa: true, ultima: false, siguiente: 'N9' }))
      .toEqual({ tipo: 'rehacer', texto: 'Ya estaba impresa y no es la última de su serie: el N° N1 se anula y se rehace con el N° N9.' });
  });
  it('lo que cambió la compra desde la reapertura', () => {
    const foto = { total: 1160, iva: 160, moneda: 'Bs' };
    expect(cambiosCompra(foto, foto)).toEqual([]);
    expect(cambiosCompra(foto, { total: 1176, iva: 176, moneda: 'USD' })).toEqual(['total de 1.160,00 a 1.176,00', 'IVA de 160,00 a 176,00', 'moneda de Bs a USD']);
  });
  it('el botón al revisar', () => {
    expect(botonRevisar(true, 'rehacer')).toBe('Confirmar sin cambios');
    expect(botonRevisar(false, 'rehacer')).toBe('Anular y rehacer');
    expect(botonRevisar(false, 'sitio')).toBe('Registrar de nuevo');
  });
});
