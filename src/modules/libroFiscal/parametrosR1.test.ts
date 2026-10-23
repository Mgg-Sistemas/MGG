import { describe, expect, it } from 'vitest';
import type { FilaPerfil, PerfilFiscal } from './perfilesFiscales.repository';
import { desdeMinimo, fechaCorta, filtrarPorCompleto, perfilInicial, sugerenciaDistinta, territorio } from './parametrosR1';

// Datos inventados.
const fila = (id: string, completo: boolean): FilaPerfil => ({
  proveedorId: id, razonSocial: id, rif: null, telefonoAdministracion: null, actividadFicha: null, perfilId: null,
  sujeto: null, tipoContribuyente: null, licenciaEstado: null, licenciaVence: null, actividades: 0,
  faltan: completo ? [] : ['perfil'], completo,
});

describe('piezas de pantalla de R1', () => {
  it('territorio según el tipo de ente', () => {
    expect(territorio({ tipo: 'municipal', estado: 'Estado de prueba', municipio: 'Municipio de prueba' })).toBe('Municipio de prueba, Estado de prueba');
    expect(territorio({ tipo: 'estadal', estado: 'Estado de prueba', municipio: null })).toBe('Estado de prueba');
    expect(territorio({ tipo: 'nacional', estado: null, municipio: null })).toBe('Todo el país');
  });

  it('filtro todos / incompletos / completos', () => {
    const xs = [fila('a', true), fila('b', false)];
    expect(filtrarPorCompleto(xs, 'todos')).toHaveLength(2);
    expect(filtrarPorCompleto(xs, 'incompletos').map((x) => x.proveedorId)).toEqual(['b']);
    expect(filtrarPorCompleto(xs, 'completos').map((x) => x.proveedorId)).toEqual(['a']);
  });

  it('el formulario arranca del vigente o vacío; nunca adivina por el RIF', () => {
    expect(perfilInicial(null)).toMatchObject({ tipoPersona: 'juridica', residente: true, licenciaEstado: 'por_solicitar' });
    const v = { tipoPersona: 'natural', residente: false, tipoContribuyente: 'especial', esAgenteRetencion: true, licenciaTipo: 'x', licenciaNumero: '1', licenciaEstado: 'vigente', licenciaVence: '2027-01-01', licenciaEnteId: null, observacion: null } as unknown as PerfilFiscal;
    expect(perfilInicial(v)).toMatchObject({ tipoPersona: 'natural', residente: false, licenciaEstado: 'vigente', licenciaNumero: '1' });
  });

  it('la sugerencia por RIF aparece solo si difiere de lo elegido', () => {
    expect(sugerenciaDistinta('V-00000001-0', { tipoPersona: 'juridica', residente: true })?.sujeto).toBe('pn_residente');
    expect(sugerenciaDistinta('J-00000001-0', { tipoPersona: 'juridica', residente: true })).toBeNull();
    expect(sugerenciaDistinta(null, { tipoPersona: 'juridica', residente: true })).toBeNull();
  });

  it('la versión nueva empieza el día después de la vigente; fechas cortas', () => {
    expect(desdeMinimo({ desde: '2026-10-31' })).toBe('2026-11-01');
    expect(desdeMinimo(null)).toBeNull();
    expect(fechaCorta('2026-10-16T10:00:00Z')).toBe('16/10/2026');
    expect(fechaCorta(null)).toBe('—');
  });
});
