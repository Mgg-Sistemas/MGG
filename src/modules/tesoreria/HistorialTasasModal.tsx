import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { date } from '@/shared/lib/format';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { TasaCambio, TasaHoy } from '@/shared/lib/types';
import { getTasaHoy, getTasasMercado, listHistorialTasas, refrescarCop, refrescarTasa, setTasaManual } from './tasas.repository';
import { listMonedas } from './monedas';

/** Formatea una tasa (Bs por unidad) con 2 decimales en es-VE. */
function bs(n: number | null | undefined): string {
  if (n == null) return '—';
  return `Bs ${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** COP se cotiza como pesos por 1 USD (TRM), no en Bs. */
function copUsdFmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$ 1 = COP ${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formatea la tasa de una fila según la moneda (COP en pesos/USD, resto en Bs). */
function fmtTasa(moneda: string, n: number | null | undefined): string {
  return moneda === 'COP' ? copUsdFmt(n) : bs(n);
}

/** Nombre legible de la fuente de la tasa. */
function fuenteLabel(f: string | null | undefined): string {
  switch ((f ?? '').toLowerCase()) {
    case 'trm': return 'TRM Colombia';
    case 'er_api': return 'Respaldo (er-api)';
    case 'bcv': return 'BCV';
    case 'binance_p2p':
    case 'binance': return 'Binance P2P';
    case 'coingecko': return 'CoinGecko';
    case 'metals_dev': return 'metals.dev';
    case 'commoditypriceapi': return 'CommodityPriceAPI';
    case 'manual': return 'Manual';
    default: return f || '—';
  }
}

/** YYYY-MM-DD en horario de Venezuela para una fecha. */
function iso(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
}

/** Rango [desde, hasta] de un preset (hoy / ayer / mes / mes pasado / 7d / 30d). */
function rangoPreset(p: 'hoy' | 'ayer' | 'mes' | 'mespasado' | '7d' | '30d'): { desde: string; hasta: string } {
  const hoy = new Date();
  const h = iso(hoy);
  if (p === 'hoy') return { desde: h, hasta: h };
  if (p === 'ayer') { const a = new Date(hoy); a.setDate(a.getDate() - 1); return { desde: iso(a), hasta: iso(a) }; }
  if (p === '7d') { const d = new Date(hoy); d.setDate(d.getDate() - 6); return { desde: iso(d), hasta: h }; }
  if (p === '30d') { const d = new Date(hoy); d.setDate(d.getDate() - 29); return { desde: iso(d), hasta: h }; }
  if (p === 'mes') { const d = new Date(hoy.getFullYear(), hoy.getMonth(), 1); return { desde: iso(d), hasta: h }; }
  // mes pasado
  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return { desde: iso(ini), hasta: iso(fin) };
}

export function HistorialTasasModal({ tasaHoy, onClose, onRefreshed }: {
  tasaHoy: TasaHoy | null;
  onClose: () => void;
  onRefreshed?: (t: TasaHoy) => void;
}) {
  const { isAdmin: esAdmin, can } = usePermissions();
  const isAdmin = esAdmin || can('tesoreria', 'full');
  const [filtros, setFiltros] = useState<{ desde: string; hasta: string; moneda: string }>({ desde: '', hasta: '', moneda: '' });
  const [filas, setFilas] = useState<TasaCambio[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyCop, setBusyCop] = useState(false);
  // TRM del COP (pesos por 1 USD).
  const [copUsd, setCopUsd] = useState<number | null>(null);
  useEffect(() => { getTasasMercado().then((m) => setCopUsd(m.copUsd)).catch(() => { /* sin conexión */ }); }, []);
  // Corrección manual
  const [mMoneda, setMMoneda] = useState<string>('USD');
  const [mTasa, setMTasa] = useState('');
  // Monedas con tasa (todas las del sistema menos Bs, que es la base).
  const [monedasTasa, setMonedasTasa] = useState<string[]>(['USD', 'EUR', 'USDT', 'COP']);
  useEffect(() => {
    listMonedas()
      .then((ms) => setMonedasTasa(Array.from(new Set(['USD', 'EUR', ...ms])).filter((m) => m !== 'Bs')))
      .catch(() => { /* base */ });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setFilas(await listHistorialTasas({
        desde: filtros.desde || undefined,
        hasta: filtros.hasta || undefined,
        moneda: filtros.moneda || undefined,
      }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar el historial', 'error');
    } finally { setLoading(false); }
  }, [filtros]);

  useEffect(() => { void reload(); }, [reload]);

  async function actualizar() {
    setBusy(true);
    try {
      const t = await refrescarTasa();
      onRefreshed?.(t);
      toast(`Tasa actualizada: ${bs(t.usd)}/$`, 'success');
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error'); }
    finally { setBusy(false); }
  }

  async function actualizarCop() {
    setBusyCop(true);
    try {
      const cop = await refrescarCop();
      setCopUsd(cop);
      toast(`TRM Colombia actualizada: ${copUsdFmt(cop)}`, 'success');
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar la TRM', 'error'); }
    finally { setBusyCop(false); }
  }

  async function guardarManual() {
    const v = Number(mTasa);
    if (!Number.isFinite(v) || v <= 0) { toast('Indicá una tasa válida', 'error'); return; }
    setBusy(true);
    try {
      await setTasaManual({ moneda: mMoneda, tasa: v });
      setMTasa('');
      onRefreshed?.(await getTasaHoy());
      toast('Tasa corregida', 'success');
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-ghost" onClick={actualizarCop} disabled={busyCop}>{busyCop ? 'Actualizando…' : '↻ TRM COP'}</button>
      <button className="btn btn-primary" onClick={actualizar} disabled={busy}>{busy ? 'Actualizando…' : '↻ Actualizar BCV'}</button>
    </>
  );

  return (
    <Modal title="Historial de tasas" size="lg" onClose={onClose} footer={footer}>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div><div className="muted" style={{ fontSize: '.72rem' }}>USD (BCV) hoy</div><strong className="mono" style={{ fontSize: '1.1rem' }}>{bs(tasaHoy?.usd)}</strong></div>
          <div><div className="muted" style={{ fontSize: '.72rem' }}>EUR hoy</div><strong className="mono" style={{ fontSize: '1.1rem' }}>{bs(tasaHoy?.eur)}</strong></div>
          <div><div className="muted" style={{ fontSize: '.72rem' }}>COP (TRM Colombia)</div><strong className="mono" style={{ fontSize: '1.1rem' }}>{copUsdFmt(copUsd)}</strong></div>
          <div><div className="muted" style={{ fontSize: '.72rem' }}>Fecha</div><strong>{tasaHoy?.fecha ? date(tasaHoy.fecha) : '—'}</strong></div>
        </div>
      </div>

      {isAdmin && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-title"><span>Corregir tasa de hoy (manual)</span></div>
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Moneda</label>
              <select className="select" value={mMoneda} onChange={(e) => setMMoneda(e.target.value)}>
                {monedasTasa.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>{mMoneda === 'COP' ? 'Tasa (COP por $)' : 'Tasa (Bs)'}</label>
              <input className="input mono" type="number" min={0} step="0.01" value={mTasa} onChange={(e) => setMTasa(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-primary" onClick={guardarManual} disabled={busy}>Guardar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        {([['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mespasado', 'Mes pasado']] as const).map(([k, lbl]) => (
          <button key={k} className="btn btn-sm btn-ghost" onClick={() => { const r = rangoPreset(k); setFiltros((f) => ({ ...f, ...r })); }}>{lbl}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Desde</label>
          <input className="input" type="date" value={filtros.desde} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input className="input" type="date" value={filtros.hasta} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Moneda</label>
          <select className="select" value={filtros.moneda} onChange={(e) => setFiltros((f) => ({ ...f, moneda: e.target.value }))}>
            <option value="">Todas</option>
            {monedasTasa.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {(filtros.desde || filtros.hasta || filtros.moneda) && (
          <button className="btn btn-sm btn-ghost" onClick={() => setFiltros({ desde: '', hasta: '', moneda: '' })}>Limpiar</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <thead><tr><th>Fecha</th><th>Moneda</th><th style={{ textAlign: 'right' }}>Tasa</th><th>Fuente</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !filas.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin registros.</td></tr>}
            {!loading && filas.map((r) => (
              <tr key={r.id}>
                <td>{date(r.fecha)}</td>
                <td>{r.moneda}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{fmtTasa(r.moneda, r.tasa)}</td>
                <td><span className="muted">{fuenteLabel(r.fuente)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
