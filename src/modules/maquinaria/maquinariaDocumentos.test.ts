import { describe, it, expect } from 'vitest';
import {
  MAX_DOCUMENTOS_EQUIPO, espacioLibre, espaciosDocumentos, espaciosVisibles, ordenarFotosEquipo, nombreFotoEquipo, nombreDescargaDocumento, normalizarNombreDocumento,
  rutaDocumento, tamanoLegible, validarArchivoDocumento,
} from './maquinariaDocumentos';

const MB = 1024 * 1024;

describe('normalizarNombreDocumento', () => {
  it('pasa a mayúscula y quita espacios de sobra', () => {
    expect(normalizarNombreDocumento('  contrato   de  arriendo ')).toBe('CONTRATO DE ARRIENDO');
  });
  it('vacío o nulo queda vacío', () => {
    expect(normalizarNombreDocumento(null)).toBe('');
    expect(normalizarNombreDocumento('   ')).toBe('');
  });
});

describe('validarArchivoDocumento', () => {
  it('acepta PDF e imágenes', () => {
    expect(validarArchivoDocumento({ name: 'contrato.pdf', type: 'application/pdf', size: 2 * MB })).toBeNull();
    expect(validarArchivoDocumento({ name: 'foto.jpg', type: 'image/jpeg', size: 300_000 })).toBeNull();
  });
  it('sin tipo del navegador, decide por la extensión', () => {
    expect(validarArchivoDocumento({ name: 'catalogo.PDF', type: '', size: 1000 })).toBeNull();
    expect(validarArchivoDocumento({ name: 'catalogo.docx', type: '', size: 1000 })).toContain('PDF o una imagen');
  });
  it('rechaza Word, archivos vacíos y los de más de 50 MB', () => {
    expect(validarArchivoDocumento({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1000 })).toContain('PDF o una imagen');
    expect(validarArchivoDocumento({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toContain('vacío');
    expect(validarArchivoDocumento({ name: 'a.pdf', type: 'application/pdf', size: 51 * MB })).toContain('50 MB');
    expect(validarArchivoDocumento({ name: 'a.pdf', type: 'application/pdf', size: 50 * MB })).toBeNull();
  });
});

describe('rutaDocumento', () => {
  it('queda en la carpeta del equipo, sin acentos ni espacios', () => {
    expect(rutaDocumento('eq-1', 2, 'Catálogo de repuestos.pdf', 'abc')).toBe('eq-1/2-abc-Catalogo_de_repuestos.pdf');
  });
  it('sin nombre de archivo usa «documento»', () => {
    expect(rutaDocumento('eq-1', 1, '', 'x')).toBe('eq-1/1-x-documento');
  });
});

describe('espaciosDocumentos', () => {
  it('siempre devuelve todos los espacios, con cada documento en el suyo', () => {
    const r = espaciosDocumentos([{ espacio: 3, nombre: 'CONTRATO' }]);
    expect(r).toHaveLength(MAX_DOCUMENTOS_EQUIPO);
    expect(r.slice(0, 4).map((e) => e.espacio)).toEqual([1, 2, 3, 4]);
    expect(r[2].doc?.nombre).toBe('CONTRATO');
    expect(r[0].doc).toBeNull();
  });
});

describe('tamanoLegible', () => {
  it('B, KB y MB', () => {
    expect(tamanoLegible(500)).toBe('500 B');
    expect(tamanoLegible(2048)).toBe('2 KB');
    expect(tamanoLegible(12.4 * MB)).toMatch(/^12[,.]4 MB$/);
    expect(tamanoLegible(null)).toBe('0 B');
  });
});

describe('nombreDescargaDocumento', () => {
  it('usa el nombre del documento con la extensión del archivo', () => {
    expect(nombreDescargaDocumento('contrato 2026', 'scan.JPG')).toBe('CONTRATO 2026.jpg');
  });
  it('limpia caracteres que no admite un nombre de archivo', () => {
    expect(nombreDescargaDocumento('póliza a/b', null)).toBe('PÓLIZA A-B.pdf');
    expect(nombreDescargaDocumento('', 'x.pdf')).toBe('DOCUMENTO.pdf');
  });
});

describe('foto subida desde la tarjeta del equipo', () => {
  it('va al primer espacio libre, también después del 4', () => {
    expect(espacioLibre([])).toBe(1);
    expect(espacioLibre([{ espacio: 1 }, { espacio: 3 }])).toBe(2);
    expect(espacioLibre([{ espacio: 1 }, { espacio: 2 }, { espacio: 3 }, { espacio: 4 }])).toBe(5);
  });
  it('la foto principal es la que se llama FOTO DEL EQUIPO / FOTO EQUIPO, si no la primera', () => {
    const fotos = [{ nombre: 'PLACA' }, { nombre: 'foto equipo' }, { nombre: 'FOTO DEL EQUIPO 2' }];
    expect(ordenarFotosEquipo(fotos).map((f) => f.nombre)).toEqual(['foto equipo', 'FOTO DEL EQUIPO 2', 'PLACA']);
    expect(ordenarFotosEquipo([{ nombre: 'B' }, { nombre: 'FOTO DEL EQUIPO' }])[0].nombre).toBe('FOTO DEL EQUIPO');
    expect(ordenarFotosEquipo([{ nombre: 'B' }, { nombre: 'A' }]).map((f) => f.nombre)).toEqual(['B', 'A']);
  });
  it('se llama FOTO DEL EQUIPO, y las siguientes llevan número', () => {
    expect(nombreFotoEquipo([{ nombre: 'CONTRATO' }])).toBe('FOTO DEL EQUIPO');
    expect(nombreFotoEquipo([{ nombre: 'foto del equipo' }])).toBe('FOTO DEL EQUIPO 2');
    expect(nombreFotoEquipo([{ nombre: 'FOTO DEL EQUIPO' }, { nombre: 'FOTO DEL EQUIPO 2' }])).toBe('FOTO DEL EQUIPO 3');
  });
});

describe('hasta 20 documentos: se ven los cargados y un espacio libre', () => {
  it('admite 20 por equipo', () => {
    expect(MAX_DOCUMENTOS_EQUIPO).toBe(20);
  });
  it('sin documentos, un solo espacio (el 1)', () => {
    expect(espaciosVisibles([]).map((e) => e.espacio)).toEqual([1]);
  });
  it('los cargados y el primer hueco, aunque haya huecos en medio', () => {
    expect(espaciosVisibles([{ espacio: 1 }, { espacio: 3 }]).map((e) => e.espacio)).toEqual([1, 2, 3]);
  });
  it('con los 20 cargados no queda espacio libre', () => {
    const llenos = Array.from({ length: 20 }, (_, i) => ({ espacio: i + 1 }));
    expect(espaciosVisibles(llenos)).toHaveLength(20);
    expect(espacioLibre(llenos)).toBeNull();
  });
});
