import { describe, expect, it } from 'vitest';
import {
  COMPROMISO_TRABAJADOR,
  contenidoSolicitudPermiso,
  diasInclusivePermiso,
  validarSolicitudPermiso,
  type SolicitudPermisoForm,
} from './permisoLaboral';
import { MGG } from './empresa';

const VALIDA: SolicitudPermisoForm = {
  personal_id: 'persona-1',
  fecha_solicitud: '2026-11-20',
  fecha_inicio: '2026-11-23',
  fecha_fin: '2026-11-25',
  tiempo_solicitado: '3 día(s)',
  horario: '08:00 a 12:00',
  motivo: 'Trámite médico familiar',
  compromiso: COMPROMISO_TRABAJADOR,
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
});
