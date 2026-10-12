import { describe, expect, it } from 'vitest';
import type { RetencionItem } from './retenciones.repository';
import { semillaDeItem } from './semillaRetencion';

// Datos inventados: ningún proveedor ni monto real.
const fila = (over: Partial<RetencionItem>): RetencionItem => ({
  kind: 'oc', id: 'oc-1', ocCodigo: 'OC-0001', opCodigo: 'OP-0001',
  proveedorNombre: 'Proveedor de prueba', proveedorId: 'p-1', proveedorRif: 'J-00000000-0',
  condicionLabel: 'Contado', retencionLabel: '—', moneda: 'USD', total: 0,
  tesoreria: 'pagada', finalizada: false, finalizadaEn: null, tiposComprobante: [],
  ...over,
});
const orden = (iva: number | null, igtf: number | null) => ({ iva, igtf }) as unknown as RetencionItem['orden'];
const compra = (iva: number, igtf: number) => ({ iva, igtf }) as unknown as RetencionItem['compra'];

describe('semilla del 🧾 · la base es el total menos el IVA y el IGTF, con lo exento dentro', () => {
  it('OC con IVA: trae el IVA de la orden y la base queda sin él', () => {
    const s = semillaDeItem(fila({ total: 1160, orden: orden(160, null) }));
    expect(s.iva).toBe(160);
    expect(s.baseImponible).toBe(1000);
  });

  it('OC con algo exento: lo exento queda dentro de la base (total − IVA)', () => {
    // 1000 gravado + 100 exento + 160 de IVA
    const s = semillaDeItem(fila({ total: 1260, orden: orden(160, 0) }));
    expect(s.baseImponible).toBe(1100);
  });

  it('OC con IGTF: el IGTF tampoco es base', () => {
    const s = semillaDeItem(fila({ total: 1190, orden: orden(160, 30) }));
    expect(s.baseImponible).toBe(1000);
  });

  it('OC sin IVA ni IGTF cargados: la base es el total, como hoy', () => {
    const s = semillaDeItem(fila({ total: 500, orden: orden(null, null) }));
    expect(s.iva).toBe(0);
    expect(s.baseImponible).toBe(500);
  });

  it('compra directa: no cambia, el IVA y el IGTF salen de la compra', () => {
    const s = semillaDeItem(fila({ kind: 'compra_directa', moneda: 'Bs', total: 1190, compra: compra(160, 30) }));
    expect(s.iva).toBe(160);
    expect(s.baseImponible).toBe(1000);
    expect(s.moneda).toBe('Bs');
  });
});
