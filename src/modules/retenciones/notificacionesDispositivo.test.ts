import { describe, expect, it, beforeEach } from 'vitest';
import {
  isAvisosPantallaHabilitados,
  setAvisosPantallaHabilitados,
  isNotificacionesSoportadas,
  getEstadoPermisoNotificacion,
  lanzarAvisoFactura,
  detenerAlertaTitulo,
} from './notificacionesDispositivo';

describe('notificacionesDispositivo · Avisos en Pantalla / Móvil (100% Web sin instalación)', () => {
  beforeEach(() => {
    setAvisosPantallaHabilitados(true);
  });

  it('permite habilitar y deshabilitar avisos en pantalla', () => {
    setAvisosPantallaHabilitados(false);
    expect(isAvisosPantallaHabilitados()).toBe(false);

    setAvisosPantallaHabilitados(true);
    expect(isAvisosPantallaHabilitados()).toBe(true);
  });

  it('reporta estado de soporte o permisos en el entorno de ejecución', () => {
    // En Node / Vitest sin DOM nativo de navegador, debe manejar unsupported limpiamente
    const soportado = isNotificacionesSoportadas();
    const estado = getEstadoPermisoNotificacion();
    expect(typeof soportado).toBe('boolean');
    expect(['granted', 'denied', 'default', 'unsupported']).toContain(estado);
  });

  it('ejecuta lanzarAvisoFactura y detenerAlertaTitulo sin arrojar excepciones', () => {
    expect(() => {
      lanzarAvisoFactura({
        empresa: 'MGG Inversiones',
        proveedorNombre: 'Proveedor Test',
        moneda: 'USD',
        montoTotal: 150,
      });
      detenerAlertaTitulo();
    }).not.toThrow();
  });
});

