#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Probando orden de columnas de conciliación (DRIVE/BANCO al final)...');

const file = fs.readFileSync(path.resolve('src/modules/conciliacion/conciliacion.ts'), 'utf8');

// Extraer el array COLUMNAS_CONCILIACION
const match = file.match(/export const COLUMNAS_CONCILIACION:\s*\{[^}]+\}\[\]\s*=\s*\[([\s\S]*?)\];/);
assert.ok(match, 'Debe existir COLUMNAS_CONCILIACION en conciliacion.ts');

const lineas = match[1]
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('{ clave:'));

const claves = lineas.map((l) => {
  const m = l.match(/clave:\s*'([^']+)'/);
  return m ? m[1] : null;
}).filter(Boolean);

console.log('  Columnas encontradas:', claves.join(' → '));

// 1. DRIVE/BANCO debe ser la última columna
assert.equal(claves[claves.length - 1], 'drive');
console.log('  ✓ DRIVE/BANCO es la última columna');

// 2. Retención, Factura y Status deben estar antes de DRIVE/BANCO
const idxDrive = claves.indexOf('drive');
const idxRetencion = claves.indexOf('retencion');
const idxFactura = claves.indexOf('factura');
const idxEstado = claves.indexOf('estado');

assert.ok(idxRetencion < idxDrive, 'retención debe estar antes de drive');
assert.ok(idxFactura < idxDrive, 'factura debe estar antes de drive');
assert.ok(idxEstado < idxDrive, 'estado debe estar antes de drive');
console.log('  ✓ retención, factura y status preceden a DRIVE/BANCO');

// 3. En ConciliacionPage.tsx el thead debe tener DRIVE/BANCO al final
const pageFile = fs.readFileSync(path.resolve('src/modules/conciliacion/ConciliacionPage.tsx'), 'utf8');
assert.ok(pageFile.includes('<th>Status</th><th>DRIVE/BANCO</th>'), 'En ConciliacionPage.tsx thead DRIVE/BANCO debe ser la última columna');
console.log('  ✓ En ConciliacionPage.tsx thead DRIVE/BANCO está al final');

console.log('🎉 Todas las pruebas de posición de columna DRIVE/BANCO pasaron exitosamente.');
