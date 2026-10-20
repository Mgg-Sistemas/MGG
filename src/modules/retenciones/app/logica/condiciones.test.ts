import { describe, expect, it } from 'vitest';
import { aplicaRegla, versionVigente, type DocumentoCondiciones } from './condiciones';
import { IGTF, ISLR_PNR, IVA } from './reglasDePrueba';
import type { VersionRegla } from './regla';

const docu = (over: Partial<DocumentoCondiciones> = {}): DocumentoCondiciones => ({
  direccion: 'practicada', tipo: 'factura', operacion: 'servicios', sujeto: 'pn_residente', contribuyente: 'ordinario', ...over,
});

describe('la versión que rige a la fecha de la factura', () => {
  const vieja: VersionRegla = { ...IVA, id: 'v1', vigente_desde: '2020-01-01', vigente_hasta: '2025-07-31' };
  const nueva: VersionRegla = { ...IVA, id: 'v2', vigente_desde: '2025-08-01', vigente_hasta: null };
  const enPrueba: VersionRegla = { ...IVA, id: 'v3', vigente_desde: '2026-11-01', estado: 'prueba' };
  const retirada: VersionRegla = { ...IVA, id: 'v0', vigente_desde: '2010-01-01', vigente_hasta: null, estado: 'retirada' };
  const todas = [vieja, nueva, enPrueba, retirada];

  it('los dos extremos de la vigencia cuentan', () => {
    expect(versionVigente(todas, '2025-07-31')?.id).toBe('v1');
    expect(versionVigente(todas, '2025-08-01')?.id).toBe('v2');
  });

  it('una retirada no rige nunca; sin versión a la fecha, null', () => {
    expect(versionVigente(todas, '2015-06-01')).toBeNull();
  });

  it('la «en prueba» solo cuenta para el simulador', () => {
    expect(versionVigente(todas, '2026-11-15')?.id).toBe('v2');
    expect(versionVigente(todas, '2026-11-15', { incluirPrueba: true })?.id).toBe('v3');
  });
});

describe('las condiciones de la versión, sin mirar el nombre del impuesto', () => {
  it('aplica cuando todo se cumple', () => {
    expect(aplicaRegla(ISLR_PNR, docu(), null)).toEqual({ aplica: true, aviso: null });
  });

  it('la dirección, el tipo de documento y la operación', () => {
    expect(aplicaRegla(ISLR_PNR, docu({ direccion: 'recibida' }), null)).toMatchObject({ aplica: false });
    expect(aplicaRegla(IGTF, docu({ tipo: 'factura' }), null)).toEqual({ aplica: false, motivo: 'La regla no aplica a una factura.' });
    expect(aplicaRegla({ ...ISLR_PNR, operacion: 'bienes' }, docu(), null)).toEqual({ aplica: false, motivo: 'La regla aplica solo a compras de bienes.' });
  });

  it('lo que la base deja en null: sin dirección no se aplica; operación, sujetos y contribuyentes en null = todos', () => {
    expect(aplicaRegla({ ...ISLR_PNR, direccion: null }, docu(), null)).toMatchObject({ aplica: false, motivo: expect.stringContaining('no dice si es para retenciones practicadas o recibidas') });
    expect(aplicaRegla({ ...ISLR_PNR, operacion: null, sujetos: null, contribuyentes: null }, docu({ operacion: 'bienes', sujeto: null, contribuyente: null }), null))
      .toEqual({ aplica: true, aviso: null });
  });

  it('un documento con bienes y servicios no descarta la regla: se decide por línea', () => {
    expect(aplicaRegla({ ...ISLR_PNR, operacion: 'servicios' }, docu({ operacion: 'ambos' }), null)).toEqual({ aplica: true, aviso: null });
  });

  it('el sujeto: si la regla lo exige y el perfil no lo dice, se pide; nunca se adivina', () => {
    expect(aplicaRegla(ISLR_PNR, docu({ sujeto: null }), null)).toMatchObject({ aplica: 'falta_dato', falta: 'sujeto' });
    expect(aplicaRegla(ISLR_PNR, docu({ sujeto: 'pj_no_domiciliada' }), null)).toMatchObject({ aplica: false });
  });

  it('el tipo de contribuyente: al formal no se le retiene IVA', () => {
    expect(aplicaRegla(IVA, docu({ contribuyente: 'formal' }), 1)).toEqual({ aplica: false, motivo: 'La regla no aplica a este tipo de contribuyente.' });
  });

  it('la condición del agente: 1 aplica, 0 no aplica', () => {
    expect(aplicaRegla(IVA, docu(), 1)).toEqual({ aplica: true, aviso: null });
    expect(aplicaRegla(IVA, docu(), 0)).toEqual({ aplica: false, motivo: 'La empresa no es agente de este impuesto a esa fecha.' });
  });

  it('sin la condición del agente cargada: avisa o bloquea, según el interruptor', () => {
    expect(aplicaRegla(IVA, docu(), null)).toMatchObject({ aplica: true, aviso: expect.stringContaining('no está cargada') });
    expect(aplicaRegla(IVA, docu(), null, 'bloquear')).toMatchObject({ aplica: 'falta_dato', falta: 'condicion_agente' });
  });
});
