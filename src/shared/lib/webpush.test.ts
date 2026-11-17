import { describe, it, expect, beforeEach } from 'vitest';
import {
  soportaPush,
  isPushHabilitado,
  togglePushHabilitado,
  probarNotificacionPush,
  MODULOS_NOTIFICACION,
  getModulosNotifActivos,
  isModuloNotifActivo,
  setModuloNotifActivo,
  setTodosModulosNotif,
  emitirWebPush,
} from './webpush';

describe('webpush · Notificaciones Push y del Dispositivo (MGG)', () => {
  beforeEach(async () => {
    await togglePushHabilitado(true);
    setTodosModulosNotif(true);
  });

  it('detecta soporte de push según las APIs del navegador', () => {
    const soporta = soportaPush();
    expect(typeof soporta).toBe('boolean');
  });

  it('devuelve falso en isPushHabilitado si no hay soporte en el entorno', () => {
    if (!soportaPush()) {
      expect(isPushHabilitado()).toBe(false);
    }
  });

  it('permite alternar el estado con togglePushHabilitado', async () => {
    await togglePushHabilitado(false);
    await togglePushHabilitado(true);
  });

  it('informa correctamente si no soporta push al intentar probarlo en entorno sin SW', async () => {
    if (!soportaPush()) {
      const res = await probarNotificacionPush();
      expect(res.ok).toBe(false);
      expect(res.motivo).toMatch(/no soporta/i);
    }
  });

  it('contiene la lista completa de módulos con notificaciones configurables', () => {
    expect(MODULOS_NOTIFICACION.length).toBeGreaterThanOrEqual(8);
    const keys = MODULOS_NOTIFICACION.map((m) => m.key);
    expect(keys).toContain('administracion');
    expect(keys).toContain('delivery');
    expect(keys).toContain('inventario');
    expect(keys).toContain('maquinaria');
    expect(keys).toContain('combustible');
    expect(keys).toContain('tesoreria');
    expect(keys).toContain('cocina');
    expect(keys).toContain('compras');
  });

  it('permite consultar y alternar el estado de cada módulo individualmente', () => {
    expect(isModuloNotifActivo('delivery')).toBe(true);
    setModuloNotifActivo('delivery', false);
    expect(isModuloNotifActivo('delivery')).toBe(false);
    expect(isModuloNotifActivo('administracion')).toBe(true);
    setModuloNotifActivo('delivery', true);
    expect(isModuloNotifActivo('delivery')).toBe(true);
  });

  it('permite activar o desactivar todos los módulos de forma masiva', () => {
    setTodosModulosNotif(false);
    const inactivos = getModulosNotifActivos();
    expect(inactivos.delivery).toBe(false);
    expect(inactivos.administracion).toBe(false);
    expect(inactivos.maquinaria).toBe(false);

    setTodosModulosNotif(true);
    const activos = getModulosNotifActivos();
    expect(activos.delivery).toBe(true);
    expect(activos.administracion).toBe(true);
    expect(activos.maquinaria).toBe(true);
  });

  it('bloquea la emisión si el módulo especificado está desactivado', async () => {
    setModuloNotifActivo('delivery', false);
    const emitido = await emitirWebPush({
      modulo: 'delivery',
      titulo: 'Test Delivery',
      cuerpo: 'Probando bloqueo de módulo silenciado',
    });
    expect(emitido).toBe(false);
  });
});
