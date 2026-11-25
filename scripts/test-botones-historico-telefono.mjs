import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vista = readFileSync(new URL('../src/modules/inventario/InventarioMovilView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/surtidor.css', import.meta.url), 'utf8');

assert.ok((vista.match(/btn-editar/g) ?? []).length >= 2, 'Falta la clase de Editar en algún histórico.');
assert.ok((vista.match(/btn-pdf/g) ?? []).length >= 2, 'Falta la clase roja del PDF en algún histórico.');
assert.ok((vista.match(/btn-whatsapp/g) ?? []).length >= 2, 'Falta la clase de WhatsApp en algún histórico.');
assert.match(css, /\.btn-pdf\s*\{[^}]*#ef4444[^}]*color:\s*#fff/s);
assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.doesNotMatch(css, /\.surt-hist-acciones > \.btn:first-child/);
assert.doesNotMatch(css, /\.surt-hist-acciones > \.btn:last-child/);

console.log('✓ Editar/PDF/WhatsApp tienen estilos propios; PDF rojo visible y disposición adaptable.');
