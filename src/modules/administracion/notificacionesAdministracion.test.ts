import { describe, it, expect } from 'vitest';
import {
  calcularHitoVigencia,
  siguienteHitoEstablecido,
  debeNotificarDocumento,
  evaluarAlertasDocumentos,
  type RegistroDescarte,
} from './notificacionesAdministracion';
import type { DocumentoEmpresa } from './admin.repository';

describe('notificacionesAdministracion · Lógica de Alertas y Tiempos Establecidos', () => {
  it('calcula los hitos canónicos según los días restantes', () => {
    expect(calcularHitoVigencia(45)).toBe('vigente_ok');
    expect(calcularHitoVigencia(31)).toBe('vigente_ok');
    expect(calcularHitoVigencia(30)).toBe('pv_30d');
    expect(calcularHitoVigencia(20)).toBe('pv_30d');
    expect(calcularHitoVigencia(15)).toBe('pv_15d');
    expect(calcularHitoVigencia(10)).toBe('pv_15d');
    expect(calcularHitoVigencia(7)).toBe('pv_7d');
    expect(calcularHitoVigencia(5)).toBe('pv_7d');
    expect(calcularHitoVigencia(3)).toBe('pv_3d');
    expect(calcularHitoVigencia(2)).toBe('pv_3d');
    expect(calcularHitoVigencia(1)).toBe('pv_1d');
    expect(calcularHitoVigencia(0)).toBe('pv_1d');

    // Vencidos según días transcurridos
    expect(calcularHitoVigencia(-1)).toBe('vencido_0d');
    expect(calcularHitoVigencia(-3)).toBe('vencido_0d');
    expect(calcularHitoVigencia(-5)).toBe('vencido_7d');
    expect(calcularHitoVigencia(-7)).toBe('vencido_7d');
    expect(calcularHitoVigencia(-12)).toBe('vencido_15d');
    expect(calcularHitoVigencia(-25)).toBe('vencido_30d');
  });

  it('determina la secuencia estricta del siguiente hito establecido', () => {
    expect(siguienteHitoEstablecido('pv_30d')).toBe('pv_15d');
    expect(siguienteHitoEstablecido('pv_15d')).toBe('pv_7d');
    expect(siguienteHitoEstablecido('pv_7d')).toBe('pv_3d');
    expect(siguienteHitoEstablecido('pv_3d')).toBe('pv_1d');
    expect(siguienteHitoEstablecido('pv_1d')).toBe('vencido_0d');
    expect(siguienteHitoEstablecido('vencido_0d')).toBe('vencido_7d');
    expect(siguienteHitoEstablecido('vencido_7d')).toBe('vencido_15d');
    expect(siguienteHitoEstablecido('vencido_15d')).toBe('vencido_30d');
  });

  it('cumple la regla del usuario: descartable y no vuelve a sonar hasta el siguiente tiempo establecido', () => {
    const docId = 'doc-rum-2026';
    const descartes: Record<string, RegistroDescarte> = {};

    // 1. A los 25 días (pv_30d), nunca se ha descartado -> debe sonar
    expect(debeNotificarDocumento(docId, 'pv_30d', descartes)).toBe(true);

    // 2. El usuario la descarta en pv_30d
    descartes[docId] = {
      docId,
      hitoDescartado: 'pv_30d',
      descartadoEn: '2026-11-16T12:00:00Z',
      proximoHitoEsperado: 'pv_15d',
      diasAlDescartar: 25,
    };

    // 3. Pasan los días, ahora quedan 20 días (sigue en pv_30d) -> NO debe sonar
    expect(debeNotificarDocumento(docId, 'pv_30d', descartes)).toBe(false);

    // 4. El tiempo avanza y entra a los 15 días (pv_15d - siguiente tiempo establecido) -> VUELVE A SONAR
    expect(debeNotificarDocumento(docId, 'pv_15d', descartes)).toBe(true);

    // 5. El usuario vuelve a descartar en pv_15d
    descartes[docId] = {
      docId,
      hitoDescartado: 'pv_15d',
      descartadoEn: '2026-11-26T12:00:00Z',
      proximoHitoEsperado: 'pv_7d',
      diasAlDescartar: 15,
    };

    // 6. A los 12 días (sigue en pv_15d) -> NO debe sonar
    expect(debeNotificarDocumento(docId, 'pv_15d', descartes)).toBe(false);

    // 7. A los 7 días (pv_7d) -> VUELVE A SONAR
    expect(debeNotificarDocumento(docId, 'pv_7d', descartes)).toBe(true);
  });

  it('aplica la regla de silenciamiento hasta el siguiente tiempo en caso de estar vencido', () => {
    const docId = 'doc-bomberos';
    const descartes: Record<string, RegistroDescarte> = {};

    // 1. Vencido hace 2 días (vencido_0d) -> debe sonar
    expect(debeNotificarDocumento(docId, 'vencido_0d', descartes)).toBe(true);

    // 2. El usuario lo descarta
    descartes[docId] = {
      docId,
      hitoDescartado: 'vencido_0d',
      descartadoEn: '2026-11-16T12:00:00Z',
      proximoHitoEsperado: 'vencido_7d',
      diasAlDescartar: -2,
    };

    // 3. Al día siguiente (vencido hace 3 días, sigue en vencido_0d) -> NO debe sonar
    expect(debeNotificarDocumento(docId, 'vencido_0d', descartes)).toBe(false);

    // 4. A los 6 días de vencido (alcanzó el hito vencido_7d) -> VUELVE A SONAR
    expect(debeNotificarDocumento(docId, 'vencido_7d', descartes)).toBe(true);
  });

  it('evalúa una lista de documentos discriminando los que deben sonar de los silenciados', () => {
    const mockDocs: DocumentoEmpresa[] = [
      {
        id: 'doc-1',
        empresaClave: 'GT',
        carpeta: 'permisos_mineros',
        tipo: 'otro',
        nombre: 'RUM 2026',
        path: 'GT/rum.pdf',
        contentType: 'application/pdf',
        tamano: 1000,
        fechaEmision: '2026-01-01',
        fechaVencimiento: '2026-12-01', // ~15 días a partir de hoyRef 2026-11-16
        statusVencimiento: 'por_vencer',
        socioNombre: null,
        entidadEmisora: null,
        numeroRegistro: null,
        notaTramite: null,
        historial: [],
        createdAt: '2026-01-01',
        updatedAt: null,
      },
      {
        id: 'doc-2',
        empresaClave: 'GT',
        carpeta: 'tributario_fiscal',
        tipo: 'solvencia_municipal',
        nombre: 'Bomberos 2026',
        path: 'GT/bomberos.pdf',
        contentType: 'application/pdf',
        tamano: 1000,
        fechaEmision: '2025-01-01',
        fechaVencimiento: '2026-11-10', // Vencido hace 6 días
        statusVencimiento: 'vencido',
        socioNombre: null,
        entidadEmisora: null,
        numeroRegistro: null,
        notaTramite: null,
        historial: [],
        createdAt: '2025-01-01',
        updatedAt: null,
      },
    ];

    const descartes: Record<string, RegistroDescarte> = {
      'doc-1': {
        docId: 'doc-1',
        hitoDescartado: 'pv_15d', // Silenciado en este hito
        descartadoEn: '2026-11-16T10:00:00Z',
        proximoHitoEsperado: 'pv_7d',
        diasAlDescartar: 15,
      },
    };

    const res = evaluarAlertasDocumentos(mockDocs, '2026-11-16', descartes);
    expect(res.alertas.length).toBe(2);
    // doc-1 está silenciada en pv_15d, así que solo doc-2 (vencido) debe sonar
    expect(res.nuevasParaSonar.length).toBe(1);
    expect(res.nuevasParaSonar[0].docId).toBe('doc-2');
    expect(res.totalSilenciadas).toBe(1);
  });
});
