import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { TasaHoy } from '@/shared/lib/types';
import {
  getTasaHoy, getBinance3, getTasasMercado, getCripto, getCriptoCache, getMetales, setMetalManual,
  refrescarTasa, refrescarBinanceP2P, refrescarCop, refrescarMetales,
  type Binance3, type CriptoTasa, type MetalTasa, type TasasMercado,
} from './tasas.repository';

/** Bs con 2 decimales. */
function bs(n: number | null | undefined): string {
  return n == null ? '—' : `Bs ${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** $ con 2 decimales. */
function usd(n: number | null | undefined): string {
  return n == null ? '—' : `$ ${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** COP (pesos por 1 USD). */
function cop(n: number | null | undefined): string {
  return n == null ? '—' : `COP ${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Tarjeta de tasa con el estilo kpi del sistema (como el dashboard). */
function RateCard({ icon, label, value, sub, alert, onClick }: {
  icon: string; label: string; value: string; sub?: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <div className="kpi" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}
      title={onClick ? 'Clic para cargar el precio manualmente' : undefined}>
      <div className="icon">{icon}</div>
      <div className="label">{label}</div>
      <div className="value mono" style={{ fontSize: '1.25rem' }}>{value}</div>
      <div className={alert ? 'delta down' : 'delta'}>{sub ?? ''}</div>
    </div>
  );
}

/**
 * Vista de tasas en tarjetas: divisas (BCV, USDT/VES, TRM), cripto y metales.
 * Se actualiza automáticamente 2×/día (cron del servidor) y permite refrescar
 * a mano. El historial vive en el modal "Historial Tasas".
 */
export function TasasView() {
  const [tasaHoy, setTasaHoy] = useState<TasaHoy | null>(null);
  const [binance, setBinance] = useState<Binance3 | null>(null);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  const [cripto, setCripto] = useState<CriptoTasa[]>([]);
  const [metales, setMetales] = useState<MetalTasa[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Admin o quien tenga FULL CONTROL de Tesorería puede cargar/editar tasas manuales.
  const { isAdmin: esAdmin, can } = usePermissions();
  const isAdmin = esAdmin || can('tesoreria', 'full');

  // Carga inicial: todo en paralelo y leyendo de snapshots (cripto desde cache,
  // sin pegarle a CoinGecko). El cron mantiene los valores al día.
  const cargar = useCallback(async () => {
    setLoading(true);
    const [t, b, m, c, me] = await Promise.all([
      getTasaHoy().catch(() => null),
      getBinance3().catch(() => null),
      getTasasMercado().catch(() => null),
      getCriptoCache().catch(() => [] as CriptoTasa[]),
      getMetales().catch(() => [] as MetalTasa[]),
    ]);
    setTasaHoy(t); setBinance(b); setMercado(m); setCripto(c); setMetales(me);
    setLoading(false);
    // Si no hay cripto en cache todavía, traela en vivo en segundo plano.
    if (!c.some((x) => x.usd != null)) {
      getCripto().then((live) => { if (live.some((x) => x.usd != null)) setCripto(live); }).catch(() => {});
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function refrescar() {
    setBusy(true);
    try {
      // Refresco en vivo de todo: BCV, Binance, TRM, cripto (CoinGecko) y metales.
      const [, , , criptoLive] = await Promise.all([
        refrescarTasa().catch(() => null),
        refrescarBinanceP2P().catch(() => null),
        refrescarCop().catch(() => null),
        getCripto().catch(() => null),
        refrescarMetales().catch(() => null),
      ]);
      await cargar();
      if (criptoLive && criptoLive.some((x) => x.usd != null)) setCripto(criptoLive);
      toast('Tasas actualizadas', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron actualizar las tasas', 'error');
    } finally { setBusy(false); }
  }

  async function cargarMetalManual(m: MetalTasa) {
    const txt = window.prompt(`Precio de ${m.label} en USD por ${m.unidad}:`, m.usd != null ? String(m.usd) : '');
    if (txt == null) return;
    const v = Number(txt.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) { toast('Indicá un precio válido', 'error'); return; }
    try {
      await setMetalManual(m.key, v);
      await cargar();
      toast(`${m.label} actualizado`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
  }

  const usdUsdt = binance?.promedio ?? mercado?.usdtVes ?? null;
  const copUsd = mercado?.copUsd ?? null;
  // "Configurá la API" solo si faltan los metales automáticos (no cuenta el estaño, que es manual).
  const autoFaltante = metales.some((m) => !m.manual) && !metales.some((m) => !m.manual && m.usd != null);
  const ultimaCripto = cripto.find((c) => c.at)?.at ?? null;

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.6rem' }}>
        <div className="card-title" style={{ margin: 0 }}><span>Tasas del día</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="muted" style={{ fontSize: '.72rem' }}>
            {tasaHoy?.fecha ? `BCV: ${tasaHoy.fecha}` : ''}{ultimaCripto ? ` · cripto: ${dateTime(ultimaCripto)}` : ''}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={refrescar} disabled={busy}>{busy ? 'Actualizando…' : '↻ Actualizar'}</button>
        </div>
      </div>

      {/* Divisas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.75rem' }}>
        <RateCard icon="💵" label="DÓLAR BCV" value={bs(tasaHoy?.usd)} sub="Venezuela" />
        <RateCard icon="💶" label="EURO BCV" value={bs(tasaHoy?.eur)} sub="Venezuela" />
        <RateCard icon="🟡" label="P2P USDT/VES" value={bs(usdUsdt)}
          sub={binance ? `Binance · C ${bs(binance.buy)} / V ${bs(binance.sell)}` : 'Binance'} />
        <RateCard icon="🇨🇴" label="TRM COLOMBIA" value={cop(copUsd)} sub="COP/USD · oficial" />
      </div>

      {/* Cripto */}
      <div className="card-title" style={{ margin: '1rem 0 .5rem' }}><span>Cripto (USD)</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.75rem' }}>
        {cripto.length === 0 && loading && <div className="muted" style={{ fontSize: '.85rem' }}>Cargando…</div>}
        {cripto.map((c) => (
          <RateCard key={c.key} icon="🪙" label={c.label.toUpperCase()} value={usd(c.usd)} sub="CoinGecko" />
        ))}
      </div>

      {/* Metales */}
      <div className="card-title" style={{ margin: '1rem 0 .5rem' }}>
        <span>Metales (USD)</span>
        {autoFaltante && <span className="muted" style={{ fontSize: '.72rem' }}>· configurá la API de metales para activarlos</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.75rem' }}>
        {metales.map((m) => (
          <RateCard
            key={m.key}
            icon="⛏"
            label={m.label}
            value={usd(m.usd)}
            sub={m.manual ? `${m.unidad} · ${isAdmin ? 'clic para cargar' : 'manual'}` : m.unidad}
            alert={m.usd == null}
            onClick={m.manual && isAdmin ? () => cargarMetalManual(m) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
