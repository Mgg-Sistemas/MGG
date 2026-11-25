import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regresión del recorte que mandó el usuario (24/11/2026): los nombres de las
// tres firmas se salían de su columna y se pisaban. Sin el arreglo el grid era
// '1fr 1fr 1fr' y no había control de palabras largas.
const ruta = new URL('../src/modules/rrhh/SolicitudPermisoModal.tsx', import.meta.url);
const fuente = readFileSync(ruta, 'utf8');
const inicio = fuente.indexOf('gridTemplateColumns: form.requiere_firma_jefe');
assert.ok(inicio >= 0, 'No se encontró el bloque de las firmas en el modal.');

const bloque = fuente.slice(inicio, inicio + 3500);
assert.match(bloque, /repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(bloque, /overflowWrap: 'anywhere'/);
assert.match(bloque, /minWidth: 0/);

console.log('✓ Las tres firmas tienen columnas que no se solapan.');
