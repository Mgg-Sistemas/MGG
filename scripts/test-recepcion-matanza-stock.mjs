#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  omitirInventarioAlRecibir,
  sinInventarioPorDefecto,
} from '../src/modules/pedidos/recepcionSinInventario.ts';
import {
  movimientosRecepcionSinInventarioDesdeOrdenes,
  recepcionesDesdeMovimientos,
} from '../src/modules/inventario/recepcionesHistorico.ts';

console.log('🧪 Probando recepción a crédito que no sumó stock (24-11-2026)...');

// Antes: `sinInventario === true || o.sin_inventario === true` heredaba en silencio
// la casilla de una recepción anterior. El teléfono no la mostraba y no entraba stock.
const ordenConFlagViejo = { sin_inventario: true };
assert.equal(omitirInventarioAlRecibir({
  sinInventarioMarcado: false,
  esServicio: false,
}), false, 'el flag viejo NO debe decidir por quien recibe ahora');
assert.equal(sinInventarioPorDefecto(ordenConFlagViejo.sin_inventario), true);
console.log('  ✓ La casilla se ve marcada, pero el repository ya no la hereda en silencio');

// La decisión explícita de quien recibe sí se respeta; los servicios nunca entran.
assert.equal(omitirInventarioAlRecibir({ sinInventarioMarcado: true, esServicio: false }), true);
assert.equal(omitirInventarioAlRecibir({ sinInventarioMarcado: false, esServicio: true }), true);
assert.equal(omitirInventarioAlRecibir({ sinInventarioMarcado: false, esServicio: false }), false);
console.log('  ✓ Solo «ya lo cargué a mano» o un servicio omiten el inventario');

// La recepción sin stock tiene que aparecer en el histórico, aunque no haya kardex.
const ordenes = [{
  id: 'oc-matanza',
  codigo: 'OC-2026-9999',
  oc_codigo: 'OC-2026-9999',
  proveedor_id: 'prov-1',
  recibida_en: '2026-11-24T10:30:00',
  recibida_por: 'carlos@mgg.com',
  almacen_destino: 'General',
  sin_inventario: true,
  items: [
    { sku: 'DES-01', nombre: 'Desinfectante clorado', producto_id: 'p-1', cantidad: 12, cantidad_recibida: 12, precio: 8 },
    { sku: 'DES-02', nombre: 'Desinfectante concentrado', producto_id: 'p-2', cantidad: 5, cantidad_recibida: 0, precio: 20 },
  ],
}];
const movs = movimientosRecepcionSinInventarioDesdeOrdenes(ordenes);
assert.equal(movs.length, 1, 'solo entra el renglón con cantidad recibida > 0');
assert.equal(movs[0].ref_tipo, 'orden');
assert.equal(movs[0].ref_codigo, 'OC-2026-9999');
assert.equal(movs[0].almacen, 'General');
assert.equal(movs[0].actor, 'carlos@mgg.com');
assert.match(movs[0].detalle ?? '', /SIN inventario/);
assert.equal(movs[0].precio_unitario, null, 'no se inventa un costo en dólares');

const recs = recepcionesDesdeMovimientos(movs);
assert.equal(recs.length, 1);
assert.equal(recs[0].codigo, 'OC-2026-9999');
assert.equal(recs[0].unidades, 12);
assert.equal(recs[0].valor, null);
console.log('  ✓ La recepción sin stock se ve en el histórico con quién y cuándo');

// Sin flag guardado no se inventa una recepción fantasma.
assert.equal(movimientosRecepcionSinInventarioDesdeOrdenes([
  { ...ordenes[0], sin_inventario: false },
]).length, 0);
console.log('✅ Todo bien: ni se pierde el stock en silencio ni se oculta la recepción.');
