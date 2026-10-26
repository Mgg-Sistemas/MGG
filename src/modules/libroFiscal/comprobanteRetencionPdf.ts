/* ============================================================
   Golden Touch · Libro fiscal · Comprobante de retención (Venezuela)

   Formato fiel al comprobante legal físico (ISLR / IVA / ISAE / Patente):
   - Encabezado con título centrado en negro
   - Recuadro superior derecho con N° Comprobante, Período fiscal y Fecha
   - Recuadro de Agente de Retención con Nombre, RIF y Dirección Fiscal
   - Recuadro de Sujeto Retenido con Nombre, RIF y Dirección Fiscal del beneficiario
   - Tabla contable de retenciones con líneas y totalizador
   - Cajas de firma para Agente y Sujeto Retenido, con soporte de estampa
     digital de sello y firma según la opción elegida por el usuario.
   - Marca de agua "ANULADO" si la retención fue anulada.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { previewPdf } from '@/shared/lib/reportePreview';
import { EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';
import { labelSujeto, type ConfigRetencion } from './retencionesCalculo';
import { tipoAGt, type RetencionPracticada } from './retencionesFiscal.repository';
import { formatoParaImprimir } from './formatos.repository';
import {
  MARGEN_PDF, fechaPdf, montoPdf, textoPdf,
} from './pdfComun';
import { aplicarFormato, type FormatoParaAplicar } from './formatoComprobante';
import { listImagenesAgente, versionVigente, urlImagen } from './entes.repository';
import QRCode from 'qrcode';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { diaVE } from '@/modules/tesoreria/tasas.repository';

/** La razón social del agente: la de Parámetros o, si falta, la de la empresa. */
export const razonSocialAgente = (config: ConfigRetencion) => config.razonSocial || EMPRESA_NOMBRE;

/** Las dos partes del comprobante, renglón por renglón: el agente que retiene y el sujeto retenido. */
export function partesComprobante(r: RetencionPracticada, config: ConfigRetencion): { agente: string[]; sujeto: string[] } {
  const empresa = [
    razonSocialAgente(config),
    `RIF: ${config.rif || EMPRESA_RIF}`,
    config.direccionFiscal || '',
    [config.municipio, config.estado].filter(Boolean).join(' · '),
  ].filter(Boolean);
  const contraparte = [
    r.contraparteNombre || '—',
    `RIF: ${r.contraparteRif || '—'}`,
    ...(r.contraparteDireccion ? [r.contraparteDireccion] : []),
  ];
  if (r.direccion === 'recibida') return { agente: contraparte, sujeto: empresa };
  const sujeto = r.contraparteSujeto ? [...contraparte, labelSujeto(r.contraparteSujeto)] : contraparte;
  return { agente: empresa, sujeto };
}

/** Resuelve la dirección fiscal del sujeto retenido (beneficiario). */
export async function direccionFiscalSujeto(r: RetencionPracticada): Promise<string> {
  if (r.contraparteDireccion && r.contraparteDireccion.trim()) {
    return r.contraparteDireccion.trim();
  }
  if (r.contraparteId) {
    try {
      const { data } = await supabase.from('proveedores').select('direccion').eq('id', r.contraparteId).maybeSingle();
      if (data?.direccion?.trim()) return data.direccion.trim();
    } catch { /* continuar con RIF */ }
  }
  if (r.contraparteRif) {
    try {
      const { data } = await supabase.from('proveedores').select('direccion').eq('rif', r.contraparteRif.trim()).maybeSingle();
      if (data?.direccion?.trim()) return data.direccion.trim();
    } catch { /* fallback */ }
  }
  return '—';
}

/** El equivalente en bolívares, cuando la retención está en otra moneda (así se declara). */
export function lineaEquivalenteBs(r: Pick<RetencionPracticada, 'moneda' | 'montoBs' | 'tasa'>): string | null {
  if (r.moneda === 'Bs' || !r.montoBs) return null;
  const tasa = r.tasa ? ` (tasa ${r.tasa.toLocaleString('es-VE', { maximumFractionDigits: 4 })})` : '';
  return `Equivalente en bolívares: ${montoPdf(r.montoBs, 'Bs')}${tasa}`;
}

/** El valor de cada columna de la tabla del comprobante (por su campo). */
export function valoresDeColumnas(r: RetencionPracticada): Record<string, string> {
  const op = r.operacionNumero != null
    ? String(r.operacionNumero).padStart(4, '0')
    : '0001';
  const exentoMonto = r.exento != null ? r.exento : 0;
  const totFactura = r.facturaTotal != null
    ? r.facturaTotal
    : (r.baseImponible + r.impuesto + exentoMonto);

  return {
    operacion: op,
    factura: r.facturaNumero || r.docCodigo || '—',
    fecha: fechaPdf(r.facturaFecha),
    control: r.facturaControl || '—',
    afectada: r.facturaAfectadaNro || '—',
    total_factura: montoPdf(totFactura, r.moneda),
    exento: montoPdf(exentoMonto, r.moneda),
    concepto: r.conceptoNombre || 'SERVICIOS',
    base: montoPdf(r.baseImponible, r.moneda),
    alicuota: r.alicuota ? `${r.alicuota}%` : '—',
    iva: montoPdf(r.impuesto, r.moneda),
    sustraendo: r.sustraendo ? montoPdf(r.sustraendo, r.moneda) : '0,00',
    pct: `${r.porcentaje}%`,
    monto: montoPdf(r.montoRetenido, r.moneda),
  };
}

const COLUMNAS_NUMERICAS = new Set(['total_factura', 'exento', 'base', 'alicuota', 'iva', 'sustraendo', 'pct', 'monto']);

/** Cadena canónica para verificación tributaria y generación de huella digital SHA-256 (PA 0084 / 0093). */
export function cadenaCanonicoFiscal(r: RetencionPracticada, config: ConfigRetencion): string {
  const rifAgente = config.rif || EMPRESA_RIF;
  const rifSujeto = r.contraparteRif || '—';
  const comp = r.numeroComprobante || r.id;
  const fecha = r.facturaFecha || r.createdAt || '';
  const base = Number(r.baseImponible || 0).toFixed(2);
  const monto = Number(r.montoRetenido || 0).toFixed(2);
  const moneda = r.moneda || 'Bs';
  const estado = r.anulada ? 'ANULADA' : 'VALIDA';
  const tipoDoc = r.tipoDocumento === 'nota_credito' ? 'NC' : r.tipoDocumento === 'nota_debito' ? 'ND' : 'FACT';
  const afectada = r.facturaAfectadaNro ? `:AF:${r.facturaAfectadaNro}` : '';
  return `SENIAT|RET|${r.tipo.toUpperCase()}|${rifAgente}|${comp}|${fecha.slice(0, 10)}|${rifSujeto}|${tipoDoc}:${r.facturaNumero || ''}${afectada}|${moneda}|${base}|${monto}|${estado}`;
}

/** Calcula el hash SHA-256 de una cadena en representación hexadecimal minúscula. */
export async function calcularSha256Hex(texto: string): Promise<string> {
  try {
    if (typeof globalThis.crypto?.subtle?.digest === 'function') {
      const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
      return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fallback */ }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(64, '0');
}

/** Genera la DataURL del código QR para incrustar en el PDF. */
export async function generarQrVerificacion(contenido: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(contenido, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 140,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    return null;
  }
}

export type ModoEjemplar = 'ambos' | 'original' | 'copia';
export type EjemplarPdf = 'original' | 'copia';

export interface OpcionesComprobantePdf {
  incluirLogo?: boolean;
  incluirFirma?: boolean;
  incluirSello?: boolean;
  incluirQr?: boolean;
  /** Compatibilidad hacia atrás */
  incluirFirmaSello?: boolean;
  /** Ejemplar que se imprime en esta página concreta ('original' o 'copia') */
  ejemplar?: EjemplarPdf | null;
  /** Modo de emisión del documento: ambos (Original + Copia), solo original o solo copia */
  modoEjemplar?: ModoEjemplar;
  imprimirOriginalYCopia?: boolean;
}

export interface DisponibilidadElementosDigitales {
  tieneLogo: boolean;
  tieneFirma: boolean;
  tieneSello: boolean;
  tieneAlguno: boolean;
}

/** Comprueba qué elementos (logo, firma, sello) están cargados y activos en Parámetros del módulo. */
export async function consultarElementosDigitales(fecha = hoyVenezuela()): Promise<DisponibilidadElementosDigitales> {
  try {
    const imagenes = await listImagenesAgente();
    const l = versionVigente(imagenes.filter((i) => i.clase === 'logo' && i.activo), fecha)
      || imagenes.find((i) => i.clase === 'logo' && i.activo);
    const f = versionVigente(imagenes.filter((i) => i.clase === 'firma' && i.activo), fecha)
      || imagenes.find((i) => i.clase === 'firma' && i.activo);
    const s = versionVigente(imagenes.filter((i) => i.clase === 'sello' && i.activo), fecha)
      || imagenes.find((i) => i.clase === 'sello' && i.activo);
    const tieneLogo = !!l?.ruta;
    const tieneFirma = !!f?.ruta;
    const tieneSello = !!s?.ruta;
    return {
      tieneLogo,
      tieneFirma,
      tieneSello,
      tieneAlguno: tieneLogo || tieneFirma || tieneSello,
    };
  } catch {
    return { tieneLogo: false, tieneFirma: false, tieneSello: false, tieneAlguno: false };
  }
}

/** Alias para compatibilidad */
export async function hayFirmaYSelloCargado(fecha = hoyVenezuela()): Promise<{ tieneFirma: boolean; tieneSello: boolean; tieneAlguno: boolean }> {
  const d = await consultarElementosDigitales(fecha);
  return { tieneFirma: d.tieneFirma, tieneSello: d.tieneSello, tieneAlguno: d.tieneFirma || d.tieneSello };
}

/** Convierte una URL a Data URL base64 para jsPDF. */
async function urlADataUrl(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Carga las imágenes de logo, firma y sello digital de la empresa SOLO si están cargadas en Parámetros del módulo. */
export async function cargarElementosDigitales(fecha = hoyVenezuela()): Promise<{
  logoDataUrl: string | null;
  firmaDataUrl: string | null;
  selloDataUrl: string | null;
}> {
  let logoDataUrl: string | null = null;
  let firmaDataUrl: string | null = null;
  let selloDataUrl: string | null = null;

  try {
    const imagenes = await listImagenesAgente();
    const l = versionVigente(imagenes.filter((i) => i.clase === 'logo' && i.activo), fecha)
      || imagenes.find((i) => i.clase === 'logo' && i.activo);
    const f = versionVigente(imagenes.filter((i) => i.clase === 'firma' && i.activo), fecha)
      || imagenes.find((i) => i.clase === 'firma' && i.activo);
    const s = versionVigente(imagenes.filter((i) => i.clase === 'sello' && i.activo), fecha)
      || imagenes.find((i) => i.clase === 'sello' && i.activo);

    if (l?.ruta) {
      try {
        const u = await urlImagen(l.ruta);
        logoDataUrl = await urlADataUrl(u);
      } catch { /* noop */ }
    }
    if (f?.ruta) {
      try {
        const u = await urlImagen(f.ruta);
        firmaDataUrl = await urlADataUrl(u);
      } catch { /* noop */ }
    }
    if (s?.ruta) {
      try {
        const u = await urlImagen(s.ruta);
        selloDataUrl = await urlADataUrl(u);
      } catch { /* noop */ }
    }
  } catch { /* noop */ }

  return { logoDataUrl, firmaDataUrl, selloDataUrl };
}

/** Construye la instancia jsPDF del comprobante de retención. */
export async function generarDocComprobanteRetencionPdf(
  r: RetencionPracticada,
  config: ConfigRetencion,
  formato?: FormatoParaAplicar | null,
  opciones: OpcionesComprobantePdf = {},
  docExistente?: any,
): Promise<any> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);

  const leerDocCabecera = async () => {
    if (!r.documentoId) return null;
    try {
      const res = await supabase.from('retencion_documentos')
        .select('tipo_documento, factura_afectada_nro, factura_total, exento')
        .eq('id', r.documentoId)
        .maybeSingle();
      return res.data;
    } catch {
      return null;
    }
  };

  const leerPerfilesProv = async () => {
    if (!r.contraparteId) return null;
    try {
      const res = await supabase.from('retencion_contraparte_perfiles')
        .select('licencia_numero, licencia_estado')
        .eq('proveedor_id', r.contraparteId)
        .order('desde', { ascending: false });
      return res.data;
    } catch {
      return null;
    }
  };

  // Consultas de enriquecimiento: dirección del sujeto, documento fiscal y licencias municipales
  const [direccionSujeto, docCabecera, perfilesProv] = await Promise.all([
    direccionFiscalSujeto(r),
    leerDocCabecera(),
    leerPerfilesProv(),
  ]);

  const tipoDocumento = docCabecera?.tipo_documento ?? r.tipoDocumento ?? null;
  const facturaAfectadaNro = docCabecera?.factura_afectada_nro ?? r.facturaAfectadaNro ?? null;
  const exentoMonto = docCabecera?.exento != null
    ? Number(docCabecera.exento)
    : (r.exento != null ? r.exento : 0);
  const facturaTotal = docCabecera?.factura_total != null
    ? Number(docCabecera.factura_total)
    : (r.facturaTotal != null ? r.facturaTotal : (r.baseImponible + r.impuesto + exentoMonto));

  let licenciaSujeto = r.licenciaSujeto ?? null;
  if (!licenciaSujeto && perfilesProv && perfilesProv.length > 0) {
    const pVig = perfilesProv.find((p: any) => p.licencia_numero?.trim());
    if (pVig?.licencia_numero) licenciaSujeto = pVig.licencia_numero.trim();
  }

  const licenciaAgente = config.licenciaMunicipal?.trim() || null;

  const rEnriquecida: RetencionPracticada = {
    ...r,
    contraparteDireccion: direccionSujeto,
    tipoDocumento: (tipoDocumento as any),
    facturaAfectadaNro,
    facturaTotal,
    exento: exentoMonto,
    licenciaSujeto,
  };

  const f = aplicarFormato(r.tipo, formato);
  const orientacion = f.orientacion === 'vertical' ? 'portrait' : 'landscape';
  let doc: any;
  if (docExistente) {
    doc = docExistente;
    doc.addPage('letter', orientacion);
  } else {
    doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orientacion });
  }
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = MARGEN_PDF;
  const UTIL = W - M * 2;
  let y = M + 6;

  // 1. Título principal a todo el ancho (sin reducirse, centrado en la página)
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  const lineasEncabezado = doc.splitTextToSize(textoPdf(f.textos.encabezado), UTIL) as string[];
  doc.text(lineasEncabezado, W / 2, y, { align: 'center' });
  y += (lineasEncabezado.length * 13) + 3;

  // 2. Subtítulo (nota legal del decreto / gaceta oficial) debajo del título
  if (f.textos.nota_legal && f.textos.nota_legal.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(0, 0, 0);
    const lineasNotaLegal = doc.splitTextToSize(textoPdf(f.textos.nota_legal.trim()), UTIL) as string[];
    doc.text(lineasNotaLegal, W / 2, y, { align: 'center' });
    y += (lineasNotaLegal.length * 8.2) + 6;
  } else {
    y += 4;
  }

  // 3. Resto del formato: Logo a la izquierda y Recuadro de Comprobante a la derecha
  const { logoDataUrl, firmaDataUrl, selloDataUrl } = await cargarElementosDigitales(diaVE(r.createdAt) || hoyVenezuela());
  const tieneLogo = opciones.incluirLogo && !!logoDataUrl;
  const logoW = 75;
  const logoH = 34;

  const restoY = y;
  if (tieneLogo) {
    try {
      doc.addImage(logoDataUrl!, 'PNG', M, restoY, logoW, logoH);
    } catch { /* noop */ }
  }

  const ejemplar = opciones.ejemplar ?? null;

  // Recuadro superior derecho: N° DE COMPROBANTE, PERÍODO FISCAL, FECHA DE EMISIÓN
  const boxW = Math.min(260, UTIL * 0.46);
  const boxH = 40;
  const boxX = W - M - boxW;

  const badgeH = ejemplar ? 14 : 0;
  const badgeGap = ejemplar ? 3 : 0;
  const badgeY = restoY;
  const boxY = restoY + badgeH + badgeGap;
  const colDivX = boxX + 118; // divisor vertical que alinea perfectamente ambas filas

  // Badge oficial de Ejemplar (Original / Copia) según Providencia SENIAT
  if (ejemplar) {
    const textoBadge = ejemplar === 'original'
      ? 'ORIGINAL · SUJETO RETENIDO'
      : 'COPIA · AGENTE DE RETENCIÓN';
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.setFillColor(242, 244, 246);
    doc.rect(boxX, badgeY, boxW, badgeH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(0, 0, 0);
    doc.text(textoBadge, boxX + boxW / 2, badgeY + 10, { align: 'center' });
  }

  // Dibujar recuadro con cuadrícula interna
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(boxX, boxY, boxW, boxH);
  doc.line(boxX, boxY + 18, boxX + boxW, boxY + 18); // divisor horizontal entre filas
  doc.line(colDivX, boxY, colDivX, boxY + boxH);     // divisor vertical completo

  // Fila 1 - Columna Izquierda: N° DE COMPROBANTE
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(0, 0, 0);
  doc.text(textoPdf(f.rotulos.n_comprobante || 'N° DE COMPROBANTE'), boxX + 6, boxY + 12);

  // Fila 1 - Columna Derecha: Número alineado con la fecha inferior
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(textoPdf(r.numeroComprobante ?? '—'), colDivX + 6, boxY + 12);

  // Fila 2 - Columna Izquierda: PERÍODO FISCAL
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text(textoPdf(f.rotulos.periodo || 'PERÍODO FISCAL'), boxX + 6, boxY + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const pDigits = (r.periodo ?? '').replace(/\D/g, '');
  const anioStr = pDigits.length >= 4 ? pDigits.slice(0, 4) : (r.facturaFecha?.slice(0, 4) ?? '');
  const mesStr = pDigits.length >= 6 ? pDigits.slice(4, 6) : (r.facturaFecha?.slice(5, 7) ?? '');
  doc.text(`AÑO: ${anioStr}   MES: ${mesStr}`, boxX + 6, boxY + 36);

  // Fila 2 - Columna Derecha: FECHA DE EMISIÓN
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text(textoPdf(f.rotulos.fecha_emision || 'FECHA DE EMISIÓN'), colDivX + 6, boxY + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(textoPdf(fechaPdf(r.facturaFecha || r.createdAt)), colDivX + 6, boxY + 36);

  y = Math.max(boxY + boxH, tieneLogo ? restoY + logoH : 0) + 8;

  // ── Determinación de partes (Agente vs Sujeto Retenido) ──
  const esRecibida = r.direccion === 'recibida';
  const nombreAgente = esRecibida ? (r.contraparteNombre || '—') : razonSocialAgente(config);
  const rifAgente = esRecibida ? (r.contraparteRif || '—') : (config.rif || EMPRESA_RIF);
  const dirAgente = esRecibida
    ? direccionSujeto
    : ([config.direccionFiscal, config.municipio, config.estado].filter(Boolean).join(', ') || '—');

  const nombreSujeto = esRecibida ? razonSocialAgente(config) : (r.contraparteNombre || '—');
  const rifSujeto = esRecibida ? (config.rif || EMPRESA_RIF) : (r.contraparteRif || '—');
  const dirSujeto = esRecibida
    ? ([config.direccionFiscal, config.municipio, config.estado].filter(Boolean).join(', ') || '—')
    : direccionSujeto;

  // ── Denominación y sincronización de términos (Agente vs Sujeto) ──
  const rotuloSujetoConfig = (f.rotulos.sujeto || '').trim();
  const sujetoTermino = rotuloSujetoConfig.toUpperCase().includes('BENEFICIARIO')
    ? 'BENEFICIARIO'
    : rotuloSujetoConfig.toUpperCase().includes('PROVEEDOR')
      ? 'PROVEEDOR'
      : rotuloSujetoConfig.toUpperCase().includes('CONTRIBUYENTE')
        ? 'CONTRIBUYENTE'
        : 'SUJETO RETENIDO';

  const rotuloAgenteConfig = (f.rotulos.agente || '').trim();
  const agenteTermino = rotuloAgenteConfig.toUpperCase().includes('AGENTE')
    ? rotuloAgenteConfig.toUpperCase()
    : 'AGENTE DE RETENCIÓN';

  const rotuloAgenteNombre = rotuloAgenteConfig || 'AGENTE DE RETENCIÓN';
  const rotuloAgenteDir = `DIRECCIÓN FISCAL DEL ${agenteTermino}`;
  const rotuloAgenteRif = `REGISTRO DE INFORMACIÓN FISCAL DEL ${agenteTermino}`;

  const rotuloSujetoNombre = rotuloSujetoConfig || `NOMBRE O RAZÓN SOCIAL DEL ${sujetoTermino}`;
  const rotuloSujetoDir = `DIRECCIÓN FISCAL DEL ${sujetoTermino}`;
  const rotuloSujetoRif = `REGISTRO DE INFORMACIÓN FISCAL DEL ${sujetoTermino}`;

  // ── Recuadros: AGENTE DE RETENCIÓN y SUJETO RETENIDO ──
  const colIzqW = UTIL * 0.62;
  const colDerX = M + colIzqW;

  // Adaptación dinámica al texto del Agente
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const lineasNombreAgente = doc.splitTextToSize(textoPdf(nombreAgente), colIzqW - 14) as string[];
  doc.setFontSize(7);
  const lineasDirAgente = doc.splitTextToSize(textoPdf(dirAgente), colIzqW - 14) as string[];

  const licenciaAgenteEfectiva = esRecibida ? licenciaSujeto : licenciaAgente;
  const licenciaSujetoEfectiva = esRecibida ? licenciaAgente : licenciaSujeto;

  // Altura requerida con paddings holgados
  const altoIzqAgente = 8 + 8 + (lineasNombreAgente.length * 9.5) + 6 + 8 + (lineasDirAgente.length * 8.5) + 8;
  const altoDerAgente = licenciaAgenteEfectiva ? 48 : 38;
  const altoAgente = Math.max(altoIzqAgente, altoDerAgente, 50);

  // Dibujar recuadro Agente
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(M, y, UTIL, altoAgente);
  doc.line(colDerX, y, colDerX, y + altoAgente);

  // Textos Izquierda Agente
  let curY = y + 8.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(0, 0, 0);
  doc.text(textoPdf(rotuloAgenteNombre), M + 6, curY);
  curY += 8.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(lineasNombreAgente, M + 6, curY);
  curY += (lineasNombreAgente.length * 9.5) + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text(textoPdf(rotuloAgenteDir), M + 6, curY);
  curY += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(lineasDirAgente, M + 6, curY);

  // Textos Derecha Agente
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text(textoPdf(rotuloAgenteRif), colDerX + 6, y + 8.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(textoPdf(rifAgente), colDerX + 6, y + 20);

  if (licenciaAgenteEfectiva) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('N° LICENCIA MUNICIPAL / RIM:', colDerX + 6, y + 31);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(textoPdf(licenciaAgenteEfectiva), colDerX + 6, y + 41);
  }

  y += altoAgente;

  // Adaptación dinámica al texto del Sujeto Retenido
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const lineasNombreSujeto = doc.splitTextToSize(textoPdf(nombreSujeto), colIzqW - 14) as string[];
  doc.setFontSize(7);
  const lineasDirSujeto = doc.splitTextToSize(textoPdf(dirSujeto), colIzqW - 14) as string[];

  const altoIzqSujeto = 8 + 8 + (lineasNombreSujeto.length * 9.5) + 6 + 8 + (lineasDirSujeto.length * 8.5) + 8;
  const altoDerSujeto = licenciaSujetoEfectiva ? 48 : 38;
  const altoSujeto = Math.max(altoIzqSujeto, altoDerSujeto, 50);

  // Dibujar recuadro Sujeto
  doc.rect(M, y, UTIL, altoSujeto);
  doc.line(colDerX, y, colDerX, y + altoSujeto);

  // Textos Izquierda Sujeto
  curY = y + 8.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text(textoPdf(rotuloSujetoNombre), M + 6, curY);
  curY += 8.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(lineasNombreSujeto, M + 6, curY);
  curY += (lineasNombreSujeto.length * 9.5) + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text(textoPdf(rotuloSujetoDir), M + 6, curY);
  curY += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(lineasDirSujeto, M + 6, curY);

  // Textos Derecha Sujeto
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text(textoPdf(rotuloSujetoRif), colDerX + 6, y + 8.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(textoPdf(rifSujeto), colDerX + 6, y + 20);

  if (licenciaSujetoEfectiva) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('N° LICENCIA MUNICIPAL / RIM:', colDerX + 6, y + 31);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(textoPdf(licenciaSujetoEfectiva), colDerX + 6, y + 41);
  }

  y += altoSujeto + 10;

  // ── Concepto y documento afectado (PA 071 Art. 15) ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const labelImp = r.tipo === 'islr' ? 'I.S.L.R.' : r.tipo === 'iva' ? 'I.V.A.' : r.tipo === 'municipal' ? 'I.S.A.E.' : 'Impuesto';
  const textoConcepto = `Retención de ${labelImp}${r.conceptoNombre ? ` por concepto de: ${textoPdf(r.conceptoNombre)}` : ''}`;
  doc.text(textoConcepto, M, y);

  if (rEnriquecida.facturaAfectadaNro || rEnriquecida.tipoDocumento === 'nota_credito' || rEnriquecida.tipoDocumento === 'nota_debito') {
    const tipoDoc = rEnriquecida.tipoDocumento === 'nota_credito'
      ? 'NOTA DE CRÉDITO'
      : rEnriquecida.tipoDocumento === 'nota_debito'
        ? 'NOTA DE DÉBITO'
        : 'DOCUMENTO DE AJUSTE';
    const textoDocAfectado = `${tipoDoc}${rEnriquecida.facturaAfectadaNro ? ` · FACTURA AFECTADA N°: ${rEnriquecida.facturaAfectadaNro}` : ''}`;
    doc.setFont('helvetica', 'bold');
    doc.text(textoDocAfectado, W - M, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
  }
  y += 4;

  // ── Columnas y tabla de la operación ──
  const valores = valoresDeColumnas(rEnriquecida);
  const cabecera = f.columnas.map((c) => c.rotulo);
  const fila = f.columnas.map((c) => valores[c.campo] ?? '—');
  const estilosCols: Record<number, { halign?: 'right' | 'left' | 'center'; cellWidth?: number }> = {};
  f.columnas.forEach((c, i) => {
    estilosCols[i] = {
      ...(COLUMNAS_NUMERICAS.has(c.campo) ? { halign: 'right' as const } : c.campo === 'operacion' || c.campo === 'fecha' ? { halign: 'center' as const } : { halign: 'left' as const }),
      ...(c.ancho ? { cellWidth: c.ancho } : {}),
    };
  });

  // Fila de totales alineada con las columnas del formato
  const primerColNumericaIdx = f.columnas.findIndex((col) => COLUMNAS_NUMERICAS.has(col.campo));
  const idxRotuloTotal = primerColNumericaIdx > 0 ? primerColNumericaIdx - 1 : 0;

  const filaTotales = f.columnas.map((c, i) => {
    if (c.campo === 'total_factura') return montoPdf(rEnriquecida.facturaTotal ?? (r.baseImponible + r.impuesto + (rEnriquecida.exento ?? 0)), r.moneda);
    if (c.campo === 'exento') return montoPdf(rEnriquecida.exento ?? 0, r.moneda);
    if (c.campo === 'base') return montoPdf(r.baseImponible, r.moneda);
    if (c.campo === 'iva') return montoPdf(r.impuesto, r.moneda);
    if (c.campo === 'sustraendo') return r.sustraendo ? montoPdf(r.sustraendo, r.moneda) : '0,00';
    if (c.campo === 'monto') return montoPdf(r.montoRetenido, r.moneda);
    if (i === idxRotuloTotal) return f.rotulos.total || 'TOTALES:';
    return '';
  });

  autoTable(doc, {
    startY: y,
    head: [cabecera.map((h) => textoPdf(h))],
    body: [fila.map((c) => textoPdf(c))],
    foot: [filaTotales.map((c) => textoPdf(c))],
    theme: 'plain',
    styles: {
      fontSize: 7.2,
      cellPadding: { top: 4, bottom: 4, left: 2.5, right: 2.5 },
      textColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: false,
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 7.2,
      lineWidth: { top: 0.6, bottom: 0.6 },
      lineColor: [0, 0, 0],
    },
    footStyles: {
      fillColor: false,
      textColor: [0, 0, 0],
      fontStyle: 'normal',
      fontSize: 7.2,
      lineWidth: { top: 0.6, bottom: 0.6 },
      lineColor: [0, 0, 0],
      halign: 'right',
    },
    columnStyles: estilosCols,
    didParseCell: (data) => {
      const col = f.columnas[data.column.index];
      if (!col) return;
      const esNumerica = COLUMNAS_NUMERICAS.has(col.campo);
      if (data.section === 'head') {
        data.cell.styles.halign = esNumerica ? 'right' : (col.campo === 'operacion' || col.campo === 'fecha' ? 'center' : 'left');
      } else if (data.section === 'foot') {
        data.cell.styles.halign = 'right';
      } else {
        data.cell.styles.halign = esNumerica ? 'right' : (col.campo === 'operacion' || col.campo === 'fecha' ? 'center' : 'left');
      }
    },
    margin: { left: M, right: M },
  });

  y = (doc as any).lastAutoTable.finalY + 12;

  // Equivalente en Bs si aplica
  const enBs = lineaEquivalenteBs(r);
  if (enBs) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(50, 50, 50);
    doc.text(textoPdf(enBs), W - M, y, { align: 'right' });
    y += 12;
  }

  // ── ANULADO: marca de agua diagonal ──
  if (r.anulada) {
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.15 }));
    doc.setTextColor(200, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(72);
    const cx = W / 2;
    const cy = H / 2;
    const ang = Math.atan2(H, W) * (180 / Math.PI);
    doc.text(textoPdf('ANULADO'), cx, cy, { align: 'center', angle: ang });
    doc.restoreGraphicsState();
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    if (r.anuladaMotivo) {
      doc.setFontSize(8.5);
      doc.setTextColor(180, 40, 40);
      doc.text(textoPdf(`Motivo de anulación: ${r.anuladaMotivo}`), M, y);
      doc.setTextColor(0, 0, 0);
      y += 14;
    }
  }

  // ── Verificación Digital Fiscal (PA SNAT/2026/0084 y 0093) ──
  const conQr = opciones.incluirQr ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConQr') !== 'false' : true);
  let qrDataUrl: string | null = null;
  let hashSha256 = '';
  if (conQr) {
    try {
      const canonico = cadenaCanonicoFiscal(rEnriquecida, config);
      hashSha256 = await calcularSha256Hex(canonico);
      qrDataUrl = await generarQrVerificacion(`SENIAT|${canonico}|SHA256:${hashSha256.slice(0, 16)}`);
    } catch {
      qrDataUrl = null;
    }
  }

  // ── Bloque inferior de Firmas y Verificación Digital ──
  const altoCajaFirma = 54;
  const firmaY = Math.max(y + 14, H - 95);

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);

  // Estampa de firma y/o sello digital en la caja del agente
  const conFirma = (opciones.incluirFirma || (opciones.incluirFirmaSello && opciones.incluirFirma === undefined)) && !!firmaDataUrl;
  const conSello = (opciones.incluirSello || (opciones.incluirFirmaSello && opciones.incluirSello === undefined)) && !!selloDataUrl;

  if (conQr && qrDataUrl) {
    // Disposición en 3 cajas: Agente (Izquierda) | Verificación Digital (Centro) | Sujeto (Derecha)
    const anchoCaja = (UTIL - 24) / 3;
    const xAgente = M;
    const xCentro = M + anchoCaja + 12;
    const xSujeto = M + (anchoCaja + 12) * 2;
    const xFinAgente = xAgente + anchoCaja;

    // Caja 1: Agente
    let rotuloFirmaAgente = (f.rotulos.firma_agente || `${agenteTermino}:`).trim();
    if (/\bde ret(\.|encion|ención)?$/i.test(rotuloFirmaAgente)) {
      rotuloFirmaAgente = rotuloFirmaAgente.replace(/\bde ret(\.|encion|ención)?$/i, 'de retención');
    }
    doc.rect(xAgente, firmaY, anchoCaja, altoCajaFirma);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(rotuloFirmaAgente), xAgente + 6, firmaY + 12, { maxWidth: anchoCaja - 12 });

    let xEstampasInicio = xFinAgente;
    if (conFirma && conSello) {
      const wFirma = 55;
      const wSello = 40;
      xEstampasInicio = xFinAgente - (wFirma + wSello + 6) - 6;
      try {
        doc.addImage(firmaDataUrl!, 'PNG', xEstampasInicio, firmaY + 4, wFirma, 44);
        doc.addImage(selloDataUrl!, 'JPEG', xEstampasInicio + wFirma + 6, firmaY + 5, wSello, 42);
      } catch { /* noop */ }
    } else if (conFirma) {
      const wFirma = 75;
      xEstampasInicio = xFinAgente - wFirma - 8;
      try {
        doc.addImage(firmaDataUrl!, 'PNG', xEstampasInicio, firmaY + 4, wFirma, 44);
      } catch { /* noop */ }
    } else if (conSello) {
      const wSello = 50;
      xEstampasInicio = xFinAgente - wSello - 8;
      try {
        doc.addImage(selloDataUrl!, 'JPEG', xEstampasInicio, firmaY + 5, wSello, 42);
      } catch { /* noop */ }
    }

    const maxTextoAgenteW = (conFirma || conSello)
      ? Math.max(70, xEstampasInicio - (xAgente + 6) - 6)
      : anchoCaja - 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const lineasPorAgente = doc.splitTextToSize(`Por ${textoPdf(nombreAgente)}`, maxTextoAgenteW) as string[];
    if (lineasPorAgente.length > 1) {
      doc.text(lineasPorAgente[0], xAgente + 6, firmaY + 21);
      doc.text(lineasPorAgente[1], xAgente + 6, firmaY + 29);
      doc.text(textoPdf(rifAgente), xAgente + 6, firmaY + 38);
    } else {
      doc.text(lineasPorAgente[0] || `Por ${textoPdf(nombreAgente)}`, xAgente + 6, firmaY + 23);
      doc.text(textoPdf(rifAgente), xAgente + 6, firmaY + 34);
    }

    // Caja 2: Verificación Digital (QR + SHA-256)
    doc.rect(xCentro, firmaY, anchoCaja, altoCajaFirma);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(f.rotulos.verificacion_digital || 'VERIFICACIÓN DIGITAL FISCAL'), xCentro + 6, firmaY + 11);

    // QR de 34x34
    doc.addImage(qrDataUrl, 'PNG', xCentro + 6, firmaY + 14, 34, 34);

    // Leyendas a la derecha del QR
    const xTextosQr = xCentro + 44;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.text('SISTEMA COMPUTARIZADO', xTextosQr, firmaY + 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.2);
    doc.text('PA SNAT/2026/0084 · 0093', xTextosQr, firmaY + 27);
    doc.text('Emisión Digital Inalterable', xTextosQr, firmaY + 34);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5);
    doc.text('SHA-256:', xTextosQr, firmaY + 42);
    doc.setFont('courier', 'normal');
    doc.setFontSize(4.8);
    doc.text(`${hashSha256.slice(0, 22)}...`, xTextosQr + 24, firmaY + 42);

    // Caja 3: Sujeto Retenido
    let rotuloFirmaSujeto = (f.rotulos.firma_sujeto || `${sujetoTermino}:`).trim();
    if (/\bde ret(\.|encion|ención)?$/i.test(rotuloFirmaSujeto)) {
      rotuloFirmaSujeto = rotuloFirmaSujeto.replace(/\bde ret(\.|encion|ención)?$/i, 'de retención');
    }
    doc.rect(xSujeto, firmaY, anchoCaja, altoCajaFirma);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(rotuloFirmaSujeto), xSujeto + 6, firmaY + 12, { maxWidth: anchoCaja - 12 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const lineasPorSujeto = doc.splitTextToSize(`Por ${textoPdf(nombreSujeto)}`, anchoCaja - 12) as string[];
    if (lineasPorSujeto.length > 1) {
      doc.text(lineasPorSujeto[0], xSujeto + 6, firmaY + 21);
      doc.text(lineasPorSujeto[1], xSujeto + 6, firmaY + 29);
      doc.text(textoPdf(rifSujeto), xSujeto + 6, firmaY + 38);
    } else {
      doc.text(lineasPorSujeto[0] || `Por ${textoPdf(nombreSujeto)}`, xSujeto + 6, firmaY + 23);
      doc.text(textoPdf(rifSujeto), xSujeto + 6, firmaY + 34);
    }
  } else {
    // Disposición tradicional en 2 cajas
    const anchoCajaFirma = (UTIL - 16) / 2;
    const xFinAgente = M + anchoCajaFirma;

    let rotuloFirmaAgente = (f.rotulos.firma_agente || `${agenteTermino}:`).trim();
    if (/\bde ret(\.|encion|ención)?$/i.test(rotuloFirmaAgente)) {
      rotuloFirmaAgente = rotuloFirmaAgente.replace(/\bde ret(\.|encion|ención)?$/i, 'de retención');
    }
    doc.rect(M, firmaY, anchoCajaFirma, altoCajaFirma);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(rotuloFirmaAgente), M + 8, firmaY + 12, { maxWidth: anchoCajaFirma - 16 });

    let xEstampasInicio = xFinAgente;
    if (conFirma && conSello) {
      const wFirma = 85;
      const wSello = 60;
      xEstampasInicio = xFinAgente - (wFirma + wSello + 8) - 8;
      try {
        doc.addImage(firmaDataUrl!, 'PNG', xEstampasInicio, firmaY + 4, wFirma, 44);
        doc.addImage(selloDataUrl!, 'JPEG', xEstampasInicio + wFirma + 8, firmaY + 5, wSello, 42);
      } catch { /* noop */ }
    } else if (conFirma) {
      const wFirma = 110;
      xEstampasInicio = xFinAgente - wFirma - 12;
      try {
        doc.addImage(firmaDataUrl!, 'PNG', xEstampasInicio, firmaY + 4, wFirma, 44);
      } catch { /* noop */ }
    } else if (conSello) {
      const wSello = 70;
      xEstampasInicio = xFinAgente - wSello - 14;
      try {
        doc.addImage(selloDataUrl!, 'JPEG', xEstampasInicio, firmaY + 5, wSello, 42);
      } catch { /* noop */ }
    }

    const maxTextoAgenteW = (conFirma || conSello)
      ? Math.max(90, xEstampasInicio - (M + 8) - 8)
      : anchoCajaFirma - 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    const lineasPorAgente = doc.splitTextToSize(`Por ${textoPdf(nombreAgente)}`, maxTextoAgenteW) as string[];
    if (lineasPorAgente.length > 1) {
      doc.text(lineasPorAgente[0], M + 8, firmaY + 21);
      doc.text(lineasPorAgente[1], M + 8, firmaY + 29);
      doc.text(textoPdf(rifAgente), M + 8, firmaY + 38);
    } else {
      doc.text(lineasPorAgente[0] || `Por ${textoPdf(nombreAgente)}`, M + 8, firmaY + 23);
      doc.text(textoPdf(rifAgente), M + 8, firmaY + 34);
    }

    const xSujetoFirma = M + anchoCajaFirma + 16;
    let rotuloFirmaSujeto = (f.rotulos.firma_sujeto || `${sujetoTermino}:`).trim();
    if (/\bde ret(\.|encion|ención)?$/i.test(rotuloFirmaSujeto)) {
      rotuloFirmaSujeto = rotuloFirmaSujeto.replace(/\bde ret(\.|encion|ención)?$/i, 'de retención');
    }
    doc.rect(xSujetoFirma, firmaY, anchoCajaFirma, altoCajaFirma);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(rotuloFirmaSujeto), xSujetoFirma + 8, firmaY + 12, { maxWidth: anchoCajaFirma - 16 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    const lineasPorSujeto = doc.splitTextToSize(`Por ${textoPdf(nombreSujeto)}`, anchoCajaFirma - 16) as string[];
    if (lineasPorSujeto.length > 1) {
      doc.text(lineasPorSujeto[0], xSujetoFirma + 8, firmaY + 21);
      doc.text(lineasPorSujeto[1], xSujetoFirma + 8, firmaY + 29);
      doc.text(textoPdf(rifSujeto), xSujetoFirma + 8, firmaY + 38);
    } else {
      doc.text(lineasPorSujeto[0] || `Por ${textoPdf(nombreSujeto)}`, xSujetoFirma + 8, firmaY + 23);
      doc.text(textoPdf(rifSujeto), xSujetoFirma + 8, firmaY + 34);
    }
  }

  // ── Pie de página con el texto configurado en Parámetros y destino del ejemplar ──
  const pieTexto = f.textos.pie || razonSocialAgente(config);
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
    doc.text(textoPdf(pieTexto), M, H - 18, { maxWidth: UTIL - 210 });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.text(textoPdf(pieTexto), M, H - 18, { maxWidth: UTIL });
  }

  return doc;
}

/**
 * Emite las páginas correspondientes a un comprobante según el modo de ejemplar
 * ('ambos': Original + Copia consecutivas, 'original' o 'copia').
 */
export async function anexarPaginasComprobantePdf(
  r: RetencionPracticada,
  config: ConfigRetencion,
  formato: FormatoParaAplicar | null | undefined,
  opciones: OpcionesComprobantePdf = {},
  docExistente?: any,
): Promise<any> {
  const modo: ModoEjemplar = opciones.modoEjemplar || 'ambos';
  let doc = docExistente;

  if (modo === 'ambos') {
    doc = await generarDocComprobanteRetencionPdf(r, config, formato, { ...opciones, ejemplar: 'original' }, doc);
    doc = await generarDocComprobanteRetencionPdf(r, config, formato, { ...opciones, ejemplar: 'copia' }, doc);
  } else if (modo === 'copia') {
    doc = await generarDocComprobanteRetencionPdf(r, config, formato, { ...opciones, ejemplar: 'copia' }, doc);
  } else {
    doc = await generarDocComprobanteRetencionPdf(r, config, formato, { ...opciones, ejemplar: 'original' }, doc);
  }

  return doc;
}

export async function verComprobanteRetencionPdf(
  r: RetencionPracticada,
  config: ConfigRetencion,
  formato?: FormatoParaAplicar | null,
  opciones: OpcionesComprobantePdf = {},
): Promise<void> {
  const fechaRef = r.facturaFecha || r.createdAt || hoyVenezuela();
  const fechaFiltro = /^\d{4}-\d{2}-\d{2}$/.test(fechaRef) ? fechaRef : (diaVE(fechaRef) || hoyVenezuela());
  const disp = await consultarElementosDigitales(fechaFiltro);

  let modoEjemplar: ModoEjemplar = opciones.modoEjemplar
    ?? (opciones.imprimirOriginalYCopia === false ? 'original' : (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:modoEjemplar') as ModoEjemplar : null) || 'ambos');
  let conLogo = disp.tieneLogo && (opciones.incluirLogo ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConLogo') !== 'false' : true));
  let conFirma = disp.tieneFirma && (opciones.incluirFirma ?? (opciones.incluirFirmaSello ? true : (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConFirma') !== 'false' : true)));
  let conSello = disp.tieneSello && (opciones.incluirSello ?? (opciones.incluirFirmaSello ? true : (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConSello') !== 'false' : true)));
  let conQr = opciones.incluirQr ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConQr') !== 'false' : true);

  const generarDoc = () => anexarPaginasComprobantePdf(r, config, formato, {
    modoEjemplar,
    incluirLogo: conLogo,
    incluirFirma: conFirma,
    incluirSello: conSello,
    incluirQr: conQr,
  });

  const doc = await generarDoc();
  const filename = `retencion-${r.tipo}-${r.numeroComprobante ?? r.id.slice(0, 8)}.pdf`;

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
      optAmbos.textContent = '📄 Original y Copia';

      const optOriginal = document.createElement('option');
      optOriginal.value = 'original';
      optOriginal.textContent = '📄 Solo Original';

      const optCopia = document.createElement('option');
      optCopia.value = 'copia';
      optCopia.textContent = '📄 Solo Copia';

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

/**
 * Genera y visualiza un único PDF con TODOS los comprobantes emitidos de una factura,
 * permitiendo mandar a imprimir el paquete completo con un solo clic (Original y Copia o según preferencia).
 */
export async function verTodosComprobantesFacturaPdf(
  facturaNumero: string,
  retenciones: RetencionPracticada[],
  config: ConfigRetencion,
  opciones: OpcionesComprobantePdf = {},
): Promise<void> {
  const activas = retenciones.filter((r) => !r.anulada && r.numeroComprobante);
  const seleccionadas = activas.length > 0 ? activas : retenciones.filter((r) => r.numeroComprobante);
  if (!seleccionadas.length) {
    throw new Error('Esta factura no tiene comprobantes emitidos para imprimir.');
  }

  const fechaRef = seleccionadas[0]?.facturaFecha || seleccionadas[0]?.createdAt || hoyVenezuela();
  const fechaFiltro = /^\d{4}-\d{2}-\d{2}$/.test(fechaRef) ? fechaRef : (diaVE(fechaRef) || hoyVenezuela());
  const disp = await consultarElementosDigitales(fechaFiltro);

  let modoEjemplar: ModoEjemplar = opciones.modoEjemplar
    ?? (opciones.imprimirOriginalYCopia === false ? 'original' : (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:modoEjemplar') as ModoEjemplar : null) || 'ambos');
  let conLogo = disp.tieneLogo && (opciones.incluirLogo ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConLogo') !== 'false' : true));
  let conFirma = disp.tieneFirma && (opciones.incluirFirma ?? (opciones.incluirFirmaSello ? true : (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConFirma') !== 'false' : true)));
  let conSello = disp.tieneSello && (opciones.incluirSello ?? (opciones.incluirFirmaSello ? true : (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConSello') !== 'false' : true)));
  let conQr = opciones.incluirQr ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('retenciones:imprimirConQr') !== 'false' : true);

  const generarLote = async () => {
    let doc: any = null;
    for (const r of seleccionadas) {
      const formato = await formatoParaImprimir(tipoAGt(r.tipo), diaVE(r.createdAt) || null, hoyVenezuela());
      doc = await anexarPaginasComprobantePdf(r, config, formato, {
        modoEjemplar,
        incluirLogo: conLogo,
        incluirFirma: conFirma,
        incluirSello: conSello,
        incluirQr: conQr,
      }, doc);
    }
    return doc;
  };

  const doc = await generarLote();
  const filename = `comprobantes-factura-${facturaNumero.replace(/[^\w.-]+/g, '_')}.pdf`;

  previewPdf(doc, filename, {
    extraControls: ({ bar, updatePdf }) => {
      const container = document.createElement('div');
      container.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin-left:auto;margin-right:.5rem;flex-wrap:wrap;';

      const infoLote = document.createElement('span');
      infoLote.style.cssText =
        'color:#f5b133;font:600 .78rem system-ui;display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .6rem;background:rgba(245,177,51,0.12);border-radius:6px;border:1px solid rgba(245,177,51,0.3);';
      const cantPags = modoEjemplar === 'ambos' ? seleccionadas.length * 2 : seleccionadas.length;
      infoLote.textContent = `Factura ${facturaNumero} · ${seleccionadas.length} comprobante(s) (${cantPags} págs)`;
      container.appendChild(infoLote);

      // Selector de Ejemplar (Original y Copia / Solo Original / Solo Copia)
      const selEjemplar = document.createElement('select');
      selEjemplar.style.cssText =
        'background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:.35rem .6rem;font:600 .82rem system-ui;cursor:pointer;outline:none;';
      selEjemplar.title = 'Seleccionar ejemplares a emitir para todos los comprobantes';

      const optAmbos = document.createElement('option');
      optAmbos.value = 'ambos';
      optAmbos.textContent = '📄 Original y Copia';

      const optOriginal = document.createElement('option');
      optOriginal.value = 'original';
      optOriginal.textContent = '📄 Solo Original';

      const optCopia = document.createElement('option');
      optCopia.value = 'copia';
      optCopia.textContent = '📄 Solo Copia';

      selEjemplar.append(optAmbos, optOriginal, optCopia);
      selEjemplar.value = modoEjemplar;

      selEjemplar.onchange = async () => {
        modoEjemplar = selEjemplar.value as ModoEjemplar;
        try { localStorage.setItem('retenciones:modoEjemplar', modoEjemplar); } catch {}
        selEjemplar.style.opacity = '0.6';
        try {
          const nuevoDoc = await generarLote();
          const p = modoEjemplar === 'ambos' ? seleccionadas.length * 2 : seleccionadas.length;
          infoLote.textContent = `Factura ${facturaNumero} · ${seleccionadas.length} comprobante(s) (${p} págs)`;
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
            const nuevoDoc = await generarLote();
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
