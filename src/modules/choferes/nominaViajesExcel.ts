/* ============================================================
   MGG · Choferes / Conductores · Nómina de viajes (Excel .xlsx)
   Genera un archivo Excel real (.xlsx) con estilos del sistema:
   título corporativo naranja, agrupación por chofer, C.I. con puntos,
   valores numéricos para totales y sumas en Excel, y vista previa.
   ============================================================ */
import { previewWorkbook } from '@/shared/lib/reportPreview';
import { formatoCI, date as fmtDate } from '@/shared/lib/format';
import type { Conductor } from './choferes.repository';
import type { GrupoChoferNomina } from './nominaViajesPdf';

interface XlsxLike {
  utils: {
    aoa_to_sheet: (d: unknown[][]) => Record<string, unknown>;
    encode_cell: (c: { r: number; c: number }) => string;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
}

type Celda = { v?: unknown; t?: string; z?: string; s?: unknown } | undefined;

const NARANJA = 'FF8A00';
const NARANJA_OSCURO = 'D9531E';
const BLANCO = 'FFFFFF';
const GRIS_ENCABEZADO = '243A5E';
const GRIS_BORDE = 'CBD5E1';
const TEXTO_OSCURO = '0F172A';

const TITULO_STYLE = {
  font: { name: 'Arial', sz: 14, bold: true, color: { rgb: BLANCO } },
  fill: { patternType: 'solid', fgColor: { rgb: NARANJA_OSCURO } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const SUBTITULO_STYLE = {
  font: { name: 'Arial', sz: 9, italic: true, color: { rgb: '475569' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const BANNER_CHOFER_STYLE = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: BLANCO } },
  fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
  alignment: { horizontal: 'left', vertical: 'center' },
};

const CABECERA_TABLA_STYLE = {
  font: { name: 'Arial', sz: 9, bold: true, color: { rgb: BLANCO } },
  fill: { patternType: 'solid', fgColor: { rgb: GRIS_ENCABEZADO } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: GRIS_BORDE } },
    bottom: { style: 'thin', color: { rgb: GRIS_BORDE } },
    left: { style: 'thin', color: { rgb: GRIS_BORDE } },
    right: { style: 'thin', color: { rgb: GRIS_BORDE } },
  },
};

const CELDA_TEXTO_STYLE = {
  font: { name: 'Arial', sz: 9, color: { rgb: TEXTO_OSCURO } },
  alignment: { vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: GRIS_BORDE } },
    bottom: { style: 'thin', color: { rgb: GRIS_BORDE } },
    left: { style: 'thin', color: { rgb: GRIS_BORDE } },
    right: { style: 'thin', color: { rgb: GRIS_BORDE } },
  },
};

const CELDA_NUMERO_STYLE = {
  font: { name: 'Arial', sz: 9, color: { rgb: TEXTO_OSCURO } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: GRIS_BORDE } },
    bottom: { style: 'thin', color: { rgb: GRIS_BORDE } },
    left: { style: 'thin', color: { rgb: GRIS_BORDE } },
    right: { style: 'thin', color: { rgb: GRIS_BORDE } },
  },
};

const CELDA_CENTRO_STYLE = {
  font: { name: 'Arial', sz: 9, color: { rgb: TEXTO_OSCURO } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: GRIS_BORDE } },
    bottom: { style: 'thin', color: { rgb: GRIS_BORDE } },
    left: { style: 'thin', color: { rgb: GRIS_BORDE } },
    right: { style: 'thin', color: { rgb: GRIS_BORDE } },
  },
};

const SUBTOTAL_STYLE = {
  font: { name: 'Arial', sz: 10, bold: true, color: { rgb: TEXTO_OSCURO } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FEF3EB' } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: NARANJA } },
    bottom: { style: 'medium', color: { rgb: NARANJA } },
  },
};

const TOTAL_GENERAL_STYLE = {
  font: { name: 'Arial', sz: 11, bold: true, color: { rgb: BLANCO } },
  fill: { patternType: 'solid', fgColor: { rgb: NARANJA_OSCURO } },
  alignment: { horizontal: 'right', vertical: 'center' },
};

export async function generarNominaViajesExcel(opts: {
  grupos: GrupoChoferNomina[];
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  filtroChofer?: string | null;
  conductoresMap: Map<string, Conductor>;
}): Promise<void> {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as XlsxLike;

  const aoa: unknown[][] = [];
  const estilosPorCelda: Map<string, unknown> = new Map();
  const formatosNumericos: Map<string, string> = new Map();
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];

  const COLS_TOTAL = 11; // 0..10

  // 1. Título principal
  aoa.push(['NÓMINA DE VIAJES DE CHOFERES · MINERAL GROUP GUAYANA, C.A.']);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COLS_TOTAL - 1 } });
  estilosPorCelda.set('0:0', TITULO_STYLE);

  // 2. Subtítulo con filtros y fecha
  const periodoTexto = [
    opts.fechaDesde && opts.fechaHasta
      ? `Período: del ${fmtDate(opts.fechaDesde)} al ${fmtDate(opts.fechaHasta)}`
      : opts.fechaHasta
        ? `Corte de viajes al: ${fmtDate(opts.fechaHasta)}`
        : 'Todos los viajes',
    opts.filtroChofer ? `Conductor: ${opts.filtroChofer}` : `${opts.grupos.length} conductores`,
    `Emitido: ${fmtDate(new Date().toISOString())}`,
  ].join('  ·  ');
  aoa.push([periodoTexto]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COLS_TOTAL - 1 } });
  estilosPorCelda.set('1:0', SUBTITULO_STYLE);

  // Fila en blanco
  aoa.push([]);

  // Cabecera estándar de columnas
  const encabezados = [
    'FECHA',
    'VEHÍCULO',
    'EQUIPOS / MOVIMIENTOS',
    'ORIGEN (PROVIENE)',
    'DESTINO',
    'CANTIDAD VIAJES',
    'PRECIO ($)',
    'TOTAL A PAGAR ($)',
    'TIPO DE VIAJE',
    'ESTADO PAGO',
    'FECHA PAGO',
  ];

  let rIdx = 3;

  for (const g of opts.grupos) {
    const cond = opts.conductoresMap.get(g.choferId);
    const ciRaw = cond?.personal?.cedula ?? cond?.cedula ?? '';
    const ciFmt = ciRaw ? `C.I. ${formatoCI(ciRaw)}` : 'Sin C.I.';
    const tel = cond?.personal?.telefono ?? cond?.telefono ?? '';

    // Fila Banner de conductor
    const infoBanner = `${g.nombre.toUpperCase()}  ·  ${ciFmt}  ·  NÓMINA: ${g.nominaFija}${tel ? `  ·  Tel: ${tel}` : ''}`;
    aoa.push([infoBanner]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: COLS_TOTAL - 1 } });
    estilosPorCelda.set(`${rIdx}:0`, BANNER_CHOFER_STYLE);
    rIdx++;

    // Fila Encabezados de tabla
    aoa.push(encabezados);
    for (let c = 0; c < COLS_TOTAL; c++) {
      estilosPorCelda.set(`${rIdx}:${c}`, CABECERA_TABLA_STYLE);
    }
    rIdx++;

    let viajesChofer = 0;
    let totalChofer = 0;

    for (const f of g.filas) {
      viajesChofer += f.viajes;
      totalChofer += f.totalPagar;

      const estadoPagoTxt = f.pagado
        ? `PAGADO${f.fechaPago ? ` (${f.fechaPago.slice(8, 10)}/${f.fechaPago.slice(5, 7)})` : ''}`
        : 'PENDIENTE';

      aoa.push([
        f.fecha,
        f.vehiculo,
        f.movimiento,
        f.proviene,
        f.destino,
        f.viajes,
        f.monto,
        f.totalPagar,
        f.observaciones,
        estadoPagoTxt,
        f.fechaPago || '—',
      ]);

      estilosPorCelda.set(`${rIdx}:0`, CELDA_CENTRO_STYLE);
      estilosPorCelda.set(`${rIdx}:1`, CELDA_CENTRO_STYLE);
      estilosPorCelda.set(`${rIdx}:2`, CELDA_TEXTO_STYLE);
      estilosPorCelda.set(`${rIdx}:3`, CELDA_TEXTO_STYLE);
      estilosPorCelda.set(`${rIdx}:4`, CELDA_TEXTO_STYLE);
      estilosPorCelda.set(`${rIdx}:5`, CELDA_CENTRO_STYLE);
      estilosPorCelda.set(`${rIdx}:6`, CELDA_NUMERO_STYLE);
      formatosNumericos.set(`${rIdx}:6`, '#,##0.00');
      estilosPorCelda.set(`${rIdx}:7`, { ...CELDA_NUMERO_STYLE, font: { name: 'Arial', sz: 9, bold: true, color: { rgb: NARANJA_OSCURO } } });
      formatosNumericos.set(`${rIdx}:7`, '#,##0.00');
      estilosPorCelda.set(`${rIdx}:8`, CELDA_CENTRO_STYLE);
      estilosPorCelda.set(`${rIdx}:9`, {
        ...CELDA_CENTRO_STYLE,
        font: { name: 'Arial', sz: 9, bold: true, color: { rgb: f.pagado ? '16A34A' : 'DC2626' } },
      });
      estilosPorCelda.set(`${rIdx}:10`, CELDA_CENTRO_STYLE);
      rIdx++;
    }

    // Fila Subtotal por chofer
    aoa.push([
      `TOTAL A PAGAR ${g.nombre.toUpperCase()}`,
      '', '', '', '',
      viajesChofer,
      '',
      totalChofer,
      `Pagado: $ ${g.totalPagado.toFixed(2)}`,
      `Pendiente: $ ${g.totalPendiente.toFixed(2)}`,
      '',
    ]);
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: 4 } });
    for (let c = 0; c < COLS_TOTAL; c++) {
      estilosPorCelda.set(`${rIdx}:${c}`, SUBTOTAL_STYLE);
    }
    formatosNumericos.set(`${rIdx}:7`, '#,##0.00');
    rIdx++;

    // Separación entre conductores
    aoa.push([]);
    rIdx++;
  }

  // Fila Total General Consolidado
  const totalGeneralViajes = opts.grupos.reduce((a, g) => a + g.filas.reduce((x, f) => x + f.viajes, 0), 0);
  const totalGeneralMonto = opts.grupos.reduce((a, g) => a + g.totalGeneral, 0);
  const totalGeneralPagado = opts.grupos.reduce((a, g) => a + g.totalPagado, 0);
  const totalGeneralPendiente = opts.grupos.reduce((a, g) => a + g.totalPendiente, 0);

  aoa.push([
    'TOTAL GENERAL DE LA NÓMINA',
    '', '', '', '',
    totalGeneralViajes,
    '',
    totalGeneralMonto,
    `Pagado: $ ${totalGeneralPagado.toFixed(2)}`,
    `Pendiente: $ ${totalGeneralPendiente.toFixed(2)}`,
    '',
  ]);
  merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: 4 } });
  for (let c = 0; c < COLS_TOTAL; c++) {
    estilosPorCelda.set(`${rIdx}:${c}`, TOTAL_GENERAL_STYLE);
  }
  formatosNumericos.set(`${rIdx}:7`, '#,##0.00');
  rIdx++;

  // Crear la hoja de cálculo
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const w = ws as Record<string, unknown>;

  // Asignar anchos de columnas
  w['!cols'] = [
    { wch: 12 }, // 0: Fecha
    { wch: 14 }, // 1: Vehículo
    { wch: 26 }, // 2: Equipo / Movimiento
    { wch: 22 }, // 3: Origen
    { wch: 22 }, // 4: Destino
    { wch: 12 }, // 5: Viajes
    { wch: 14 }, // 6: Precio ($)
    { wch: 16 }, // 7: Total a pagar ($)
    { wch: 16 }, // 8: Tipo viaje
    { wch: 16 }, // 9: Estado pago
    { wch: 14 }, // 10: Fecha pago
  ];

  w['!merges'] = merges;

  // Aplicar estilos y formatos
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < COLS_TOTAL; c++) {
      const coord = XLSX.utils.encode_cell({ r, c });
      const celda = (ws as Record<string, Celda>)[coord];
      const estilo = estilosPorCelda.get(`${r}:${c}`);
      const formato = formatosNumericos.get(`${r}:${c}`);
      if (celda) {
        if (estilo) celda.s = estilo;
        if (formato) celda.z = formato;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Nómina de Viajes');

  const nombreArchivo = `nomina-viajes-${opts.fechaHasta || 'completa'}.xlsx`;
  previewWorkbook(XLSX, wb, nombreArchivo);
}
