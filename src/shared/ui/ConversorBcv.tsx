import { useEffect, useState } from 'react';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';

/**
 * Conversor rápido Bs ⇄ $ a tasa BCV. Ayuda de escritorio (no persiste nada):
 * el usuario teclea un monto, elige la dirección y ve el equivalente. La tasa
 * arranca con la BCV del día (editable). Se usa, p. ej., al cargar ofertas de una
 * OC para pasar un precio en Bs a su equivalente en dólares y viceversa.
 */
export function ConversorBcv({ compact = true }: { compact?: boolean }) {
  const [monto, setMonto] = useState('');
  const [dir, setDir] = useState<'bs_usd' | 'usd_bs'>('bs_usd');
  const [tasa, setTasa] = useState('');

  useEffect(() => {
    getTasaHoy()
      .then((t) => { if (t.usd != null) setTasa(String(t.usd)); })
      .catch(() => { /* sin tasa: el usuario la teclea */ });
  }, []);

  const m = Number(monto) || 0;
  const t = Number(tasa) || 0;
  const equivale = t > 0 ? (dir === 'bs_usd' ? m / t : m * t) : 0;
  const monedaOut = dir === 'bs_usd' ? '$' : 'Bs';
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      className="card"
      style={{
        display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap',
        padding: compact ? '.55rem .8rem' : '.8rem 1rem', margin: 0,
        border: '1px solid var(--brand, #ff8a00)', background: 'var(--bg-2)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="muted" style={{ fontSize: '.68rem', letterSpacing: '.04em' }}>CONVERSOR · MONTO</span>
        <input className="input mono" type="number" min={0} step="any" style={{ width: 130, textAlign: 'right' }}
          value={monto} placeholder="0,00" onChange={(e) => setMonto(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="muted" style={{ fontSize: '.68rem', letterSpacing: '.04em' }}>DIRECCIÓN</span>
        <select className="select" style={{ width: 120 }} value={dir} onChange={(e) => setDir(e.target.value as 'bs_usd' | 'usd_bs')}>
          <option value="bs_usd">Bs → $</option>
          <option value="usd_bs">$ → Bs</option>
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="muted" style={{ fontSize: '.68rem', letterSpacing: '.04em' }}>TASA BCV (Bs/$)</span>
        <input className="input mono" type="number" min={0} step="any" style={{ width: 110, textAlign: 'right' }}
          value={tasa} placeholder="0,00" onChange={(e) => setTasa(e.target.value)} />
      </div>
      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
        <span className="muted" style={{ fontSize: '.72rem', display: 'block' }}>Equivale a</span>
        <strong className="mono" style={{ fontSize: '1.05rem', color: 'var(--primary-3)' }}>
          {monedaOut} {t > 0 ? fmt(equivale) : '—'}
        </strong>
      </div>
    </div>
  );
}
