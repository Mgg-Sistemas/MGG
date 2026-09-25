import { describe, it, expect } from 'vitest';
import {
  MAX_ADJUNTOS_SALIDA, MAX_BYTES_ADJUNTO, adjuntosDeFila, adjuntosQueQuedan, archivoAdjuntoValido,
  cupoAdjuntos, esImagenAdjunto, esPdfAdjunto, iconoAdjunto, nombreSeguroAdjunto, pesoAdjunto,
  recortarAlCupo, resumenAdjuntos, validarArchivoAdjunto, validarTandaAdjuntos,
} from './adjuntosSalida';

const archivo = (name: string, type = '', size = 1024) => ({ name, type, size });
const guardado = (path: string, filename = path) => ({ path, filename });

describe('qué archivo se acepta', () => {
  it('una foto y un PDF pasan', () => {
    expect(archivoAdjuntoValido(archivo('material.jpg', 'image/jpeg'))).toBe(true);
    expect(archivoAdjuntoValido(archivo('nota.pdf', 'application/pdf'))).toBe(true);
  });

  it('la foto del teléfono pasa aunque el navegador no declare el tipo', () => {
    // Android e iOS mandan type vacío en buena parte de las fotos de cámara:
    // sin caer a la extensión se rechazaría justo el caso más común.
    expect(archivoAdjuntoValido(archivo('IMG_0042.HEIC', ''))).toBe(true);
    expect(archivoAdjuntoValido(archivo('escaneo.pdf', ''))).toBe(true);
  });

  it('un Word o un ZIP no pasan, y dicen por qué', () => {
    expect(validarArchivoAdjunto(archivo('nota.docx', 'application/msword'))).toMatch(/imágenes .* o PDF/i);
    expect(validarArchivoAdjunto(archivo('todo.zip', 'application/zip'))).toMatch(/imágenes .* o PDF/i);
  });

  it('el mensaje nombra el archivo: con cuatro elegidos hay que saber cuál falló', () => {
    expect(validarArchivoAdjunto(archivo('nota.docx', 'application/msword'))).toContain('nota.docx');
  });

  it('un archivo vacío no pasa', () => {
    expect(validarArchivoAdjunto(archivo('foto.jpg', 'image/jpeg', 0))).toMatch(/vacío/i);
  });

  it('pasado el tope de 15 MB no pasa, y dice cuánto pesa', () => {
    const msg = validarArchivoAdjunto(archivo('foto.jpg', 'image/jpeg', MAX_BYTES_ADJUNTO + 1));
    expect(msg).toMatch(/15 MB/);
  });

  it('justo en el tope sí pasa', () => {
    expect(archivoAdjuntoValido(archivo('foto.jpg', 'image/jpeg', MAX_BYTES_ADJUNTO))).toBe(true);
  });

  it('sin archivo reclama', () => {
    expect(validarArchivoAdjunto(null)).toMatch(/Elegí/);
  });

  it('distingue imagen de PDF', () => {
    expect(esPdfAdjunto(archivo('a.pdf', 'application/pdf'))).toBe(true);
    expect(esPdfAdjunto(archivo('a.jpg', 'image/jpeg'))).toBe(false);
    expect(esImagenAdjunto(archivo('a.jpg', 'image/jpeg'))).toBe(true);
    expect(esImagenAdjunto(archivo('a.pdf', 'application/pdf'))).toBe(false);
  });
});

describe('el tope de cuatro por solicitud', () => {
  it('son cuatro', () => {
    expect(MAX_ADJUNTOS_SALIDA).toBe(4);
  });

  it('el cupo baja con lo que ya hay cargado', () => {
    expect(cupoAdjuntos([], [], 0)).toBe(4);
    expect(cupoAdjuntos([guardado('a'), guardado('b')])).toBe(2);
    expect(cupoAdjuntos([guardado('a'), guardado('b')], [], 2)).toBe(0);
  });

  it('quitar uno libera su lugar en el momento, sin guardar todavía', () => {
    // Es lo que permite reemplazar el cuarto adjunto sin guardar en dos pasos.
    const hay = [guardado('a'), guardado('b'), guardado('c'), guardado('d')];
    expect(cupoAdjuntos(hay)).toBe(0);
    expect(cupoAdjuntos(hay, ['b'])).toBe(1);
  });

  it('el cupo nunca queda negativo', () => {
    expect(cupoAdjuntos([guardado('a')], [], 99)).toBe(0);
  });

  it('dice cuáles quedan después de quitar', () => {
    const quedan = adjuntosQueQuedan([guardado('a'), guardado('b')], ['a']);
    expect(quedan.map((x) => x.path)).toEqual(['b']);
  });
});

describe('la tanda completa', () => {
  it('cinco de una sola vez no pasa, y dice la cuenta', () => {
    // El error típico no es un archivo malo: es elegir de más.
    const cinco = Array.from({ length: 5 }, (_, i) => archivo(`f${i}.jpg`, 'image/jpeg'));
    expect(validarTandaAdjuntos(cinco)).toMatch(/4 adjuntos como máximo/);
  });

  it('tres nuevos sobre dos que ya había tampoco', () => {
    const msg = validarTandaAdjuntos(
      [archivo('a.jpg', 'image/jpeg'), archivo('b.jpg', 'image/jpeg'), archivo('c.jpg', 'image/jpeg')],
      [guardado('x'), guardado('y')],
    );
    expect(msg).toContain('Ya hay 2');
    expect(msg).toContain('agregando 3');
  });

  it('pero sí si se quitan los que sobran', () => {
    expect(validarTandaAdjuntos(
      [archivo('a.jpg', 'image/jpeg'), archivo('b.jpg', 'image/jpeg'), archivo('c.jpg', 'image/jpeg')],
      [guardado('x'), guardado('y')],
      ['x'],
    )).toBeNull();
  });

  it('un archivo malo se avisa antes que la cuenta', () => {
    expect(validarTandaAdjuntos([archivo('a.zip', 'application/zip')])).toMatch(/PDF/i);
  });

  it('justo cuatro pasa', () => {
    const cuatro = Array.from({ length: 4 }, (_, i) => archivo(`f${i}.pdf`, 'application/pdf'));
    expect(validarTandaAdjuntos(cuatro)).toBeNull();
  });

  it('sin nada que subir no se queja', () => {
    expect(validarTandaAdjuntos([])).toBeNull();
  });
});

describe('el recorte al cupo del repositorio', () => {
  it('guarda los que entran en vez de que la base rechace todo', () => {
    // Si el update entero se cae, la solicitud se queda sin NINGÚN adjunto.
    expect(recortarAlCupo([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4]);
    expect(recortarAlCupo([1, 2, 3], [guardado('a'), guardado('b')])).toEqual([1, 2]);
    expect(recortarAlCupo([1, 2, 3], [guardado('a'), guardado('b'), guardado('c')])).toEqual([1]);
    expect(recortarAlCupo([1, 2], [guardado('a')], ['a'])).toEqual([1, 2]);
  });
});

describe('cómo se lee en pantalla', () => {
  it('el ícono distingue el PDF de la foto', () => {
    expect(iconoAdjunto(guardado('p', 'nota.pdf'))).toBe('📄');
    expect(iconoAdjunto(guardado('p', 'material.jpg'))).toBe('🖼');
  });

  it('el resumen se lee sin pensar', () => {
    expect(resumenAdjuntos([])).toBe('—');
    expect(resumenAdjuntos(null)).toBe('—');
    expect(resumenAdjuntos([guardado('a')])).toBe('1 adjunto');
    expect(resumenAdjuntos([guardado('a'), guardado('b')])).toBe('2 adjuntos');
  });

  it('el tamaño se lee sin pensar', () => {
    expect(pesoAdjunto(500)).toBe('500 B');
    expect(pesoAdjunto(2048)).toBe('2 KB');
    expect(pesoAdjunto(2.4 * 1024 * 1024)).toBe('2,4 MB');
  });

  it('el nombre queda limpio para una ruta', () => {
    expect(nombreSeguroAdjunto('Nota de salida (firmada).pdf')).toBe('Nota_de_salida_firmada_.pdf');
    expect(nombreSeguroAdjunto('   ')).toBe('adjunto');
  });
});

describe('lo que llega de la base', () => {
  it('una columna vacía o rara no rompe la pantalla', () => {
    expect(adjuntosDeFila(null)).toEqual([]);
    expect(adjuntosDeFila('no soy una lista')).toEqual([]);
    expect(adjuntosDeFila([{ filename: 'sin path' }])).toEqual([]);
  });

  it('un adjunto sin nombre se muestra con el del archivo', () => {
    expect(adjuntosDeFila([{ path: 'sol-1/foto.jpg' }])).toEqual([{ path: 'sol-1/foto.jpg', filename: 'foto.jpg' }]);
  });

  it('nunca devuelve más de cuatro, aunque la fila traiga más', () => {
    const seis = Array.from({ length: 6 }, (_, i) => ({ path: `p${i}`, filename: `f${i}` }));
    expect(adjuntosDeFila(seis)).toHaveLength(4);
  });
});
