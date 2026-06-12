/* ============================================================
   Golden Touch · Centro de Acopio · Resumen de Caja · PDF
   Réplica de la hoja «RESUMEN CAJA PERAMANAL GT».
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { ResumenCajaAcopio } from './caja.repository';

const NOMBRE = 'resumen-caja-acopio';
const fmtUsd = (v: number) => `$${v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number) => v.toLocaleString('es', { maximumFractionDigits: 2 });
const fmtPct = (v: number) => `${(v * 100).toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

async function construirResumenDoc(r: ResumenCajaAcopio) {
  const [{ dateTime }, { loadLogoDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 32;
  let y = MARGIN;

  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Resumen de Caja · Centro de Acopio', tx, y + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Centro de Acopio: ${r.centro}`, tx, y + 32);
  doc.setFontSize(9);
  doc.text(`GOLDEN TOUCH 1127 C.A. · ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 16, { align: 'right' });
  y += 54;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 14;

  // Período
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const periodo = `Inicio: ${r.fechaInicio ?? '—'}   ·   Última actualización: ${r.fechaActualizacion}   ·   Días transcurridos: ${r.dias}   ·   ${r.movimientos} movimiento(s)`;
  doc.text(periodo, MARGIN, y); y += 20;

  // KPIs principales (en dos columnas)
  const kpis: [string, string][] = [
    ['Saldo actual de la caja', fmtUsd(r.saldoUsd)],
    ['Total entregado', fmtUsd(r.totalEntregado)],
    ['Total gastado (gastos + nómina)', fmtUsd(r.totalGastado)],
    ['Tasa del material', `${fmtUsd(r.tasaMaterial)} /Kg`],
    [`Gastos GT  (${fmtPct(r.pctGastos)})`, fmtUsd(r.totalGastos)],
    [`Nómina GT  (${fmtPct(r.pctNomina)})`, fmtUsd(r.totalNominas)],
  ];
  autoTable(doc, {
    startY: y,
    body: kpis,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 240 }, 1: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable lo agrega el plugin
  y = doc.lastAutoTable.finalY + 18;

  // Bloque de Kg de casiterita
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Kg de casiterita', MARGIN, y); y += 6;
  autoTable(doc, {
    startY: y,
    head: [['Producción GT (entra)', 'Enviados a MGG', 'Diferencia']],
    body: [[`${fmtNum(r.kgProduccion)} Kg`, `${fmtNum(r.kgEnviados)} Kg`, `${fmtNum(r.diferenciaKg)} Kg`]],
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 0], textColor: 20 },
    styles: { fontSize: 10, halign: 'center', cellPadding: 5 },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error lastAutoTable
  y = doc.lastAutoTable.finalY + 18;

  // Distribución de gastos por categoría
  if (r.gastosPorCategoria.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Gastos por categoría', MARGIN, y); y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Categoría', 'Monto', '% del total gastado']],
      body: r.gastosPorCategoria.map((c) => [c.valor, fmtUsd(c.monto), fmtPct(c.pct)]),
      foot: [['Total gastos', fmtUsd(r.totalGastos), fmtPct(r.pctGastos)]],
      theme: 'striped',
      headStyles: { fillColor: [239, 68, 68], textColor: 255 },
      footStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 4 },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error lastAutoTable
    y = doc.lastAutoTable.finalY + 18;
  }

  // Distribución de nómina por categoría
  if (r.nominaPorCategoria.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Nómina por categoría', MARGIN, y); y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Categoría', 'Monto', '% del total gastado']],
      body: r.nominaPorCategoria.map((c) => [c.valor, fmtUsd(c.monto), fmtPct(c.pct)]),
      foot: [['Total nómina', fmtUsd(r.totalNominas), fmtPct(r.pctNomina)]],
      theme: 'striped',
      headStyles: { fillColor: [168, 85, 247], textColor: 255 },
      footStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 4 },
      margin: { left: MARGIN, right: MARGIN },
    });
  }

  return doc;
}

export async function descargarResumenCajaPdf(r: ResumenCajaAcopio): Promise<void> {
  (await construirResumenDoc(r)).save(`${NOMBRE}-${r.fechaActualizacion}.pdf`);
}

export async function enviarResumenCajaPorCorreo(r: ResumenCajaAcopio, destinos: string[]): Promise<{ destinatarios: string[] }> {
  const base64 = (await construirResumenDoc(r)).output('datauristring').split(',')[1] ?? '';
  const { data, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>('enviar-reporte', {
    body: {
      pdf_base64: base64,
      nombre_archivo: `${NOMBRE}-${r.fechaActualizacion}.pdf`,
      asunto: `Resumen de Caja · Centro de Acopio ${r.centro}`,
      mensaje: `Resumen de caja del Centro de Acopio ${r.centro} al ${r.fechaActualizacion} · Saldo ${fmtUsd(r.saldoUsd)} · Total gastado ${fmtUsd(r.totalGastado)}.`,
      to_emails: destinos,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}
