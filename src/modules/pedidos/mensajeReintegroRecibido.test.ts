import { describe, expect, it } from 'vitest';
import { mensajeReintegroRecibido } from './mensajeReintegroRecibido';

describe('aviso de reintegro confirmado', () => {
  it('identifica ingreso, cuenta, referencia, productos y comprobante con emojis', () => {
    const texto = mensajeReintegroRecibido({ codigo: 'OC-2026-0202', proveedor: 'Proveedor de prueba', monto: 6475.84,
      moneda: 'Bs', caja: 'Caja Bs', cuenta: 'personal', referencia: '536736597', motivo: 'Cinco unidades no entregadas',
      fecha: '2026-11-27T20:00:00Z', productos: [{ sku: 'MAT-109', nombre: 'PERRO DE GUAYA', cantidad: 5 }] });
    expect(texto).toContain('↩️ *REINTEGRO RECIBIDO · TESORERÍA*');
    expect(texto).toContain('💳 *Cuenta:* personal');
    expect(texto).toContain('🔎 *Referencia:* 536736597');
    expect(texto).toContain('• MAT-109 · PERRO DE GUAYA · 5');
    expect(texto).toContain('📝 *Motivo:* Cinco unidades no entregadas');
    expect(texto).toContain('📎 Se adjunta el comprobante');
    expect(texto).toContain('Entradas por reintegro');
  });
});
