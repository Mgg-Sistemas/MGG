#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  limpiarReferencia,
  errorReferencia,
} from '../src/modules/tesoreria/referenciaPago.ts';
import {
  tieneMetodoPagoCargado,
} from '../src/modules/pedidos/ordenPagoUtils.ts';

console.log('🧪 Probando referencia alfanumérica Binance y filtro de OC con método de pago en Tesorería...');

// 1. Limpieza de referencias
assert.equal(limpiarReferencia('1234', 'bs'), '1234');
assert.equal(limpiarReferencia('12ab34cd', 'bs'), '1234');
assert.equal(limpiarReferencia('12-34', 'bs'), '1234');

assert.equal(limpiarReferencia('1234', 'binance'), '1234');
assert.equal(limpiarReferencia('ab12', 'binance'), 'ab12');
assert.equal(limpiarReferencia('3F9a', 'binance'), '3F9a');
assert.equal(limpiarReferencia('x-Y_1 2', 'binance'), 'xY12');
console.log('  ✓ limpiarReferencia funciona correctamente para Bs y Binance');

// 2. Validación de errorReferencia
assert.match(errorReferencia('', 'bs'), /últimos 4 dígitos/);
assert.match(errorReferencia('123', 'bs'), /cargaste 3/);
assert.equal(errorReferencia('1234', 'bs'), null);
assert.notEqual(errorReferencia('12ab', 'bs'), null);

assert.match(errorReferencia('', 'binance'), /últimos 4 caracteres/);
assert.match(errorReferencia('123', 'binance'), /cargaste 3/);
assert.equal(errorReferencia('1234', 'binance'), null);
assert.equal(errorReferencia('AB12', 'binance'), null);
assert.equal(errorReferencia('3f9a', 'binance'), null);
assert.equal(errorReferencia('ABCD', 'binance'), null);
console.log('  ✓ errorReferencia valida 4 dígitos para Bs y 4 caracteres (letras y números) para Binance');

// 3. tieneMetodoPagoCargado
const ordenSinMetodo1 = {
  orden: { estado: 'confirmada_metodo', metodo_pago: [] },
  esperandoMetodo: true,
};
assert.equal(tieneMetodoPagoCargado(ordenSinMetodo1), false);

const ordenSinMetodo2 = {
  orden: { estado: 'oc_aprobada', metodo_pago: [] },
  esperandoMetodo: false,
};
assert.equal(tieneMetodoPagoCargado(ordenSinMetodo2), false);

const ordenSinMetodo3 = {
  orden: { estado: 'oc_aprobada', metodo_pago: [{ tipo: 'transferencia_bs' }] },
  esperandoMetodo: true,
};
assert.equal(tieneMetodoPagoCargado(ordenSinMetodo3), false);

const ordenConMetodo = {
  orden: { estado: 'oc_aprobada', metodo_pago: [{ tipo: 'binance' }] },
  esperandoMetodo: false,
};
assert.equal(tieneMetodoPagoCargado(ordenConMetodo), true);
console.log('  ✓ tieneMetodoPagoCargado filtra correctamente OCs sin método de pago cargado');

console.log('🎉 Todas las pruebas de Binance y filtro de OCs pasaron exitosamente.');
