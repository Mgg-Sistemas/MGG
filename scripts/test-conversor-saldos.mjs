import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pagina = readFileSync(new URL('../src/modules/tesoreria/TesoreriaPage.tsx', import.meta.url), 'utf8');
const conversor = pagina.slice(pagina.indexOf('function ConversorModal'), pagina.indexOf('function HistorialConversiones'));
assert.match(conversor, /listSaldos\(\)/);
assert.match(conversor, /\.catch\(.*setErrorSaldos\(true\)/);
assert.match(conversor, /const puede = !cargandoSaldos && !errorSaldos/);
assert.match(conversor, /errorSaldos \?\s*\(\s*<div role="alert">[\s\S]*?saldosOrigen\.length === 0/);
console.log('El conversor diferencia una consulta fallida de una lista de saldos vacía.');
