import { useMemo } from 'react';

export interface ChartPoint {
  label: string;
  value: number;
  tooltip?: string;
}

interface BaseProps {
  data: ChartPoint[];
  height?: number;
  color?: string;
  yFormatter?: (v: number) => string;
  emptyMessage?: string;
}

const PAD = { top: 14, right: 12, bottom: 36, left: 64 };

/** Devuelve los ticks redondeados para el eje Y. */
function buildTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const step = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / mag;
  const niceStep = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let i = 0; i <= count + 1; i++) {
    const t = niceStep * i;
    ticks.push(t);
    if (t >= max) break;
  }
  return ticks;
}

export function LineChart({ data, height = 220, color = '#ff8a00', yFormatter = String, emptyMessage }: BaseProps) {
  const width = 720; // viewBox; el SVG escala vía 100% width
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const { path, points, ticks, max } = useMemo(() => {
    if (!data.length) return { path: '', points: [] as Array<{ x: number; y: number; pt: ChartPoint }>, ticks: [0], max: 0 };
    const maxV = Math.max(1, ...data.map((d) => d.value));
    const tk = buildTicks(maxV);
    const scaledMax = Math.max(maxV, tk[tk.length - 1]);
    const stepX = data.length === 1 ? 0 : innerW / (data.length - 1);
    const pts = data.map((pt, i) => ({
      x: PAD.left + (data.length === 1 ? innerW / 2 : i * stepX),
      y: PAD.top + innerH - (pt.value / scaledMax) * innerH,
      pt,
    }));
    const p = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return { path: p, points: pts, ticks: tk, max: scaledMax };
  }, [data, innerW, innerH]);

  if (!data.length) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
        {emptyMessage ?? 'Sin datos para el periodo seleccionado.'}
      </div>
    );
  }

  const showEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Gráfica de líneas">
      {ticks.map((t) => {
        const y = PAD.top + innerH - (t / max) * innerH;
        return (
          <g key={t}>
            <line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke="rgba(226,232,240,0.18)" strokeDasharray="3,3" />
            <text x={PAD.left - 8} y={y + 4} fontSize="11" fontWeight="600" textAnchor="end" fill="#e2e8f0">{yFormatter(t)}</text>
          </g>
        );
      })}

      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <path
        d={`${path} L ${points[points.length - 1].x.toFixed(1)} ${PAD.top + innerH} L ${points[0].x.toFixed(1)} ${PAD.top + innerH} Z`}
        fill={color}
        opacity={0.08}
      />

      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={color} />
          <title>{p.pt.tooltip ?? `${p.pt.label}: ${yFormatter(p.pt.value)}`}</title>
        </g>
      ))}

      {points.map((p, i) => (
        (i % showEvery === 0 || i === points.length - 1) && (
          <text key={`x${i}`} x={p.x} y={height - PAD.bottom + 18} fontSize="11" fontWeight="600" textAnchor="middle" fill="#e2e8f0">
            {p.pt.label}
          </text>
        )
      ))}
    </svg>
  );
}

/**
 * Gráfica de barras HORIZONTALES tipo ranking: una fila por ítem con la etiqueta
 * a la izquierda, una barra proporcional al valor y el valor a la derecha. El
 * color va de verde (el mayor) a rojo (el menor) según la posición. Espera la
 * data ya ordenada de mayor a menor.
 */
export function RankedBarChart({ data, valueFormatter = String, emptyMessage }: {
  data: ChartPoint[];
  valueFormatter?: (v: number) => string;
  emptyMessage?: string;
}) {
  if (!data.length) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
        {emptyMessage ?? 'Sin datos para el periodo seleccionado.'}
      </div>
    );
  }
  const ordenada = [...data].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...ordenada.map((d) => d.value));
  const n = ordenada.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem', maxHeight: 420, overflowY: 'auto' }}>
      {ordenada.map((d, i) => {
        const frac = n <= 1 ? 0 : i / (n - 1);
        const hue = 140 - 140 * frac; // 140 = verde · 0 = rojo
        const color = `hsl(${hue}, 62%, 46%)`;
        const pct = Math.max(2, (d.value / max) * 100);
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 230px) 1fr auto', alignItems: 'center', gap: '.6rem' }}>
            <span title={d.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '.85rem' }}>{d.label}</span>
            <div style={{ background: 'rgba(226,232,240,0.06)', borderRadius: 999, height: 18, overflow: 'hidden' }} title={d.tooltip ?? `${d.label}: ${valueFormatter(d.value)}`}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width .3s' }} />
            </div>
            <span className="mono" style={{ fontSize: '.85rem', whiteSpace: 'nowrap', fontWeight: 600 }}>{valueFormatter(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BarChart({ data, height = 220, color = '#10b981', yFormatter = String, emptyMessage }: BaseProps) {
  const width = 720;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const { bars, ticks, max } = useMemo(() => {
    if (!data.length) return { bars: [] as Array<{ x: number; y: number; w: number; h: number; pt: ChartPoint }>, ticks: [0], max: 0 };
    const maxV = Math.max(1, ...data.map((d) => d.value));
    const tk = buildTicks(maxV);
    const scaledMax = Math.max(maxV, tk[tk.length - 1]);
    const slot = innerW / data.length;
    const w = Math.max(8, slot * 0.7);
    const bs = data.map((pt, i) => {
      const x = PAD.left + slot * i + (slot - w) / 2;
      const h = (pt.value / scaledMax) * innerH;
      return {
        x,
        y: PAD.top + innerH - h,
        w,
        h,
        pt,
      };
    });
    return { bars: bs, ticks: tk, max: scaledMax };
  }, [data, innerW, innerH]);

  if (!data.length) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
        {emptyMessage ?? 'Sin datos para el periodo seleccionado.'}
      </div>
    );
  }

  const showEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Gráfica de barras">
      {ticks.map((t) => {
        const y = PAD.top + innerH - (t / max) * innerH;
        return (
          <g key={t}>
            <line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke="rgba(226,232,240,0.18)" strokeDasharray="3,3" />
            <text x={PAD.left - 8} y={y + 4} fontSize="11" fontWeight="600" textAnchor="end" fill="#e2e8f0">{yFormatter(t)}</text>
          </g>
        );
      })}

      {bars.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={color} rx={3} />
          <title>{b.pt.tooltip ?? `${b.pt.label}: ${yFormatter(b.pt.value)}`}</title>
          {(i % showEvery === 0 || i === bars.length - 1) && (
            <text x={b.x + b.w / 2} y={height - PAD.bottom + 18} fontSize="11" fontWeight="600" textAnchor="middle" fill="#e2e8f0">
              {b.pt.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
