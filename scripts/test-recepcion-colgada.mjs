#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  puedeRetomarRecepcionColgada,
  MINUTOS_PARA_RECUPERAR_RECEPCION,
} from '../src/modules/pedidos/recepcionColgada.ts';

console.log('🧪 Probando recepción apartada que nadie terminó (24-11-2026)...');

const apartada = '2026-11-24T18:34:10.064Z';
const ahora = Date.parse('2026-11-24T20:00:00.000Z');
const base = {
  recibidaEn: apartada,
  recibidaPor: 'almacenmatanzas2026@gmail.com',
  actorEmail: 'admin@gmail.com',
  yaTermino: false,
  hayMovimientos: false,
  ahora,
};

// Antes solo se liberaba si coincidía el correo. Otro usuario veía
// «ya fue recibida» aunque no hubiera entrado ni una unidad al stock.
assert.equal(puedeRetomarRecepcionColgada({ ...base, actorEmail: base.recibidaPor }), true);
assert.equal(puedeRetomarRecepcionColgada(base), true, 'admin puede liberar una recepción vieja sin stock');
console.log('  ✓ La recepción colgada se puede liberar aunque la intente otro usuario');

// No se le quita la orden a quien la está cargando en este momento.
assert.equal(puedeRetomarRecepcionColgada({ ...base, ahora: Date.parse(apartada) + 2 * 60 * 1000 }), false);
assert.equal(puedeRetomarRecepcionColgada({ ...base, ahora: Date.parse(apartada) + (MINUTOS_PARA_RECUPERAR_RECEPCION - 1) * 60 * 1000 }), false);
console.log('  ✓ Una recepción reciente NO se le quita a quien la está haciendo');

// Si ya entró mercadería, liberarla permitiría cargarla dos veces.
assert.equal(puedeRetomarRecepcionColgada({ ...base, hayMovimientos: true }), false);
assert.equal(puedeRetomarRecepcionColgada({ ...base, actorEmail: base.recibidaPor, hayMovimientos: true }), true, 'el mismo usuario sí retoma lo que ya cargó');
console.log('  ✓ Con stock ya cargado, otro usuario no puede duplicar la recepción');

// Nunca se reabre una orden cerrada ni se inventa una reserva.
assert.equal(puedeRetomarRecepcionColgada({ ...base, yaTermino: true }), false);
assert.equal(puedeRetomarRecepcionColgada({ ...base, recibidaEn: null }), false);
assert.equal(puedeRetomarRecepcionColgada({ ...base, recibidaEn: 'fecha rara' }), false);
console.log('✅ Todo bien: ni se bloquea una OC huérfana ni se abre una ya recibida.');
