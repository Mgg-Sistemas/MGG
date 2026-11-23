#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rutaGuardadoFotos } from '../src/modules/delivery/rutaFotosDelivery.ts';

console.log('🧪 Probando la carga de fotos del delivery (estado abierto vs entregado)...');

// 1. Pedido ABIERTO: debe usar la función que sí existe y valida dueño.
assert.equal(rutaGuardadoFotos('aceptado', 'recibo'), 'delivery_fotos');
assert.equal(rutaGuardadoFotos('aceptado', 'entrega'), 'delivery_fotos');
assert.equal(rutaGuardadoFotos('en_ruta', 'recibo'), 'delivery_fotos');
assert.equal(rutaGuardadoFotos('en_ruta', 'entrega'), 'delivery_fotos');
console.log('  ✓ Pedido aceptado/en_ruta guarda recibo y entrega con delivery_fotos');

// 2. Pedido ENTREGADO: se corrige con la función de edición (sin el error 42703).
assert.equal(rutaGuardadoFotos('entregado', 'recibo'), 'delivery_editar_fotos');
assert.equal(rutaGuardadoFotos('entregado', 'entrega'), 'delivery_editar_fotos');
assert.equal(rutaGuardadoFotos('entregado', 'factura'), 'delivery_editar_fotos');
console.log('  ✓ Pedido entregado usa delivery_editar_fotos para los tres grupos');

// 3. La factura NO se ofrece en pedidos abiertos (delivery_fotos no la acepta).
assert.equal(rutaGuardadoFotos('aceptado', 'factura'), null);
assert.equal(rutaGuardadoFotos('en_ruta', 'factura'), null);
assert.equal(rutaGuardadoFotos('por_tomar', 'recibo'), null);
assert.equal(rutaGuardadoFotos('cancelado', 'recibo'), null);
console.log('  ✓ Factura queda solo para entregado; estados invalidos no guardan');

// 4. El modal debe elegir la funcion segun estado, no llamar siempre a editar.
const modal = await readFile(new URL('../src/modules/delivery/EditarFotosDelivery.tsx', import.meta.url), 'utf8');
assert.match(modal, /estado === 'entregado'/, 'El modal debe mirar el estado del pedido');
assert.match(modal, /await subirFotosDelivery\(pedidoId, t, quedan\[t\], nuevos\[t\]\)/, 'El modal debe usar subirFotosDelivery en pedidos abiertos');
assert.match(modal, /await editarFotosDelivery\(pedidoId, t, quedan\[t\], nuevos\[t\], quitadas\[t\]\)/, 'El modal debe usar editarFotosDelivery en entregados');
assert.match(modal, /tipos\.includes\('factura'\)/, 'La factura solo debe mostrarse cuando el estado lo permite');
assert.match(modal, /capture="environment"/, 'Debe existir el boton de camara');
assert.match(modal, /🖼 Elegir de la galería/, 'Debe existir el boton de galeria');
console.log('  ✓ Modal enruta por estado, oculta factura en abierto y ofrece camara y galeria');

// 5. Los dos lugares que abren el modal pasan el estado.
for (const archivo of ['DeliveryMovilView.tsx', 'DeliveryPage.tsx']) {
  const fuente = await readFile(new URL(`../src/modules/delivery/${archivo}`, import.meta.url), 'utf8');
  assert.match(fuente, /<EditarFotosDeliveryModal[\s\S]*?estado=/, `${archivo} debe pasar el estado al modal`);
}
console.log('  ✓ Celular y PC pasan el estado del pedido al modal');

console.log('🎉 Todas las pruebas de fotos de delivery pasaron exitosamente.');
