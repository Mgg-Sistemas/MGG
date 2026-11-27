import { describe, expect, it } from 'vitest';
import { mensajeConfirmarRetiro } from './mensajeConfirmarRetiro';
import { enlaceWhatsapp } from '@/modules/combustible/mensajeMovimiento';

/** OC-2026-0309, el ejemplo que pidió la administración (27-11-2026). */
const base = {
  codigo: 'OP-2026-0309',
  oc_codigo: 'OC-2026-0309',
  entrega_modalidad: 'carga_pesada' as const,
  retiro_confirmado_en: '2026-11-27T14:41:00.000Z', // 10:41 a. m. en Caracas
  urgente: false,
  notas: 'LISTADO DE MATERIALES PARA CONSTRUCCION DE BAÑOS, LAVANDERO Y SEPTICO (PEDRO MORENO)',
  total: 5423.6,
  moneda: 'USD',
  almacen_destino: 'General',
  sede_destino: 'LOS PINOS',
  unidad_solicitante: 'MINA PERAMANAL',
};
const extra = {
  proveedorDireccion: 'URB BARRIO GUAYANA, MNAZ T CASA 10-A PUERTO ORDAZ EDO BOLIVAR',
  solicita: 'SRA WENDY',
  analista: 'KELVIN PEÑA',
};
const proveedor = 'COMERCIALIZADORA MAXIAVANCE, C.A';

describe('mensajeConfirmarRetiro (27-11-2026)', () => {
  it('Carga pesada: reproduce el formato pedido, renglón por renglón', () => {
    const m = mensajeConfirmarRetiro(base, proveedor, 'JAVIER LEIVA', extra);
    expect(m?.split('\n')).toEqual([
      '*CONFIRMAR RETIRO POR SISTEMAS - CARGA PESADA*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '🔹 *ORDEN:* OC-2026-0309',
      `🏭 *Proveedor:* ${proveedor}`,
      `📍 *Dirección:* ${extra.proveedorDireccion}`,
      '🟢 *Requerimiento:* Normal',
      '🚚 *Entrega:* Carga pesada',
      '🚛 *CARGA PESADA*',
      '👤 *Solicita:* SRA WENDY · MINA PERAMANAL',
      '🛒 *Analista encargado:* KELVIN PEÑA',
      '🏬 *Entregar en:* General',
      '📍 *Dirección de recepción:* Almacén Los Pinos',
      `📌 *Nota:* ${base.notas}`,
      '💵 *Total:* $5.423,60',
      '',
      '📦 *Productos:* NO se muestran aquí · para verlos, *revise el sistema*.',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '✅ *Retiro confirmado:* JAVIER LEIVA · 🕒 27/11/2026, 10:41 a. m.',
      '🏢 *GOLDEN TOUCH 1127 C.A.* · Delivery',
    ]);
  });

  it('Delivery: dice DELIVERY en el encabezado y en la línea de la flota', () => {
    const m = mensajeConfirmarRetiro({ ...base, entrega_modalidad: 'delivery' }, proveedor, 'JAVIER LEIVA', extra) ?? '';
    expect(m.split('\n')[0]).toBe('*CONFIRMAR RETIRO POR SISTEMAS - DELIVERY*');
    expect(m).toContain('🚚 *Entrega:* Delivery');
    expect(m).toContain('🛵 *DELIVERY*');
    expect(m.toUpperCase()).not.toContain('CARGA PESADA');
  });

  it('un requerimiento urgente se marca como URGENTE', () => {
    expect(mensajeConfirmarRetiro({ ...base, urgente: true }, proveedor, null, extra)).toContain('🚨 *Requerimiento:* URGENTE');
  });

  it('no muestra la lista de productos ni la palabra SUBELO', () => {
    const m = mensajeConfirmarRetiro(base, proveedor, 'JAVIER LEIVA', extra) ?? '';
    expect(m).not.toMatch(/^•/m);
    expect(m.toUpperCase()).not.toContain('SUBELO');
  });

  it('entrega a domicilio no genera aviso de flota', () => {
    expect(mensajeConfirmarRetiro({ ...base, entrega_modalidad: 'proveedor' }, proveedor, 'x@gmail.com', extra)).toBeNull();
  });

  it('sin confirmación guardada no genera aviso', () => {
    expect(mensajeConfirmarRetiro({ ...base, retiro_confirmado_en: null }, proveedor, 'x@gmail.com', extra)).toBeNull();
  });

  it('al reabrir el aviso desde el detalle usa quién confirmó, aunque venga guardado en la OC', () => {
    const conGuardado = { ...base, retiro_confirmado_por: 'hector@gmail.com' };
    expect(mensajeConfirmarRetiro(conGuardado, proveedor, null, extra)).toContain('✅ *Retiro confirmado:* hector@gmail.com');
    expect(mensajeConfirmarRetiro(conGuardado, proveedor, 'otro@gmail.com', extra)).toContain('✅ *Retiro confirmado:* otro@gmail.com');
  });

  it('los datos que faltan no salen como «—» ni dejan separadores colgando', () => {
    const m = mensajeConfirmarRetiro({ ...base, unidad_solicitante: null }, null, null) ?? '';
    expect(m).not.toContain('Proveedor:');
    expect(m).not.toContain('Dirección:*');
    expect(m).not.toContain('Solicita:');
    expect(m).not.toContain('Analista encargado:');
    expect(m).toContain('✅ *Retiro confirmado:* 🕒');
    expect(m).not.toContain('—');
  });

  it('viaja sin selector de emoji ni unión invisible', () => {
    expect(/\uFE0F|\u200D/.test(mensajeConfirmarRetiro(base, proveedor, 'x@gmail.com', extra) ?? '')).toBe(false);
  });

  it('el enlace va derecho a api.whatsapp.com y devuelve el texto exacto', () => {
    const texto = mensajeConfirmarRetiro(base, proveedor, 'x@gmail.com', extra) ?? '';
    const url = enlaceWhatsapp(texto);
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(url).not.toContain('wa.me');
    expect(decodeURIComponent(url.split('text=')[1])).toBe(texto);
  });
});
