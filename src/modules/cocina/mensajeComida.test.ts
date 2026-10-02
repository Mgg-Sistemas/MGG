import { describe, expect, it } from 'vitest';
import { EMOJI_COMIDA, enlaceWhatsapp, fechaComidaTexto, mensajeComida } from './mensajeComida';

const comida = () => ({
  tipo_comida: 'almuerzo' as const,
  platos: 32,
  codigo: 'COC-2026-0430',
  at: '2026-09-29T16:00:00.000Z',
  nota: 'Pollo guisado',
  items: [
    { producto_id: 'a', sku: 'VIV-057', nombre: 'ARROZ', unidad: 'KILOGRAMO', cantidad: 3.5, precio: 1.33, subtotal: 4.66 },
    { producto_id: 'b', sku: 'CAR-012', nombre: 'POLLO', unidad: 'KILOGRAMO', cantidad: 8, precio: 3, subtotal: 24 },
  ],
});

describe('mensajeComida', () => {
  it('cuenta servicio, cocina, fecha, personas y lo consumido (sin precios)', () => {
    const t = mensajeComida(comida(), { cocina: 'Los Pinos', fotos: 2 });
    expect(t).toContain('🍛 *ALMUERZO*');
    expect(t).toContain('🏠 Cocina: Los Pinos');
    expect(t).toContain('📅 Fecha: 29/09/2026');
    expect(t).toContain('👥 Personas: *32*');
    expect(t).toContain('• ARROZ: 3,5 kilogramo');
    expect(t).toContain('📝 Nota: Pollo guisado');
    expect(t).toContain('📷 Fotos: 2');
    expect(t).not.toContain('$');
  });

  it('la fecha es la de planta (Venezuela)', () => {
    expect(fechaComidaTexto('2026-09-30T02:00:00.000Z')).toBe('29/09/2026');
  });

  it('ningún emoji depende del selector U+FE0F y el texto viaja entero por el enlace', () => {
    const SELECTOR = /️/;
    for (const [tipo, e] of Object.entries(EMOJI_COMIDA)) expect(e, tipo).not.toMatch(SELECTOR);
    for (const tipo of ['desayuno', 'almuerzo', 'cena'] as const) {
      const t = mensajeComida({ ...comida(), tipo_comida: tipo }, { cocina: 'La Esperanza', fotos: 1 });
      expect(t, tipo).not.toMatch(SELECTOR);
      const enlace = enlaceWhatsapp(t);
      expect(enlace.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
      expect(decodeURIComponent(enlace.split('text=')[1])).toBe(t);
    }
  });
});
