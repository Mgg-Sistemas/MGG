#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  esOfertaAceptadaDeEstaOc,
  esSubOrden,
  ordenDeOfertas,
  ordenesConOfertasDe,
  unificarPorProveedor,
} from '../src/modules/pedidos/ordenDeOfertas.ts';

console.log('🧪 Probando las cotizaciones de una OC hija multiproveedor...');

// La hija escrita por el reparto: vínculo en parent_orden_id. Ya funcionaba.
assert.deepEqual(ordenesConOfertasDe({ id: 'hija-1', parent_orden_id: 'madre' }), ['madre', 'hija-1']);

// 23/11/2026: el chat de compras usa op_padre_id para el mismo vínculo madre/hija.
// Sin el arreglo esto daba ['hija-2'] y solo se veía la cotización aceptada de la hija.
assert.equal(ordenDeOfertas({ id: 'hija-2', op_padre_id: 'madre' }), 'madre');
assert.equal(esSubOrden({ id: 'hija-2', op_padre_id: 'madre' }), true);
assert.deepEqual(ordenesConOfertasDe({ id: 'hija-2', op_padre_id: 'madre' }), ['madre', 'hija-2']);
console.log('  ✓ Una hija con op_padre_id lee las cotizaciones de su madre');

// Si vienen los dos campos, manda el del reparto actual (no cambia la escritura).
assert.equal(ordenDeOfertas({ id: 'hija-3', parent_orden_id: 'madre-a', op_padre_id: 'madre-b' }), 'madre-a');

// Las N cotizaciones siguen siendo N: se leen madre e hija y se agrupan por proveedor.
const ofertas = [
  { id: 'o1', orden_id: 'madre', proveedor_id: 'p1', estado: 'aceptada' },
  { id: 'o2', orden_id: 'madre', proveedor_id: 'p2', estado: 'aceptada' },
  { id: 'o3', orden_id: 'madre', proveedor_id: 'p3', estado: 'pendiente' },
  { id: 'o4', orden_id: 'hija-2', proveedor_id: 'p1', estado: 'aceptada' },
];
const visibles = unificarPorProveedor(ofertas, 'madre');
assert.equal(visibles.length, 3);
assert.deepEqual(visibles.map((o) => o.id), ['o1', 'o2', 'o3']);
console.log('  ✓ Las N cotizaciones se conservan, sin repetir proveedores');

// La marcada como elegida es la de ESTA OC, no todas las aceptadas de la SP.
const hija = { id: 'hija-2', proveedor_id: 'p2' };
assert.equal(esOfertaAceptadaDeEstaOc(ofertas[1], hija), true);
assert.equal(esOfertaAceptadaDeEstaOc(ofertas[0], hija), false);
assert.equal(esOfertaAceptadaDeEstaOc(ofertas[2], hija), false);
// En la madre (sin proveedor asignado) se mantiene el comportamiento de siempre.
assert.equal(esOfertaAceptadaDeEstaOc(ofertas[0], { id: 'madre', proveedor_id: null }), true);
console.log('  ✓ Solo la cotización aceptada de esta OC se marca como elegida');

console.log('✅ Todo bien: la hija ve todas las cotizaciones y distingue la suya.');
