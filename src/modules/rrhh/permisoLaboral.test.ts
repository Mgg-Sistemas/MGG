import { describe, expect, it } from 'vitest';
import type { Personal, RrhhEvento } from '@/shared/lib/types';
import {
  COMPROMISO_TRABAJADOR,
  contenidoSolicitudPermiso,
  diasInclusivePermiso,
  hayCambioFirmaEnEdicion,
  inicialSolicitudPermiso,
  solicitudSinPersonal,
  validarSolicitudPermiso,
  type SolicitudPermisoForm,
} from './permisoLaboral';
import { MGG } from './empresa';
import { construirSolicitudPermisoPdf } from './solicitudPermisoPdf';

const VALIDA: SolicitudPermisoForm = {
  personal_id: 'persona-1',
  fecha_solicitud: '2026-11-20',
  fecha_inicio: '2026-11-23',
  fecha_fin: '2026-11-25',
  tiempo_solicitado: '3 día(s)',
  horario: '08:00 a 12:00',
  motivo: 'Trámite médico familiar',
  compromiso: COMPROMISO_TRABAJADOR,
  empresa: 'MGG',
  trabajador: {
    nombre: 'Ana María',
    apellido: 'Pérez González',
    cedula: 'V-27.514.395',
    cargo: 'Analista de RRHH',
    departamento: 'Recursos Humanos',
    telefono: '0412-5551234',
  },
};

describe('permiso laboral · validación', () => {
  it('acepta una solicitud completa', () => {
    expect(validarSolicitudPermiso(VALIDA)).toBeNull();
  });

  it('pide el trabajador y el motivo', () => {
    expect(validarSolicitudPermiso({ ...VALIDA, personal_id: '' })).toMatch(/trabajador/i);
    expect(validarSolicitudPermiso({ ...VALIDA, motivo: '   ' })).toMatch(/motivo/i);
  });

  it('exige fechas válidas y que el fin no sea antes del inicio', () => {
    expect(validarSolicitudPermiso({ ...VALIDA, fecha_inicio: '' })).toMatch(/inicio/i);
    expect(validarSolicitudPermiso({ ...VALIDA, fecha_fin: '2026-11-22' })).toMatch(/fin/i);
  });

  it('cuenta los días inclusive', () => {
    expect(diasInclusivePermiso('2026-11-23', '2026-11-25')).toBe(3);
    expect(diasInclusivePermiso('2026-11-25', '2026-11-23')).toBe(0);
  });

  it('valida la firma opcional del jefe de departamento cuando está marcada', () => {
    expect(validarSolicitudPermiso({ ...VALIDA, requiere_firma_jefe: true, jefe_departamento: null })).toMatch(/jefe de departamento/i);
    expect(
      validarSolicitudPermiso({
        ...VALIDA,
        requiere_firma_jefe: true,
        jefe_departamento: {
          personal_id: 'p-jefe',
          nombre: 'Carlos',
          apellido: 'Rodríguez',
          cargo: 'Gerente de Planta',
          departamento: 'Operaciones',
        },
      }),
    ).toBeNull();
  });
});

describe('permiso laboral · abrir un permiso ya guardado', () => {
  const persona: Personal = {
    id: 'p-1', nombre: 'Ana María', apellido: 'Pérez González', cedula: 'V-27.514.395',
    cargo: 'Analista de RRHH', departamento: 'Recursos Humanos', telefono: '0412-5551234',
    sueldo_base: 1000, activo: true, created_at: '2026-01-01T00:00:00.000Z',
  };
  const eventoViejo: RrhhEvento = {
    id: 'e-1', personal_id: 'p-1', tipo: 'permiso', estado: 'activo',
    empresa: 'MGG', fecha_desde: '2026-11-23', fecha_hasta: '2026-11-25', dias: 3,
    descripcion: 'Trámite médico familiar', created_at: '2026-11-20T12:00:00.000Z',
  };

  it('muestra el trabajador del evento aunque el selector de arriba esté vacío', () => {
    const form = inicialSolicitudPermiso([persona], '', MGG.key, eventoViejo);
    expect(form.personal_id).toBe('p-1');
    expect(form.trabajador.nombre).toBe('Ana María');
    expect(form.trabajador.cedula).toBe('V-27.514.395');
    expect(form.fecha_inicio).toBe('2026-11-23');
    expect(form.motivo).toBe('Trámite médico familiar');
  });

  it('corrige un nombre cortado guardado en la solicitud con el dato actual de RRHH', () => {
    const snapshotViejo = {
      ...solicitudSinPersonal({ ...VALIDA, personal_id: 'p-1' }),
      trabajador: { ...VALIDA.trabajador, nombre: 'ANA MAR' },
    };
    const eventoConSnapshot: RrhhEvento = { ...eventoViejo, solicitud: snapshotViejo };
    const form = inicialSolicitudPermiso([persona], '', MGG.key, eventoConSnapshot);
    expect(form.trabajador.nombre).toBe('Ana María');
    expect(form.motivo).toBe('Trámite médico familiar');
  });

  it('detecta que se agregó la firma del jefe en un permiso viejo sin solicitud', () => {
    const form = inicialSolicitudPermiso([persona], '', MGG.key, eventoViejo);
    expect(hayCambioFirmaEnEdicion(eventoViejo, form)).toBe(false);
    const conFirma: SolicitudPermisoForm = {
      ...form,
      requiere_firma_jefe: true,
      jefe_departamento: {
        personal_id: 'p-jefe', nombre: 'Carlos', apellido: 'Rodríguez',
        cargo: 'Gerente de Planta', departamento: 'Operaciones',
      },
    };
    expect(hayCambioFirmaEnEdicion(eventoViejo, conFirma)).toBe(true);
  });

  it('no repite el personal_id dentro del JSON de la solicitud', () => {
    const guardada = solicitudSinPersonal(VALIDA);
    expect(guardada).not.toHaveProperty('personal_id');
    expect(guardada.motivo).toBe('Trámite médico familiar');
  });
});

describe('permiso laboral · contenido del PDF', () => {
  it('muestra todos los datos rellenados, el compromiso y las dos firmas', () => {
    const txt = contenidoSolicitudPermiso(VALIDA, MGG);
    for (const parte of [
      'SOLICITUD DE PERMISO LABORAL',
      'Ana María Pérez González',
      'V-27.514.395',
      'Analista de RRHH',
      'Recursos Humanos',
      '0412-5551234',
      '20/11/2026',
      '23/11/2026',
      '25/11/2026',
      '3 día(s)',
      '08:00 a 12:00',
      'Trámite médico familiar',
      COMPROMISO_TRABAJADOR,
      'Firma del trabajador',
      'Firma de RRHH',
      MGG.razonSocial,
    ]) {
      expect(txt, `debe aparecer: ${parte}`).toContain(parte);
    }
  });

  it('no pone la línea de horario cuando no aplica', () => {
    const txt = contenidoSolicitudPermiso({ ...VALIDA, horario: '' }, MGG);
    expect(txt).not.toContain('Horario (si aplica): —');
  });

  it('construye el documento PDF con jsPDF exitosamente', async () => {
    const doc = await construirSolicitudPermisoPdf(VALIDA, MGG);
    expect(doc).toBeDefined();
    expect(doc.internal.pages.length).toBeGreaterThanOrEqual(2); // jsPDF 1-based page array
  });

  it('incluye la firma de jefe de departamento en el contenido y construye el PDF con 3 firmas', async () => {
    const conJefe: SolicitudPermisoForm = {
      ...VALIDA,
      requiere_firma_jefe: true,
      jefe_departamento: {
        personal_id: 'p-jefe',
        nombre: 'Carlos',
        apellido: 'Rodríguez',
        cedula: 'V-19.876.543',
        cargo: 'Gerente de Planta',
        departamento: 'Operaciones',
      },
    };
    const txt = contenidoSolicitudPermiso(conJefe, MGG);
    expect(txt).toContain('Firma Jefe de Departamento');
    expect(txt).toContain('Carlos Rodríguez · Gerente de Planta');

    const doc = await construirSolicitudPermisoPdf(conJefe, MGG);
    expect(doc).toBeDefined();
    expect(doc.internal.pages.length).toBeGreaterThanOrEqual(2);
  });
});
