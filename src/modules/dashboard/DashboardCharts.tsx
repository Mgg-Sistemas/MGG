import { useEffect, useMemo, useState } from 'react';
import { LineChart, BarChart, type ChartPoint } from '@/shared/ui/Chart';
import { money, num } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import {
  getSerieValorInventario,
  getSerieProduccion,
  type BucketKind,
  type RangoFechas,
  type SeriePoint,
} from './dashboard.series';

type Preset = '7d' | '30d' | '90d' | '12m' | 'custom';

function dateInputValue(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function parseDateInput(value: string): Date {
  const [y, m, d] = value.split('-').map((s) => parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function rangoFromPreset(preset: Preset, bucket: BucketKind): RangoFechas {
  const hasta = new Date();
  hasta.setHours(23, 59, 59, 999);
  const desde = new Date(hasta);
  if (preset === '7d') desde.setDate(desde.getDate() - 6);
  else if (preset === '30d') desde.setDate(desde.getDate() - 29);
  else if (preset === '90d') desde.setDate(desde.getDate() - 89);
  else desde.setMonth(desde.getMonth() - 11);
  desde.setHours(0, 0, 0, 0);
  return { desde, hasta, bucket };
}

interface FiltroChartProps {
  preset: Preset;
  bucket: BucketKind;
  desde: Date;
  hasta: Date;
  setPreset: (p: Preset) => void;
  setBucket: (b: BucketKind) => void;
  setDesde: (d: Date) => void;
  setHasta: (d: Date) => void;
}

function FiltroChart({ preset, bucket, desde, hasta, setPreset, setBucket, setDesde, setHasta }: FiltroChartProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', marginBottom: '.75rem' }}>
      <div className="view-switch" style={{ marginTop: 0, padding: '.15rem' }}>
        {(['7d', '30d', '90d', '12m', 'custom'] as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`view-switch-tab${preset === p ? ' active' : ''}`}
            onClick={() => setPreset(p)}
            style={{ padding: '.35rem .75rem', fontSize: '.78rem' }}
          >
            {p === '7d' ? '7 días' : p === '30d' ? '30 días' : p === '90d' ? '90 días' : p === '12m' ? '12 meses' : 'Rango'}
          </button>
        ))}
      </div>

      <select
        className="select"
        style={{ maxWidth: 130, fontSize: '.82rem' }}
        value={bucket}
        onChange={(e) => setBucket(e.target.value as BucketKind)}
        title="Granularidad del eje X"
      >
        <option value="day">Por día</option>
        <option value="week">Por semana</option>
        <option value="month">Por mes</option>
      </select>

      {preset === 'custom' && (
        <>
          <input
            type="date"
            className="input"
            value={dateInputValue(desde)}
            onChange={(e) => setDesde(parseDateInput(e.target.value))}
            style={{ maxWidth: 160 }}
          />
          <input
            type="date"
            className="input"
            value={dateInputValue(hasta)}
            onChange={(e) => setHasta(parseDateInput(e.target.value))}
            style={{ maxWidth: 160 }}
          />
        </>
      )}
    </div>
  );
}

function useSerie(loader: (rango: RangoFechas) => Promise<SeriePoint[]>) {
  const [preset, setPreset] = useState<Preset>('30d');
  const [bucket, setBucket] = useState<BucketKind>('day');
  const inicial = useMemo(() => rangoFromPreset('30d', 'day'), []);
  const [desde, setDesde] = useState<Date>(inicial.desde);
  const [hasta, setHasta] = useState<Date>(inicial.hasta);
  const [serie, setSerie] = useState<SeriePoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (preset !== 'custom') {
      const r = rangoFromPreset(preset, bucket);
      setDesde(r.desde);
      setHasta(r.hasta);
    }
  }, [preset, bucket]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader({ desde, hasta, bucket })
      .then((s) => { if (!cancelled) setSerie(s); })
      .catch((e: unknown) => {
        if (!cancelled) toast(e instanceof Error ? e.message : 'No se pudo cargar la serie', 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [desde, hasta, bucket, loader]);

  return { preset, setPreset, bucket, setBucket, desde, setDesde, hasta, setHasta, serie, loading };
}

export function GraficaValorInventario() {
  const { preset, setPreset, bucket, setBucket, desde, setDesde, hasta, setHasta, serie, loading } =
    useSerie(getSerieValorInventario);

  const data: ChartPoint[] = useMemo(
    () => serie.map((s) => ({
      label: s.label,
      value: Math.round(s.value),
      tooltip: `${s.label}: ${money(s.value)}`,
    })),
    [serie],
  );

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <div className="card-title" style={{ marginBottom: '.5rem' }}>
        <span>Valor del inventario</span>
        <span className="muted mono" style={{ fontSize: '.78rem' }}>
          {loading ? 'cargando…' : `${data.length} ${bucket === 'day' ? 'días' : bucket === 'week' ? 'semanas' : 'meses'}`}
        </span>
      </div>
      <FiltroChart preset={preset} bucket={bucket} desde={desde} hasta={hasta}
        setPreset={setPreset} setBucket={setBucket} setDesde={setDesde} setHasta={setHasta} />
      <LineChart data={data} yFormatter={(v) => money(v)} color="#ff8a00" />
    </div>
  );
}

export function GraficaProduccion() {
  const { preset, setPreset, bucket, setBucket, desde, setDesde, hasta, setHasta, serie, loading } =
    useSerie(getSerieProduccion);
  const [metric, setMetric] = useState<'count' | 'valor'>('count');

  const data: ChartPoint[] = useMemo(
    () => serie.map((s) => ({
      label: s.label,
      value: metric === 'count' ? s.count : Math.round(s.value),
      tooltip: `${s.label}: ${metric === 'count' ? `${num(s.count)} und producidas` : money(s.value)}`,
    })),
    [serie, metric],
  );

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <div className="card-title" style={{ marginBottom: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
        <span>Fundición finalizada</span>
        <div className="view-switch" style={{ marginTop: 0, padding: '.15rem' }}>
          <button type="button" className={`view-switch-tab${metric === 'count' ? ' active' : ''}`} onClick={() => setMetric('count')} style={{ padding: '.35rem .75rem', fontSize: '.78rem' }}>
            Unidades
          </button>
          <button type="button" className={`view-switch-tab${metric === 'valor' ? ' active' : ''}`} onClick={() => setMetric('valor')} style={{ padding: '.35rem .75rem', fontSize: '.78rem' }}>
            Valor $
          </button>
        </div>
      </div>
      <span className="muted mono" style={{ fontSize: '.78rem' }}>
        {loading ? 'cargando…' : `${data.length} ${bucket === 'day' ? 'días' : bucket === 'week' ? 'semanas' : 'meses'}`}
      </span>
      <div style={{ marginTop: '.5rem' }}>
        <FiltroChart preset={preset} bucket={bucket} desde={desde} hasta={hasta}
          setPreset={setPreset} setBucket={setBucket} setDesde={setDesde} setHasta={setHasta} />
        <BarChart data={data} yFormatter={metric === 'count' ? num : money} color="#10b981" />
      </div>
    </div>
  );
}

/** Componente combinado lazy. */
export default function DashboardCharts() {
  return (
    <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', marginTop: '1rem' }}>
      <GraficaValorInventario />
      <GraficaProduccion />
    </div>
  );
}
