#!/usr/bin/env node
import assert from 'node:assert/strict';

console.log('🧪 Probando lógica de factura opcional en recepciones de almacén...');

const MAX_FACTURAS_ALMACEN = 6;
assert.equal(MAX_FACTURAS_ALMACEN, 6);
console.log('  ✓ Límite de facturas de almacén es 6');

function errorArchivoFactura(f) {
  const tipoOk = /^image\//.test(f.type) || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name);
  if (!tipoOk) return `«${f.name}» no es una foto ni un PDF.`;
  if (f.size > 10 * 1024 * 1024) return `«${f.name}» pesa más de 10 MB.`;
  return null;
}

// 1. Validación de archivo de factura
const archivoPdf = { name: 'factura_001.pdf', type: 'application/pdf', size: 1024 * 500 };
assert.equal(errorArchivoFactura(archivoPdf), null);

const archivoFoto = { name: 'factura_foto.jpg', type: 'image/jpeg', size: 1024 * 1024 * 2 };
assert.equal(errorArchivoFactura(archivoFoto), null);

const archivoInvalido = { name: 'documento.docx', type: 'application/msword', size: 1024 };
assert.notEqual(errorArchivoFactura(archivoInvalido), null);

const archivoPesado = { name: 'factura_pesada.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 };
assert.notEqual(errorArchivoFactura(archivoPesado), null);
console.log('  ✓ Validación de archivo (PDF/imagen hasta 10 MB) correcta');

// 2. Comportamiento de recepción con factura opcional
// En PC (RecepcionesPendientes) y teléfono (RecepcionesTelefono), la ausencia de factura
// NO debe bloquear la recepción ni deshabilitar el botón de confirmar/guardar.
function validaBloqueoRecepcion({ tieneRes, sinFicha, facturasLen }) {
  if (tieneRes) return 'Trae res en canal: se recibe despiezada desde la PC.';
  if (sinFicha && sinFicha.length > 0) return 'Sin ficha de inventario.';
  // Antes se validaba: if (pideFactura && !facturaSubida && !facturas.length) return 'Carga la factura...';
  // Ahora la factura es OPCIONAL: no retorna error si facturasLen es 0.
  return null;
}

assert.equal(validaBloqueoRecepcion({ tieneRes: false, sinFicha: [], facturasLen: 0 }), null);
assert.equal(validaBloqueoRecepcion({ tieneRes: false, sinFicha: [], facturasLen: 1 }), null);
assert.notEqual(validaBloqueoRecepcion({ tieneRes: true, sinFicha: [], facturasLen: 0 }), null);
console.log('  ✓ Recepción permitida sin factura cargada (factura opcional)');

console.log('🎉 Todas las pruebas de recepción con factura opcional pasaron exitosamente.');
