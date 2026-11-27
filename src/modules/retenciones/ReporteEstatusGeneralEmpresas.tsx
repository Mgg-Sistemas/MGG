/* ============================================================
   Golden Touch · Retenciones · Estatus General Consolidado de Empresas
   Reporte dinámico ejecutivo que muestra el estatus consolidado y por
   empresa de las retenciones practicadas: totales retenidos en Bs y USD,
   número de retenciones, desglose por tributo (ISLR, ISAE, IVA) y estatus
   de cumplimiento (declaradas vs por declarar).
   Exporta a Excel, CSV y PDF.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { diaVE, hoyVE } from '@/modules/tesoreria/tasas.repository';
import { type ConfigRetencion } from '@/modules/libroFiscal/retencionesCalculo';
import { listRetenciones, type RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { listEmpresasReceptoras, type EmpresaReceptora } from './empresasReceptoras.repository';
import { esEmpresaGt } from './empresaActual';
import { rangoDePeriodo, formatoMonto, retenidoBs, type PeriodoReporte, type EleccionPeriodo, type Rango } from './reportesRetenciones';
import { previewExcelArchivo, previewPdf } from '@/shared/lib/reportePreview';
import { MARGEN_PDF, textoPdf } from '@/modules/libroFiscal/pdfComun';

const PERIODOS_ESTATUS: { value: PeriodoReporte; label: string }[] = [
  { value: 'mes_actual', label: 'Mes actual' },
  { value: 'mes_anterior', label: 'Mes anterior' },
  { value: 'anio_actual', label: 'Año actual' },
  { value: 'anio_anterior', label: 'Año anterior' },
  { value: 'quincena_actual', label: 'Quincena actual' },
  { value: 'quincena_anterior', label: 'Quincena anterior' },
  { value: 'mes', label: 'Mes específico…' },
  { value: 'anio', label: 'Año específico…' },
  { value: 'rango', label: 'Rango de fechas…' },
];

export interface EstatusEmpresaFila {
  empresaId: string;
  nombre: string;
  nombreCorto?: string;
  rif: string;
  esEspecial: boolean;
  totalRetenciones: number;
  totalRetenidoBs: number;
  totalRetenidoUsd: number;
  // Desglose ISLR
  islrCount: number;
  islrMontoBs: number;
  // Desglose ISAE Municipal
  isaeCount: number;
  isaeMontoBs: number;
  // Desglose IVA
  ivaCount: number;
  ivaMontoBs: number;
  // Desglose IGTF u otros
  otrosCount: number;
  otrosMontoBs: number;
  // Estatus de cumplimiento
  declaradas: number;
  registradas: number;
}

export function ReporteEstatusGeneralEmpresas({
  actor: _actor,
  config,
  onSeleccionarEmpresa,
}: {
  actor: string;
  config: ConfigRetencion | null;
  onSeleccionarEmpresa?: (empresaId: string) => void;
}) {
  const hoy = diaVE(new Date().toISOString()) || hoyVE();

  const [periodo, setPeriodo] = useState<PeriodoReporte>('mes_actual');
  const [eleccion, setEleccion] = useState<EleccionPeriodo>({});
  const [busqueda, setBusqueda] = useState('');
  const [filtroRegimen, setFiltroRegimen] = useState<'todos' | 'especiales' | 'ordinarios'>('todos');
  const [generando, setGenerando] = useState<string | null>(null);

  const [empresas, setEmpresas] = useState<EmpresaReceptora[]>([]);
  const [retenciones, setRetenciones] = useState<RetencionPracticada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [emps, rets] = await Promise.all([
        listEmpresasReceptoras().catch(() => []),
        listRetenciones({ incluirAnuladas: false, direccion: 'practicada' }),
      ]);
      setEmpresas(emps);
      setRetenciones(rets);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los datos del consolidado.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  const rango: Rango | null = useMemo(() => rangoDePeriodo(periodo, hoy, eleccion), [periodo, hoy, eleccion]);

  // Retenciones filtradas por el período seleccionado
  const retencionesEnPeriodo = useMemo(() => {
    if (!rango) return [];
    return retenciones.filter((r) => {
      const f = r.facturaFecha || r.fecha || (r.periodo ? `${r.periodo.slice(0, 4)}-${r.periodo.slice(4, 6)}-01` : '');
      if (!f) return false;
      return f >= rango.desde && f <= rango.hasta;
    });
  }, [retenciones, rango]);

  // Lista de empresas unificando GT si no está explícitamente en la lista
  const todasEmpresas = useMemo(() => {
    const list = [...empresas];
    const tieneGt = list.some((e) => esEmpresaGt(e));
    if (!tieneGt) {
      list.unshift({
        id: 'empresa-golden-touch',
        clave: 'GT',
        nombre: 'Golden Touch, C.A.',
        nombreCorto: 'Golden Touch',
        rif: 'J-50129993-5',
        colorBadge: '#ff8a00',
        activo: true,
        orden: 0,
        esContribuyenteEspecial: config?.esContribuyenteEspecial === true,
      });
    }
    return list;
  }, [empresas, config]);

  // Cálculo consolidado por empresa
  const filasCalculadas = useMemo<EstatusEmpresaFila[]>(() => {
    const mapa = new Map<string, EstatusEmpresaFila>();

    for (const emp of todasEmpresas) {
      const esEspecial = esEmpresaGt(emp)
        ? (config?.esContribuyenteEspecial === true)
        : Boolean(emp.esContribuyenteEspecial);

      mapa.set(emp.id, {
        empresaId: emp.id,
        nombre: emp.nombre,
        nombreCorto: emp.nombreCorto,
        rif: emp.rif,
        esEspecial,
        totalRetenciones: 0,
        totalRetenidoBs: 0,
        totalRetenidoUsd: 0,
        islrCount: 0,
        islrMontoBs: 0,
        isaeCount: 0,
        isaeMontoBs: 0,
        ivaCount: 0,
        ivaMontoBs: 0,
        otrosCount: 0,
        otrosMontoBs: 0,
        declaradas: 0,
        registradas: 0,
      });
    }

    // Identificador de GT en el mapa
    const gtEntry = [...mapa.entries()].find(([_, val]) => esEmpresaGt(val));
    const gtId = gtEntry ? gtEntry[0] : 'empresa-golden-touch';

    for (const r of retencionesEnPeriodo) {
      let targetId = r.empresaId;
      if (!targetId || !mapa.has(targetId)) {
        if (!targetId || targetId === 'empresa-golden-touch' || targetId === 'gt-default' || targetId === '1') {
          targetId = gtId;
        }
      }

      let fila = mapa.get(targetId ?? '');
      if (!fila) {
        fila = mapa.get(gtId);
      }
      if (!fila) continue;

      const montoBs = retenidoBs(r) ?? (String(r.moneda).toUpperCase() === 'BS' ? r.montoRetenido : 0);
      const montoUsd = String(r.moneda).toUpperCase() === 'USD' ? r.montoRetenido : (r.tasa && r.tasa > 0 ? r.montoRetenido / r.tasa : 0);

      fila.totalRetenciones += 1;
      fila.totalRetenidoBs += montoBs;
      fila.totalRetenidoUsd += montoUsd;

      if (r.estado === 'declarada') {
        fila.declaradas += 1;
      } else {
        fila.registradas += 1;
      }

      if (r.tipo === 'islr') {
        fila.islrCount += 1;
        fila.islrMontoBs += montoBs;
      } else if (r.tipo === 'municipal') {
        fila.isaeCount += 1;
        fila.isaeMontoBs += montoBs;
      } else if (r.tipo === 'iva') {
        fila.ivaCount += 1;
        fila.ivaMontoBs += montoBs;
      } else {
        fila.otrosCount += 1;
        fila.otrosMontoBs += montoBs;
      }
    }

    return Array.from(mapa.values());
  }, [todasEmpresas, retencionesEnPeriodo, config]);

  // Filtrar según búsqueda y régimen
  const filasFiltradas = useMemo(() => {
    let res = filasCalculadas;
    const q = busqueda.trim().toLowerCase();
    if (q) {
      res = res.filter((f) =>
        f.nombre.toLowerCase().includes(q) ||
        (f.nombreCorto && f.nombreCorto.toLowerCase().includes(q)) ||
        f.rif.toLowerCase().includes(q)
      );
    }
    if (filtroRegimen === 'especiales') {
      res = res.filter((f) => f.esEspecial);
    } else if (filtroRegimen === 'ordinarios') {
      res = res.filter((f) => !f.esEspecial);
    }
    return res;
  }, [filasCalculadas, busqueda, filtroRegimen]);

  // Totales generales
  const totalesConsolidados = useMemo(() => {
    let retenciones = 0;
    let retenidoBs = 0;
    let retenidoUsd = 0;
    let islrBs = 0;
    let islrCount = 0;
    let isaeBs = 0;
    let isaeCount = 0;
    let ivaBs = 0;
    let ivaCount = 0;
    let declaradas = 0;
    let registradas = 0;
    let conMovimiento = 0;

    for (const f of filasFiltradas) {
      retenciones += f.totalRetenciones;
      retenidoBs += f.totalRetenidoBs;
      retenidoUsd += f.totalRetenidoUsd;
      islrBs += f.islrMontoBs;
      islrCount += f.islrCount;
      isaeBs += f.isaeMontoBs;
      isaeCount += f.isaeCount;
      ivaBs += f.ivaMontoBs;
      ivaCount += f.ivaCount;
      declaradas += f.declaradas;
      registradas += f.registradas;
      if (f.totalRetenciones > 0) conMovimiento += 1;
    }

    return {
      empresasTotal: filasFiltradas.length,
      empresasConMovimiento: conMovimiento,
      retenciones,
      retenidoBs,
      retenidoUsd,
      islrBs,
      islrCount,
      isaeBs,
      isaeCount,
      ivaBs,
      ivaCount,
      declaradas,
      registradas,
    };
  }, [filasFiltradas]);

  /* ───────── Exportar a CSV ───────── */
  function exportarCsv() {
    if (!rango) return;
    const encabezados = [
      'Empresa',
      'RIF',
      'Regimen',
      'Retenciones Totales',
      'Total Retenido Bs',
      'Total Retenido USD equiv',
      'ISLR N°',
      'ISLR Bs',
      'ISAE N°',
      'ISAE Bs',
      'IVA N°',
      'IVA Bs',
      'Declaradas',
      'Registradas (Por declarar)',
    ];

    const escape = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;

    const lineas = [
      encabezados.map(escape).join(','),
      ...filasFiltradas.map((f) => [
        escape(f.nombreCorto || f.nombre),
        escape(f.rif),
        escape(f.esEspecial ? 'Especial' : 'Ordinario'),
        f.totalRetenciones,
        f.totalRetenidoBs.toFixed(2),
        f.totalRetenidoUsd.toFixed(2),
        f.islrCount,
        f.islrMontoBs.toFixed(2),
        f.isaeCount,
        f.isaeMontoBs.toFixed(2),
        f.esEspecial ? f.ivaCount : 'N/A',
        f.esEspecial ? f.ivaMontoBs.toFixed(2) : 'N/A',
        f.declaradas,
        f.registradas,
      ].join(',')),
      [
        escape('TOTAL CONSOLIDADO'),
        escape(''),
        escape(''),
        totalesConsolidados.retenciones,
        totalesConsolidados.retenidoBs.toFixed(2),
        totalesConsolidados.retenidoUsd.toFixed(2),
        totalesConsolidados.islrCount,
        totalesConsolidados.islrBs.toFixed(2),
        totalesConsolidados.isaeCount,
        totalesConsolidados.isaeBs.toFixed(2),
        totalesConsolidados.ivaCount,
        totalesConsolidados.ivaBs.toFixed(2),
        totalesConsolidados.declaradas,
        totalesConsolidados.registradas,
      ].join(','),
    ];

    const blob = new Blob(['\uFEFF', lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estatus-general-empresas-${rango.desde}-al-${rango.hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV consolidado descargado.', 'success');
  }

  /* ───────── Exportar a Excel (.xlsx) ───────── */
  async function exportarExcel() {
    if (!rango) return;
    setGenerando('excel');
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Estatus Empresas', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ state: 'frozen', ySplit: 5 }],
      });

      ws.columns = [
        { width: 28 }, // Empresa
        { width: 15 }, // RIF
        { width: 14 }, // Régimen
        { width: 16 }, // N° Retenciones
        { width: 18 }, // Total Retenido Bs
        { width: 18 }, // Total Retenido USD
        { width: 12 }, // ISLR N°
        { width: 16 }, // ISLR Bs
        { width: 12 }, // ISAE N°
        { width: 16 }, // ISAE Bs
        { width: 12 }, // IVA N°
        { width: 16 }, // IVA Bs
        { width: 14 }, // Declaradas
        { width: 16 }, // Registradas
      ];

      const borde = { style: 'thin' as const, color: { argb: 'FFBFC5CC' } };
      const bordes = { top: borde, left: borde, bottom: borde, right: borde };

      const linea = (fila: number, texto: string, tam: number, color: string, negrita = false) => {
        ws.mergeCells(fila, 1, fila, 14);
        const cel = ws.getCell(fila, 1);
        cel.value = texto;
        cel.font = { name: 'Arial', size: tam, bold: negrita, color: { argb: color } };
        cel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      };

      linea(1, 'ESTATUS GENERAL CONSOLIDADO DE EMPRESAS · RETENCIONES FISCALES', 13, 'FFFF8A00', true);
      linea(2, `Período: Del ${rango.desde} al ${rango.hasta} · Generado el ${hoy}`, 10, 'FF5C6673');
      linea(
        3,
        `Consolidado: ${totalesConsolidados.retenciones} retenciones · Bs ${formatoMonto(totalesConsolidados.retenidoBs)} ($ ${formatoMonto(totalesConsolidados.retenidoUsd)}) · Declaradas: ${totalesConsolidados.declaradas} · Por declarar: ${totalesConsolidados.registradas}`,
        10,
        'FF1F2328',
        true
      );

      const encabezados = [
        'Razón Social / Empresa',
        'RIF',
        'Régimen',
        'N° Retenciones',
        'Total Retenido (Bs)',
        'Total Equiv. ($)',
        'ISLR (N°)',
        'ISLR (Bs)',
        'ISAE (N°)',
        'ISAE (Bs)',
        'IVA (N°)',
        'IVA (Bs)',
        'Declaradas',
        'Por declarar',
      ];

      const cab = ws.getRow(5);
      cab.values = encabezados;
      cab.height = 24;
      cab.eachCell((cel) => {
        cel.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A00' } };
        cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cel.border = bordes;
      });

      filasFiltradas.forEach((f, idx) => {
        const r = ws.getRow(6 + idx);
        r.values = [
          f.nombreCorto || f.nombre,
          f.rif,
          f.esEspecial ? 'Especial' : 'Ordinario',
          f.totalRetenciones,
          f.totalRetenidoBs,
          f.totalRetenidoUsd,
          f.islrCount,
          f.islrMontoBs,
          f.isaeCount,
          f.isaeMontoBs,
          f.esEspecial ? f.ivaCount : 'N/A',
          f.esEspecial ? f.ivaMontoBs : 'N/A',
          f.declaradas,
          f.registradas,
        ];

        for (let col = 1; col <= 14; col += 1) {
          const cel = r.getCell(col);
          cel.font = { name: 'Arial', size: 9 };
          cel.border = bordes;
          cel.alignment = { vertical: 'middle', horizontal: col <= 3 ? 'left' : 'right' };
          if (idx % 2 === 1) {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          }
          if ([4, 5, 6, 8, 10, 12].includes(col) && typeof cel.value === 'number') {
            cel.numFmt = '#,##0.00';
          }
        }
      });

      // Fila de totales
      const filaTot = ws.getRow(6 + filasFiltradas.length);
      filaTot.values = [
        'TOTAL GENERAL',
        `${totalesConsolidados.empresasConMovimiento} activas`,
        '',
        totalesConsolidados.retenciones,
        totalesConsolidados.retenidoBs,
        totalesConsolidados.retenidoUsd,
        totalesConsolidados.islrCount,
        totalesConsolidados.islrBs,
        totalesConsolidados.isaeCount,
        totalesConsolidados.isaeBs,
        totalesConsolidados.ivaCount,
        totalesConsolidados.ivaBs,
        totalesConsolidados.declaradas,
        totalesConsolidados.registradas,
      ];
      filaTot.height = 22;
      for (let col = 1; col <= 14; col += 1) {
        const cel = filaTot.getCell(col);
        cel.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF111827' } };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1DE' } };
        cel.border = bordes;
        cel.alignment = { vertical: 'middle', horizontal: col <= 3 ? 'left' : 'right' };
        if ([4, 5, 6, 8, 10, 12].includes(col) && typeof cel.value === 'number') {
          cel.numFmt = '#,##0.00';
        }
      }

      const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
      await previewExcelArchivo(buf, `estatus-general-empresas-${rango.desde}-al-${rango.hasta}.xlsx`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al generar el Excel.', 'error');
    } finally {
      setGenerando(null);
    }
  }

  /* ───────── Exportar a PDF ───────── */
  async function exportarPdf() {
    if (!rango) return;
    setGenerando('pdf');
    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const margen = MARGEN_PDF;
      let y = margen + 20;

      // Encabezado
      doc.setFontSize(14);
      doc.setTextColor(255, 138, 0);
      doc.setFont('helvetica', 'bold');
      doc.text('Estatus General Consolidado de Empresas · Retenciones Fiscales', margen, y);

      y += 16;
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.text(`Período: Del ${rango.desde} al ${rango.hasta} · Generado el ${hoy}`, margen, y);

      y += 14;
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Total consolidado: ${totalesConsolidados.retenciones} retenciones · Bs ${formatoMonto(totalesConsolidados.retenidoBs)} ($ ${formatoMonto(totalesConsolidados.retenidoUsd)}) | Declaradas: ${totalesConsolidados.declaradas} · Por declarar: ${totalesConsolidados.registradas}`,
        margen,
        y
      );

      y += 18;
      // Tabla
      const cols = [
        { title: 'Empresa', width: 140 },
        { title: 'RIF', width: 75 },
        { title: 'Régimen', width: 60 },
        { title: 'N° Rets', width: 45 },
        { title: 'Total Bs', width: 75 },
        { title: 'Total $', width: 60 },
        { title: 'ISLR Bs', width: 70 },
        { title: 'ISAE Bs', width: 70 },
        { title: 'IVA Bs', width: 70 },
        { title: 'Decl.', width: 40 },
        { title: 'Reg.', width: 40 },
      ];

      // Cabecera tabla
      doc.setFillColor(255, 138, 0);
      doc.rect(margen, y, 792 - margen * 2, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');

      let x = margen + 4;
      for (const c of cols) {
        doc.text(c.title, x, y + 12);
        x += c.width;
      }

      y += 18;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);

      for (let i = 0; i < filasFiltradas.length; i += 1) {
        const f = filasFiltradas[i];
        if (y > 550) {
          doc.addPage();
          y = margen + 20;
        }

        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margen, y, 792 - margen * 2, 16, 'F');
        }

        doc.setTextColor(30, 41, 59);
        x = margen + 4;

        // Empresa
        doc.text(textoPdf((f.nombreCorto || f.nombre).slice(0, 25)), x, y + 11);
        x += 140;
        // RIF
        doc.text(f.rif, x, y + 11);
        x += 75;
        // Régimen
        doc.text(f.esEspecial ? 'Especial' : 'Ordinario', x, y + 11);
        x += 60;
        // N° Rets
        doc.text(String(f.totalRetenciones), x, y + 11);
        x += 45;
        // Total Bs
        doc.text(formatoMonto(f.totalRetenidoBs), x, y + 11);
        x += 75;
        // Total $
        doc.text(formatoMonto(f.totalRetenidoUsd), x, y + 11);
        x += 60;
        // ISLR Bs
        doc.text(formatoMonto(f.islrMontoBs), x, y + 11);
        x += 70;
        // ISAE Bs
        doc.text(formatoMonto(f.isaeMontoBs), x, y + 11);
        x += 70;
        // IVA Bs
        doc.text(f.esEspecial ? formatoMonto(f.ivaMontoBs) : '—', x, y + 11);
        x += 70;
        // Declaradas
        doc.text(String(f.declaradas), x, y + 11);
        x += 40;
        // Registradas
        doc.text(String(f.registradas), x, y + 11);

        y += 16;
      }

      // Fila de totales en PDF
      doc.setFillColor(255, 241, 222);
      doc.rect(margen, y, 792 - margen * 2, 18, 'F');
      doc.setTextColor(17, 24, 39);
      doc.setFont('helvetica', 'bold');
      x = margen + 4;
      doc.text('TOTAL CONSOLIDADO', x, y + 12);
      x += 140;
      doc.text(`${totalesConsolidados.empresasConMovimiento} activas`, x, y + 12);
      x += 75;
      x += 60;
      doc.text(String(totalesConsolidados.retenciones), x, y + 12);
      x += 45;
      doc.text(formatoMonto(totalesConsolidados.retenidoBs), x, y + 12);
      x += 75;
      doc.text(formatoMonto(totalesConsolidados.retenidoUsd), x, y + 12);
      x += 60;
      doc.text(formatoMonto(totalesConsolidados.islrBs), x, y + 12);
      x += 70;
      doc.text(formatoMonto(totalesConsolidados.isaeBs), x, y + 12);
      x += 70;
      doc.text(formatoMonto(totalesConsolidados.ivaBs), x, y + 12);
      x += 70;
      doc.text(String(totalesConsolidados.declaradas), x, y + 12);
      x += 40;
      doc.text(String(totalesConsolidados.registradas), x, y + 12);

      await previewPdf(doc, `estatus-general-empresas-${rango.desde}-al-${rango.hasta}.pdf`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al generar el PDF.', 'error');
    } finally {
      setGenerando(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* ── Encabezado y Selector de Período ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.8rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span>📊 Estatus General de Empresas</span>
            <span style={{ fontSize: '.75rem', background: 'rgba(255, 138, 0, 0.15)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
              Consolidado Multi-Empresa
            </span>
          </h2>
          <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.84rem' }}>
            Resumen comparativo, montos retenidos y estado de cumplimiento fiscal de cada razón social.
          </p>
        </div>

        {/* Acciones de exportación */}
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={exportarCsv} disabled={cargando || !filasFiltradas.length}>
            Descargar CSV
          </button>
          <button className="btn btn-sm" onClick={() => void exportarExcel()} disabled={cargando || !filasFiltradas.length || !!generando}>
            {generando === 'excel' ? 'Generando Excel…' : 'Descargar Excel'}
          </button>
          <button className="btn btn-sm" onClick={() => void exportarPdf()} disabled={cargando || !filasFiltradas.length || !!generando}>
            {generando === 'pdf' ? 'Generando PDF…' : 'Imprimir / PDF'}
          </button>
        </div>
      </div>

      {/* ── Barra de filtros del consolidado ── */}
      <div className="card" style={{ padding: '.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', background: 'var(--surface, #1e232b)' }}>
        {/* Selector de período */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>PERÍODO FISCAL</span>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select select-sm"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as PeriodoReporte)}
              style={{ minWidth: 150 }}
            >
              {PERIODOS_ESTATUS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {periodo === 'mes' && (
              <input
                className="input input-sm"
                type="month"
                value={eleccion.mes ?? ''}
                onChange={(e) => setEleccion((prev) => ({ ...prev, mes: e.target.value }))}
              />
            )}
            {periodo === 'anio' && (
              <input
                className="input input-sm mono"
                placeholder="AAAA"
                value={eleccion.anio ?? ''}
                onChange={(e) => setEleccion((prev) => ({ ...prev, anio: e.target.value.slice(0, 4) }))}
                style={{ width: 70 }}
              />
            )}
            {periodo === 'rango' && (
              <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                <input
                  className="input input-sm"
                  type="date"
                  value={eleccion.desde ?? ''}
                  onChange={(e) => setEleccion((prev) => ({ ...prev, desde: e.target.value }))}
                />
                <span className="muted" style={{ fontSize: '.8rem' }}>a</span>
                <input
                  className="input input-sm"
                  type="date"
                  value={eleccion.hasta ?? ''}
                  onChange={(e) => setEleccion((prev) => ({ ...prev, hasta: e.target.value }))}
                />
              </div>
            )}
          </div>
        </div>

        {/* Filtro por Régimen */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>RÉGIMEN SENIAT</span>
          <div style={{ display: 'flex', gap: '.3rem' }}>
            <button
              type="button"
              className={`btn btn-sm ${filtroRegimen === 'todos' ? 'btn-primary' : ''}`}
              onClick={() => setFiltroRegimen('todos')}
            >
              Todas ({filasCalculadas.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroRegimen === 'ordinarios' ? 'btn-primary' : ''}`}
              onClick={() => setFiltroRegimen('ordinarios')}
            >
              🏢 Ordinarias ({filasCalculadas.filter((f) => !f.esEspecial).length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroRegimen === 'especiales' ? 'btn-primary' : ''}`}
              onClick={() => setFiltroRegimen('especiales')}
            >
              ⭐ Especiales ({filasCalculadas.filter((f) => f.esEspecial).length})
            </button>
          </div>
        </div>

        {/* Buscador */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', flex: '1 1 200px' }}>
          <span style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>BUSCAR EMPRESA</span>
          <input
            className="input input-sm"
            placeholder="Filtrar por nombre o RIF…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {/* ── KPIs Ejecutivos Consolidados ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '.75rem' }}>
        <div className="card" style={{ padding: '.75rem 1rem', borderLeft: '4px solid var(--primary)' }}>
          <div className="muted" style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Total Retenido Consolidado</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary)', marginTop: 2 }}>
            Bs {formatoMonto(totalesConsolidados.retenidoBs)}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>
            ≈ $ {formatoMonto(totalesConsolidados.retenidoUsd)} en divisas
          </div>
        </div>

        <div className="card" style={{ padding: '.75rem 1rem', borderLeft: '4px solid var(--success)' }}>
          <div className="muted" style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Retenciones Practicadas</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
            {totalesConsolidados.retenciones}
            <span style={{ fontSize: '.85rem', fontWeight: 400, marginLeft: 6, color: 'var(--text-muted)' }}>
              en {totalesConsolidados.empresasConMovimiento} de {totalesConsolidados.empresasTotal} empresas
            </span>
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--success)', marginTop: 2 }}>
            🔒 {totalesConsolidados.declaradas} declaradas · <span style={{ color: 'var(--warning)' }}>⏳ {totalesConsolidados.registradas} por declarar</span>
          </div>
        </div>

        <div className="card" style={{ padding: '.75rem 1rem', borderLeft: '4px solid #38bdf8' }}>
          <div className="muted" style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Desglose ISLR (Decreto 1.808)</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>
            Bs {formatoMonto(totalesConsolidados.islrBs)}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>
            {totalesConsolidados.islrCount} retenciones de ISLR
          </div>
        </div>

        <div className="card" style={{ padding: '.75rem 1rem', borderLeft: '4px solid #a855f7' }}>
          <div className="muted" style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Desglose ISAE Municipal</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#a855f7', marginTop: 2 }}>
            Bs {formatoMonto(totalesConsolidados.isaeBs)}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>
            {totalesConsolidados.isaeCount} retenciones municipales
          </div>
        </div>

        <div className="card" style={{ padding: '.75rem 1rem', borderLeft: '4px solid #f59e0b' }}>
          <div className="muted" style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Desglose IVA (Solo Especiales)</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f59e0b', marginTop: 2 }}>
            Bs {formatoMonto(totalesConsolidados.ivaBs)}
          </div>
          <div className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>
            {totalesConsolidados.ivaCount} retenciones de IVA
          </div>
        </div>
      </div>

      {/* ── Tabla Dinámica Consolidada ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {cargando ? (
          <div style={{ padding: '2rem', textAlign: 'center' }} className="muted">
            Cargando estatus de empresas y retenciones…
          </div>
        ) : error ? (
          <div style={{ padding: '1.5rem', color: 'var(--danger)' }}>{error}</div>
        ) : filasFiltradas.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center' }} className="muted">
            No se encontraron empresas con los filtros aplicados.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '.84rem', margin: 0 }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.03)' }}>
                  <th style={{ padding: '.65rem .85rem' }}>Empresa</th>
                  <th style={{ padding: '.65rem .85rem' }}>Régimen Fiscal</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'right' }}>N° Retenciones</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'right' }}>Total Retenido (Bs)</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'right' }}>Equiv. ($)</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'right' }}>ISLR (Bs)</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'right' }}>ISAE (Bs)</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'right' }}>IVA (Bs)</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'center' }}>Cumplimiento</th>
                  <th style={{ padding: '.65rem .85rem', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((f) => (
                  <tr key={f.empresaId} style={{ borderBottom: '1px solid var(--border)' }}>
                    {/* Empresa y RIF */}
                    <td style={{ padding: '.6rem .85rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {f.nombreCorto || f.nombre}
                      </div>
                      <div className="muted mono" style={{ fontSize: '.75rem' }}>
                        {f.rif}
                      </div>
                    </td>

                    {/* Régimen */}
                    <td style={{ padding: '.6rem .85rem' }}>
                      {f.esEspecial ? (
                        <span style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: '.76rem' }}>
                          ⭐ Especial
                        </span>
                      ) : (
                        <span style={{ background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: '.76rem' }}>
                          🏢 Ordinario
                        </span>
                      )}
                    </td>

                    {/* N° Retenciones */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'right', fontWeight: 600 }}>
                      {f.totalRetenciones > 0 ? (
                        <span style={{ color: 'var(--text)' }}>{f.totalRetenciones}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>

                    {/* Total Bs */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'right', fontWeight: 700, color: f.totalRetenidoBs > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                      Bs {formatoMonto(f.totalRetenidoBs)}
                    </td>

                    {/* Total USD */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      $ {formatoMonto(f.totalRetenidoUsd)}
                    </td>

                    {/* ISLR */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'right' }}>
                      {f.islrCount > 0 ? (
                        <div>
                          <span style={{ fontWeight: 600 }}>Bs {formatoMonto(f.islrMontoBs)}</span>
                          <span className="muted" style={{ fontSize: '.72rem', display: 'block' }}>({f.islrCount})</span>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    {/* ISAE */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'right' }}>
                      {f.isaeCount > 0 ? (
                        <div>
                          <span style={{ fontWeight: 600 }}>Bs {formatoMonto(f.isaeMontoBs)}</span>
                          <span className="muted" style={{ fontSize: '.72rem', display: 'block' }}>({f.isaeCount})</span>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    {/* IVA */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'right' }}>
                      {f.esEspecial ? (
                        f.ivaCount > 0 ? (
                          <div>
                            <span style={{ fontWeight: 600, color: '#f59e0b' }}>Bs {formatoMonto(f.ivaMontoBs)}</span>
                            <span className="muted" style={{ fontSize: '.72rem', display: 'block' }}>({f.ivaCount})</span>
                          </div>
                        ) : (
                          <span className="muted">Bs 0,00</span>
                        )
                      ) : (
                        <span className="muted" style={{ fontSize: '.74rem', fontStyle: 'italic' }}>
                          No retiene (Ordinario)
                        </span>
                      )}
                    </td>

                    {/* Cumplimiento */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'center' }}>
                      {f.totalRetenciones > 0 ? (
                        <div style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
                          {f.declaradas > 0 && (
                            <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)', padding: '1px 6px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600 }} title={`${f.declaradas} declaradas`}>
                              ✓ {f.declaradas}
                            </span>
                          )}
                          {f.registradas > 0 && (
                            <span style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--warning)', padding: '1px 6px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600 }} title={`${f.registradas} pendientes por declarar`}>
                              ⏳ {f.registradas}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: '.75rem' }}>Al día</span>
                      )}
                    </td>

                    {/* Acciones */}
                    <td style={{ padding: '.6rem .85rem', textAlign: 'center' }}>
                      {onSeleccionarEmpresa && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ fontSize: '.76rem', padding: '2px 8px' }}
                          title={`Ver retenciones de ${f.nombreCorto || f.nombre}`}
                          onClick={() => onSeleccionarEmpresa(f.empresaId)}
                        >
                          Ver empresa →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Pie de tabla con totales */}
              <tfoot>
                <tr style={{ background: 'rgba(255, 138, 0, 0.08)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td style={{ padding: '.75rem .85rem' }}>
                    TOTAL CONSOLIDADO
                  </td>
                  <td style={{ padding: '.75rem .85rem', color: 'var(--text-muted)' }}>
                    {totalesConsolidados.empresasConMovimiento} activas de {totalesConsolidados.empresasTotal}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'right' }}>
                    {totalesConsolidados.retenciones}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'right', color: 'var(--primary)' }}>
                    Bs {formatoMonto(totalesConsolidados.retenidoBs)}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                    $ {formatoMonto(totalesConsolidados.retenidoUsd)}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'right' }}>
                    Bs {formatoMonto(totalesConsolidados.islrBs)}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'right' }}>
                    Bs {formatoMonto(totalesConsolidados.isaeBs)}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'right', color: '#f59e0b' }}>
                    Bs {formatoMonto(totalesConsolidados.ivaBs)}
                  </td>
                  <td style={{ padding: '.75rem .85rem', textAlign: 'center' }}>
                    <span style={{ color: 'var(--success)', marginRight: 4 }}>✓ {totalesConsolidados.declaradas}</span>
                    <span style={{ color: 'var(--warning)' }}>⏳ {totalesConsolidados.registradas}</span>
                  </td>
                  <td style={{ padding: '.75rem .85rem' }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
