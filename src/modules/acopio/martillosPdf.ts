/* ============================================================
   Golden Touch · Centro de Acopio · Consumo de Martillos · Reportes
   PDF / Correo de la hoja «CONSUMO MAZOS MARTILLOS GT».
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import type { MartilloMovimiento } from './martillos.repository';

const NOMBRE = 'consumo-martillos-molino-h66';
const fmtUsd = (v: number | null | undefined) => (v == null ? '' : `$${v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtNum = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('es', { maximumFractionDigits: 2 }));

const HEAD = [
  'Fecha', 'Descripción', '$Usd Entregados', 'Cant. entregados', 'Precio $/Martillo',
  '$Usd Facturados', 'Saldo $ Usd', 'Martillos a GT', 'Consumidos', 'Martillos restantes',
];

async function construirDoc(movs: MartilloMovimiento[]) {
  const [{ dateTime }, { loadLogoDataUrl }, { jsPDF }, { default: autoTable }] = await Promise.all([
    import('@/shared/lib/format'), import('@/shared/lib/pdfLogo'), import('jspdf'), import('jspdf-autotable'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 28;
  let y = MARGIN;
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  const tx = logo ? MARGIN + 58 : MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Consumo de Martillos · Molino H66', tx, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Saldo $ = entregados − facturados · Restantes = entregados − a GT − consumidos', tx, y + 33);
  doc.text(`GOLDEN TOUCH 1127 C.A. · ${dateTime(new Date().toISOString())}`, PAGE_W - MARGIN, y + 18, { align: 'right' });
  doc.text(`${movs.length} movimiento(s)`, PAGE_W - MARGIN, y + 33, { align: 'right' });
  y += 54;
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 8;

  const body = movs.map((m) => [
    m.fecha, m.descripcion ?? '', fmtUsd(m.usd_entregados || null), fmtNum(m.cantidad_entregados || null),
    fmtUsd(m.precio_usd_martillo || null), fmtUsd(m.usd_facturados || null), fmtUsd(m.saldo_usd),
    fmtNum(m.martillos_a_gt || null), fmtNum(m.consumidos || null), fmtNum(m.martillos_restantes),
  ]);

  autoTable(doc, {
    startY: y + 4,
    head: [HEAD],
    body,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' },
    },
  });
  return doc;
}

export async function descargarMartillosPdf(movs: MartilloMovimiento[]): Promise<void> {
  (await construirDoc(movs)).save(`${NOMBRE}.pdf`);
}

export async function enviarMartillosPorCorreo(movs: MartilloMovimiento[], destinos: string[]): Promise<{ destinatarios: string[] }> {
  const base64 = (await construirDoc(movs)).output('datauristring').split(',')[1] ?? '';
  const { data, error } = await supabase.functions.invoke<{ ok: true; destinatarios: string[] } | { error: string }>('enviar-reporte', {
    body: { pdf_base64: base64, nombre_archivo: `${NOMBRE}.pdf`, asunto: 'Consumo de Martillos · Molino H66', mensaje: `Consumo de martillos del Molino H66 (${movs.length} movimiento(s)).`, to_emails: destinos },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el correo');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida');
  return { destinatarios: data.destinatarios };
}
