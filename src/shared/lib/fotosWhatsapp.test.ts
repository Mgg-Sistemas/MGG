import { describe, expect, it } from 'vitest';
import {
  SEGUNDOS_ENLACE_FOTO, adjuntaArchivos, modoEnvioWhatsapp, nombreFotoCompartir, textoConEnlacesDeFotos, tipoDeFoto,
} from './fotosWhatsapp';

const foto = (nombre = 'foto.jpg', tipo = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], nombre, { type: tipo });

describe('modoEnvioWhatsapp', () => {
  it('con fotos y un navegador que las adjunta, van como archivos', () => {
    expect(modoEnvioWhatsapp({ hayFotos: true, adjuntaArchivos: true, hojaCompartir: true })).toBe('archivos');
  });

  it('sin poder adjuntar, se cae a la hoja de compartir con texto o al enlace', () => {
    expect(modoEnvioWhatsapp({ hayFotos: true, adjuntaArchivos: false, hojaCompartir: true })).toBe('texto');
    expect(modoEnvioWhatsapp({ hayFotos: true, adjuntaArchivos: false, hojaCompartir: false })).toBe('enlace');
  });

  it('sin fotos se comporta como siempre', () => {
    expect(modoEnvioWhatsapp({ hayFotos: false, adjuntaArchivos: true, hojaCompartir: true })).toBe('texto');
    expect(modoEnvioWhatsapp({ hayFotos: false, adjuntaArchivos: false, hojaCompartir: false })).toBe('enlace');
  });
});

describe('adjuntaArchivos', () => {
  it('pide share y canShare, y que canShare diga que sí', () => {
    const fs = [foto()];
    expect(adjuntaArchivos({ share: () => {}, canShare: () => true }, fs)).toBe(true);
    expect(adjuntaArchivos({ share: () => {}, canShare: () => false }, fs)).toBe(false);
    expect(adjuntaArchivos({ share: () => {} }, fs)).toBe(false);
    expect(adjuntaArchivos({ canShare: () => true }, fs)).toBe(false);
    expect(adjuntaArchivos(undefined, fs)).toBe(false);
  });

  it('sin fotos es no, y si canShare lanza también es no', () => {
    expect(adjuntaArchivos({ share: () => {}, canShare: () => true }, [])).toBe(false);
    expect(adjuntaArchivos({ share: () => {}, canShare: () => { throw new TypeError('viejo'); } }, [foto()])).toBe(false);
  });
});

describe('textoConEnlacesDeFotos', () => {
  const texto = '📤 *SALIDA DE ALMACÉN*\n🔖 *N°:* SAL-001\n';

  it('sin enlaces deja el texto igual', () => {
    expect(textoConEnlacesDeFotos(texto, [])).toBe(texto);
    expect(textoConEnlacesDeFotos(texto, ['', '  '])).toBe(texto);
  });

  it('una foto: un renglón con su enlace', () => {
    expect(textoConEnlacesDeFotos(texto, ['https://x/1'])).toBe('📤 *SALIDA DE ALMACÉN*\n🔖 *N°:* SAL-001\n\n📷 *Foto:*\nhttps://x/1');
  });

  it('varias fotos: numeradas, en orden', () => {
    const t = textoConEnlacesDeFotos('Hola', ['https://x/1', 'https://x/2']);
    expect(t).toBe('Hola\n\n📷 *Fotos:*\n1. https://x/1\n2. https://x/2');
  });

  it('no mete el selector de emoji U+FE0F', () => {
    expect(textoConEnlacesDeFotos('Hola', ['https://x/1'])).not.toContain('️');
  });
});

describe('tipo y nombre de la foto', () => {
  it('respeta el tipo que trae y si no lo saca de la extensión', () => {
    expect(tipoDeFoto('image/png', 'a.jpg')).toBe('image/png');
    expect(tipoDeFoto('', 'a.PNG')).toBe('image/png');
    expect(tipoDeFoto('application/octet-stream', 'a.webp')).toBe('image/webp');
    expect(tipoDeFoto(null, 'sin-extension')).toBe('image/jpeg');
  });

  it('la extensión siempre coincide con el tipo real', () => {
    expect(nombreFotoCompartir('IMG_0001.HEIC', 'image/jpeg', 0)).toBe('IMG_0001.jpg');
    expect(nombreFotoCompartir('Cámara 1.png', 'image/png', 0)).toBe('Camara_1.png');
  });

  it('sin nombre usable se numera', () => {
    expect(nombreFotoCompartir('', 'image/jpeg', 2)).toBe('foto-3.jpg');
    expect(nombreFotoCompartir('###.jpg', 'image/jpeg', 0)).toBe('foto-1.jpg');
  });

  it('el enlace vale 7 días', () => {
    expect(SEGUNDOS_ENLACE_FOTO).toBe(604800);
  });
});
