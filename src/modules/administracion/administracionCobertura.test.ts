import { describe, it, expect } from 'vitest';
import { coberturaCentro } from './administracionCobertura';
import { sumarTiempoVigencia } from './administracionVigencia';
import type { CentroRequerido, DocumentoEmpresa, TipoDocumento } from './admin.repository';

const HOY = '2026-11-07';
const en = (d: number) => sumarTiempoVigencia(HOY, d, 'dias');
const req = (centroId: string, tipo: TipoDocumento): CentroRequerido => ({ id: `${centroId}-${tipo}`, empresaClave: 'GT', centroId, tipoDocumento: tipo });
const doc = (centroId: string, tipo: TipoDocumento, fechaVenc: string | null): DocumentoEmpresa =>
  ({ id: `${centroId}-${tipo}-doc`, empresaClave: 'GT', carpeta: 'x', centroAcopioId: centroId, tipo, nombre: tipo, fechaVencimiento: fechaVenc } as DocumentoEmpresa);

describe('coberturaCentro (N de M contra checklist)', () => {
  it('cuenta cubiertos vigentes/por vencer; el vencido NO cuenta; otro centro no cuenta', () => {
    const centros = [{ id: 'c1', nombre: 'Acopio 1' }];
    const requeridos = [req('c1', 'rupdae'), req('c1', 'mintras'), req('c1', 'ivss')];
    const documentos = [
      doc('c1', 'rupdae', en(200)),   // vigente → cuenta
      doc('c1', 'mintras', en(10)),   // por vencer → cuenta
      doc('c1', 'ivss', en(-5)),      // vencido → NO cuenta
      doc('c2', 'rupdae', en(200)),   // otro centro → no cuenta
    ];
    const [cob] = coberturaCentro(centros, requeridos, documentos, HOY);
    expect(cob).toMatchObject({ centroId: 'c1', requeridos: 3, cubiertos: 2, pct: 67 });
    expect(cob.faltantes).toEqual(['ivss']);
  });

  it('centro sin requeridos → 100% (nada exigido), sin dividir por cero', () => {
    const [cob] = coberturaCentro([{ id: 'c1', nombre: 'A' }], [], [], HOY);
    expect(cob).toMatchObject({ requeridos: 0, cubiertos: 0, pct: 100, faltantes: [] });
  });

  it('cuenta el documento cuyo centro se HEREDA de su carpeta (no tiene centro propio)', () => {
    const centros = [{ id: 'c1', nombre: 'Acopio 1' }];
    const requeridos = [req('c1', 'rupdae')];
    // El documento no trae centroAcopioId; su carpeta «legal» sí está asociada al centro c1.
    const d = { id: 'd9', empresaClave: 'GT', carpeta: 'legal', tipo: 'rupdae', nombre: 'RUPDAE', fechaVencimiento: en(200) } as DocumentoEmpresa;
    const carpetas = [{ id: 'legal', centroAcopioId: 'c1' }];
    const [cob] = coberturaCentro(centros, requeridos, [d], HOY, carpetas);
    expect(cob).toMatchObject({ cubiertos: 1, pct: 100 });
  });

  it('tolera que centroAcopioId traiga el NOMBRE del centro (datos heredados)', () => {
    const centros = [{ id: 'c1', nombre: 'Acopio 1' }];
    const requeridos = [req('c1', 'rupdae')];
    const d = { id: 'd8', empresaClave: 'GT', carpeta: 'x', centroAcopioId: 'Acopio 1', tipo: 'rupdae', nombre: 'RUPDAE', fechaVencimiento: en(200) } as DocumentoEmpresa;
    const [cob] = coberturaCentro(centros, requeridos, [d], HOY);
    expect(cob).toMatchObject({ cubiertos: 1, pct: 100 });
  });
});
