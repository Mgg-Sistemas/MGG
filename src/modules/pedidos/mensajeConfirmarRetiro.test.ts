import { describe, expect, it } from 'vitest';
import { mensajeConfirmarRetiro } from './mensajeConfirmarRetiro';
import { enlaceWhatsapp } from '@/modules/combustible/mensajeMovimiento';

const base = {
  codigo: 'OP-2026-0100',
  oc_codigo: 'OC-2026-0243',
  entrega_modalidad: 'delivery' as const,
  retiro_confirmado_en: '2026-11-27T14:35:00.000Z',
};

describe('mensajeConfirmarRetiro (27-11-2026)', () => {
  it('Delivery: el encabezado se ve grande, en mayúsculas y con el formato de Compras', () => {
    const m = mensajeConfirmarRetiro(base, 'FERRETERÍA CARONÍ', 'analista1mgg@gmail.com');
    expect(m?.split('\n')[0]).toBe('*CONFIRMAR RETIRO POR SISTEMAS - DELIVERY*');
    expect(m).toContain('🔹 *Orden:* OC-2026-0243');
    expect(m).toContain('🏭 *Proveedor:* FERRETERÍA CARONÍ');
    expect(m).toContain('🚚 *Entrega:* Delivery');
    expect(m).toContain('👤 *Confirmó:* analista1mgg@gmail.com');
    expect(m).toContain('🕒 *Fecha:*');
    expect(m).toContain('🏢 *MINERAL GROUP GUAYANA C.A.*');
  });

  it('Carga pesada: dice CARGA PESADA y no lleva la palabra SUBELO', () => {
    const m = mensajeConfirmarRetiro({ ...base, entrega_modalidad: 'carga_pesada' }, 'MINERALES DEL SUR', 'analista1mgg@gmail.com');
    expect(m?.split('\n')[0]).toBe('*CONFIRMAR RETIRO POR SISTEMAS - CARGA PESADA*');
    expect(m).toContain('🚚 *Entrega:* Carga pesada');
    expect(m?.toUpperCase()).not.toContain('SUBELO');
  });

  it('entrega a domicilio no genera aviso de flota', () => {
    expect(mensajeConfirmarRetiro({ ...base, entrega_modalidad: 'proveedor' }, 'FERRETERÍA CARONÍ', 'x@gmail.com')).toBeNull();
  });

  it('sin confirmación guardada no genera aviso', () => {
    expect(mensajeConfirmarRetiro({ ...base, retiro_confirmado_en: null }, 'FERRETERÍA CARONÍ', 'x@gmail.com')).toBeNull();
  });

  it('al reabrir el aviso desde el detalle usa quién confirmó, aunque venga guardado en la OC', () => {
    const m = mensajeConfirmarRetiro({ ...base, retiro_confirmado_por: 'hector@gmail.com' }, 'FERRETERÍA CARONÍ');
    expect(m).toContain('👤 *Confirmó:* hector@gmail.com');
    expect(mensajeConfirmarRetiro({ ...base, retiro_confirmado_por: 'hector@gmail.com' }, null, 'otro@gmail.com')).toContain('👤 *Confirmó:* otro@gmail.com');
  });

  it('los datos que faltan no salen como «—»', () => {
    const m = mensajeConfirmarRetiro(base, null, null);
    expect(m).not.toContain('Proveedor:');
    expect(m).not.toContain('Confirmó:');
    expect(m).not.toContain('—');
  });

  it('viaja sin selector de emoji ni unión invisible', () => {
    expect(/\uFE0F|\u200D/.test(mensajeConfirmarRetiro(base, 'FERRETERÍA CARONÍ', 'x@gmail.com') ?? '')).toBe(false);
  });

  it('el enlace va derecho a api.whatsapp.com y devuelve el texto exacto', () => {
    const texto = mensajeConfirmarRetiro(base, 'FERRETERÍA CARONÍ', 'x@gmail.com') ?? '';
    const url = enlaceWhatsapp(texto);
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(url).not.toContain('wa.me');
    expect(decodeURIComponent(url.split('text=')[1])).toBe(texto);
  });
});
