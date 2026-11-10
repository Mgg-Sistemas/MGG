#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  CALIDAD_LABELS,
  validarArchivoFactura,
  calcularPuntualidadAutomatica,
  LIMITE_FACTURA_BYTES,
} from '../src/modules/pedidos/finalizarPedidoEvaluacion.ts';

console.log('🧪 Probando lógica de finalización de pedido y calificación por estrellas...');

// 1. Etiquetas de estrellas
assert.equal(CALIDAD_LABELS[5], '5 estrellas · Excelente');
assert.equal(CALIDAD_LABELS[1], '1 estrella · Muy mala');
console.log('  ✓ Etiquetas de estrellas 1 a 5 correctas');

// 2. Validación de archivo de factura
assert.equal(validarArchivoFactura(null), null);
assert.equal(validarArchivoFactura({ size: 1024 }), null);
assert.equal(validarArchivoFactura({ size: LIMITE_FACTURA_BYTES }), null);
assert.equal(validarArchivoFactura({ size: LIMITE_FACTURA_BYTES + 1 }), 'La factura no puede superar 10 MB.');
console.log('  ✓ Validación de archivo de factura (límite 10 MB) correcta');

// 3. Puntualidad automática
assert.equal(calcularPuntualidadAutomatica(null, '2026-11-10'), 0);
assert.equal(calcularPuntualidadAutomatica('', '2026-11-10'), 0);
assert.equal(calcularPuntualidadAutomatica('2026-11-10', '2026-11-10'), 0);
assert.equal(calcularPuntualidadAutomatica('2026-11-15', '2026-11-10'), 5);
assert.equal(calcularPuntualidadAutomatica('2026-11-05', '2026-11-10'), -5);
console.log('  ✓ Cálculo automático de puntualidad correcto');

console.log('🎉 Todas las pruebas de finalización de pedido pasaron exitosamente.');
