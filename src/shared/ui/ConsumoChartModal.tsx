import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { RankedBarChart, type ChartPoint } from '@/shared/ui/Chart';
import { money, num } from '@/shared/lib/format';

/** Una fila de consumo: un producto/combustible consumido en el período. */
export interface ConsumoRow {
  id: string;
  label: string;        // nombre visible
  sub?: string;         // sub-etiqueta (SKU, etc.)
  unidad: string;       // und / Lt / KG…
  cantidad: number;     // cantidad consumida (en su unidad)
  valor: number;        // equivalente en $ (cantidad × costo)
}

type Preset = 'hoy' | '7d' | '15d' | 'mes' | 'rango';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'hoy', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '15d', label: '15 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'rango', label: 'Rango' },
];

function isoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
}

/** Rango [desde, hasta] de un preset (hasta = ahora). */
function rangoDePreset(preset: Preset, desdeStr: string, hastaStr: string): { desde: Date; hasta: Date } {
  const ahora = new Date();
  if (preset === 'rango') {
    return {
      desde: new Date(`${desdeStr}T00:00:00`),
      hasta: new Date(`${hastaStr}T23:59:59`),
    };
  }
  const desde = new Date();
  if (preset === 'hoy') desde.setHours(0, 0, 0, 0);
  else if (preset === '7d') desde.setDate(desde.getDate() - 7);
  else if (preset === '15d') desde.setDate(desde.getDate() - 15);
  else if (preset === 'mes') { desde.setDate(1); desde.setHours(0, 0, 0, 0); }
  return { desde, hasta: ahora };
}

/**
 * Modal genérico de "Consumo": filtra por período (día, 7/15 días, mes o rango),
 * muestra una barra por cada producto/combustible consumido y una tabla con la
 * cantidad y su equivalente en $. Lo usan Inventario (por almacén) y Combustible.
 */
export function ConsumoChartModal({ title, subtitle, cargar, grupos, onClose }: {
  title: string;
  subtitle?: string;
  /** Carga las filas del período. Si hay `grupos`, recibe la clave del grupo activo. */
  cargar: (desde: Date, hasta: Date, grupo: string) => Promise<ConsumoRow[]>;
  /** Opcional: agrupaciones alternativas (ej. Por tipo / Por equipo). La 1ª es la activa. */
  grupos?: { key: string; label: string }[];
  onClose: () => void;
}) {
  const hoy = isoDay(new Date());
  const [preset, setPreset] = useState<Preset>('15d');
  const [desdeStr, setDesdeStr] = useState(hoy);
  const [hastaStr, setHastaStr] = useState(hoy);
  const [metrica, setMetrica] = useState<'valor' | 'cantidad'>('valor');
  const [grupo, setGrupo] = useState<string>(grupos?.[0]?.key ?? '');
  const [busca, setBusca] = useState('');
  const [rows, setRows] = useState<ConsumoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `cargar` suele llegar como arrow inline (nueva referencia en cada render).
  // Lo guardamos en un ref para que NO entre en las deps del efecto y evitar un
  // loop infinito de recargas (el modal quedaba en blanco / cargando sin fin).
  const cargarRef = useRef(cargar);
  useEffect(() => { cargarRef.current = cargar; });

  const recargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { desde, hasta } = rangoDePreset(preset, desdeStr, hastaStr);
      const data = await cargarRef.current(desde, hasta, grupo);
      setRows(data.slice().sort((a, b) => b.valor - a.valor));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el consumo');
      setRows([]);
    } finally { setLoading(false); }
  }, [preset, desdeStr, hastaStr, grupo]);
  useEffect(() => { void recargar(); }, [recargar]);

  // Buscador: filtra las filas por nombre/sub-etiqueta (no recarga; filtra lo ya cargado).
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q) || (r.sub ?? '').toLowerCase().includes(q));
  }, [rows, busca]);

  const totalCantidad = filtradas.reduce((a, r) => a + r.cantidad, 0);
  const totalValor = filtradas.reduce((a, r) => a + r.valor, 0);

  const data: ChartPoint[] = useMemo(
    () => filtradas.map((r) => ({
      label: r.label.length > 14 ? r.label.slice(0, 13) + '…' : r.label,
      value: metrica === 'valor' ? Math.round(r.valor * 100) / 100 : r.cantidad,
      tooltip: `${r.label}: ${num(r.cantidad)} ${r.unidad} · ${money(r.valor)}`,
    })),
    [filtradas, metrica],
  );

  return (
    <Modal title={title} size="xl" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {subtitle && <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>{subtitle}</p>}

      {/* Agrupación (opcional): ej. Por tipo / Por equipo */}
      {grupos && grupos.length > 1 && (
        <div style={{ display: 'inline-flex', gap: '.3rem', marginBottom: '.6rem' }}>
          {grupos.map((g) => (
            <button key={g.key} className={`btn btn-sm ${grupo === g.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setGrupo(g.key)}>{g.label}</button>
          ))}
        </div>
      )}

      {/* Filtros de período */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center', marginBottom: '.6rem' }}>
        {PRESETS.map((p) => (
          <button key={p.key} className={`btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPreset(p.key)}>{p.label}</button>
        ))}
        {preset === 'rango' && (
          <span style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input className="input" type="date" value={desdeStr} max={hastaStr} onChange={(e) => setDesdeStr(e.target.value)} style={{ width: 150 }} />
            <span className="muted">→</span>
            <input className="input" type="date" value={hastaStr} min={desdeStr} max={hoy} onChange={(e) => setHastaStr(e.target.value)} style={{ width: 150 }} />
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '.3rem' }}>
          <button className={`btn btn-sm ${metrica === 'valor' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMetrica('valor')}>Valor ($)</button>
          <button className={`btn btn-sm ${metrica === 'cantidad' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMetrica('cantidad')}>Cantidad</button>
        </span>
      </div>

      {/* Buscador: filtra la lista por nombre. */}
      <div style={{ marginBottom: '.6rem' }}>
        <input className="input no-upper" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="🔎 Buscar por nombre…" style={{ maxWidth: 320 }} />
      </div>

      {/* Totales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.6rem', marginBottom: '.75rem' }}>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>PRODUCTOS CONSUMIDOS</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{num(filtradas.length)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>CANTIDAD TOTAL</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{num(totalCantidad)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>VALOR TOTAL ($)</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-3)' }}>{money(totalValor)}</div>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      {/* Gráfica por producto */}
      <div className="card" style={{ padding: '.8rem', marginBottom: '.75rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem' }}>
          <span>Consumo por producto {metrica === 'valor' ? '(en $)' : '(en cantidad)'}</span>
          <span className="muted mono" style={{ fontSize: '.78rem' }}>{loading ? 'cargando…' : `${filtradas.length} producto(s)`}</span>
        </div>
        <RankedBarChart data={data}
          valueFormatter={(v) => (metrica === 'valor' ? money(v) : num(v))}
          emptyMessage={loading ? 'Cargando…' : 'Sin consumo en el período seleccionado.'} />
      </div>

      {/* Tabla detalle */}
      <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Valor ($)</th></tr></thead>
          <tbody>
            {!filtradas.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center' }}>{loading ? 'Cargando…' : 'Sin consumo en el período.'}</td></tr>}
            {filtradas.map((r) => (
              <tr key={r.id}>
                <td>{r.label}{r.sub ? <span className="muted mono" style={{ fontSize: '.72rem' }}> · {r.sub}</span> : null}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(r.cantidad)} {r.unidad}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(r.valor)}</td>
              </tr>
            ))}
          </tbody>
          {filtradas.length > 0 && (
            <tfoot>
              <tr>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalCantidad)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary-3)' }}>{money(totalValor)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Modal>
  );
}
