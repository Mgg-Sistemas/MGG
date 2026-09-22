import { describe, it, expect } from 'vitest';
import {
  MAX_BYTES_DOCUMENTO, TIPOS_DOCUMENTO_PERSONAL, archivoDocumentoValido, documentacionCompleta,
  documentosFaltantes, esImagen, esPdf, esTipoDocumento, labelDocumento, megas, nombreSeguro,
  resumenDocumentos, validarArchivoDocumento,
} from './documentosPersonal';

const archivo = (name: string, type = '', size = 1024) => ({ name, type, size });

describe('qué archivo se acepta', () => {
  it('un PDF pasa', () => {
    expect(archivoDocumentoValido(archivo('rif.pdf', 'application/pdf'))).toBe(true);
  });

  it('una imagen pasa', () => {
    expect(archivoDocumentoValido(archivo('cedula.jpg', 'image/jpeg'))).toBe(true);
    expect(archivoDocumentoValido(archivo('cedula.png', 'image/png'))).toBe(true);
  });

  it('la foto del teléfono pasa aunque el navegador no declare el tipo', () => {
    // Android y iOS a veces mandan type vacío: se cae a la extensión.
    expect(archivoDocumentoValido(archivo('IMG_2201.HEIC', ''))).toBe(true);
    expect(archivoDocumentoValido(archivo('escaneo.pdf', ''))).toBe(true);
  });

  it('un Word no pasa, y dice por qué', () => {
    const msg = validarArchivoDocumento(archivo('cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(msg).toMatch(/PDF o una imagen/i);
  });

  it('un ZIP no pasa', () => {
    expect(archivoDocumentoValido(archivo('papeles.zip', 'application/zip'))).toBe(false);
  });

  it('un archivo vacío no pasa', () => {
    expect(validarArchivoDocumento(archivo('rif.pdf', 'application/pdf', 0))).toMatch(/vacío/i);
  });

  it('pasado el tope de 10 MB no pasa, y dice cuánto pesa', () => {
    const msg = validarArchivoDocumento(archivo('cv.pdf', 'application/pdf', MAX_BYTES_DOCUMENTO + 1));
    expect(msg).toMatch(/10 MB/);
    expect(msg).toMatch(/10,?\d* MB/);
  });

  it('justo en el tope sí pasa', () => {
    expect(archivoDocumentoValido(archivo('cv.pdf', 'application/pdf', MAX_BYTES_DOCUMENTO))).toBe(true);
  });

  it('sin archivo reclama', () => {
    expect(validarArchivoDocumento(null)).toMatch(/elegí/i);
  });
});

describe('PDF o imagen', () => {
  it('distingue uno del otro', () => {
    expect(esPdf(archivo('a.pdf', 'application/pdf'))).toBe(true);
    expect(esPdf(archivo('a.jpg', 'image/jpeg'))).toBe(false);
    expect(esImagen(archivo('a.jpg', 'image/jpeg'))).toBe(true);
    expect(esImagen(archivo('a.pdf', 'application/pdf'))).toBe(false);
  });
});

describe('los tres papeles', () => {
  it('son cédula, RIF y currículum', () => {
    expect(TIPOS_DOCUMENTO_PERSONAL.map((d) => d.key)).toEqual(['cedula', 'rif', 'cv']);
  });

  it('no acepta un tipo inventado', () => {
    expect(esTipoDocumento('rif')).toBe(true);
    expect(esTipoDocumento('pasaporte')).toBe(false);
    expect(esTipoDocumento(null)).toBe(false);
  });

  it('dice cuáles faltan, en orden', () => {
    const faltan = documentosFaltantes([{ tipo: 'rif' }]);
    expect(faltan.map((d) => d.key)).toEqual(['cedula', 'cv']);
  });

  it('cuenta cuántos hay', () => {
    expect(resumenDocumentos([{ tipo: 'rif' }, { tipo: 'cv' }])).toBe('2 de 3');
    expect(resumenDocumentos([])).toBe('0 de 3');
  });

  it('un tipo repetido no infla la cuenta', () => {
    expect(resumenDocumentos([{ tipo: 'rif' }, { tipo: 'rif' }])).toBe('1 de 3');
  });

  it('está completa solo con los tres', () => {
    expect(documentacionCompleta([{ tipo: 'rif' }, { tipo: 'cv' }])).toBe(false);
    expect(documentacionCompleta([{ tipo: 'rif' }, { tipo: 'cv' }, { tipo: 'cedula' }])).toBe(true);
  });

  it('cada uno tiene su nombre en castellano', () => {
    expect(labelDocumento('cedula')).toMatch(/cédula/i);
    expect(labelDocumento('cv')).toMatch(/currículum/i);
    expect(labelDocumento('otro')).toBe('—');
  });
});

describe('detalles de presentación', () => {
  it('el tamaño se lee sin pensar', () => {
    expect(megas(500)).toBe('500 B');
    expect(megas(2048)).toBe('2 KB');
    expect(megas(2.4 * 1024 * 1024)).toBe('2,4 MB');
  });

  it('el nombre queda limpio para una ruta', () => {
    expect(nombreSeguro('Cédula José Pérez (frente).pdf')).toBe('C_dula_Jos_P_rez_frente_.pdf');
    expect(nombreSeguro('   ')).toBe('documento');
    expect(nombreSeguro('a/b\\c.pdf')).toBe('a_b_c.pdf');
  });
});
