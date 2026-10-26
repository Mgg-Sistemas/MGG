/* ============================================================
   Golden Touch · Libro fiscal · Comprobante Anual ARC (ISLR)

   Artículo 24 del Decreto N° 1.808 (Reglamento Parcial de la Ley de
   Impuesto sobre la Renta en materia de Retenciones):
   «Los agentes de retención están obligados a entregar a los contribuyentes,
   un comprobante por cada retención de impuesto que les practiquen...
   Asimismo, deberán entregar una relación del total de impuestos retenidos
   en el ejercicio fiscal anterior, a más tardar el mes siguiente al
   cierre del ejercicio...»

   Contiene:
   1. Datos del Agente de Retención y del Sujeto Retenido.
   2. Ejercicio fiscal anual comprendido (Enero - Diciembre).
   3. Tabla mensual detallada con los 12 meses del ejercicio:
      base imponible pagada en Bs, % aplicado y monto retenido en Bs.
   4. Fila de totales anuales.
   5. Declaración de certificación formal, firmas y verificación digital
      mediante código QR y huella SHA-256 (PA 0084 y 0093).
   ============================================================ */
import { previewPdf } from '@/shared/lib/reportePreview';
import { EMPRESA_RIF } from '@/shared/lib/empresa';
import { MARGEN_PDF, MARGENES_TABLA_PDF, montoPdf, textoPdf } from './pdfComun';
import {
  calcularSha256Hex, cargarElementosDigitales, consultarElementosDigitales, generarQrVerificacion, razonSocialAgente,
  type ModoEjemplar, type EjemplarPdf,
} from './comprobanteRetencionPdf';
import type { ConfigRetencion } from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';

export const MESES_ANIO = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export interface RenglonMesArc {
  mesNumero: number; // 1..12
  mesNombre: string;
  baseImponibleBs: number;
  porcentaje: number;
  impuestoRetenidoBs: number;
  operaciones: number;
}

export interface DatosArc {
  anio: number;
  proveedorRif: string;
  proveedorNombre: string;
  proveedorDireccion: string;
  meses: RenglonMesArc[];
  totalBaseBs: number;
  totalRetenidoBs: number;
  totalOperaciones: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const enBs = (n: number, r: RetencionPracticada): number => {
  if (r.montoBs != null && r.montoRetenido && r.montoRetenido > 0) {
    const factorBs = r.montoBs / r.montoRetenido;
    return r2(n * factorBs);
  }
  if (String(r.moneda || '').toUpperCase() === 'BS') return r2(n);
  return r.tasa && r.tasa > 0 ? r2(n * r.tasa) : 0;
};

/**
 * Agrupa y consolida las retenciones de ISLR de un año y proveedor en la estructura ARC.
 * Deduce notas de crédito y descarta las retenciones anuladas.
 */
export function compilarDatosArc(
  anio: number,
  proveedorRif: string,
  todasLasFilas: RetencionPracticada[],
): DatosArc {
  const rifNorm = proveedorRif.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const anioStr = String(anio);

  const anioDe = (r: RetencionPracticada): string => {
    const f = (r.facturaFecha || r.createdAt || '').slice(0, 4);
    if (/^\d{4}$/.test(f)) return f;
    if (r.periodo && r.periodo.length >= 4) return r.periodo.slice(0, 4);
    return '';
  };

  const mesIdxDe = (r: RetencionPracticada): number => {
    const f = (r.facturaFecha || r.createdAt || '').slice(5, 7);
    if (/^\d{2}$/.test(f)) return Number(f) - 1;
    if (r.periodo && r.periodo.length >= 6) return Number(r.periodo.slice(4, 6)) - 1;
    return -1;
  };

  // Filtrar: practicadas de ISLR, del año dado, del proveedor, no anuladas
  const filasProv = todasLasFilas.filter((r) => {
    if (r.direccion !== 'practicada' || r.tipo !== 'islr' || r.anulada) return false;
    const rRif = (r.contraparteRif ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (rRif !== rifNorm) return false;
    return anioDe(r) === anioStr;
  });

  const primerFila = filasProv[0];
  const proveedorNombre = primerFila?.contraparteNombre || 'Proveedor sin nombre';
  const proveedorDireccion = primerFila?.contraparteDireccion || '—';

  const acumuladoMeses: RenglonMesArc[] = MESES_ANIO.map((mesNombre, idx) => ({
    mesNumero: idx + 1,
    mesNombre,
    baseImponibleBs: 0,
    porcentaje: 0,
    impuestoRetenidoBs: 0,
    operaciones: 0,
  }));

  for (const r of filasProv) {
    const mesIdx = mesIdxDe(r);
    if (mesIdx < 0 || mesIdx > 11) continue;

    const factor = r.tipoDocumento === 'nota_credito' ? -1 : 1;
    const baseBs = enBs(r.baseImponible, r) * factor;
    const retBs = (r.montoBs ?? enBs(r.montoRetenido, r)) * factor;

    const item = acumuladoMeses[mesIdx];
    item.baseImponibleBs = r2(item.baseImponibleBs + baseBs);
    item.impuestoRetenidoBs = r2(item.impuestoRetenidoBs + retBs);
    item.operaciones += 1;
    if (r.porcentaje > 0) item.porcentaje = r.porcentaje;
  }

  const totalBaseBs = r2(acumuladoMeses.reduce((a, m) => a + m.baseImponibleBs, 0));
  const totalRetenidoBs = r2(acumuladoMeses.reduce((a, m) => a + m.impuestoRetenidoBs, 0));
  const totalOperaciones = acumuladoMeses.reduce((a, m) => a + m.operaciones, 0);

  return {
    anio,
    proveedorRif,
    proveedorNombre,
    proveedorDireccion,
    meses: acumuladoMeses,
    totalBaseBs,
    totalRetenidoBs,
    totalOperaciones,
  };
}

export interface OpcionesArcPdf {
  incluirLogo?: boolean;
  incluirFirma?: boolean;
  incluirSello?: boolean;
  incluirQr?: boolean;
  ejemplar?: EjemplarPdf | null;
  modoEjemplar?: ModoEjemplar;
}

/**
 * Construye una página (o añade a un documento existente) del Comprobante Anual ARC de ISLR (Art. 24 Decreto 1.808).
 */
export async function generarDocComprobanteArcPdf(
  datos: DatosArc,
  config: ConfigRetencion,
  opciones: OpcionesArcPdf = {},
  docExistente?: any,
): Promise<any> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);

  let doc: any;
  if (docExistente) {
    doc = docExistente;
    doc.addPage('letter', 'portrait');
  } else {
    doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  }

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  let y = M;

  const ejemplar = opciones.ejemplar ?? null;

  // Carga de elementos digitales desde Parámetros del módulo
  const { logoDataUrl, firmaDataUrl, selloDataUrl } = await cargarElementosDigitales().catch(() => ({
    logoDataUrl: null, firmaDataUrl: null, selloDataUrl: null,
  }));

  const tieneLogo = !!(opciones.incluirLogo && logoDataUrl);
  const logoW = 90;
  const logoH = 32;

  if (tieneLogo) {
    try {
      doc.addImage(logoDataUrl, 'PNG', M, y, logoW, logoH);
    } catch { /* continuar sin logo */ }
  }

  // Si hay ejemplar, estampar el badge en la esquina superior derecha
  const badgeW = 160;
  const badgeH = 14;
  const badgeX = W - M - badgeW;
  if (ejemplar) {
    const textoBadge = ejemplar === 'original'
      ? 'ORIGINAL · SUJETO RETENIDO'
      : 'COPIA · AGENTE DE RETENCIÓN';
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.setFillColor(242, 244, 246);
    doc.rect(badgeX, y, badgeW, badgeH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(textoBadge, badgeX + badgeW / 2, y + 10, { align: 'center' });
  }

  // Título oficial y membrete
  const xTexto = tieneLogo ? M + logoW + 12 : W / 2;
  const anchoTexto = tieneLogo
    ? (ejemplar ? W - M - badgeW - 12 - xTexto : W - M - xTexto)
    : (ejemplar ? W - M * 2 - badgeW : W - M * 2);
  const align = tieneLogo ? 'left' : 'center';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const lineasTitulo = doc.splitTextToSize(
    textoPdf('COMPROBANTE DE RETENCIÓN DE IMPUESTO SOBRE LA RENTA ANUAL (FORMA ARC)'),
    anchoTexto,
  ) as string[];
  doc.text(lineasTitulo, xTexto, y + 8, { align });

  let textY = y + 8 + (lineasTitulo.length * 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(80, 80, 80);
  const lineasSub = doc.splitTextToSize(
    textoPdf('Artículo 24 del Decreto N° 1.808 · Reglamento Parcial de la Ley de I.S.L.R. en materia de Retenciones'),
    anchoTexto,
  ) as string[];
  doc.text(lineasSub, xTexto, textY, { align });

  textY += (lineasSub.length * 8.5) + 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(40, 40, 40);
  doc.text(
    textoPdf(`EJERCICIO FISCAL: ${datos.anio} (Del 01/01/${datos.anio} al 31/12/${datos.anio})`),
    xTexto,
    textY,
    { align },
  );

  y = Math.max(y + (tieneLogo ? logoH : 0), textY) + 12;

  // Recuadro de Agente y Sujeto
  const boxW = W - M * 2;
  const colW = (boxW - 12) / 2;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.6);

  // Recuadro Agente
  doc.rect(M, y, colW, 58);
  doc.setFillColor(245, 245, 245);
  doc.rect(M, y, colW, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(40, 40, 40);
  doc.text(textoPdf('DATOS DEL AGENTE DE RETENCIÓN'), M + 6, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(textoPdf(`Razón Social: ${razonSocialAgente(config)}`), M + 6, y + 24);
  doc.text(textoPdf(`RIF: ${config.rif || EMPRESA_RIF}`), M + 6, y + 35);
  const dirAgente = [config.direccionFiscal, config.municipio, config.estado].filter(Boolean).join(', ') || 'Venezuela';
  doc.text(textoPdf(`Dirección: ${dirAgente.slice(0, 52)}`), M + 6, y + 46);

  // Recuadro Sujeto Retenido
  const xSujeto = M + colW + 12;
  doc.rect(xSujeto, y, colW, 58);
  doc.setFillColor(245, 245, 245);
  doc.rect(xSujeto, y, colW, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(40, 40, 40);
  doc.text(textoPdf('DATOS DEL BENEFICIARIO / SUJETO RETENIDO'), xSujeto + 6, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(textoPdf(`Nombre / Razón Social: ${datos.proveedorNombre}`), xSujeto + 6, y + 24);
  doc.text(textoPdf(`RIF / C.I.: ${datos.proveedorRif}`), xSujeto + 6, y + 35);
  doc.text(textoPdf(`Dirección: ${datos.proveedorDireccion.slice(0, 52)}`), xSujeto + 6, y + 46);

  y += 66;

  // Tabla mensual
  const cabecera = ['N°', 'Mes', 'Base Imponible Pagada (Bs)', '% Ret.', 'Impuesto Retenido (Bs)', 'Impuesto Enterado (Bs)'].map(textoPdf);
  const cuerpo = datos.meses.map((m) => [
    String(m.mesNumero).padStart(2, '0'),
    textoPdf(m.mesNombre),
    montoPdf(m.baseImponibleBs, 'Bs'),
    m.porcentaje > 0 ? `${m.porcentaje.toFixed(2)}%` : '—',
    montoPdf(m.impuestoRetenidoBs, 'Bs'),
    montoPdf(m.impuestoRetenidoBs, 'Bs'),
  ]);

  const filaTotales = [
    '',
    textoPdf('TOTALES DEL EJERCICIO:'),
    montoPdf(datos.totalBaseBs, 'Bs'),
    '—',
    montoPdf(datos.totalRetenidoBs, 'Bs'),
    montoPdf(datos.totalRetenidoBs, 'Bs'),
  ];

  autoTable(doc as any, {
    startY: y,
    head: [cabecera],
    body: cuerpo,
    foot: [filaTotales],
    styles: { fontSize: 7.5, cellPadding: 3.5 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    footStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 90 },
      2: { halign: 'right' },
      3: { halign: 'center', cellWidth: 50 },
      4: { halign: 'right', fontStyle: 'bold' },
      5: { halign: 'right' },
    },
    margin: MARGENES_TABLA_PDF,
  });

  let finY = (doc as any).lastAutoTable?.finalY ?? y + 200;

  // Nota de fe pública tributaria
  finY += 12;
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 90);
  doc.text(textoPdf(
    'Certifico que la información contenida en el presente comprobante fue extraída fielmente de los registros contables y comprobantes de retención emitidos durante el ejercicio fiscal correspondiente, de conformidad con lo establecido en el Artículo 24 del Decreto N° 1.808.',
  ), M, finY, { maxWidth: W - M * 2 });

  finY += 20;

  // ── Bloque inferior de 3 recuadros: Agente | Verificación Fiscal | Sujeto ──
  const firmaBoxW = (boxW - 16) / 3;
  const firmaBoxH = 75;

  // Verificación Digital con QR y Hash
  const canonicoArc = `SENIAT|ARC|ISLR|${config.rif || EMPRESA_RIF}|${datos.proveedorRif}|${datos.anio}|${datos.totalBaseBs.toFixed(2)}|${datos.totalRetenidoBs.toFixed(2)}`;
  let hashSha256 = '';
  let qrDataUrl: string | null = null;
  const conQr = opciones.incluirQr ?? true;

  if (conQr) {
    try {
      hashSha256 = await calcularSha256Hex(canonicoArc);
      qrDataUrl = await generarQrVerificacion(canonicoArc);
    } catch { /* continuar sin QR */ }
  }

  // Recuadro 1: Agente
  doc.rect(M, finY, firmaBoxW, firmaBoxH);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text(textoPdf('POR EL AGENTE DE RETENCIÓN'), M + firmaBoxW / 2, finY + 10, { align: 'center' });

  // Firma y sello si están activados
  const xFirma = M + 8;
  const yFirma = finY + 14;
  if (opciones.incluirFirma && firmaDataUrl) {
    try { doc.addImage(firmaDataUrl, 'PNG', xFirma, yFirma, 65, 34); } catch {}
  }
  if (opciones.incluirSello && selloDataUrl) {
    try { doc.addImage(selloDataUrl, 'PNG', xFirma + 50, yFirma - 2, 40, 40); } catch {}
  }

  doc.setDrawColor(180, 180, 180);
  doc.line(M + 12, finY + firmaBoxH - 16, M + firmaBoxW - 12, finY + firmaBoxH - 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(textoPdf('Firma y Sello Autorizado'), M + firmaBoxW / 2, finY + firmaBoxH - 6, { align: 'center' });

  // Recuadro 2: Verificación Digital Fiscal
  const xVerif = M + firmaBoxW + 8;
  doc.rect(xVerif, finY, firmaBoxW, firmaBoxH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text(textoPdf('VERIFICACIÓN DIGITAL FISCAL'), xVerif + firmaBoxW / 2, finY + 10, { align: 'center' });

  if (qrDataUrl) {
    const qrSize = 36;
    doc.addImage(qrDataUrl, 'PNG', xVerif + 8, finY + 16, qrSize, qrSize);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(80, 80, 80);
    doc.text(textoPdf('PA SNAT/2026/0084 y 0093'), xVerif + qrSize + 14, finY + 22);
    doc.text(textoPdf('Comprobante Certificado'), xVerif + qrSize + 14, finY + 30);
    doc.text(textoPdf(`Huella SHA-256:`), xVerif + qrSize + 14, finY + 38);
    const hashCorto1 = hashSha256.slice(0, 16);
    const hashCorto2 = hashSha256.slice(16, 32);
    doc.setFont('courier', 'normal');
    doc.setFontSize(5);
    doc.text(hashCorto1, xVerif + qrSize + 14, finY + 45);
    doc.text(hashCorto2, xVerif + qrSize + 14, finY + 52);
  }

  // Recuadro 3: Sujeto Retenido
  const xSuj = xVerif + firmaBoxW + 8;
  doc.rect(xSuj, finY, firmaBoxW, firmaBoxH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(60, 60, 60);
  doc.text(textoPdf('CONFORME: SUJETO RETENIDO'), xSuj + firmaBoxW / 2, finY + 10, { align: 'center' });
  doc.line(xSuj + 12, finY + firmaBoxH - 16, xSuj + firmaBoxW - 12, finY + firmaBoxH - 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(textoPdf('Firma / Fecha de Recepción'), xSuj + firmaBoxW / 2, finY + firmaBoxH - 6, { align: 'center' });

  // Pie de página con destino
  if (ejemplar) {
    const rotuloDestino = ejemplar === 'original'
      ? 'DESTINO: ORIGINAL (SUJETO RETENIDO)'
      : 'DESTINO: COPIA (AGENTE DE RETENCIÓN)';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(60, 60, 60);
    doc.text(textoPdf(rotuloDestino), W - M, H - 18, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(razonSocialAgente(config)), M, H - 18, { maxWidth: W - M * 2 - 210 });
  }

  return doc;
}

/**
 * Emite las páginas del Comprobante Anual ARC según el modo de ejemplar
 * ('ambos': Original + Copia consecutivas, 'original' o 'copia').
 */
export async function anexarPaginasArcPdf(
  datos: DatosArc,
  config: ConfigRetencion,
  opciones: OpcionesArcPdf = {},
  docExistente?: any,
): Promise<any> {
  const modo: ModoEjemplar = opciones.modoEjemplar || 'ambos';
  let doc = docExistente;

  if (modo === 'ambos') {
    doc = await generarDocComprobanteArcPdf(datos, config, { ...opciones, ejemplar: 'original' }, doc);
    doc = await generarDocComprobanteArcPdf(datos, config, { ...opciones, ejemplar: 'copia' }, doc);
  } else if (modo === 'copia') {
    doc = await generarDocComprobanteArcPdf(datos, config, { ...opciones, ejemplar: 'copia' }, doc);
  } else {
    doc = await generarDocComprobanteArcPdf(datos, config, { ...opciones, ejemplar: 'original' }, doc);
  }

  return doc;
}

/**
 * Genera y previsualiza el Comprobante Anual ARC de ISLR en PDF (Art. 24 Decreto 1.808)
 * con soporte de emisión de Original y Copia e interactividad en el visor.
 */
export async function verComprobanteArcPdf(
  anio: number,
  proveedorRif: string,
  filas: RetencionPracticada[],
  config: ConfigRetencion,
  opciones: OpcionesArcPdf = {},
): Promise<void> {
  const datos = compilarDatosArc(anio, proveedorRif, filas);
  const disp = await consultarElementosDigitales();

  let modoEjemplar: ModoEjemplar = opciones.modoEjemplar
    ?? ((typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:modoEjemplar') as ModoEjemplar : null) || 'ambos');
  let conLogo = disp.tieneLogo && (opciones.incluirLogo ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConLogo') !== 'false' : true));
  let conFirma = disp.tieneFirma && (opciones.incluirFirma ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConFirma') !== 'false' : true));
  let conSello = disp.tieneSello && (opciones.incluirSello ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConSello') !== 'false' : true));
  let conQr = opciones.incluirQr ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConQr') !== 'false' : true);

  const generarDoc = () => anexarPaginasArcPdf(datos, config, {
    modoEjemplar,
    incluirLogo: conLogo,
    incluirFirma: conFirma,
    incluirSello: conSello,
    incluirQr: conQr,
  });

  const doc = await generarDoc();
  const filename = `comprobante-arc-${datos.anio}-${datos.proveedorRif.replace(/[^\w.-]+/g, '_')}.pdf`;

  previewPdf(doc, filename, {
    extraControls: ({ bar, updatePdf }) => {
      const container = document.createElement('div');
      container.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin-left:auto;margin-right:.5rem;flex-wrap:wrap;';

      // Selector de Ejemplar (Original y Copia / Solo Original / Solo Copia)
      const selEjemplar = document.createElement('select');
      selEjemplar.style.cssText =
        'background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:.35rem .6rem;font:600 .82rem system-ui;cursor:pointer;outline:none;';
      selEjemplar.title = 'Seleccionar ejemplares a emitir (Original y Copia)';

      const optAmbos = document.createElement('option');
      optAmbos.value = 'ambos';
      optAmbos.textContent = '📄 Original y Copia (2 págs)';

      const optOriginal = document.createElement('option');
      optOriginal.value = 'original';
      optOriginal.textContent = '📄 Solo Original (1 pág)';

      const optCopia = document.createElement('option');
      optCopia.value = 'copia';
      optCopia.textContent = '📄 Solo Copia (1 pág)';

      selEjemplar.append(optAmbos, optOriginal, optCopia);
      selEjemplar.value = modoEjemplar;

      selEjemplar.onchange = async () => {
        modoEjemplar = selEjemplar.value as ModoEjemplar;
        try { localStorage.setItem('retenciones:modoEjemplar', modoEjemplar); } catch {}
        selEjemplar.style.opacity = '0.6';
        try {
          const nuevoDoc = await generarDoc();
          updatePdf(nuevoDoc);
        } finally {
          selEjemplar.style.opacity = '1';
        }
      };

      container.appendChild(selEjemplar);

      if (!disp.tieneAlguno) {
        const aviso = document.createElement('span');
        aviso.style.cssText =
          'color:#8b949e;font:500 .78rem system-ui;display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .6rem;background:#161b22;border-radius:6px;border:1px solid #30363d;';
        aviso.title = 'Para estampar logo, firma o sello, cárgalos en Parámetros › Firma / Sello o Logo.';
        aviso.textContent = 'Sin logo ni firma en Parámetros';
        container.appendChild(aviso);
      }

      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;align-items:center;gap:.4rem;';

      const labelTitulo = document.createElement('span');
      labelTitulo.style.cssText = 'color:#8b949e;font:600 .78rem system-ui;margin-right:.2rem;';
      labelTitulo.textContent = 'Imprimir:';
      toolbar.appendChild(labelTitulo);

      const crearCheck = (etiqueta: string, valor: boolean, onChange: (val: boolean) => void) => {
        const lbl = document.createElement('label');
        lbl.style.cssText =
          'color:#e6edf3;font:500 .82rem system-ui;display:inline-flex;align-items:center;gap:.35rem;cursor:pointer;background:#21262d;padding:.35rem .65rem;border-radius:6px;border:1px solid #30363d;user-select:none;';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = valor;
        chk.style.cssText = 'cursor:pointer;accent-color:#ff8a00;width:.95rem;height:.95rem;margin:0;';
        chk.onchange = async () => {
          onChange(chk.checked);
          lbl.style.opacity = '0.6';
          try {
            const nuevoDoc = await generarDoc();
            updatePdf(nuevoDoc);
          } finally {
            lbl.style.opacity = '1';
          }
        };
        lbl.append(chk, document.createTextNode(etiqueta));
        return lbl;
      };

      if (disp.tieneLogo) {
        toolbar.appendChild(crearCheck('Logo', conLogo, (v) => {
          conLogo = v;
          try { localStorage.setItem('retenciones:imprimirConLogo', String(v)); } catch {}
        }));
      }
      if (disp.tieneFirma) {
        toolbar.appendChild(crearCheck('Firma', conFirma, (v) => {
          conFirma = v;
          try { localStorage.setItem('retenciones:imprimirConFirma', String(v)); } catch {}
        }));
      }
      if (disp.tieneSello) {
        toolbar.appendChild(crearCheck('Sello', conSello, (v) => {
          conSello = v;
          try { localStorage.setItem('retenciones:imprimirConSello', String(v)); } catch {}
        }));
      }
      toolbar.appendChild(crearCheck('QR Fiscal', conQr, (v) => {
        conQr = v;
        try { localStorage.setItem('retenciones:imprimirConQr', String(v)); } catch {}
      }));

      container.appendChild(toolbar);

      const firstBtn = bar.querySelector('button');
      if (firstBtn) bar.insertBefore(container, firstBtn);
      else bar.appendChild(container);
    },
  });
}
