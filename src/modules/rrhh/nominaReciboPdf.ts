/* ============================================================
   MGG · RRHH · Comprobante de pago de personal (recibo)
   PDF tipo factura/recibo, una página por trabajador, con el
   desglose del pago y las líneas de firma (trabajador y RRHH).
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { date as fmtDate } from '@/shared/lib/format';
import type { NominaPeriodo, NominaRenglon } from '@/shared/lib/types';

function usd(n: number | null | undefined): string {
  return '$ ' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function bsStr(n: number | null | undefined): string {
  return 'Bs ' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function labelMotivo(tipo?: string | null): string {
  switch (tipo) {
    case 'vacaciones': return 'Vacaciones';
    case 'liquidacion': return 'Liquidación';
    case 'quincena': return 'Sueldo (quincena)';
    default: return 'Sueldo';
  }
}

export interface ReciboMeta {
  periodo: Pick<NominaPeriodo, 'codigo' | 'tipo' | 'periodo_desde' | 'periodo_hasta' | 'tasa_bcv'>;
  cedulas?: Record<string, string | null | undefined>;   // personal_id -> cédula
}

async function construir(renglones: NominaRenglon[], meta: ReciboMeta) {
  const [logoDataUrl, { jsPDF }, { default: autoTable }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)

  renglones.forEach((r, idx) => {
    if (idx > 0) doc.addPage();
    let y = MARGIN;

    // Encabezado: logo + empresa + título.
    const LOGO = 56;
    if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
    const tx = logoDataUrl ? MARGIN + LOGO + 14 : MARGIN;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('Mineral Group Guayana C.A.', tx, y + 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Comprobante de Pago de Personal', tx, y + 32);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(meta.periodo.codigo ?? '', PAGE_W - MARGIN, y + 16, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const fecha = meta.periodo.periodo_desde ? fmtDate(meta.periodo.periodo_desde) : (r.pagada_en ? fmtDate(r.pagada_en) : '');
    doc.text(fecha, PAGE_W - MARGIN, y + 32, { align: 'right' });
    y += Math.max(LOGO, 40) + 6;

    doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 18;

    // Título grande.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('COMPROBANTE DE PAGO', MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Motivo: ${labelMotivo(meta.periodo.tipo)}`, PAGE_W - MARGIN, y, { align: 'right' });
    y += 18;

    // Datos del trabajador.
    const cedula = meta.cedulas?.[r.personal_id ?? ''] || '';
    autoTable(doc, {
      startY: y,
      body: [
        ['Trabajador', r.nombre, 'Cédula', cedula || '—'],
        ['Cargo', r.cargo || '—', 'Departamento', r.departamento || '—'],
        ['Estado', r.estado === 'pagada' ? `Pagado${r.pagada_en ? ' · ' + fmtDate(r.pagada_en) : ''}` : 'Por pagar', 'Días', String(r.dias_trabajados ?? '')],
      ],
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 2: { fontStyle: 'bold', cellWidth: 90 } },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 16;

    // Desglose de conceptos.
    const tasa = Number(r.tasa_pago) || Number(meta.periodo.tasa_bcv) || 0;
    const filas: Array<[string, string]> = [
      ['Sueldo base mensual', usd(r.sueldo_base_mensual)],
      ['Días trabajados', String(r.dias_trabajados ?? '')],
      ['Salario bruto', usd(r.salario_bruto)],
    ];
    if (Number(r.asignaciones) > 0) filas.push(['Asignaciones / bonos', usd(r.asignaciones)]);
    if (Number(r.deduc_anticipos) > 0) filas.push(['(−) Anticipos', '- ' + usd(r.deduc_anticipos)]);
    if (Number(r.deduc_prestamos) > 0) filas.push(['(−) Préstamos', '- ' + usd(r.deduc_prestamos)]);

    autoTable(doc, {
      startY: y,
      head: [['Concepto', 'Monto']],
      body: filas,
      foot: [
        ['NETO A PAGAR (USD)', usd(r.neto_usd)],
        ...(tasa > 0 ? [['Equivalente en Bs (BCV ' + tasa.toLocaleString('es-VE') + ')', bsStr(Number(r.neto_usd) * tasa)]] as Array<[string, string]> : []),
      ],
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      styles: { fontSize: 9.5, cellPadding: 5 },
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', cellWidth: 160 } },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
    if (r.seriales_billetes && r.seriales_billetes.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(`Seriales de billetes: ${r.seriales_billetes.join(', ')}`, MARGIN, y + 10);
    }

    // Firmas (al pie de la página).
    const fy = PAGE_H - MARGIN - 50;
    const colW = (PAGE_W - MARGIN * 2 - 40) / 2;
    doc.setDrawColor(120); doc.setLineWidth(0.7);
    doc.line(MARGIN, fy, MARGIN + colW, fy);
    doc.line(MARGIN + colW + 40, fy, MARGIN + colW * 2 + 40, fy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Firma del trabajador', MARGIN + colW / 2, fy + 14, { align: 'center' });
    doc.text(r.nombre, MARGIN + colW / 2, fy + 26, { align: 'center' });
    doc.text('Firma de la Jefa de RRHH', MARGIN + colW + 40 + colW / 2, fy + 14, { align: 'center' });
    doc.text('Recursos Humanos', MARGIN + colW + 40 + colW / 2, fy + 26, { align: 'center' });
  });

  return doc;
}

function nombreArchivo(renglones: NominaRenglon[], meta: ReciboMeta): string {
  const base = renglones.length === 1
    ? `recibo-${renglones[0].nombre}`
    : `comprobantes-${meta.periodo.codigo ?? 'nomina'}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.pdf';
}

/** Descarga el/los comprobante(s) de pago (uno por trabajador). */
export async function descargarNominaReciboPdf(renglones: NominaRenglon[], meta: ReciboMeta): Promise<void> {
  if (!renglones.length) throw new Error('No hay renglones para el comprobante.');
  const doc = await construir(renglones, meta);
  doc.save(nombreArchivo(renglones, meta));
}
