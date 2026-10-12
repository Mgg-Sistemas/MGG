/* ============================================================
   MGG · Choferes / Conductores · ¿De qué caja sale (o a cuál entra) la plata?

   Casilla «Registrar en Tesorería» + caja / cuenta / moneda. El monto se
   fija en $; si la cuenta elegida es en Bs, se convierte a la tasa del día
   y se muestra cuánto sale en Bs. Devuelve un `CajaDestino` o null.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import type { CajaSaldo } from '@/shared/lib/types';
import { money } from '@/shared/lib/format';
import { listSaldos } from '@/modules/tesoreria/cajaSaldos.repository';
import type { CajaDestino } from './choferes.repository';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function CajaSelector({ montoUsd, tasa, modo, onChange, disabled }: {
  montoUsd: number;
  /** Bs por $ del día (para cuentas en Bs). */
  tasa: number | null;
  /** egreso = sale plata (anticipo, gasto, pago) · ingreso = entra (devolución). */
  modo: 'egreso' | 'ingreso';
  onChange: (v: CajaDestino | null) => void;
  disabled?: boolean;
}) {
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  const [activo, setActivo] = useState(false);
  const [sel, setSel] = useState('');

  useEffect(() => { listSaldos().then(setSaldos).catch(() => setSaldos([])); }, []);

  const opciones = useMemo(() => saldos
    .filter((s) => modo === 'ingreso' || (Number(s.saldo) || 0) > 0)
    .map((s) => ({
      key: `${s.caja_id}|${s.cuenta}|${s.moneda}`,
      label: `${s.caja?.nombre ?? 'Caja'} · ${s.cuenta} · ${s.moneda} (saldo ${money(Number(s.saldo) || 0, s.moneda)})`,
      s,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es')), [saldos, modo]);

  const elegido = opciones.find((o) => o.key === sel)?.s ?? null;
  const esBs = (elegido?.moneda ?? '').toUpperCase() === 'BS';
  const monto = elegido ? (esBs ? (tasa && tasa > 0 ? r2(montoUsd * tasa) : 0) : r2(montoUsd)) : 0;

  // Avisa al padre cada vez que cambia algo relevante.
  useEffect(() => {
    if (!activo || !elegido || monto <= 0) { onChange(null); return; }
    onChange({ cajaId: elegido.caja_id, cuenta: elegido.cuenta, moneda: elegido.moneda, monto });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, sel, monto]);

  const insuficiente = modo === 'egreso' && elegido && monto > (Number(elegido.saldo) || 0) + 0.004;

  return (
    <div className="card" style={{ padding: '.6rem .75rem', margin: '.5rem 0 0' }}>
      <label style={{ display: 'flex', gap: '.45rem', alignItems: 'center', cursor: disabled ? 'default' : 'pointer', fontWeight: 600, fontSize: '.88rem' }}>
        <input type="checkbox" checked={activo} disabled={disabled} onChange={(e) => setActivo(e.target.checked)} />
        💵 Registrar en Tesorería ({modo === 'egreso' ? 'sale de una caja' : 'entra a una caja'})
      </label>
      {activo && (
        <div style={{ marginTop: '.45rem', display: 'grid', gap: '.4rem' }}>
          <select className="select" value={sel} disabled={disabled} onChange={(e) => setSel(e.target.value)} aria-label="Caja, cuenta y moneda">
            <option value="">— elige caja · cuenta · moneda —</option>
            {opciones.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {!opciones.length && <span className="muted" style={{ fontSize: '.8rem' }}>No hay cajas con saldo. Ingresa fondos en Tesorería o guarda sin mover caja.</span>}
          {elegido && (
            <div className="muted" style={{ fontSize: '.82rem' }}>
              {esBs
                ? (tasa && tasa > 0
                  ? <>Se registran <strong>{money(monto, 'Bs')}</strong> ({money(montoUsd)} a tasa {tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 })}).</>
                  : <span style={{ color: 'var(--danger)' }}>No hay tasa del día para convertir a Bs: elige una cuenta en $ o espera la tasa.</span>)
                : <>Se registran <strong>{money(monto, elegido.moneda)}</strong> en {elegido.caja?.nombre ?? 'la caja'}.</>}
              {insuficiente && <span style={{ color: 'var(--danger)', display: 'block' }}>⛔ Saldo insuficiente en esa cuenta.</span>}
            </div>
          )}
        </div>
      )}
      {!activo && <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>Sin la casilla, queda solo en el módulo: la plata se registra aparte en Tesorería.</div>}
    </div>
  );
}
