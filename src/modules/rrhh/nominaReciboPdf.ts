/* ============================================================
   MGG · RRHH · Comprobante de pago de personal (recibo)
   PDF tipo factura/recibo, una página por trabajador, con el
   desglose del pago y las líneas de firma (trabajador y RRHH).
   ============================================================ */
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';
import { definicionEmpresa, normalizarEmpresa } from './empresa';
import { date as fmtDate } from '@/shared/lib/format';
import { aBs, calcularRecibo, lineasConMonto } from './sueldoQuincena';
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
    // La razón social sale de la EMPRESA del renglón, no de una constante: el
    // recibo tiene que decir a nombre de quién se paga.
    doc.text(definicionEmpresa(normalizarEmpresa(r.empresa)).razonSocial, tx, y + 16);
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
        ['Período', meta.periodo.periodo_desde
          ? `${fmtDate(meta.periodo.periodo_desde)}${meta.periodo.periodo_hasta ? ' al ' + fmtDate(meta.periodo.periodo_hasta) : ''}`
          : '—',
          'Días', `${Number(r.dias_trabajados) || 0} trabajados + ${Number(r.dias_descanso) || 0} de descanso`],
        ['Estado', r.estado === 'pagada' ? `Pagado${r.pagada_en ? ' · ' + fmtDate(r.pagada_en) : ''}` : 'Por pagar',
          'Sueldo mensual', usd(r.sueldo_base_mensual)],
      ],
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 2: { fontStyle: 'bold', cellWidth: 90 } },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 16;

    /* ── El desglose, en bolívares Y en dólares ──
       La tasa es la de la quincena: se guardó al cerrarla y no se recalcula.
       Si el renglón ya se pagó con una tasa propia, manda esa, porque es la
       que de verdad se usó para entregar el dinero. */
    const tasa = Number(r.tasa_pago) || Number(meta.periodo.tasa_bcv) || 0;
    const c = calcularRecibo({
      // Del BRUTO ya calculado, no del sueldo mensual: así el recibo suma
      // exactamente lo que la nómina liquidó, con cualquier reparto de días.
      brutoQuincena: Number(r.salario_bruto) || 0,
      diasTrabajados: Number(r.dias_trabajados) || 0,
      diasDescanso: Number(r.dias_descanso) || 0,
      bonosExtra: Number(r.asignaciones) || 0,
      viaticos: Number(r.viaticos) || 0,
      deducciones: {
        ivss: Number(r.deduc_ivss) || 0,
        rpe: Number(r.deduc_rpe) || 0,
        faov: Number(r.deduc_faov) || 0,
        sindicato: Number(r.deduc_sindicato) || 0,
        prestamos: Number(r.deduc_prestamos) || 0,
        anticipos: Number(r.deduc_anticipos) || 0,
        otros: Number(r.deduc_otros) || 0,
      },
      tasa,
    });

    // Cabecera del desglose: sueldo quincenal y diario, en las dos monedas.
    autoTable(doc, {
      startY: y,
      body: [
        ['Forma de pago', r.moneda_pago === 'BS' ? 'Bolívares' : r.moneda_pago === 'USD' ? 'Dólares en efectivo' : 'Por definir',
          'Tasa de la quincena', tasa > 0 ? `${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$` : '—'],
        ['Sueldo quincenal', `${bsStr(aBs(c.reparto.sueldo, tasa))}  (${usd(c.reparto.sueldo)})`,
          'Sueldo diario', `${bsStr(aBs(c.diario, tasa))}  (${usd(c.diario)})`],
      ],
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 2: { fontStyle: 'bold', cellWidth: 90 } },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 12;

    // Los renglones. Se muestran solo los que tienen algo: un recibo con once
    // ceros no se lee, y los conceptos en cero no le dicen nada a nadie.
    const filas = lineasConMonto(c.lineas).map((l, i) => ([
      String(i + 1),
      l.concepto,
      l.dias != null ? String(l.dias) : '',
      l.tipo === 'devengado' ? bsStr(aBs(l.usd, tasa)) : '',
      l.tipo === 'devengado' ? usd(l.usd) : '',
      l.tipo === 'deduccion' ? bsStr(aBs(l.usd, tasa)) : '',
      l.tipo === 'deduccion' ? usd(l.usd) : '',
    ]));

    autoTable(doc, {
      startY: y,
      head: [['#', 'CONCEPTO', 'DÍAS', 'DEVENGADO Bs', 'EN $', 'DEDUCCIÓN Bs', 'EN $']],
      body: filas,
      foot: [
        ['', 'TOTALES', '', bsStr(c.totalDevengadoBs), usd(c.totalDevengadoUsd), bsStr(c.totalDeduccionBs), usd(c.totalDeduccionUsd)],
        ['', 'NETO A PAGAR', '', bsStr(c.netoBs), usd(c.netoUsd), '', ''],
      ],
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 32, halign: 'center' },
        3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' },
      },
    });
    // @ts-expect-error lastAutoTable lo agrega el plugin en runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 10;

    // La conformidad. Dice los dos montos porque el pago se entrega en una
    // moneda pero el sueldo se pactó en la otra.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const conformidad = `Certifico haber recibido la cantidad de ${bsStr(c.netoBs)} (${usd(c.netoUsd)} a la tasa de ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$), que comprende la totalidad de mi salario del período indicado, y firmo en señal de conformidad.`;
    doc.text(doc.splitTextToSize(conformidad, PAGE_W - MARGIN * 2), MARGIN, y + 10);
    y += 10 + doc.splitTextToSize(conformidad, PAGE_W - MARGIN * 2).length * 11;

    if (r.seriales_billetes && r.seriales_billetes.length) {
      doc.setFontSize(8);
      doc.text(`Seriales de billetes: ${r.seriales_billetes.join(', ')}`, MARGIN, y + 8);
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

/**
 * Abre los comprobantes en VISTA PREVIA, uno por página, para revisarlos
 * antes de mandarlos a la impresora.
 *
 * Es lo que se usa al imprimir por lote: cuando salen veinte recibos de una,
 * bajar el archivo y abrirlo aparte para recién ahí ver que faltaba uno es el
 * camino largo. Acá se ven, se imprimen desde el visor, y nada se descarga si
 * no se pide.
 */
export async function verNominaRecibosPdf(renglones: NominaRenglon[], meta: ReciboMeta): Promise<void> {
  if (!renglones.length) throw new Error('No hay recibos seleccionados para imprimir.');
  const { previewPdfDoc } = await import('@/shared/lib/reportPreview');
  const doc = await construir(renglones, meta);
  previewPdfDoc(doc, nombreArchivo(renglones, meta));
}
