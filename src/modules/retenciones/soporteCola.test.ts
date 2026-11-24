import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FacturaDeOrigen } from '@/modules/libroFiscal/documentosOrigen.repository';
import type { FacturaBuzon } from './facturasBuzon.repository';

const mocks = vi.hoisted(() => ({
  buzon: vi.fn(async (_path: string) => 'https://firmada.test/buzon'),
  origen: vi.fn(async (_fac: unknown) => 'https://firmada.test/origen'),
  orden: vi.fn(async (_path: string) => 'https://firmada.test/orden'),
}));

vi.mock('./adjuntosBuzon', () => ({ obtenerUrlAdjunto: mocks.buzon }));
vi.mock('@/modules/libroFiscal/documentosOrigen.repository', () => ({ urlFacturaDeOrigen: mocks.origen }));
vi.mock('./retenciones.repository', () => ({ urlRetencion: mocks.orden }));

import { soporteDeItem, urlSoporteCola } from './soporteCola';

const fac = { id: 'fac-1' } as unknown as FacturaDeOrigen;
const buz = { id: 'buz-1' } as FacturaBuzon;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Retenciones · soporte de la cola «Por hacer»', () => {
  it('conserva el origen y las referencias originales al pasar al detalle', () => {
    const soporte = soporteDeItem({
      origen: 'compras_archivo',
      archivoNombre: 'factura-proveedor.pdf',
      archivoPath: 'ignorado/porque/hay/raw',
      rawFacturaOrigen: fac,
      rawBuzon: buz,
    });

    expect(soporte).toEqual({
      origen: 'compras_archivo',
      archivoNombre: 'factura-proveedor.pdf',
      archivoPath: 'ignorado/porque/hay/raw',
      rawFacturaOrigen: fac,
      rawBuzon: buz,
    });
  });

  it('abre el soporte del Buzón con su propio resolvedor', async () => {
    const url = await urlSoporteCola(soporteDeItem({
      origen: 'buzon', archivoNombre: 'foto.jpg', archivoPath: 'buzon/foto.jpg', rawBuzon: buz,
    }));

    expect(url).toBe('https://firmada.test/buzon');
    expect(mocks.buzon).toHaveBeenCalledWith('buzon/foto.jpg');
    expect(mocks.origen).not.toHaveBeenCalled();
    expect(mocks.orden).not.toHaveBeenCalled();
  });

  it('abre un archivo subido por Compras con el descriptor de origen', async () => {
    const url = await urlSoporteCola(soporteDeItem({
      origen: 'compras_archivo', archivoNombre: 'factura.pdf', rawFacturaOrigen: fac,
    }));

    expect(url).toBe('https://firmada.test/origen');
    expect(mocks.origen).toHaveBeenCalledWith(fac);
    expect(mocks.buzon).not.toHaveBeenCalled();
  });

  it('abre la factura de recepción de una OC como lo hacía la fila', async () => {
    const url = await urlSoporteCola(soporteDeItem({
      origen: 'compras_orden', archivoNombre: 'factura-oc.pdf', archivoPath: 'compras-oc/oc-1/factura.pdf',
    }));

    expect(url).toBe('https://firmada.test/orden');
    expect(mocks.orden).toHaveBeenCalledWith('compras-oc/oc-1/factura.pdf');
    expect(mocks.buzon).not.toHaveBeenCalled();
    expect(mocks.origen).not.toHaveBeenCalled();
  });

  it('no inventa una URL si el item no trae archivo', async () => {
    await expect(urlSoporteCola(soporteDeItem({
      origen: 'compras_archivo', archivoNombre: 'factura.pdf',
    }))).rejects.toThrow('No se encontró el archivo adjunto');
    expect(mocks.buzon).not.toHaveBeenCalled();
    expect(mocks.origen).not.toHaveBeenCalled();
    expect(mocks.orden).not.toHaveBeenCalled();
  });
});
