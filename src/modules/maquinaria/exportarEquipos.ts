/* ============================================================
   Golden Touch · Control de Maquinaria · Descargar datos de Equipos (Excel / PDF)
   (26/10/2026)

   Permite al usuario elegir qué columnas salen (igual que en RRHH):
   - Equipo, Tipo, Empresa/Propietario, Encargado, Estatus, Marca, Modelo,
     Horómetro, Kilometraje, Serial, Placa, Ubicación, Combustible, Mantt.
   - Agrupación por empresa / propietario (secciones separadas con conteos).
   - Filtro por categoría (maquinaria / vehículos / motos / lanchas): el título
     del PDF y del Excel la nombran cuando no es «Todas».
   - Generación de PDF institucional en fichas con foto (logo, naranja, membrete,
     orientación; la foto solo si está marcada «Foto del equipo») y Excel
     profesional con bordes y estilos (ExcelJS).
   ============================================================ */
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { extraerEncargado } from './maquinariaEquipos.repository';
import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { pdfSafe } from '@/shared/lib/pdfSafe';
import { fotosDeEquipos } from './flota.repository';
import { ESTADOS_EQUIPO, estadoEfectivo } from './flota';
import { identidadEmpresa } from '@/shared/lib/empresa';

export interface ContextoEquipoExportar {
  horometro?: number | null;
  kilometraje?: number | null;
  horasFaltantes?: number | null;
  encargado?: string | null;
  avisoServicio?: string | null;
}

export interface CampoEquipo {
  clave: string;
  etiqueta: string;
  ancho: number;
  valor: (e: MaquinariaEquipo, ctx?: ContextoEquipoExportar) => string | number;
}

const txt = (v: string | null | undefined) => (v ?? '').trim();
const fmtNum = (v: number | null | undefined) => (v == null ? '' : Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 }));

export const CAMPOS_EQUIPO: CampoEquipo[] = [
  { clave: 'foto', etiqueta: 'Foto del equipo', ancho: 14, valor: () => ' ' },
  { clave: 'equipo', etiqueta: 'Equipo / Máquina', ancho: 22, valor: (e) => txt(e.equipo) },
  { clave: 'tipo', etiqueta: 'Tipo de equipo', ancho: 16, valor: (e) => txt(e.tipo) || '—' },
  { clave: 'propietario', etiqueta: 'Empresa / Propietario', ancho: 20, valor: (e) => txt(e.propietario) || 'Sin propietario' },
  { clave: 'encargado', etiqueta: 'Encargado responsable', ancho: 20, valor: (e, ctx) => txt(ctx?.encargado ?? extraerEncargado(e)) || '—' },
  { clave: 'status', etiqueta: 'Estatus / Condición', ancho: 14, valor: (e) => txt(e.status).toUpperCase() },
  { clave: 'marca', etiqueta: 'Marca', ancho: 14, valor: (e) => txt(e.marca) || '—' },
  { clave: 'modelo', etiqueta: 'Modelo', ancho: 14, valor: (e) => txt(e.modelo) || '—' },
  { clave: 'anio', etiqueta: 'Año', ancho: 8, valor: (e) => (e.anio ? String(e.anio) : '—') },
  { clave: 'serial', etiqueta: 'Serial / Chasis', ancho: 16, valor: (e) => txt(e.serial) || '—' },
  { clave: 'placa', etiqueta: 'Placa', ancho: 10, valor: (e) => txt(e.placa) || '—' },
  { clave: 'color', etiqueta: 'Color', ancho: 10, valor: (e) => txt(e.color) || '—' },
  { clave: 'ubicacion', etiqueta: 'Ubicación / Garaje', ancho: 16, valor: (e) => txt(e.ubicacion) || '—' },
  { clave: 'combustible', etiqueta: 'Combustible', ancho: 12, valor: (e) => txt(e.combustible) || '—' },
  { clave: 'litros_consume', etiqueta: 'Consumo (L)', ancho: 11, valor: (e) => fmtNum(e.litros_consume) },
  { clave: 'horometro', etiqueta: 'Horómetro actual (h)', ancho: 14, valor: (_e, ctx) => (ctx?.horometro != null ? fmtNum(ctx.horometro) : '—') },
  { clave: 'kilometraje', etiqueta: 'Kilometraje actual (km)', ancho: 14, valor: (_e, ctx) => (ctx?.kilometraje != null ? fmtNum(ctx.kilometraje) : '—') },
  { clave: 'mantenimiento_cada_hrs', etiqueta: 'Mantt. cada (h)', ancho: 12, valor: (e) => fmtNum(e.mantenimiento_cada_hrs) },
  { clave: 'mantenimiento_cada_km', etiqueta: 'Mantt. cada (km)', ancho: 12, valor: (e) => fmtNum(e.mantenimiento_cada_km) },
  { clave: 'combustible_equipo', etiqueta: 'Vinculado a Combustible', ancho: 20, valor: (e) => txt(e.combustible_equipo) || '—' },
];

/** Lo que viene marcado por defecto al abrir el diálogo */
export const CAMPOS_POR_DEFECTO_EQUIPOS = [
  'foto', 'equipo', 'tipo', 'propietario', 'encargado', 'status', 'marca', 'modelo', 'horometro', 'mantenimiento_cada_hrs',
];

export type OrientacionHoja = 'auto' | 'vertical' | 'horizontal';

export function camposElegidos(claves: string[]): CampoEquipo[] {
  const set = new Set(claves);
  return CAMPOS_EQUIPO.filter((c) => set.has(c.clave));
}

export function orientacionFinal(claves: string[], elegida: OrientacionHoja = 'auto'): 'portrait' | 'landscape' {
  if (elegida === 'vertical') return 'portrait';
  if (elegida === 'horizontal') return 'landscape';
  const anchoTotal = camposElegidos(claves).reduce((a, c) => a + c.ancho, 0);
  return anchoTotal > 85 ? 'landscape' : 'portrait';
}

export function agruparEquiposPorEmpresa(equipos: MaquinariaEquipo[]): Map<string, MaquinariaEquipo[]> {
  const map = new Map<string, MaquinariaEquipo[]>();
  for (const e of equipos) {
    const emp = txt(e.propietario) || 'SIN EMPRESA ASIGNADA';
    const arr = map.get(emp) ?? [];
    arr.push(e);
    map.set(emp, arr);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')));
}

const hoyStr = () => new Date().toISOString().slice(0, 10);

/* ─────────────────────────────────────────────────────────────
   EXCEL: Descargar datos de equipos (ExcelJS con estilos)
   ───────────────────────────────────────────────────────────── */
export async function descargarEquiposExcelPersonalizado(
  equipos: MaquinariaEquipo[],
  claves: string[],
  agruparPorEmpresa: boolean,
  contextoMap?: Map<string, ContextoEquipoExportar>,
  orientacion: OrientacionHoja = 'auto',
  categoria?: string | null,
): Promise<void> {
  const campos = camposElegidos(claves);
  if (!campos.length) throw new Error('Marca al menos un dato para descargar.');
  if (!equipos.length) throw new Error('No hay equipos en la lista.');

  const [{ default: ExcelJS }] = await Promise.all([import('exceljs')]);
  const cat = txt(categoria);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Equipos', {
    pageSetup: { orientation: orientacionFinal(claves, orientacion), fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  ws.columns = [{ width: 7 }, ...campos.map((c) => ({ width: Math.max(c.ancho, c.etiqueta.length) + 5 }))];
  const ultimaCol = campos.length + 1;
  const borde = { style: 'thin' as const, color: { argb: 'FFBFC5CC' } };
  const bordes = { top: borde, left: borde, bottom: borde, right: borde };

  // Encabezado institucional
  ws.getRow(1).height = 26; ws.getRow(2).height = 20; ws.getRow(3).height = 12;
  ws.mergeCells(1, 1, 1, Math.max(1, ultimaCol));
  ws.mergeCells(2, 1, 2, Math.max(1, ultimaCol));

  const t = ws.getCell(1, 1);
  t.value = cat ? `${cat.toUpperCase()} · MINERAL GROUP GUAYANA C.A.` : 'CONTROL DE MAQUINARIA Y VEHÍCULOS · MINERAL GROUP GUAYANA C.A.';
  t.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF8A00' } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const sub = ws.getCell(2, 1);
  sub.value = `${equipos.length} equipo(s)${cat ? ` · Categoría: ${cat}` : ''} · ${agruparPorEmpresa ? 'Agrupados por empresa' : 'Listado general'} · ${new Date().toLocaleString('es-VE')}`;
  sub.font = { name: 'Arial', size: 10, color: { argb: 'FF5C6673' } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  let filaActual = 5;

  if (!agruparPorEmpresa) {
    // Encabezados de tabla
    const cab = ws.getRow(filaActual);
    cab.values = ['N°', ...campos.map((c) => c.etiqueta)];
    cab.height = 25;
    cab.eachCell((c) => {
      c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = bordes;
    });
    filaActual++;

    equipos.forEach((eq, idx) => {
      const r = ws.getRow(filaActual);
      const ctx = contextoMap?.get(eq.id);
      r.values = [idx + 1, ...campos.map((c) => c.valor(eq, ctx))];
      r.height = 20;
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = { name: 'Arial', size: 9.5 };
        c.border = bordes;
        c.alignment = { vertical: 'middle', horizontal: col === 1 ? 'center' : 'left', indent: col === 1 ? 0 : 1, wrapText: true };
        if (idx % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6F0' } };
      });
      filaActual++;
    });
  } else {
    // Agrupado por empresa / propietario
    const grupos = agruparEquiposPorEmpresa(equipos);
    let contadorGeneral = 1;

    for (const [empresa, listaEmpresa] of grupos.entries()) {
      // Fila de encabezado de grupo
      const filaGrupo = ws.getRow(filaActual);
      ws.mergeCells(filaActual, 1, filaActual, Math.max(1, ultimaCol));
      filaGrupo.height = 24;
      const cGrupo = ws.getCell(filaActual, 1);
      cGrupo.value = `🏢 EMPRESA: ${empresa.toUpperCase()} (${listaEmpresa.length} equipos)`;
      cGrupo.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cGrupo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cGrupo.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      filaActual++;

      // Encabezados de columnas
      const cab = ws.getRow(filaActual);
      cab.values = ['N°', ...campos.map((c) => c.etiqueta)];
      cab.height = 22;
      cab.eachCell((c) => {
        c.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = bordes;
      });
      filaActual++;

      // Filas de los equipos de esta empresa
      listaEmpresa.forEach((eq, idx) => {
        const r = ws.getRow(filaActual);
        const ctx = contextoMap?.get(eq.id);
        r.values = [contadorGeneral++, ...campos.map((c) => c.valor(eq, ctx))];
        r.height = 20;
        r.eachCell({ includeEmpty: true }, (c, col) => {
          c.font = { name: 'Arial', size: 9.5 };
          c.border = bordes;
          c.alignment = { vertical: 'middle', horizontal: col === 1 ? 'center' : 'left', indent: col === 1 ? 0 : 1, wrapText: true };
          if (idx % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6F0' } };
        });
        filaActual++;
      });

      // Espacio entre empresas
      filaActual++;
    }
  }

  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  await previewExcelArchivo(bytes, `control-maquinaria-${hoyStr()}.xlsx`);
}

async function cargarImagenDataUrl(url: string): Promise<{ data: string; tipo: 'JPEG' | 'PNG' } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const objUrl = URL.createObjectURL(blob);
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 320;
          const w = img.naturalWidth || img.width || 200;
          const h = img.naturalHeight || img.height || 200;
          const scale = Math.min(maxDim / w, maxDim / h, 1);
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL('image/jpeg', 0.85);
          URL.revokeObjectURL(objUrl);
          resolve({ data, tipo: 'JPEG' });
        } catch {
          URL.revokeObjectURL(objUrl);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        resolve(null);
      };
      img.src = objUrl;
    });
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   PDF: Descargar datos de equipos (Fichas Técnicas con Foto)
   ───────────────────────────────────────────────────────────── */
export async function descargarEquiposPdfPersonalizado(
  equipos: MaquinariaEquipo[],
  claves: string[],
  agruparPorEmpresa: boolean,
  contextoMap?: Map<string, ContextoEquipoExportar>,
  orientacion: OrientacionHoja = 'auto',
  fotosMap?: Map<string, string>,
  categoria?: string | null,
): Promise<void> {
  const campos = camposElegidos(claves);
  if (!campos.length) throw new Error('Marca al menos un dato para descargar.');
  if (!equipos.length) throw new Error('No hay equipos en la lista.');

  const [{ jsPDF }, { loadLogoPdfDataUrl, dibujarLogoPdf, anchoLogoPdf }] = await Promise.all([
    import('jspdf'),
    import('@/shared/lib/pdfLogo'),
  ]);

  // La ficha lleva foto solo si el usuario marcó «Foto del equipo»
  const conFoto = campos.some((c) => c.clave === 'foto');
  const cat = txt(categoria);

  // Precarga de fotos de los equipos en DataURLs (solo si van a salir)
  let fm = fotosMap;
  if (!fm && conFoto) {
    try {
      const fts = await fotosDeEquipos();
      fm = new Map<string, string>();
      for (const f of fts) {
        if (!fm.has(f.equipo_id)) fm.set(f.equipo_id, f.url);
      }
    } catch {
      fm = new Map();
    }
  }

  const fotosDataUrlMap = new Map<string, { data: string; tipo: 'JPEG' | 'PNG' }>();
  if (conFoto) {
    await Promise.allSettled(
      equipos.map(async (eq) => {
        const url = fm?.get(eq.id);
        if (!url) return;
        const r = await cargarImagenDataUrl(url);
        if (r) fotosDataUrlMap.set(eq.id, r);
      })
    );
  }

  const logo = await loadLogoPdfDataUrl().catch(() => null);
  const orient = orientacionFinal(claves, orientacion);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: orient });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 36; // 0.5 pulgada
  const UW = W - MARGIN * 2;
  let y = MARGIN;

  const idEmp = identidadEmpresa();

  function pies(ref: string) {
    const numPages = doc.getNumberOfPages();
    for (let i = 1; i <= numPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, H - 18, W - MARGIN, H - 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${idEmp.nombre} · RIF ${idEmp.rif} · ${ref}`, MARGIN, H - 9);
      doc.text(`Página ${i} de ${numPages}`, W - MARGIN, H - 9, { align: 'right' });
    }
  }

  function dibujarEncabezadoGeneral(titulo: string) {
    if (logo) {
      dibujarLogoPdf(doc, logo, MARGIN, y, 38);
    }
    const tx = logo ? MARGIN + anchoLogoPdf(38) + 12 : MARGIN;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 138, 0);
    doc.text(titulo, tx, y + 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    doc.text(
      `MINERAL GROUP GUAYANA C.A. · RIF ${idEmp.rif} · ${equipos.length} equipo(s)${cat ? ` · ${cat}` : ''} · ${agruparPorEmpresa ? 'Agrupados por Empresa' : 'Listado General'} · ${new Date().toLocaleString('es-VE')}`,
      tx,
      y + 27,
    );

    y += 44;
    doc.setDrawColor(255, 138, 0);
    doc.setLineWidth(1.4);
    doc.line(MARGIN, y, W - MARGIN, y);
    y += 12;
  }

  /* ──────────────────────────────────────────────────────────
     FICHAS TÉCNICAS CON FOTO (Estilo Ficha Técnica elegante)
     ────────────────────────────────────────────────────────── */
  {
    dibujarEncabezadoGeneral(cat ? `CATÁLOGO Y FICHAS TÉCNICAS · ${cat.toUpperCase()}` : 'CATÁLOGO Y FICHAS TÉCNICAS DE MAQUINARIA Y EQUIPOS');

    const grupos = agruparPorEmpresa ? agruparEquiposPorEmpresa(equipos) : new Map([['TODOS LOS EQUIPOS', equipos]]);
    let contadorGeneral = 1;

    for (const [empresa, listaEmpresa] of grupos.entries()) {
      // Subtítulo con barra naranja corporativa idéntica a la ficha técnica
      if (y > H - 120) {
        doc.addPage();
        y = MARGIN;
      }

      if (agruparPorEmpresa) {
        doc.setFillColor(241, 245, 249);
        doc.rect(MARGIN, y, UW, 16, 'F');
        doc.setFillColor(255, 138, 0);
        doc.rect(MARGIN, y, 3.5, 16, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text(pdfSafe(`🏢 EMPRESA / PROPIETARIO: ${empresa.toUpperCase()} (${listaEmpresa.length} equipos)`), MARGIN + 8, y + 11.5);
        y += 22;
      }

      for (const eq of listaEmpresa) {
        const cardH = 82;
        if (y + cardH > H - 36) {
          doc.addPage();
          y = MARGIN;
        }

        // Caja de la tarjeta (Card)
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.6);
        doc.roundedRect(MARGIN, y, UW, cardH, 4, 4, 'FD');

        // Franja superior de la tarjeta con nombre y modelo
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(MARGIN, y, UW, 18, 4, 4, 'F');
        doc.setFillColor(255, 138, 0);
        doc.rect(MARGIN, y, 2.5, 18, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.2);
        doc.setTextColor(30, 41, 59);
        const nomEq = pdfSafe(`${contadorGeneral++}. ${eq.equipo.toUpperCase()} ${[eq.marca, eq.modelo].filter(Boolean).join(' · ')}`);
        doc.text(nomEq, MARGIN + 6, y + 12);

        // Badge de Estado Efectivo
        const st = estadoEfectivo(eq);
        const stInfo = ESTADOS_EQUIPO[st] ?? { label: eq.status || 'OPERATIVA' };
        const stColor = st === 'operativa' ? [22, 163, 74] : st === 'taller' || st === 'averiada' ? [220, 38, 38] : [217, 119, 6];
        const stLabel = pdfSafe(stInfo.label.toUpperCase());
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        const stW = doc.getTextWidth(stLabel) + 10;
        const stX = W - MARGIN - stW - 6;
        doc.setFillColor(stColor[0], stColor[1], stColor[2]);
        doc.roundedRect(stX, y + 3.5, stW, 11, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(stLabel, stX + stW / 2, y + 11.5, { align: 'center' });

        // Badge de Placa
        if (eq.placa) {
          const plLabel = pdfSafe(`PLACA: ${eq.placa}`);
          const plW = doc.getTextWidth(plLabel) + 8;
          const plX = stX - plW - 6;
          doc.setFillColor(224, 242, 254);
          doc.roundedRect(plX, y + 3.5, plW, 11, 2, 2, 'F');
          doc.setTextColor(2, 132, 199);
          doc.text(plLabel, plX + plW / 2, y + 11.5, { align: 'center' });
        }

        // Recuadro de Foto a la izquierda (solo si está marcada «Foto del equipo»;
        // si no, el texto ocupa ese ancho)
        const imgBoxX = MARGIN + 6;
        const imgBoxY = y + 22;
        const imgBoxW = conFoto ? 68 : 0;
        const imgBoxH = 54;
        if (conFoto) {
          doc.setFillColor(241, 245, 249);
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.4);
          doc.roundedRect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, 3, 3, 'FD');

          const imgData = fotosDataUrlMap.get(eq.id);
          if (imgData) {
            try {
              const prop = doc.getImageProperties(imgData.data);
              const k = Math.min((imgBoxW - 4) / prop.width, (imgBoxH - 4) / prop.height);
              const iw = prop.width * k;
              const ih = prop.height * k;
              const ix = imgBoxX + (imgBoxW - iw) / 2;
              const iy = imgBoxY + (imgBoxH - ih) / 2;
              doc.addImage(imgData.data, imgData.tipo, ix, iy, iw, ih);
            } catch {
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(7.5);
              doc.setTextColor(148, 163, 184);
              doc.text('Foto no disp.', imgBoxX + imgBoxW / 2, imgBoxY + imgBoxH / 2 + 2, { align: 'center' });
            }
          } else {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(148, 163, 184);
            doc.text('Sin foto', imgBoxX + imgBoxW / 2, imgBoxY + imgBoxH / 2 + 2, { align: 'center' });
          }
        }

        // Especificaciones técnicas a la derecha (2 columnas bien proporcionadas)
        const specX1 = conFoto ? imgBoxX + imgBoxW + 10 : imgBoxX;
        const specW1 = (UW - imgBoxW - 24) * 0.52;
        const specX2 = specX1 + specW1 + 8;

        const ctx = contextoMap?.get(eq.id);
        const horo = ctx?.horometro != null ? `${fmtNum(ctx.horometro)} h` : null;
        const km = ctx?.kilometraje != null ? `${fmtNum(ctx.kilometraje)} km` : null;
        const aviso = ctx?.avisoServicio || (eq.mantenimiento_cada_hrs ? `Cada ${fmtNum(eq.mantenimiento_cada_hrs)} h` : eq.mantenimiento_cada_km ? `Cada ${fmtNum(eq.mantenimiento_cada_km)} km` : '—');

        const drawField = (label: string, val: string, x: number, lineY: number) => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.setTextColor(100, 116, 139);
          doc.text(label, x, lineY);
          const lw = doc.getTextWidth(label) + 2;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(30, 41, 59);
          doc.text(pdfSafe(val), x + lw, lineY);
        };

        let ly = y + 32;
        drawField('Tipo / Clase: ', `${eq.tipo || '—'}${eq.anio ? ` · Año ${eq.anio}` : ''}${eq.color ? ` · ${eq.color}` : ''}`, specX1, ly);
        drawField('Empresa: ', eq.propietario || 'Sin propietario asignado', specX2, ly);

        ly += 12;
        drawField('Serial / PIN: ', eq.serial || '—', specX1, ly);
        drawField('Encargado: ', ctx?.encargado ?? extraerEncargado(eq) ?? '—', specX2, ly);

        ly += 12;
        drawField('Lectura vigente: ', [horo, km].filter(Boolean).join(' · ') || 'Sin lectura registrada', specX1, ly);
        drawField('Motor: ', [eq.motor_modelo, eq.motor_serial].filter(Boolean).join(' / ') || '—', specX2, ly);

        ly += 12;
        drawField('Mantenimiento: ', aviso, specX1, ly);
        drawField('Combustible: ', `${eq.combustible || '—'}${eq.litros_consume ? ` · ${fmtNum(eq.litros_consume)} L` : ''}`, specX2, ly);

        y += cardH + 7;
      }

      y += 8;
    }

    pies('Catálogo y Fichas Técnicas de Equipos');
    previewPdf(doc, `fichas-tecnicas-maquinaria-${hoyStr()}.pdf`);
  }
}
