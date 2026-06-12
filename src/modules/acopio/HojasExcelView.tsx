import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import type { CeldaExcel, HojaExcel } from '@/shared/lib/types';
import { getHojaExcel } from './hojas.repository';

/* ============================================================
   Vistas de los procesos del Excel, adaptadas al estilo del
   sistema (no es la rejilla del Excel): cada hoja se interpreta
   y se muestra como tabla limpia o como resumen de tarjetas.
   ============================================================ */

type VistaCfg =
  | { nombre: string; titulo: string; subtitulo?: string; tipo: 'tabla'; headerRow: number; dataStart: number }
  | { nombre: string; titulo: string; subtitulo?: string; tipo: 'resumen'; desde: number };

const VISTAS: VistaCfg[] = [
  { nombre: 'RESUMEN CAJA PERAMANAL GT', titulo: 'Resumen de Caja Peramanal', tipo: 'resumen', desde: 1 },
  { nombre: 'Movimiento de Caja Mayo 2026', titulo: 'Movimiento de Caja · Mayo 2026', tipo: 'resumen', desde: 0 },
  { nombre: 'CONSUMO MAZOS MARTILLOS GT', titulo: 'Consumo de Mazos y Martillos', subtitulo: 'Entrega y existencia de martillos', tipo: 'tabla', headerRow: 3, dataStart: 4 },
  { nombre: 'REGISTROS MESA SECA GT - 03-06-', titulo: 'Registros · Mesa Seca', subtitulo: 'Material por caja, mesa seca y bruto (Kg)', tipo: 'tabla', headerRow: 10, dataStart: 11 },
  { nombre: 'REGISTROS CUADRILLAS', titulo: 'Registros de Cuadrillas', subtitulo: 'Asistencia y producción por cuadrilla', tipo: 'tabla', headerRow: 14, dataStart: 15 },
  { nombre: 'CLASIFICACIONES', titulo: 'Clasificaciones', subtitulo: 'Categorías por grupo', tipo: 'tabla', headerRow: 0, dataStart: 1 },
];

const txt = (c?: CeldaExcel) => (c && c.v ? c.v.trim() : '');
const esNumero = (s: string) => /^-?\$?\s?[\d.,]+%?$/.test(s.trim()) && /\d/.test(s);

export function HojasExcelView() {
  const [sel, setSel] = useState<string>(VISTAS[0].nombre);
  const [hoja, setHoja] = useState<HojaExcel | null>(null);
  const [loading, setLoading] = useState(false);

  const cfg = VISTAS.find((v) => v.nombre === sel)!;

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    getHojaExcel(sel)
      .then((h) => { if (!cancel) setHoja(h); })
      .catch((e) => toast(e instanceof Error ? e.message : 'Error al cargar', 'error'))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [sel]);

  return (
    <div>
      <div className="filterbar" style={{ flexWrap: 'wrap', gap: '.4rem' }}>
        {VISTAS.map((v) => (
          <button key={v.nombre} className={`btn btn-sm ${sel === v.nombre ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSel(v.nombre)}>
            {v.titulo}
          </button>
        ))}
      </div>

      <div className="page-head" style={{ marginBottom: '.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{cfg.titulo}</h2>
          {cfg.subtitulo && <p className="muted" style={{ margin: '.2rem 0 0' }}>{cfg.subtitulo}</p>}
        </div>
      </div>

      {loading || !hoja ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : cfg.tipo === 'resumen' ? (
        <ResumenView hoja={hoja} desde={cfg.desde} />
      ) : (
        <TablaView hoja={hoja} headerRow={cfg.headerRow} dataStart={cfg.dataStart} />
      )}
    </div>
  );
}

/** Tabla limpia con el estilo del sistema (detecta columnas con contenido). */
function TablaView({ hoja, headerRow, dataStart }: { hoja: HojaExcel; headerRow: number; dataStart: number }) {
  const rows = hoja.datos ?? [];
  const header = rows[headerRow] ?? [];
  const data = rows.slice(dataStart);

  // Columnas con contenido (en header o en datos).
  const cols = useMemo(() => {
    const keep: number[] = [];
    for (let c = 0; c < hoja.cols; c++) {
      const hasHeader = txt(header[c]) !== '';
      const hasData = data.some((r) => txt(r[c]) !== '');
      if (hasHeader || hasData) keep.push(c);
    }
    return keep;
  }, [hoja, header, data]);

  const filas = data.filter((r) => cols.some((c) => txt(r[c]) !== ''));

  if (!cols.length) return <EmptyState message="Hoja sin datos." icon="📄" />;

  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: '.82rem' }}>
        <thead>
          <tr>{cols.map((c) => <th key={c} style={{ whiteSpace: 'pre-line' }}>{txt(header[c]) || '·'}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = txt(r[c]);
                const numero = esNumero(v);
                return <td key={c} className={numero ? 'mono' : undefined} style={{ textAlign: numero ? 'right' : 'left', whiteSpace: 'pre-wrap' }}>{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: '.75rem', marginTop: '.4rem' }}>{filas.length} registros</p>
    </div>
  );
}

/** Resumen de tarjetas: pares etiqueta/valor; las filas de una sola celda son encabezados. */
function ResumenView({ hoja, desde }: { hoja: HojaExcel; desde: number }) {
  const rows = (hoja.datos ?? []).slice(desde);
  const items: { label: string; value?: string; heading?: boolean }[] = [];
  for (const r of rows) {
    const cells = r.map(txt).filter((v) => v !== '');
    if (!cells.length) continue;
    if (cells.length === 1) items.push({ label: cells[0], heading: true });
    else items.push({ label: cells[0], value: cells.slice(1).join('  ·  ') });
  }
  if (!items.length) return <EmptyState message="Sin datos." icon="📄" />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '.75rem' }}>
      {items.map((it, i) =>
        it.heading ? (
          <div key={i} style={{ gridColumn: '1 / -1', fontWeight: 700, color: 'var(--primary-3)', marginTop: i ? '.5rem' : 0 }}>{it.label}</div>
        ) : (
          <div key={i} className="card" style={{ padding: '.7rem .8rem' }}>
            <div className="muted" style={{ fontSize: '.74rem' }}>{it.label}</div>
            <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '.2rem' }}>{it.value}</div>
          </div>
        ),
      )}
    </div>
  );
}
