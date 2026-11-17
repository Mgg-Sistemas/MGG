import { describe, it, expect } from 'vitest';
import {
  responsablesDeObjetivo,
  responsablesEfectivosDocumento,
  imputacion,
  cargaPorAnalista,
  misResponsabilidades,
} from './administracionResponsabilidad';
import type { DocumentoEmpresa, Responsabilidad } from './admin.repository';
import type { ItemAgenda } from './administracionAgenda';

const resp = (over: Partial<Responsabilidad>): Responsabilidad => ({
  id: Math.random().toString(36), empresaClave: 'GT', usuarioEmail: 'ana@gt.com', objetivoTipo: 'carpeta', objetivoId: 'legal', ...over,
});
const doc = (over: Partial<DocumentoEmpresa>): DocumentoEmpresa => ({ id: 'd1', empresaClave: 'GT', carpeta: 'legal', ...over } as DocumentoEmpresa);
const item = (over: Partial<ItemAgenda>): ItemAgenda => ({
  origen: 'documento', id: 'd1', empresaClave: 'GT', centroAcopioId: null, responsable: null,
  titulo: 'x', fecha: null, status: 'vigente', diasRestantes: 10, prioridad: null, ...over,
});

describe('responsablesDeObjetivo', () => {
  it('devuelve los emails distintos de un objetivo', () => {
    const rs = [resp({ usuarioEmail: 'ana@gt.com' }), resp({ usuarioEmail: 'bea@gt.com' }), resp({ usuarioEmail: 'ana@gt.com' })];
    expect(responsablesDeObjetivo('carpeta', 'legal', rs).sort()).toEqual(['ana@gt.com', 'bea@gt.com']);
  });
});

describe('responsablesEfectivosDocumento (herencia de carpeta)', () => {
  const rs = [
    resp({ usuarioEmail: 'carp@gt.com', objetivoTipo: 'carpeta', objetivoId: 'legal' }),
    resp({ usuarioEmail: 'prop@gt.com', objetivoTipo: 'documento', objetivoId: 'd1' }),
  ];
  it('usa los propios cuando existen (heredado=false)', () => {
    expect(responsablesEfectivosDocumento(doc({ id: 'd1', carpeta: 'legal' }), rs)).toEqual({ emails: ['prop@gt.com'], heredado: false });
  });
  it('hereda los de la carpeta cuando no tiene propios (heredado=true)', () => {
    expect(responsablesEfectivosDocumento(doc({ id: 'd2', carpeta: 'legal' }), rs)).toEqual({ emails: ['carp@gt.com'], heredado: true });
  });
  it('sin propios ni de carpeta → vacío, sin crashear', () => {
    expect(responsablesEfectivosDocumento(doc({ id: 'd3', carpeta: 'otra' }), rs)).toEqual({ emails: [], heredado: false });
  });
  it('usa responsable directo del documento cuando no hay en la tabla', () => {
    expect(responsablesEfectivosDocumento(doc({ id: 'd4', carpeta: 'otra', responsable: 'directo@gt.com' }), [])).toEqual({ emails: ['directo@gt.com'], heredado: false });
  });
  it('hereda responsable directo de la carpeta cuando no hay en tabla ni documento', () => {
    expect(responsablesEfectivosDocumento(doc({ id: 'd5', carpeta: 'otra' }), [], 'jefe_carpeta@gt.com')).toEqual({ emails: ['jefe_carpeta@gt.com'], heredado: true });
  });
});

describe('imputacion (solo al vencer/incumplir)', () => {
  const rs = [resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'documento', objetivoId: 'd1' })];
  const docPorId = new Map([['d1', doc({ id: 'd1', carpeta: 'legal' })]]);
  it('un item vigente NO se imputa', () => {
    expect(imputacion(item({ status: 'vigente' }), rs, docPorId)).toEqual([]);
  });
  it('un documento vencido se imputa a sus responsables efectivos', () => {
    expect(imputacion(item({ origen: 'documento', id: 'd1', status: 'vencido' }), rs, docPorId)).toEqual(['ana@gt.com']);
  });
  it('un gasto vencido usa responsabilidad directa', () => {
    const rg = [resp({ usuarioEmail: 'g@gt.com', objetivoTipo: 'gasto', objetivoId: 'mov9' })];
    expect(imputacion(item({ origen: 'gasto', id: 'mov9', status: 'vencido_en_tramite' }), rg, docPorId)).toEqual(['g@gt.com']);
  });
});

describe('cargaPorAnalista', () => {
  const docPorId = new Map<string, DocumentoEmpresa>();
  it('un ítem compartido cuenta para cada responsable; resume por estado', () => {
    const rs = [
      resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'gestion', objetivoId: 'g1' }),
      resp({ usuarioEmail: 'bea@gt.com', objetivoTipo: 'gestion', objetivoId: 'g1' }),
      resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'gasto', objetivoId: 'm1' }),
    ];
    const items = [
      item({ origen: 'gestion', id: 'g1', status: 'vencido' }),
      item({ origen: 'gasto', id: 'm1', status: 'por_vencer' }),
    ];
    const carga = cargaPorAnalista(items, rs, docPorId);
    const ana = carga.find((c) => c.usuarioEmail === 'ana@gt.com')!;
    const bea = carga.find((c) => c.usuarioEmail === 'bea@gt.com')!;
    expect(ana).toMatchObject({ total: 2, vencidos: 1, porVencer: 1 });
    expect(bea).toMatchObject({ total: 1, vencidos: 1 });
    expect(carga[0].usuarioEmail).toBe('ana@gt.com'); // más vencidos+porVencer primero
  });
});

describe('misResponsabilidades', () => {
  const docPorId = new Map<string, DocumentoEmpresa>();
  const rs = [
    resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'gestion', objetivoId: 'g1' }),
    resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'gestion', objetivoId: 'g2' }),
  ];
  const items = [
    item({ origen: 'gestion', id: 'g1', diasRestantes: 40, prioridad: 'baja', status: 'vigente' }),
    item({ origen: 'gestion', id: 'g2', diasRestantes: 5, prioridad: 'alta', status: 'por_vencer' }),
  ];
  it('vigencia_asc pone el más próximo primero', () => {
    expect(misResponsabilidades('ana@gt.com', items, rs, docPorId, 'vigencia_asc').map((i) => i.id)).toEqual(['g2', 'g1']);
  });
  it('prioridad pone alta primero', () => {
    expect(misResponsabilidades('ana@gt.com', items, rs, docPorId, 'prioridad').map((i) => i.id)).toEqual(['g2', 'g1']);
  });
  it('un analista sin responsabilidades ve vacío', () => {
    expect(misResponsabilidades('nadie@gt.com', items, rs, docPorId, 'estatus')).toEqual([]);
  });

  it('los «sin fecha» (null) van al final en asc y al principio en desc («mayor vigencia»)', () => {
    const rs2 = [
      resp({ usuarioEmail: 'z@gt.com', objetivoTipo: 'gestion', objetivoId: 'gA' }),
      resp({ usuarioEmail: 'z@gt.com', objetivoTipo: 'gestion', objetivoId: 'gB' }),
    ];
    const its = [
      item({ origen: 'gestion', id: 'gA', diasRestantes: 10 }),
      item({ origen: 'gestion', id: 'gB', diasRestantes: null, status: 'no_vence' }),
    ];
    expect(misResponsabilidades('z@gt.com', its, rs2, docPorId, 'vigencia_asc').map((i) => i.id)).toEqual(['gA', 'gB']);
    expect(misResponsabilidades('z@gt.com', its, rs2, docPorId, 'vigencia_desc').map((i) => i.id)).toEqual(['gB', 'gA']);
  });
});
