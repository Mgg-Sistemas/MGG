import { describe, it, expect } from 'vitest';
import {
  MAX_BYTES_DOCUMENTO, TIPOS_DOCUMENTO_PERSONAL, archivoDocumentoValido, documentacionCompleta,
  documentosFaltantes, esImagen, esPdf, esTipoDocumento, labelDocumento, megas, nombreSeguro,
  resumenDocumentos, validarArchivoDocumento,
  TIPO_OTRO, errorEtiquetaDocumento, esTipoFijo, iconoDocumento, tituloDocumento,
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

describe('los documentos que no son de los tres fijos', () => {
  it('distingue un tipo fijo de uno extra', () => {
    expect(esTipoFijo('rif')).toBe(true);
    expect(esTipoFijo(TIPO_OTRO)).toBe(false);
  });

  it('el título sale del tipo cuando es fijo, y del nombre cuando no', () => {
    expect(tituloDocumento({ tipo: 'cedula' })).toBe('Cédula de identidad');
    expect(tituloDocumento({ tipo: TIPO_OTRO, etiqueta: 'Título universitario' })).toBe('Título universitario');
  });

  it('un extra sin nombre no se queda sin título en pantalla', () => {
    expect(tituloDocumento({ tipo: TIPO_OTRO, etiqueta: '   ' })).toBe('Documento sin nombre');
  });

  it('los fijos traen su ícono y los extra comparten el clip', () => {
    expect(iconoDocumento('cv')).toBe('📄');
    expect(iconoDocumento(TIPO_OTRO)).toBe('📎');
  });
});

describe('qué nombre se acepta para un documento extra', () => {
  it('desde 3 caracteres', () => {
    expect(errorEtiquetaDocumento('Título universitario')).toBeNull();
    expect(errorEtiquetaDocumento('CVM')).toBeNull();
  });

  it('vacío no sirve: es lo único que lo distingue', () => {
    expect(errorEtiquetaDocumento('')).toContain('nombre');
    expect(errorEtiquetaDocumento('   ')).toContain('nombre');
    expect(errorEtiquetaDocumento(null)).toContain('nombre');
  });

  it('muy corto tampoco', () => {
    expect(errorEtiquetaDocumento('ab')).toContain('3 caracteres');
  });

  it('no se puede repetir un nombre en la misma carpeta', () => {
    const usadas = ['Título universitario', 'Certificado médico'];
    expect(errorEtiquetaDocumento('Certificado médico', usadas)).toContain('Ya hay un documento');
    // Sin importar mayúsculas ni espacios de más.
    expect(errorEtiquetaDocumento('  certificado MÉDICO ', usadas)).toContain('Ya hay un documento');
  });

  it('un nombre nuevo pasa aunque haya otros cargados', () => {
    expect(errorEtiquetaDocumento('Contrato firmado', ['Título universitario'])).toBeNull();
  });
});

describe('el «2 de 3» cuenta solo los papeles obligatorios', () => {
  it('un documento extra no completa la carpeta', () => {
    // Si contara, cargar el título taparía que falta la cédula.
    const cargados = [{ tipo: 'rif' }, { tipo: TIPO_OTRO }, { tipo: TIPO_OTRO }];
    expect(resumenDocumentos(cargados)).toBe('1 de 3');
    expect(documentacionCompleta(cargados)).toBe(false);
    expect(documentosFaltantes(cargados).map((d) => d.key)).toEqual(['cedula', 'cv']);
  });

  it('con los tres fijos está completa, haya o no extras', () => {
    const cargados = [{ tipo: 'rif' }, { tipo: 'cedula' }, { tipo: 'cv' }, { tipo: TIPO_OTRO }];
    expect(resumenDocumentos(cargados)).toBe('3 de 3');
    expect(documentacionCompleta(cargados)).toBe(true);
  });
});
