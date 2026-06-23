import { useCallback, useEffect, useState } from 'react';
import type { TasaHoy } from '@/shared/lib/types';
import { getTasaHoy, getTasasMercado, refrescarTasasSiVencido, type TasasMercado } from './tasas.repository';
import { HistorialTasasModal } from './HistorialTasasModal';

/** Tasa (Bs por unidad) con 2 decimales, es-VE. */
function r2(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fecha corta DD MMM (es-VE, Caracas). */
function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: 'short', timeZone: 'America/Caracas' }).format(new Date(`${iso}T12:00:00`));
  } catch { return iso; }
}

/** Chip de tasas BCV (USD/EUR del día) en el navbar. Clic → Historial de Tasas. */
export function TasaChip() {
  const [tasa, setTasa] = useState<TasaHoy | null>(null);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  const [open, setOpen] = useState(false);

  const cargar = useCallback(() => {
    getTasaHoy().then(setTasa).catch(() => { /* offline / sin desplegar */ });
    getTasasMercado().then(setMercado).catch(() => { /* sin función desplegada */ });
  }, []);

  useEffect(() => {
    cargar();
    // Si las tasas están vencidas (>11 h), dispara el refresco perezoso y re-lee.
    refrescarTasasSiVencido().then(cargar).catch(() => { /* sin red / función */ });
    // Re-sincroniza cuando algo refresca las tasas (modal "Actualizar ahora"),
    // al volver a la pestaña y cada 5 min, para que el navbar no quede desfasado.
    const onTasas = () => cargar();
    window.addEventListener('mgg:tasas', onTasas);
    window.addEventListener('focus', onTasas);
    const id = window.setInterval(cargar, 5 * 60_000);
    // Cada hora: fuerza el refresco de las tasas desde la fuente (BCV/Binance/COP) si el
    // último dato tiene ≥1 h, y re-lee. Así el navbar se actualiza cada hora.
    const idHora = window.setInterval(() => { refrescarTasasSiVencido(1).then(cargar).catch(() => { /* sin red / función */ }); }, 60 * 60_000);
    return () => {
      window.removeEventListener('mgg:tasas', onTasas);
      window.removeEventListener('focus', onTasas);
      window.clearInterval(id);
      window.clearInterval(idHora);
    };
  }, [cargar]);

  if (!tasa || tasa.usd == null) return null;

  // Tasa Binance (USDT/VES) y margen de ahorro vs BCV, para mostrarlos junto al BCV.
  const binance = mercado?.usdtVes ?? null;
  const bcvRef = mercado?.bcvUsd ?? tasa.usd;
  const margen = binance && bcvRef && binance > 0 ? ((binance - bcvRef) / binance) * 100 : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Tasas de referencia (Bs por USD) · BCV ${r2(tasa.usd)}${binance != null ? ` · Binance ${r2(binance)}${margen != null ? ` · ahorro ${r2(margen)} %` : ''}` : ''} · ${tasa.fecha ?? ''} · clic para ver el historial`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '.5rem',
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
          padding: '.35rem .6rem', borderRadius: 'var(--r-md)', cursor: 'pointer',
          fontSize: '.8rem', lineHeight: 1, whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: 'var(--brand, #ff8a00)', fontWeight: 700 }}>BCV</span>
        <span className="mono">$ {r2(tasa.usd)}</span>
        {tasa.eur != null && <span className="mono">€ {r2(tasa.eur)}</span>}
        {binance != null && (
          <>
            <span style={{ opacity: .35 }}>·</span>
            <span style={{ color: '#f0b90b', fontWeight: 700 }} title="Binance P2P (USDT/VES)">BIN</span>
            <span className="mono">Bs {r2(binance)}</span>
            {margen != null && (
              <span className="mono" style={{ color: margen > 0 ? '#16c784' : 'var(--muted)' }} title="Margen de ahorro pagando a BCV en vez de Binance">↓{r2(margen)}%</span>
            )}
          </>
        )}
        <span className="muted" style={{ fontSize: '.7rem' }}>{fechaCorta(tasa.fecha)}</span>
      </button>
      {open && <HistorialTasasModal tasaHoy={tasa} onClose={() => setOpen(false)} onRefreshed={setTasa} />}
    </>
  );
}
