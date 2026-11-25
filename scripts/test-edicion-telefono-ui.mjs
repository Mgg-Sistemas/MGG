import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vista = readFileSync(new URL('../src/modules/inventario/InventarioMovilView.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/modules/inventario/EditarMovimientoTelefonoModal.tsx', import.meta.url), 'utf8');

// La solicitud original era el histórico del TELÉFONO, no solo la edición de PC.
assert.match(vista, /EditarSalidaTelefonoModal grupo=\{editando\.grupo\}/);
assert.match(vista, /EditarTrasladoTelefonoModal grupo=\{editando\.grupo\}/);
assert.ok((vista.match(/✎ Editar/g) ?? []).length >= 2, 'Faltan los botones ✎ en salidas o traslados.');
assert.match(vista, /useRealtime\(\['solicitudes_salida', 'movimientos'\]/);
assert.match(modal, /form=\{formId\}/, 'El botón Guardar debe enviar el formulario aunque esté en el pie del Modal.');
assert.match(modal, /id="edit-salida-telefono"/);
assert.match(modal, /id="edit-traslado-telefono"/);
assert.match(modal, /editarSalidaTelefono\(\{/);
assert.match(modal, /editarTrasladoTelefono\(\{/);

console.log('✓ Salidas y traslados del teléfono tienen edición conectada y Guardar envía el formulario.');
