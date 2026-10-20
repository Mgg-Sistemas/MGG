import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// La portada es de consulta: no puede ofrecer guardar ni decir «guardado», ni mostrar secciones sin datos.
const fuente = readFileSync(join(__dirname, 'Parametros.tsx'), 'utf8');
const textosVisibles = fuente.replace(/\/\*[\s\S]*?\*\//g, '');

describe('⚙ Parámetros, portada de consulta', () => {
  it('no ofrece guardar ni dice que guarda', () => {
    expect(textosVisibles).not.toMatch(/Guardar|guardado|Guardado/);
  });

  it('no muestra secciones sin datos ni textos de «pronto»', () => {
    expect(textosVisibles).not.toMatch(/Pr[oó]ximamente|pronto|en construcci[oó]n/i);
    for (const s of ['Motivos de «No aplica»', 'Entes y logos', 'Firma y sello', 'Otro sistema', 'Avisos de vencimiento']) {
      expect(textosVisibles).not.toContain(s);
    }
  });

  it('dice que es consulta y dónde se cambian los datos hoy', () => {
    expect(textosVisibles).toContain('Consulta. Para cambiar estos datos');
  });
});
