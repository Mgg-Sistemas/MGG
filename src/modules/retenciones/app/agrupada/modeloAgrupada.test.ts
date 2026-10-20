import { describe, expect, it } from 'vitest';
import { CONFIG_RETENCION_DEFECTO } from '../../retencionesCalculo';
import type { RetencionItem, RetencionPracticada } from '../datos/puerta';
import { armarFacturas, base, cuentasDe, impuestosActivos, motivoNoAplica, rangoFechas, sinRetencion, vistaFactura, type EstadoVista } from './modeloAgrupada';

const IMP = ['iva', 'islr'];
const item = (id: string, x: Partial<RetencionItem> = {}): RetencionItem => ({
  kind: 'oc', id, ocCodigo: `OC-${id}`, opCodigo: null, proveedorNombre: 'Alfa', proveedorId: 'p1', proveedorRif: 'J-000000001',
  condicionLabel: '', retencionLabel: '', moneda: 'Bs', total: 1160, tesoreria: 'por_pagar', finalizada: false, finalizadaEn: null,
  tiposComprobante: [], orden: { iva: 160, created_at: '2026-10-05T10:00:00Z' } as RetencionItem['orden'], ...x,
});
const ret = (id: string, x: Partial<RetencionPracticada> = {}): RetencionPracticada => ({
  id, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: '1', docCodigo: 'OC-1', contraparteId: 'p1',
  contraparteRif: 'J-000000001', contraparteNombre: 'Alfa', contraparteSujeto: null, facturaNumero: '000123', facturaControl: null,
  facturaFecha: '2026-10-06', periodo: '202610', quincena: 1, numeroComprobante: '20261000000001', conceptoId: null, conceptoNombre: null,
  moneda: 'Bs', tasa: null, baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null, declaradaEn: null,
  actorName: 'Ana', createdAt: '2026-10-06T12:00:00Z', ...x,
});
const motivo = motivoNoAplica(CONFIG_RETENCION_DEFECTO, []);
const estado = (x: Partial<EstadoVista> = {}): EstadoVista => ({
  q: '', fecha: 'todo', desde: '', hasta: '', provs: new Set(), imp: new Set(IMP), dir: '', est: '', cuenta: null, sel: null, ...x,
});

describe('la Vista agrupada', () => {
  it('lo pendiente de un documento sin facturas va en una «Factura por indicar»', () => {
    const fs = armarFacturas([item('1')], [], IMP, () => ['iva'], motivo);
    expect(fs).toHaveLength(1);
    expect(fs[0].num).toBeNull();
    expect(fs[0].casillas.iva.estado).toBe('falta');
    expect(fs[0].casillas.islr.estado).toBe('nc');
    expect(fs[0].fecha).toBe('2026-10-05');
  });

  it('con una sola factura registrada, lo que falta va en ella; lo registrado no vuelve a pedirse', () => {
    const fs = armarFacturas([item('1')], [ret('r1')], IMP, () => ['iva', 'islr'], motivo);
    expect(fs).toHaveLength(1);
    expect(fs[0].num).toBe('000123');
    expect(fs[0].casillas.iva.estado).toBe('ok');
    expect(fs[0].casillas.islr.estado).toBe('falta');
    expect(fs[0].item?.id).toBe('1');
  });

  it('una anulada queda «Anulada · pendiente»; una declarada, «Declarada»', () => {
    const fs = armarFacturas([item('1')], [ret('r1', { anulada: true }), ret('r2', { tipo: 'islr', estado: 'declarada' })], IMP, () => ['iva', 'islr'], motivo);
    expect(fs[0].casillas.iva.estado).toBe('anulada');
    expect(fs[0].casillas.islr.estado).toBe('declarada');
  });

  it('las tarjetas cuentan pendientes, registradas y no aplican, y lo retenido por moneda', () => {
    const fs = armarFacturas([item('1'), item('2')], [ret('r1')], IMP, () => ['iva'], motivo);
    const c = cuentasDe(fs, 'iva');
    expect(c).toMatchObject({ faltan: 1, hechas: 1, nc: 0, monto: { Bs: 120 } });
    expect(cuentasDe(fs, 'islr').nc).toBe(2);
  });

  it('un número de tarjeta filtra la vista; «Sin retención» muestra las que no tienen ninguna', () => {
    const fs = armarFacturas([item('1'), item('2')], [ret('r1')], IMP, (it) => (it.id === '2' ? [] : ['iva']), motivo);
    expect(vistaFactura(fs, estado({ cuenta: { k: 'iva', tipo: 'hechas' } }), IMP).map((f) => f.num)).toEqual(['000123']);
    expect(sinRetencion(fs, IMP).map((f) => f.docCodigo)).toEqual(['OC-2']);
    const sin = armarFacturas([item('3')], [], IMP, () => [], motivo);
    expect(sinRetencion(sin, IMP)).toHaveLength(1);
    expect(sin[0].casillas.iva.motivo).toBe('Sin retención de IVA en el documento');
  });

  it('la búsqueda encuentra por factura, RIF, OC o comprobante', () => {
    const fs = armarFacturas([], [ret('r1')], IMP, () => [], motivo);
    for (const q of ['000123', 'J-000000001', 'OC-1', '20261000000001']) expect(base(fs, estado({ q }))).toHaveLength(1);
    expect(base(fs, estado({ q: 'nada' }))).toHaveLength(0);
  });

  it('las fechas: quincena, mes y mes anterior', () => {
    const hoy = new Date(2026, 0, 20);
    expect(rangoFechas({ fecha: 'quincena', desde: '', hasta: '' }, hoy)).toEqual(['2026-01-16', '2026-01-31']);
    expect(rangoFechas({ fecha: 'pasado', desde: '', hasta: '' }, hoy)).toEqual(['2025-12-01', '2025-12-31']);
  });

  it('los impuestos de la tira: el IVA si la empresa es agente; los demás con conceptos activos o con algo en el libro', () => {
    expect(impuestosActivos(CONFIG_RETENCION_DEFECTO, [], [])).toEqual(['iva']);
    expect(impuestosActivos({ ...CONFIG_RETENCION_DEFECTO, esContribuyenteEspecial: false }, [], [ret('r', { tipo: 'municipal' })])).toEqual(['municipal']);
  });
});
