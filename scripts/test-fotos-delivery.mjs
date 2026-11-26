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

// 3. Desde 26/11/2026 la factura TAMBIÉN se guarda en pedidos abiertos.
assert.equal(rutaGuardadoFotos('aceptado', 'factura'), 'delivery_fotos');
assert.equal(rutaGuardadoFotos('en_ruta', 'factura'), 'delivery_fotos');
assert.equal(rutaGuardadoFotos('por_tomar', 'recibo'), null);
assert.equal(rutaGuardadoFotos('cancelado', 'recibo'), null);
console.log('  ✓ Factura se guarda en abierto con delivery_fotos; estados invalidos no guardan');

// 4. El modal debe elegir la funcion segun estado, no llamar siempre a editar.
const modal = await readFile(new URL('../src/modules/delivery/EditarFotosDelivery.tsx', import.meta.url), 'utf8');
assert.match(modal, /estado === 'entregado'/, 'El modal debe mirar el estado del pedido');
assert.match(modal, /await subirFotosDelivery\(pedidoId, t, quedan\[t\], nuevos\[t\]\)/, 'El modal debe usar subirFotosDelivery en pedidos abiertos');
assert.match(modal, /await editarFotosDelivery\(pedidoId, t, quedan\[t\], nuevos\[t\], quitadas\[t\]\)/, 'El modal debe usar editarFotosDelivery en entregados');
assert.match(modal, /tipos\.includes\('factura'\)/, 'La factura debe mostrarse cuando el estado lo permite');
assert.match(modal, /permitirFacturaAbierta/, 'El celular debe poder habilitar la factura con pedido abierto');
assert.match(modal, /grupoInicial/, 'El boton de factura debe abrir el modal en ese grupo');
assert.match(modal, /capture="environment"/, 'Debe existir el boton de camara');
assert.match(modal, /🖼 Elegir de la galería/, 'Debe existir el boton de galeria');
console.log('  ✓ Modal enruta por estado, permite factura en abierto y ofrece camara y galeria');

// 5. Los dos lugares que abren el modal pasan el estado.
for (const archivo of ['DeliveryMovilView.tsx', 'DeliveryPage.tsx']) {
  const fuente = await readFile(new URL(`../src/modules/delivery/${archivo}`, import.meta.url), 'utf8');
  assert.match(fuente, /<EditarFotosDeliveryModal[\s\S]*?estado=/, `${archivo} debe pasar el estado al modal`);
}
console.log('  ✓ Celular y PC pasan el estado del pedido al modal');

// 6. El celular debe tener un acceso visible a la factura durante el pedido abierto.
const movil = await readFile(new URL('../src/modules/delivery/DeliveryMovilView.tsx', import.meta.url), 'utf8');
assert.match(movil, /Tomar foto de la factura/, 'La vista móvil debe mostrar el botón de factura');
assert.match(movil, /abrirFotos\(enCurso, 'factura'\)/, 'El botón debe abrir el modal en el grupo factura');
assert.match(movil, /permitirFacturaAbierta=/, 'La vista móvil debe habilitar la factura en pedido abierto');
console.log('  ✓ Celular muestra y abre la carga de factura');

console.log('🎉 Todas las pruebas de fotos de delivery pasaron exitosamente.');
