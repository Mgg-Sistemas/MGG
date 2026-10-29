import { describe, expect, it } from 'vitest';
import {
  mensajeFacturaWhatsapp,
  enlaceWhatsappFactura,
  EMOJI_ESTADO_FACTURA,
  ETIQUETA_ESTADO_FACTURA,
} from './mensajeFacturaWhatsapp';
import type { FacturaExterna } from './facturasExternas.repository';

const facturaBase: FacturaExterna = {
  id: 'f-1',
  empresa: 'GOLDEN',
  proveedorNombre: 'Inversiones Ferreteras del Sur C.A.',
  proveedorRif: 'J-12345678-9',
  numeroFactura: 'FAC-00982',
  numeroControl: '00-00441',
  fechaFactura: '2026-10-29',
  tipoDocumento: 'factura',
  moneda: 'USD',
  tasaCambio: null,
  montoTotal: 450.5,
  baseImponible: 450.5,
  ivaMonto: 72.08,
  observacion: 'Materiales para campamento',
  estado: 'recibida',
  archivos: [
    { id: 'a1', nombre: 'foto1.jpg', path: 'p1', tipo: 'imagen', size: 1024 },
    { id: 'a2', nombre: 'foto2.jpg', path: 'p2', tipo: 'imagen', size: 2048 },
    { id: 'a3', nombre: 'factura.pdf', path: 'p3', tipo: 'pdf', size: 4096 },
  ],
  actor: 'compras@mgg.com',
  actorName: 'Carlos Compras',
  createdAt: '2026-10-29T10:00:00Z',
  updatedAt: '2026-10-29T10:00:00Z',
};

describe('resumen de factura para WhatsApp', () => {
  it('genera un mensaje estructurado con todos los datos clave y estatus', () => {
    const texto = mensajeFacturaWhatsapp(facturaBase);

    expect(texto).toContain('FACTURA ·');
    expect(texto).toContain('Inversiones Ferreteras del Sur C.A.');
    expect(texto).toContain('J-12345678-9');
    expect(texto).toContain('FAC-00982');
    expect(texto).toContain('00-00441');
    expect(texto).toContain('$ 450,50');
    expect(texto).toContain('🟡 *Recibida*');
    expect(texto).toContain('2 foto(s), 1 PDF(s)');
    expect(texto).toContain('Materiales para campamento');
    expect(texto).toContain('Carlos Compras');
  });

  it('formatea montos en Bolívares con tasa si aplica', () => {
    const facturaBs: FacturaExterna = {
      ...facturaBase,
      moneda: 'Bs',
      montoTotal: 18500.75,
      tasaCambio: 45.2,
      archivos: [],
      observacion: null,
    };

    const texto = mensajeFacturaWhatsapp(facturaBs);
    expect(texto).toContain('Bs. 18.500,75');
    expect(texto).toContain('Tasa Ref: Bs. 45.2');
    expect(texto).not.toContain('Adjuntos:');
  });

  it('usa api.whatsapp.com/send sin wa.me para preservar caracteres y emojis', () => {
    const texto = mensajeFacturaWhatsapp(facturaBase);
    const link = enlaceWhatsappFactura(texto);

    expect(link.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(link).not.toContain('wa.me');
    expect(decodeURIComponent(link.split('text=')[1])).toBe(texto);
  });

  it('tiene emojis definidos para cada uno de los estatus', () => {
    expect(EMOJI_ESTADO_FACTURA.recibida).toBe('🟡');
    expect(EMOJI_ESTADO_FACTURA.procesada).toBe('🟢');
    expect(EMOJI_ESTADO_FACTURA.rechazada).toBe('🔴');
    expect(ETIQUETA_ESTADO_FACTURA.recibida).toBe('Recibida');
  });
});

