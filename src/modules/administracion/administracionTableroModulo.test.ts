import { describe, it, expect } from 'vitest';
import { resumenTablero } from './administracionTableroModulo';
import { sumarTiempoVigencia } from './administracionVigencia';
import type { DocumentoEmpresa, EnvioTesoreria, Gestion, Profesional } from './admin.repository';

const HOY = '2026-11-07';
const en = (d: number) => sumarTiempoVigencia(HOY, d, 'dias');
const prof = (id: string): Profesional => ({ id, nombre: id, profesion: null, contacto: null, activo: true });
const ges = (over: Partial<Gestion>): Gestion => ({
  id: 'g1', empresaClave: 'GT', profesionalId: 'p1', categoriaId: null, centroAcopioId: null, documentoId: null,
  concepto: 'Poder', costoTotal: 200, moneda: 'USD', tasaRef: null, fecha: HOY, fechaPactada: null, estado: 'abierta', notaAcuerdo: null, ...over,
});
const env = (over: Partial<EnvioTesoreria>): EnvioTesoreria => ({
  id: 'e1', gestionId: 'g1', empresaClave: 'GT', monto: 50, moneda: 'USD', fechaEnvio: HOY, estado: 'pagado', servicioDirectoId: 'sd', enviadoPor: null, pagadoEn: HOY, ...over,
});
const doc = (over: Partial<DocumentoEmpresa>): DocumentoEmpresa =>
  ({ id: 'd1', empresaClave: 'GT', carpeta: 'x', tipo: 'rupdae', nombre: 'RUPDAE', ...over } as DocumentoEmpresa);

const vacio = { documentos: [], movimientos: [], gestiones: [], envios: [], profesionales: [], responsabilidades: [], centros: [], requeridos: [], hoyRef: HOY };

describe('resumenTablero', () => {
  it('agrega agenda, pendiente y por-enviar por moneda nativa', () => {
    const r = resumenTablero({
      ...vacio,
      documentos: [doc({ id: 'd1', fechaVencimiento: en(-5), statusVencimiento: 'vencido' })],
      gestiones: [ges({ id: 'g1', profesionalId: 'p1', costoTotal: 200, moneda: 'USD' })],
      envios: [env({ id: 'e1', gestionId: 'g1', monto: 50, estado: 'pagado' })],
      profesionales: [prof('p1')],
    });
    expect(r.agenda.vencidos).toBe(1);
    expect(r.pendientePorMoneda.find((m) => m.moneda === 'USD')?.saldo).toBe(150); // 200 - 50 pagado
    const pe = r.porEnviar.find((m) => m.moneda === 'USD');
    expect(pe).toMatchObject({ monto: 150, n: 1 }); // disponible = 200 - 50 pagado - 0 enviado
  });

  it('módulo vacío → todo en cero, sin NaN', () => {
    const r = resumenTablero(vacio);
    expect(r.agenda).toEqual({ vencidos: 0, porVencer: 0, vigentes: 0 });
    expect(r.pendientePorMoneda).toEqual([]);
    expect(r.porEnviar).toEqual([]);
    expect(r.cargaTop).toEqual([]);
    expect(r.cobertura).toEqual([]);
  });
});
