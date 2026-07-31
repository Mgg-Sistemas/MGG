/* ============================================================
   MGG · Resúmenes GENERALES de Producción — PDF (vista previa)
   Un reporte por área con UNA fila por ítem finalizado y una fila de
   TOTALES al pie (réplica del Excel "RESUMEN DE …"):
   - Fundición (coladas): RESUMEN DE FUNDICIÓN
   - Refinación:          RESUMEN DE REFINACIÓN
   Solo por botón; se abre en vista previa (previewPdfDoc). Encabezado
   formal MGG (logo + razón social + RIF) y barra naranja de tabla.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { dateTime, num } from '@/shared/lib/format';
import { listFundicionesFinalizadasConDatos } from './colada.repository';
import { listRefinacionesFinalizadasConDatos } from './refinacion.repository';

const ORANGE: [number, number, number] = [255, 138, 0];
const GREY: [number, number, number] = [90, 90, 90];
const FOOT: [number, number, number] = [60, 60, 60];

/** kg con hasta 2 decimales es-VE; '—' si viene null. */
function kg(n: number | null | undefined): string {
  return n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
/** % con hasta 2 decimales es-VE; '—' si viene null. */
function pct(n: number | null | undefined): string {
  return n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
/** Entero es-VE; '—' si viene null. */
function entero(n: number | null | undefined): string {
  return n == null ? '—' : num(n);
}
/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (sin sustos de zona horaria). */
function fmtFecha(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
}

/** Crea el doc apaisado y pinta el encabezado común; devuelve el `y` bajo él. */
async function nuevoDoc(titulo: string) {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 42.52;
  let y = MARGIN;

  // ── Encabezado ──
  if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, 46, 46); } catch { /* opcional */ } }
  doc.setTextColor(...ORANGE); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('MINERAL GROUP GUAYANA C.A.', W / 2, y + 16, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text('RIF J-50221930-7', W / 2, y + 30, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
  doc.text(titulo, W / 2, y + 46, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
  doc.text(`Generado ${dateTime(new Date().toISOString())}`, W / 2, y + 58, { align: 'center' });
  y += 70;

  return { doc, autoTable, W, MARGIN, y };
}

/** RESUMEN DE FUNDICIÓN: todas las coladas finalizadas + fila de totales. */
export async function descargarResumenFundicionPdf(): Promise<void> {
  const filas = await listFundicionesFinalizadasConDatos();
  const { doc, autoTable, W, MARGIN, y } = await nuevoDoc('RESUMEN DE FUNDICIÓN');

  // Totales de columnas de kg (la Ley total = promedio ponderado Σsn/Σcasiterita×100).
  let tCasi = 0, tSn = 0, tCoque = 0, tCaco3 = 0, tEstano = 0, tLingotes = 0;
  filas.forEach((f) => {
    tCasi += Number(f.total_casiterita) || 0;
    tSn += Number(f.sn_kg) || 0;
    tCoque += Number(f.coque_kg) || 0;
    tCaco3 += Number(f.caco3_kg) || 0;
    tEstano += Number(f.estano_kg) || 0;
    tLingotes += Number(f.n_lingotes) || 0;
  });
  const leyProm = tCasi > 0 ? (tSn / tCasi) * 100 : null;

  const body = filas.map((f) => [
    f.colada_num ? String(f.colada_num) : '—',
    fmtFecha(f.fecha),
    f.almacen_destino || '—',
    kg(f.total_casiterita),
    pct(f.ley_sn),
    kg(f.sn_kg),
    kg(f.coque_kg),
    kg(f.caco3_kg),
    kg(f.estano_kg),
    entero(f.n_lingotes),
  ]);

  autoTable(doc, {
    startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: W - MARGIN * 2,
    head: [['N° Colada', 'Fecha', 'Lugar', 'Casiterita (kg)', 'Ley Sn/Tenor %', 'Sn contenido (kg)', 'Coque (kg)', 'CaCO₃ (kg)', 'Estaño obtenido (kg)', 'N° lingotes']],
    body: body.length ? body : [['—', '—', '—', '—', '—', '—', '—', '—', '—', '—']],
    foot: [['TOTALES', '', '', kg(tCasi), pct(leyProm), kg(tSn), kg(tCoque), kg(tCaco3), kg(tEstano), entero(tLingotes)]],
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 7.5, halign: 'center' },
    footStyles: { fillColor: FOOT, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    styles: { fontSize: 7.5, cellPadding: 3 },
    columnStyles: {
      0: { halign: 'center' }, 1: { halign: 'center' },
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'center' },
    },
  });

  previewPdfDoc(doc, `resumen-fundicion-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** RESUMEN DE REFINACIÓN: todas las refinaciones finalizadas + fila de totales. */
export async function descargarResumenRefinacionPdf(): Promise<void> {
  const filas = await listRefinacionesFinalizadasConDatos();
  const { doc, autoTable, W, MARGIN, y } = await nuevoDoc('RESUMEN DE REFINACIÓN');

  // Totales (la Ley total = promedio ponderado ΣSnTeórico/Σbruto×100).
  let tCrudo = 0, tTeorico = 0, tSoda = 0, tAzufre = 0, tCarbon = 0, tCal = 0, tRefinado = 0, tLingotes = 0;
  const body = filas.map((f) => {
    const crudo = Number(f.estano_crudo_kg) || 0;
    const teorico = f.estano_crudo_kg != null && f.pureza_inicial != null
      ? crudo * Number(f.pureza_inicial) / 100
      : null;
    tCrudo += crudo;
    tTeorico += teorico ?? 0;
    tSoda += f.soda_kg;
    tAzufre += f.azufre_kg;
    tCarbon += f.carbon_kg;
    tCal += f.cal_kg;
    tRefinado += Number(f.estano_refinado_kg) || 0;
    tLingotes += Number(f.n_lingotes) || 0;
    return [
      f.refinacion_num ? String(f.refinacion_num) : '—',
      fmtFecha(f.fecha),
      f.almacen_destino || '—',
      kg(f.estano_crudo_kg),
      pct(f.pureza_inicial),
      kg(teorico),
      kg(f.soda_kg),
      kg(f.azufre_kg),
      kg(f.carbon_kg),
      kg(f.cal_kg),
      kg(f.estano_refinado_kg),
      entero(f.n_lingotes),
    ];
  });
  const leyProm = tCrudo > 0 ? (tTeorico / tCrudo) * 100 : null;

  autoTable(doc, {
    startY: y, margin: { left: MARGIN, right: MARGIN }, tableWidth: W - MARGIN * 2,
    head: [['N° Refinación', 'Fecha', 'Lugar', 'Estaño en bruto (kg)', 'Ley/Tenor %', 'Sn Teórico (kg)', 'Soda cáustica (kg)', 'Azufre (kg)', 'Carbón vegetal (kg)', 'Cal (kg)', 'Estaño Refinado (kg)', 'N° lingotes']],
    body: body.length ? body : [['—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']],
    foot: [['TOTALES', '', '', kg(tCrudo), pct(leyProm), kg(tTeorico), kg(tSoda), kg(tAzufre), kg(tCarbon), kg(tCal), kg(tRefinado), entero(tLingotes)]],
    theme: 'grid',
    headStyles: { fillColor: ORANGE, textColor: 255, fontSize: 7, halign: 'center' },
    footStyles: { fillColor: FOOT, textColor: 255, fontStyle: 'bold', fontSize: 7 },
    styles: { fontSize: 7, cellPadding: 2.5 },
    columnStyles: {
      0: { halign: 'center' }, 1: { halign: 'center' },
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'center' },
    },
  });

  previewPdfDoc(doc, `resumen-refinacion-${new Date().toISOString().slice(0, 10)}.pdf`);
}
