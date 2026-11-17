import { describe, it, expect } from 'vitest';
import { agendaVencimientos, filtrarAgenda } from './administracionAgenda';
import { sumarTiempoVigencia } from './administracionVigencia';
import type { DocumentoEmpresa, Movimiento, Gestion } from './admin.repository';

const HOY = '2026-11-07';
const en = (dias: number) => sumarTiempoVigencia(HOY, dias, 'dias');
const doc = (o: Partial<DocumentoEmpresa>) => o as DocumentoEmpresa;
const mov = (o: Partial<Movimiento>) => o as Movimiento;
const ges = (o: Partial<Gestion>) => ({ estado: 'abierta', costoTotal: 100, moneda: 'USD', ...o }) as Gestion;

describe('agendaVencimientos', () => {
  it('ordena por urgencia: vencido → por vencer → vigente; no_vence al final', () => {
    const items = agendaVencimientos({
      documentos: [
        doc({ id: 'd-vig', empresaClave: 'GT', nombre: 'Vigente', fechaVencimiento: en(60), statusVencimiento: 'vigente' }),
        doc({ id: 'd-venc', empresaClave: 'GT', nombre: 'Vencido', fechaVencimiento: en(-5), statusVencimiento: 'vencido' }),
        doc({ id: 'd-perm', empresaClave: 'GT', nombre: 'Permanente', fechaVencimiento: null, statusVencimiento: 'no_vence' }),
      ],
      movimientos: [mov({ id: 'g-pv', empresaClave: 'GT', concepto: 'Agua', fecha: en(10), estadoPago: 'pendiente', moneda: 'Bs', monto: 500 })],
      gestiones: [],
      hoyRef: HOY,
    });
    expect(items.map((i) => i.id)).toEqual(['d-venc', 'g-pv', 'd-vig', 'd-perm']);
  });

  it('usa la FECHA del movimiento, no el período: una cuenta que cruza el cierre de mes no se marca vencida', () => {
    const items = agendaVencimientos({
      documentos: [], gestiones: [],
      movimientos: [mov({ id: 'g1', empresaClave: 'GT', concepto: 'Luz', periodo: '2026-10', fecha: '2026-11-03', estadoPago: 'pendiente', moneda: 'Bs', monto: 300 })],
      hoyRef: '2026-10-20',
    });
    expect(items[0].status).not.toBe('vencido');
  });

  it('excluye movimientos pagados y gestiones anuladas/saldadas', () => {
    const items = agendaVencimientos({
      documentos: [],
      movimientos: [mov({ id: 'pagado', empresaClave: 'GT', concepto: 'x', fecha: en(5), estadoPago: 'pagado', moneda: 'Bs', monto: 1 })],
      gestiones: [ges({ id: 'anulada', empresaClave: 'GT', concepto: 'y', fechaPactada: en(5), estado: 'anulada' })],
      hoyRef: HOY,
    });
    expect(items).toHaveLength(0);
  });

  it('filtrarAgenda por empresa, centro y origen', () => {
    const items = agendaVencimientos({
      documentos: [
        doc({ id: 'a', empresaClave: 'GT', nombre: 'A', fechaVencimiento: en(5), statusVencimiento: 'por_vencer', centroAcopioId: 'c1' }),
        doc({ id: 'b', empresaClave: 'MTO', nombre: 'B', fechaVencimiento: en(5), statusVencimiento: 'por_vencer', centroAcopioId: 'c2' }),
      ],
      movimientos: [], gestiones: [], hoyRef: HOY,
    });
    expect(filtrarAgenda(items, { empresaClave: 'GT' }).map((i) => i.id)).toEqual(['a']);
    expect(filtrarAgenda(items, { centroAcopioId: 'c2' }).map((i) => i.id)).toEqual(['b']);
    expect(filtrarAgenda(items, { origen: 'gasto' })).toHaveLength(0);
  });
});
