import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ⚙ Parámetros: solo secciones con datos, nada de «pronto», y lo que se guarda pasa por la puerta.
const fuente = readFileSync(join(__dirname, 'Parametros.tsx'), 'utf8');
const editores = readFileSync(join(__dirname, 'editores.tsx'), 'utf8');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const textosVisibles = sinComentarios(fuente);

describe('⚙ Parámetros', () => {
  it('no muestra secciones sin datos ni textos de «pronto»', () => {
    expect(textosVisibles).not.toMatch(/Pr[oó]ximamente|pronto|en construcci[oó]n/i);
    for (const s of ['Motivos de «No aplica»', 'Entes y logos', 'Firma y sello', 'Otro sistema', 'Avisos de vencimiento']) {
      expect(textosVisibles).not.toContain(s);
    }
  });

  it('dice si se edita o solo se consulta, según el permiso', () => {
    expect(textosVisibles).toContain('Edición: administración, o escritura en Retenciones.');
    expect(textosVisibles).toContain('Consulta: sin permiso de escritura en Retenciones.');
  });

  it('guarda solo por la puerta, con las funciones de hoy: no escribe en la base por su cuenta', () => {
    for (const s of [textosVisibles, sinComentarios(editores)]) {
      expect(s).not.toMatch(/supabase|from\(['"]retencion/);
    }
    expect(textosVisibles).toMatch(/puerta\.guardarConfig\(/);
    expect(textosVisibles).toMatch(/puerta\.guardarConcepto\(/);
  });

  it('cada editor valida antes de guardar y no guarda con errores', () => {
    expect(sinComentarios(editores).match(/if \(!hayErrores\(e\)\) void guardar\(\)/g)).toHaveLength(3);
  });
});
