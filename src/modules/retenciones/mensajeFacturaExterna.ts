/* ============================================================
   MGG · Retenciones · Formato de Mensaje para WhatsApp
   (Resumen de Factura Externa / Soportes Cargados - alineado con Golden Touch)

   Genera el texto limpio con emojis estándar para compartir
   en grupos de WhatsApp desde el teléfono o la PC.
   ============================================================ */
import type { FacturaExternaBuzon } from './facturasBuzon.repository';

export const EMOJI_ESTATUS: Record<FacturaExternaBuzon['estatus'], string> = {
  recibida: '🟡',
  en_revision: '🔍',
  retenida: '🟢',
  descartada: '⚪',
};

export const ROTULO_ESTATUS: Record<FacturaExternaBuzon['estatus'], string> = {
  recibida: 'Recibida (Pendiente por procesar)',
  en_revision: 'En revisión contable',
  retenida: 'Retención practicada / Lista',
  descartada: 'Descartada / No aplica retención',
};

const montoVe = (n: number) =>
  Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fechaCorta(f: string | null | undefined): string {
  const d = String(f ?? '').slice(0, 10);
  if (d.length !== 10) return '—';
  const [y, m, dia] = d.split('-');
  return `${dia}/${m}/${y}`;
}

export function mensajeFacturaExterna(fac: FacturaExternaBuzon): string {
  const lineas: string[] = [];

  lineas.push(`🧾 *FACTURA EXTERNA REGISTRADA*`);
  lineas.push(`🏢 *Empresa:* ${fac.empresaNombre || 'Empresa'}`);
  lineas.push(`👤 *Proveedor:* ${fac.proveedorNombre}`);
  if (fac.proveedorRif) {
    lineas.push(`🆔 *RIF:* ${fac.proveedorRif}`);
  }
  lineas.push(`📄 *N° Factura:* ${fac.facturaNumero}`);
  if (fac.facturaControl) {
    lineas.push(`🔢 *N° Control:* ${fac.facturaControl}`);
  }
  lineas.push(`📅 *Fecha de emisión:* ${fechaCorta(fac.facturaFecha)}`);

  if (fac.moneda === 'USD') {
    lineas.push(`💵 *Monto:* $ ${montoVe(fac.montoTotal)}`);
    if (fac.tasa && fac.tasa > 0) {
      lineas.push(`📈 *Tasa:* ${montoVe(fac.tasa)} Bs/$`);
      lineas.push(`🇻🇪 *Equivalente Bs:* Bs ${montoVe(fac.montoBs)}`);
    }
  } else {
    lineas.push(`🇻🇪 *Monto:* Bs ${montoVe(fac.montoTotal)}`);
  }

  const emoji = EMOJI_ESTATUS[fac.estatus] || '📌';
  const labelEstatus = ROTULO_ESTATUS[fac.estatus] || fac.estatus;
  lineas.push(`${emoji} *Estatus:* ${labelEstatus}`);

  if (fac.descripcion) {
    lineas.push(`📝 *Descripción:* ${fac.descripcion}`);
  }
  if (fac.observaciones) {
    lineas.push(`💬 *Notas:* ${fac.observaciones}`);
  }

  const fotos = fac.adjuntos?.filter((a) => a.tipo === 'imagen').length || 0;
  const pdfs = fac.adjuntos?.filter((a) => a.tipo === 'pdf').length || 0;
  if (fotos > 0 || pdfs > 0) {
    const partes: string[] = [];
    if (fotos > 0) partes.push(`${fotos} foto${fotos > 1 ? 's' : ''}`);
    if (pdfs > 0) partes.push(`${pdfs} PDF${pdfs > 1 ? 's' : ''}`);
    lineas.push(`📎 *Soportes:* ${partes.join(' y ')}`);
  } else {
    lineas.push(`📎 *Soportes:* Sin soportes adjuntos`);
  }

  const autor = fac.createdByName || fac.createdBy;
  if (autor) {
    lineas.push(`\n_Cargado por: ${autor}_`);
  }

  return lineas.join('\n');
}

