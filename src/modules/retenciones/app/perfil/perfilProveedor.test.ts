import { describe, expect, it } from 'vitest';
import {
  huellaPerfil, partesDePersona, personaDe, rangoPerfil, sugerenciaRif, textoCategoria, textoLicenciaHistorial, validarPerfil,
  type BorradorPerfil,
} from './perfilProveedor';

// Datos inventados.
const vacio: BorradorPerfil = { tipoContribuyente: '', persona: '', actividadCodigo: '', sujeto100Portal: false, licenciaActividad: '', numeroId: '' };

describe('el perfil fiscal del proveedor (maqueta v8-4 §7 y v7-3; tabla retencion_perfil_proveedor del paquete 05)', () => {
  it('tipo de persona + residencia → los 4 valores de la base, y de vuelta', () => {
    expect(personaDe('juridica', 've')).toBe('pj_domiciliada');
    expect(personaDe('juridica', 'fuera')).toBe('pj_no_domiciliada');
    expect(personaDe('natural', 've')).toBe('pn_residente');
    expect(personaDe('natural', 'fuera')).toBe('pn_no_residente');
    expect(personaDe('natural', '')).toBe('');
    expect(partesDePersona('pj_no_domiciliada')).toEqual({ tipo: 'juridica', residencia: 'fuera' });
    expect(partesDePersona('')).toEqual({ tipo: '', residencia: '' });
  });
  it('la categoría resulta de lo anterior; la jurídica no domiciliada avisa la Tarifa N° 2', () => {
    expect(textoCategoria('pn_residente')).toEqual({ categoria: 'Persona natural residente', falta: null });
    expect(textoCategoria('pj_no_domiciliada').falta).toMatch(/Tarifa N° 2/);
    expect(textoCategoria('').categoria).toBeNull();
  });
  it('la letra del RIF solo sugiere', () => {
    expect(sugerenciaRif('J-00000001-0')).toBe('juridica');
    expect(sugerenciaRif('g-20000000-1')).toBe('juridica');
    expect(sugerenciaRif('V-00000002-3')).toBe('natural');
    expect(sugerenciaRif('E-00000003-4')).toBe('natural');
    expect(sugerenciaRif('P-1')).toBe('');
    expect(sugerenciaRif('')).toBe('');
  });
  it('valida como la base: la actividad con el estilo 3.2.14.04 (1 a 6 niveles) o «sin actividad en el municipio»', () => {
    expect(validarPerfil(vacio)).toEqual([]);
    expect(validarPerfil({ ...vacio, actividadCodigo: '3.2.14.04' })).toEqual([]);
    expect(validarPerfil({ ...vacio, actividadCodigo: 'sin_actividad_municipio' })).toEqual([]);
    expect(validarPerfil({ ...vacio, actividadCodigo: '1.2.3.4.5.6.7' })).toHaveLength(1);
    expect(validarPerfil({ ...vacio, actividadCodigo: '3.a' })).toHaveLength(1);
    expect(validarPerfil({ ...vacio, licenciaActividad: '   ' })).toEqual([]);
  });
  it('la huella: quién y cuándo, o sin modificaciones', () => {
    expect(huellaPerfil(null, null)).toBe('Perfil sin modificaciones registradas.');
    expect(huellaPerfil('Usuaria Prueba', '05/10/2026 10:15 a. m.')).toBe('Última modificación del perfil: Usuaria Prueba · 05/10/2026 10:15 a. m.');
  });
  it('el historial de la licencia dice de dónde vino el cambio', () => {
    expect(textoLicenciaHistorial({ antes: null, despues: 'LIC-001', origen: 'retenciones', quien: 'Usuaria Prueba', cuando: '05/10/2026' }))
      .toBe('(vacía) → LIC-001 · desde Retenciones · Usuaria Prueba · 05/10/2026');
    expect(textoLicenciaHistorial({ antes: 'LIC-001', despues: 'LIC-002', origen: 'ficha', quien: 'Otro Usuario', cuando: '06/10/2026' }))
      .toBe('LIC-001 → LIC-002 · desde la ficha del proveedor · Otro Usuario · 06/10/2026');
  });
  it('los rangos de la pestaña «Retenciones» (PF_ATAJOS de v8-14)', () => {
    const hoy = new Date(2026, 9, 20);
    expect(rangoPerfil('anio_actual', hoy)).toEqual(['2026-01-01', '2026-10-20']);
    expect(rangoPerfil('anio_anterior', hoy)).toEqual(['2025-01-01', '2025-12-31']);
    expect(rangoPerfil('ultimos_6', hoy)).toEqual(['2026-05-01', '2026-10-20']);
    expect(rangoPerfil('ultimos_12', hoy)).toEqual(['2025-11-01', '2026-10-20']);
  });
});
