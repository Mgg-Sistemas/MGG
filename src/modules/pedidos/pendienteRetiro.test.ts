import { describe, expect, it } from 'vitest';
import { pendienteRetiro } from './entregaModalidad';
import { armarCierre, detallePorRetirar, rangoCierre } from './cierreDiario';

const base = {
  estado: 'pagada' as const,
  clase: 'producto' as const,
  condiciones_pago: null,
  oc_codigo: 'OC-2026-0243',
  recibida_en: null,
  pagada_en: '2026-11-06T15:00:00.000Z',
  retiro_confirmado_en: null,
};

describe('pendienteRetiro (06-11-2026)', () => {
  it('una OC pagada sin confirmar el retiro queda en «Pendientes por recibir»', () => {
    expect(pendienteRetiro(base)).toBe(true);
  });
  it('con el retiro confirmado ya no (le llegó al delivery)', () => {
    expect(pendienteRetiro({ ...base, retiro_confirmado_en: '2026-11-06T16:00:00Z' })).toBe(false);
  });
  it('recibida, servicio, contra entrega, sin OC o sin pagar: no', () => {
    expect(pendienteRetiro({ ...base, recibida_en: '2026-11-06T16:00:00Z' })).toBe(false);
    expect(pendienteRetiro({ ...base, clase: 'servicio' })).toBe(false);
    expect(pendienteRetiro({ ...base, condiciones_pago: 'contra_entrega' })).toBe(false);
    expect(pendienteRetiro({ ...base, oc_codigo: null })).toBe(false);
    expect(pendienteRetiro({ ...base, estado: 'oc_aprobada' })).toBe(false);
  });
  it('10-11-2026: las pagadas antes del 03-11 también se pueden mandar al delivery', () => {
    expect(pendienteRetiro({ ...base, pagada_en: '2026-10-29T14:43:46.703Z' })).toBe(true);
    expect(pendienteRetiro({ ...base, pagada_en: '2026-11-03T04:00:00.000Z' })).toBe(true);
  });
});

describe('cierre diario · pendientes por retirar', () => {
  const hoy = rangoCierre({ modo: 'dia', dia: '2026-11-06', mes: '', desde: '', hasta: '' }, '2026-11-06');
  const ocs = [
    { codigo: 'OC-2026-0247', proveedor: 'B', entrega: '🚚 Carga pesada', pagada: '2026-11-06T18:00:00Z' },
    { codigo: 'OC-2026-0243', proveedor: 'A', entrega: '🛵 Delivery', pagada: '2026-11-06T13:00:00Z' },
    { codigo: 'OC-2026-0182', proveedor: 'C', entrega: '🛵 Delivery', pagada: '2026-11-05T13:00:00Z' },
  ];
  it('solo las pagadas en el período, de la más vieja a la más nueva', () => {
    const d = detallePorRetirar(ocs, hoy);
    expect(d.map((f) => f.codigo)).toEqual(['OC-2026-0243', 'OC-2026-0247']);
    expect(d[0].pagada).toBe('06/11/2026');
  });
  it('el título cuenta las mismas órdenes del detalle', () => {
    const r = armarCierre({ pedidos: 0, pagadas: 0, porPagar: [], porRetirarOc: ocs }, hoy);
    expect(r.items.find((i) => i.key === 'por_retirar')?.cantidad).toBe(2);
    expect(r.porRetirarDetalle).toHaveLength(2);
  });
});
