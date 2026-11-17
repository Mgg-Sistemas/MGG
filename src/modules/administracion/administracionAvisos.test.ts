import { describe, it, expect, vi } from 'vitest';
import { construirAvisos, sincronizarAvisos } from './administracionAvisos';
import type { AdminRepo, Aviso, DocumentoEmpresa, Responsabilidad } from './admin.repository';
import type { ItemAgenda } from './administracionAgenda';

const item = (over: Partial<ItemAgenda>): ItemAgenda => ({
  origen: 'documento', id: 'd1', empresaClave: 'GT', centroAcopioId: null, responsable: null,
  titulo: 'RUPDAE', fecha: '2026-11-01', status: 'vencido', diasRestantes: -6, prioridad: null, ...over,
});
const resp = (over: Partial<Responsabilidad>): Responsabilidad => ({
  id: Math.random().toString(36), empresaClave: 'GT', usuarioEmail: 'ana@gt.com', objetivoTipo: 'documento', objetivoId: 'd1', ...over,
});
const docPorId = new Map<string, DocumentoEmpresa>();

describe('construirAvisos (dedup)', () => {
  it('genera vencido/por_vencer por responsable efectivo; vigente no genera', () => {
    const items = [
      item({ origen: 'documento', id: 'd1', status: 'vencido' }),
      item({ origen: 'gasto', id: 'm1', status: 'por_vencer', titulo: 'Agua' }),
      item({ origen: 'gestion', id: 'g1', status: 'vigente' }),
    ];
    const rs = [resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'documento', objetivoId: 'd1' })];
    const nuevos = construirAvisos(items, rs, docPorId, []);
    // d1 vencido → 1 aviso para ana; m1 por_vencer sin responsable → 1 aviso con responsable null; g1 vigente → 0
    expect(nuevos).toHaveLength(2);
    expect(nuevos.find((a) => a.origenId === 'd1')).toMatchObject({ tipo: 'vencido', responsableEmail: 'ana@gt.com', origen: 'documento' });
    expect(nuevos.find((a) => a.origenId === 'm1')).toMatchObject({ tipo: 'por_vencer', responsableEmail: null });
  });

  it('no repite un aviso que ya existe (dedup por origen+origenId+tipo+responsable)', () => {
    const items = [item({ origen: 'documento', id: 'd1', status: 'vencido' })];
    const rs = [resp({ usuarioEmail: 'ana@gt.com', objetivoTipo: 'documento', objetivoId: 'd1' })];
    const existentes: Aviso[] = [{
      id: 'x', empresaClave: 'GT', tipo: 'vencido', origen: 'documento', origenId: 'd1',
      responsableEmail: 'ana@gt.com', fecha: '2026-11-01', texto: 'ya', leido: false,
    }];
    expect(construirAvisos(items, rs, docPorId, existentes)).toHaveLength(0);
  });

  it('hereda responsable de carpeta para documento sin responsable en tabla ni directo', () => {
    const items = [item({ origen: 'documento', id: 'd2', status: 'vencido' })];
    const d2: DocumentoEmpresa = {
      id: 'd2', empresaClave: 'GT', carpeta: 'permisos', tipo: 'rupdae', nombre: 'Permiso',
      path: 'p', contentType: null, tamano: null, fechaEmision: null, fechaVencimiento: null,
      statusVencimiento: 'vencido', socioNombre: null, entidadEmisora: null, numeroRegistro: null,
      notaTramite: null, historial: [], createdAt: null, updatedAt: null,
    };
    const docs = new Map([['d2', d2]]);
    const carpetas = new Map([['permisos', { responsable: 'jefe@gt.com' }]]);
    const nuevos = construirAvisos(items, [], docs, [], carpetas);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({ tipo: 'vencido', responsableEmail: 'jefe@gt.com' });
  });

  it('sincronizarAvisos persiste nuevos avisos y conserva existentes', async () => {
    const items = [item({ origen: 'documento', id: 'd3', status: 'por_vencer' })];
    const existentes: Aviso[] = [{
      id: 'a1', empresaClave: 'GT', tipo: 'vencido', origen: 'documento', origenId: 'd1',
      responsableEmail: 'ana@gt.com', fecha: '2026-11-01', texto: 'Vencido: RUPDAE', leido: false,
    }];
    const repoMock = {
      crearAviso: vi.fn().mockImplementation(async (a) => ({ id: 'a-nuevo', ...a, leido: false })),
    } as unknown as AdminRepo;

    const res = await sincronizarAvisos(repoMock, items, [], docPorId, existentes);
    expect(repoMock.crearAviso).toHaveBeenCalledTimes(1);
    expect(res).toHaveLength(2);
    expect(res[0].id).toBe('a-nuevo');
    expect(res[1].id).toBe('a1');
  });
});
