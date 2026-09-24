import { describe, it, expect } from 'vitest';
import { correosValidos, BACKUP_EMAILS } from './backup';

describe('los destinatarios del respaldo', () => {
  it('deja pasar los correos bien escritos', () => {
    expect(correosValidos(BACKUP_EMAILS)).toEqual(BACKUP_EMAILS);
  });

  it('descarta los que no tienen forma de correo', () => {
    expect(correosValidos(['hola', 'sin@punto', '@nada.com', 'a b@c.com'])).toEqual([]);
  });

  it('normaliza a minúscula y recorta espacios', () => {
    expect(correosValidos(['  Jefe@MGG.com  '])).toEqual(['jefe@mgg.com']);
  });

  it('no repite un destinatario aunque venga escrito distinto', () => {
    expect(correosValidos(['a@b.com', 'A@B.COM', ' a@b.com '])).toEqual(['a@b.com']);
  });

  it('un dedazo no se lleva puesto al resto', () => {
    // Brevo rechaza el correo ENTERO si un destinatario viene mal.
    expect(correosValidos(['bueno@mgg.com', 'malo@@mgg', 'otro@mgg.com']))
      .toEqual(['bueno@mgg.com', 'otro@mgg.com']);
  });

  it('una lista vacía devuelve vacío, no explota', () => {
    expect(correosValidos([])).toEqual([]);
  });
});
