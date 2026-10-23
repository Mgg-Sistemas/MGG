/* ============================================================
   MGG · RRHH · Conversor $ ↔ Real brasileño (23/10/2026)

   El mismo conversor de Compras (monto · dirección · tasa · «Equivale a»), pero de
   dólares a Real brasileño: por ejemplo 20 $ = R$ 100,86 con la tasa 5,0428.
   Sale al cargar la nómina de una empresa cuya moneda de pago es el Real. La tasa
   viene puesta con la del día (se trae de una API pública) y se puede escribir a
   mano; es la MISMA tasa que queda en la nómina y en los recibos.
   ============================================================ */
import { useState } from 'react';
import { money, date } from '@/shared/lib/format';
import { aDolaresDesdeReal, aReal } from '@/modules/tesoreria/tasas.repository';
import { reales, tasaRealTexto } from './nominaReciboPdf';

export type DireccionReal = 'usd_a_brl' | 'brl_a_usd';

/** El resultado de la conversión (o null si falta el monto o la tasa). */
export function convertirReal(monto: number, tasa: number, dir: DireccionReal): number | null {
  if (!(monto > 0) || !(tasa > 0)) return null;
  return dir === 'usd_a_brl' ? aReal(monto, tasa) : aDolaresDesdeReal(monto, tasa);
}

export function ConversorReal({ tasa, tasaFecha, onTasa, onActualizar, actualizando }: {
  /** R$ por 1 USD. */
  tasa: number;
  tasaFecha: string | null;
  onTasa: (t: number) => void;
  onActualizar: () => void;
  actualizando: boolean;
}) {
  const [monto, setMonto] = useState('');
  const [dir, setDir] = useState<DireccionReal>('usd_a_brl');
  const resultado = convertirReal(Number(monto) || 0, tasa, dir);

  return (
    <div className="card" style={{ padding: '.6rem .8rem', marginTop: '.7rem', borderColor: 'var(--brand, #ff8a00)', display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'flex-end' }}>
      <div className="form-row" style={{ margin: 0 }}>
        <label style={{ fontSize: '.72rem' }}>Conversor · monto</label>
        <input className="input mono" name="cr-monto" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" style={{ width: 140 }} />
      </div>
      <div className="form-row" style={{ margin: 0 }}>
        <label style={{ fontSize: '.72rem' }}>Dirección</label>
        <select className="select" value={dir} onChange={(e) => setDir(e.target.value as DireccionReal)} style={{ width: 150 }}>
          <option value="usd_a_brl">$ → R$</option>
          <option value="brl_a_usd">R$ → $</option>
        </select>
      </div>
      <div className="form-row" style={{ margin: 0 }}>
        <label style={{ fontSize: '.72rem' }}>Tasa Real (R$/$){tasaFecha ? ` · ${date(tasaFecha)}` : ''}</label>
        <input className="input mono" name="cr-tasa" type="number" min={0} step="any" value={tasa || ''} onChange={(e) => onTasa(Number(e.target.value) || 0)} placeholder="R$ por 1 $" style={{ width: 130 }} />
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onActualizar} disabled={actualizando} title="Traer la tasa del día de la API del Real brasileño">
        {actualizando ? 'Actualizando…' : '↻ Tasa del día'}
      </button>
      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
        <div className="muted" style={{ fontSize: '.72rem' }}>Equivale a</div>
        <strong className="mono" style={{ fontSize: '1.05rem' }}>
          {resultado != null ? (dir === 'usd_a_brl' ? reales(resultado) : money(resultado)) : '—'}
        </strong>
        {resultado != null && (
          <div className="muted" style={{ fontSize: '.7rem' }}>1 $ = R$ {tasaRealTexto(tasa)}</div>
        )}
      </div>
    </div>
  );
}
