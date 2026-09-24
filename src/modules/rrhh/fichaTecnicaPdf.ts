/* ============================================================
   MGG · RRHH · Ficha técnica del trabajador (PDF)

   Una hoja con todo lo que hace falta saber de una persona: quién es, cómo
   ubicarla, a quién avisarle si le pasa algo, qué hace en la empresa y con
   quién vive.

   Cuatro bloques, en el orden en que se buscan los datos:
   IDENTIFICACIÓN · CONTACTO · DATOS LABORALES · CARGA FAMILIAR

   Solo vista previa, por botón: acá nunca se descarga nada solo.
   ============================================================ */
import { previewPdfDoc } from '@/shared/lib/reportPreview';
import { textoPdf, filaPdf } from '@/shared/lib/textoPdf';
import { date as fmtDate } from '@/shared/lib/format';
import type { Personal } from '@/shared/lib/types';
import { definicionEmpresa, normalizarEmpresa } from './empresa';
import {
  antiguedad, cantidadHijos, labelEstadoCivil, labelGenero, labelGradoInstruccion, labelParentesco,
  numeroFicha, textoEdad,
} from './fichaPersonal';
import type { FamiliarPersonal } from './personal.repository';

const raya = (v: string | null | undefined) => {
  const s = String(v ?? '').trim();
  return s || '—';
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function verFichaTecnicaPdf(p: Personal, familia: FamiliarPersonal[] = []): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, { loadLogoDataUrl }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
  ]);
  const logo = await loadLogoDataUrl().catch(() => null);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const M = 42;
  const empresa = definicionEmpresa(normalizarEmpresa(p.empresa));
  let y = M;

  /* ── Encabezado ── */
  if (logo) { try { doc.addImage(logo, 'JPEG', M, y, 42, 42); } catch { /* opcional */ } }
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(textoPdf('FICHA TECNICA DEL TRABAJADOR'), W / 2, y + 14, { align: 'center' });
  doc.setTextColor(60, 60, 60); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(textoPdf(empresa.razonSocial), W / 2, y + 28, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(textoPdf(`Emitida el ${fmtDate(new Date().toISOString())}`), W - M, y + 14, { align: 'right' });
  y += 48;

  /* ── Nombre, ficha y estado ── */
  doc.setDrawColor(230, 230, 230); doc.setFillColor(248, 248, 248);
  doc.rect(M, y, W - M * 2, 46, 'FD');
  doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(textoPdf(`${p.nombre} ${p.apellido ?? ''}`.trim().toUpperCase()), M + 12, y + 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 100, 100);
  doc.text(
    textoPdf([numeroFicha(p.numero_ficha), p.cargo || null, p.departamento || null].filter(Boolean).join('  ·  ')),
    M + 12, y + 36,
  );
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  if (p.activo) doc.setTextColor(30, 150, 90); else doc.setTextColor(180, 60, 60);
  doc.text(textoPdf(p.activo ? 'ACTIVO' : 'INACTIVO'), W - M - 12, y + 20, { align: 'right' });
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(textoPdf(`Nomina ${empresa.label}`), W - M - 12, y + 36, { align: 'right' });
  y += 60;

  /* ── Un bloque de dos columnas, en forma de tabla sin bordes ── */
  const bloque = (titulo: string, pares: [string, string][]) => {
    doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(textoPdf(titulo.toUpperCase()), M, y);
    doc.setDrawColor(255, 138, 0); doc.setLineWidth(0.8);
    doc.line(M, y + 4, W - M, y + 4);
    y += 12;

    // De a dos por renglón: la hoja rinde el doble y se lee igual de bien.
    const filas: string[][] = [];
    for (let i = 0; i < pares.length; i += 2) {
      const a = pares[i];
      const b = pares[i + 1];
      filas.push([a[0], a[1], b?.[0] ?? '', b?.[1] ?? '']);
    }
    autoTable(doc as any, {
      startY: y,
      body: filas.map((f) => filaPdf(f)),
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 2, right: 6 } },
      columnStyles: {
        0: { cellWidth: 95, textColor: [120, 120, 120] },
        1: { cellWidth: 160, fontStyle: 'bold' },
        2: { cellWidth: 95, textColor: [120, 120, 120] },
        3: { fontStyle: 'bold' },
      },
      margin: { left: M, right: M },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 16;
  };

  bloque('Identificación', [
    ['Cédula', raya(p.cedula)],
    ['RIF', raya(p.rif)],
    ['Fecha de nacimiento', p.fecha_nacimiento ? fmtDate(p.fecha_nacimiento) : '—'],
    ['Edad', textoEdad(p.fecha_nacimiento)],
    ['Grupo sanguíneo', raya(p.grupo_sanguineo)],
    ['Género', p.genero ? labelGenero(p.genero) : '—'],
    ['Nacionalidad', raya(p.nacionalidad)],
    ['Estado civil', p.estado_civil ? labelEstadoCivil(p.estado_civil) : '—'],
    ['Grado de instrucción', p.grado_instruccion ? labelGradoInstruccion(p.grado_instruccion) : '—'],
    ['', ''],
  ]);

  const emergencia = [p.contacto_emergencia, p.contacto_emergencia_parentesco]
    .map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  bloque('Contacto', [
    ['Teléfono', raya(p.telefono)],
    ['Correo', raya(p.correo)],
    ['En una emergencia', [emergencia || null, p.contacto_emergencia_tlf || null].filter(Boolean).join(' · ') || '—'],
    ['Dirección', raya(p.direccion)],
  ]);

  bloque('Datos laborales', [
    ['Cargo', raya(p.cargo)],
    ['Departamento', raya(p.departamento)],
    ['Fecha de ingreso', p.fecha_ingreso ? fmtDate(p.fecha_ingreso) : '—'],
    ['Antigüedad', antiguedad(p.fecha_ingreso)],
    ['Sueldo base mensual', Number(p.sueldo_base) > 0 ? `$ ${Number(p.sueldo_base).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '—'],
    ['Empresa', empresa.razonSocial],
  ]);

  /* ── Carga familiar ── */
  doc.setTextColor(255, 138, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(textoPdf('CARGA FAMILIAR'), M, y);
  doc.setDrawColor(255, 138, 0); doc.setLineWidth(0.8);
  doc.line(M, y + 4, W - M, y + 4);
  y += 12;

  if (!familia.length) {
    doc.setTextColor(140, 140, 140); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(textoPdf('Sin carga familiar registrada.'), M, y + 10);
    y += 24;
  } else {
    autoTable(doc as any, {
      startY: y,
      head: [filaPdf(['Nombre', 'Parentesco', 'Fecha de nacimiento', 'Edad', 'Género', 'Observación'])],
      body: familia.map((f) => filaPdf([
        f.nombre,
        labelParentesco(f.parentesco),
        f.fechaNacimiento ? fmtDate(f.fechaNacimiento) : '—',
        textoEdad(f.fechaNacimiento),
        f.genero ? labelGenero(f.genero) : '—',
        f.observacion ?? '—',
      ])),
      styles: { fontSize: 8, cellPadding: 3.5 },
      headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
      margin: { left: M, right: M },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
    const hijos = cantidadHijos(familia);
    doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(
      textoPdf(`${familia.length} familiar(es) registrado(s)${hijos ? ` · ${hijos} hijo(s)` : ''}.`),
      M, y + 4,
    );
    y += 20;
  }

  /* ── Firmas ── */
  const fy = Math.max(y + 20, doc.internal.pageSize.getHeight() - 90);
  const colW = (W - M * 2 - 40) / 2;
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.6);
  doc.line(M, fy, M + colW, fy);
  doc.line(M + colW + 40, fy, W - M, fy);
  doc.setTextColor(90, 90, 90); doc.setFontSize(8);
  doc.text(textoPdf('Firma del trabajador'), M + colW / 2, fy + 12, { align: 'center' });
  doc.text(textoPdf(`${p.nombre} ${p.apellido ?? ''}`.trim()), M + colW / 2, fy + 23, { align: 'center' });
  doc.text(textoPdf('Recursos Humanos'), M + colW + 40 + colW / 2, fy + 12, { align: 'center' });
  doc.text(textoPdf(empresa.razonSocial), M + colW + 40 + colW / 2, fy + 23, { align: 'center' });

  const nombreArchivo = `ficha-${String(p.nombre ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  previewPdfDoc(doc, nombreArchivo);
}
