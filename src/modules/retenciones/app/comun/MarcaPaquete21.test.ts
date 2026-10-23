import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEXTO_PAQUETE21 } from './MarcaPaquete21';

// La marca «2.1»: solo en local, con el texto completo en el title.
const fuente = readFileSync(join(__dirname, 'MarcaPaquete21.tsx'), 'utf8');

describe('MarcaPaquete21', () => {
  it('el texto por defecto', () => {
    expect(TEXTO_PAQUETE21).toBe('Requiere la base de Retenciones (paquete 2.1)');
  });
  it('fuera de local no se pinta', () => {
    expect(fuente).toMatch(/if \(!import\.meta\.env\.DEV\) return null;/);
  });
  it('lleva el texto completo en el title y la clase rv8-marca21', () => {
    expect(fuente).toMatch(/className="rv8-marca21" title=\{texto\}/);
  });
});
