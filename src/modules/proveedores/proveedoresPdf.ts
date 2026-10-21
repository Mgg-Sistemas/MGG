/* ============================================================
   MGG · Proveedores · PDF · 21-10-2026
   Reporte en PDF con selección de columnas y orientación:
   logo, título, filtros aplicados, resumen, fecha y hora, y tabla
   con las columnas escogidas por el usuario.
   Mismos estilos que el resto de los reportes (logo, margen de 2 cm, pie con paginado).
   Se MUESTRA en vista previa: nada se descarga solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { MARGEN_PDF, MARGENES_TABLA_PDF, anchoUtilPdf, limiteInferiorPdf } from '@/shared/lib/pdfMargen';
import { fechaReporteTexto } from '@/modules/pedidos/comprasReporteMensaje';
import type { Proveedor } from '@/shared/lib/types';
import type { FilaProveedor } from './proveedoresReporte';
import type { ActividadEconomica } from './ciiu';
import { camposElegidosProveedores, CAMPOS_POR_DEFECTO, tablaExportProveedores } from './exportarProveedores';

export type OrientacionPdf = 'auto' | 'vertical' | 'horizontal';

export interface OpcionesPdfProveedores {
  keys?: string[];
  orientacion?: OrientacionPdf;
  actividades?: ActividadEconomica[];
  impresoIso?: string;
}

export async function descargarProveedoresPdf(
  datos: Proveedor[] | FilaProveedor[],
  filtros: string,
  opcionesOImpreso: OpcionesPdfProveedores | string = {},
  impresoLegacy: string = new Date().toISOString(),
): Promise<void> {
  const opts: OpcionesPdfProveedores =
    typeof opcionesOImpreso === 'string'
      ? { impresoIso: opcionesOImpreso }
      : opcionesOImpreso;
  const impresoIso = opts.impresoIso ?? impresoLegacy;
  const keys = opts.keys && opts.keys.length ? opts.keys : CAMPOS_POR_DEFECTO;
  const orientacion: OrientacionPdf = opts.orientacion ?? 'auto';
  const actividades = opts.actividades ?? [];

  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/shared/lib/pdfLogo'),
  ]);

  // Si recibimos FilaProveedor legacy:
  const esLegacy = datos.length > 0 && 'razonSocial' in (datos[0] as object);

  let head: string[];
  let filas: string[][];
  const campos = camposElegidosProveedores(keys);
  let anchoTotal: number;

  if (esLegacy) {
    const filasLegacy = datos as FilaProveedor[];
    head = ['RIF', 'RAZÓN SOCIAL', 'CONTACTO / TELÉFONO', 'EMAIL', 'ACTIVIDAD ECONÓMICA', 'CATEGORÍAS', 'ESTADO'];
    filas = filasLegacy.map((f) => [
      f.rif,
      f.razonSocial,
      [f.contacto, f.telefono && `Tel. ${f.telefono}`, f.telefonoAdmin && `Admin. ${f.telefonoAdmin}`].filter(Boolean).join('\n') || '—',
      f.email || '—',
      f.actividad || '—',
      f.categorias || '—',
      f.estado,
    ]);
    anchoTotal = 135;
  } else {
    const provs = datos as Proveedor[];
    const res = tablaExportProveedores(provs, keys, actividades);
    head = res.head;
    filas = res.filas;
    anchoTotal = 6 + campos.reduce((acc, c) => acc + c.ancho, 0);
  }

  // La orientación se adapta a las columnas elegidas o la preferencia explícita del usuario.
  const horizontal =
    orientacion === 'horizontal' ||
    (orientacion === 'auto' && (anchoTotal > 80 || head.length > 6));

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: horizontal ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = anchoUtilPdf(W);
  const logo = await loadLogoDataUrl().catch(() => null);

  let y = MARGEN_PDF;
  if (logo) {
    try { doc.addImage(logo, 'JPEG', MARGEN_PDF, y, 44, 44); } catch { /* opcional */ }
  }
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('PROVEEDORES', W / 2 + 28, y + 20, { align: 'center' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text('Mineral Group Guayana C.A.', W / 2 + 28, y + 36, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 62;

  // Resumen del listado
  const totalActivos = esLegacy
    ? (datos as FilaProveedor[]).filter((x) => x.estado.toLowerCase().includes('activo')).length
    : (datos as Proveedor[]).filter((p) => p.estado === 'activo').length;
  const textoResumen = `${datos.length} proveedor(es) · ${totalActivos} activo(s) · ${datos.length - totalActivos} inactivo(s)`;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold'); doc.text('Filtros:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal'); doc.text(filtros, MARGEN_PDF + 38, y);
  y += 14;
  doc.setFont('helvetica', 'bold'); doc.text('Total:', MARGEN_PDF, y);
  doc.setFont('helvetica', 'normal'); doc.text(`${textoResumen} · Impreso: ${fechaReporteTexto(impresoIso)}`, MARGEN_PDF + 38, y);
  y += 10;

  // Cálculo proporcional de anchos de columna
  const columnStyles: Record<number, { cellWidth: number; halign?: 'left' | 'center' | 'right'; fontStyle?: 'bold' | 'normal' }> = {};
  if (esLegacy) {
    const col = (pct: number) => Math.round(CW * pct);
    columnStyles[0] = { cellWidth: col(0.10) };
    columnStyles[1] = { cellWidth: col(0.20), fontStyle: 'bold' };
    columnStyles[2] = { cellWidth: col(0.17) };
    columnStyles[3] = { cellWidth: col(0.16) };
    columnStyles[4] = { cellWidth: col(0.17) };
    columnStyles[5] = { cellWidth: col(0.12) };
    columnStyles[6] = { cellWidth: CW - col(0.10) - col(0.20) - col(0.17) - col(0.16) - col(0.17) - col(0.12), halign: 'center' };
  } else {
    // Primera columna es N°
    const anchoItem = 6;
    columnStyles[0] = { cellWidth: CW * (anchoItem / anchoTotal), halign: 'center' };
    campos.forEach((c, idx) => {
      const colIdx = idx + 1;
      const w = CW * (c.ancho / anchoTotal);
      columnStyles[colIdx] = {
        cellWidth: w,
        halign: c.key === 'estado' || c.key === 'origen' ? 'center' : 'left',
        fontStyle: c.key === 'razon_social' ? 'bold' : 'normal',
      };
    });
  }

  // Ajuste dinámico de tamaño de fuente según densidad de columnas
  const ptPorCaracter = CW / anchoTotal;
  const letra = Math.max(6.5, Math.min(9.5, Math.round(ptPorCaracter * 1.5 * 2) / 2));
  const relleno = letra >= 8.5 ? 4 : 3;

  autoTable(doc, {
    startY: y + 4,
    head: [head],
    body: filas,
    styles: { fontSize: letra, cellPadding: relleno, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [255, 224, 189], textColor: [138, 75, 0], fontStyle: 'bold', halign: 'center', fontSize: letra },
    bodyStyles: { textColor: [20, 20, 20] },
    alternateRowStyles: { fillColor: [255, 246, 236] },
    tableWidth: CW,
    columnStyles,
    margin: { ...MARGENES_TABLA_PDF },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal');
      doc.text(`Impreso ${fechaReporteTexto(impresoIso)} · Mineral Group Guayana C.A.`, MARGEN_PDF, limiteInferiorPdf(H));
      doc.text(`Pág. ${doc.getNumberOfPages()}`, W - MARGEN_PDF, limiteInferiorPdf(H), { align: 'right' });
    },
  });

  previewPdfDoc(doc, 'proveedores-mgg.pdf');
}
