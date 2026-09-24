/* ============================================================
   MGG · Formulario de despiece de la res en canal

   Al recibir una RES EN CANAL no entra «la res»: entran sus CORTES. Acá se
   dice en qué se convirtió, cuánto se perdió como merma y cuánto va a cada
   cocina.

   El costo se ve en vivo mientras se carga, porque es el número que sorprende:
   pagaste $5,30 el kilo de res, pero como la merma no se cocina, el kilo de
   carne que queda cuesta más.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listCatalogoPedido } from '@/modules/pedidos/pedidos.repository';
import {
  CORTES_SUGERIDOS, calcularDespiece, normalizarCorte,
  type CorteDespiece,
} from './despieceRes';

export interface EstadoDespiece {
  cortes: Array<{ nombre: string; kg: string }>;
  merma: string;
}

/** Arranca con los tres cortes de siempre, en blanco. */
export function despieceInicial(): EstadoDespiece {
  return { cortes: CORTES_SUGERIDOS.map((nombre) => ({ nombre, kg: '' })), merma: '' };
}

const n = (v: string) => Number(String(v).replace(',', '.')) || 0;

export function DespieceResForm({
  nombreRes, kgRecibidos, precioUnitario, almacenDestino, estado, onChange,
}: {
  nombreRes: string;
  kgRecibidos: number;
  /** $/kg pagado por la res. */
  precioUnitario: number;
  /** Almacén de la sede que recibe: ahí entran TODOS los cortes. */
  almacenDestino: string;
  estado: EstadoDespiece;
  onChange: (e: EstadoDespiece) => void;
}) {
  const costoTotal = Math.round(kgRecibidos * precioUnitario * 100) / 100;

  /* Los cortes que ya se usaron alguna vez. Se ofrecen como sugerencia al
     escribir: lo que alguien cargue hoy queda para la próxima compra, sin que
     nadie tenga que acordarse de cómo se escribió «CARNE PARA GUISO». */
  const [conocidos, setConocidos] = useState<string[]>([]);
  const cargarCortes = useCallback(() => {
    listCatalogoPedido('corte_res', true)
      .then((r) => setConocidos(r.map((x) => x.nombre)))
      .catch(() => setConocidos([]));
  }, []);
  useEffect(() => { cargarCortes(); }, [cargarCortes]);
  useRealtime(['catalogos_pedido'], cargarCortes);

  const calc = useMemo(() => calcularDespiece({
    kgRecibidos, costoTotal,
    cortes: estado.cortes.map((c) => ({ nombre: c.nombre, kg: n(c.kg) })) as CorteDespiece[],
    mermaKg: n(estado.merma),
  }), [kgRecibidos, costoTotal, estado.cortes, estado.merma]);

  const setCorte = (i: number, patch: Partial<{ nombre: string; kg: string }>) =>
    onChange({ ...estado, cortes: estado.cortes.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const addCorte = () => onChange({ ...estado, cortes: [...estado.cortes, { nombre: '', kg: '' }] });
  const delCorte = (i: number) => onChange({ ...estado, cortes: estado.cortes.filter((_, k) => k !== i) });

  return (
    <div className="card" style={{ margin: '.6rem 0', padding: '.75rem', borderLeft: '3px solid var(--primary)' }}>
      <div style={{ fontWeight: 700, marginBottom: '.2rem' }}>
        🔪 Despiece de {nombreRes}
      </div>
      <p className="hint muted" style={{ fontSize: '.8rem', margin: '0 0 .7rem' }}>
        Al inventario <strong>no entra la res</strong>: entran sus cortes. Indicá en qué se convirtió y cuánto quedó como merma.
        Lo pagado se reparte entre los <strong>kg que sí se pueden cocinar</strong>.
      </p>

      {/* Cortes */}
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.84rem', margin: 0 }}>
          <thead><tr>
            <th>Corte</th>
            <th style={{ width: 120, textAlign: 'right' }}>Kg</th>
            <th style={{ width: 70, textAlign: 'right' }}>% de la res</th>
            <th style={{ textAlign: 'right' }}>Costo / kg</th>
            <th style={{ textAlign: 'right' }}>Valor</th>
            <th style={{ width: 40 }}></th>
          </tr></thead>
          <tbody>
            {estado.cortes.map((c, i) => {
              const calculado = calc.cortes.find((x) => x.nombre === normalizarCorte(c.nombre));
              return (
                <tr key={i}>
                  <td>
                    <input className="input" value={c.nombre} placeholder="Nombre del corte (ej. LOMITO)"
                      list="cortes-conocidos"
                      onChange={(e) => setCorte(i, { nombre: e.target.value })} style={{ textTransform: 'uppercase' }} />
                  </td>
                  <td>
                    <input className="input mono" type="number" min={0} step="any" value={c.kg}
                      onChange={(e) => setCorte(i, { kg: e.target.value })} style={{ textAlign: 'right' }} />
                  </td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>{calculado ? `${num(calculado.pct)} %` : '—'}</td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>{calculado ? money(calculado.costoUnitario) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{calculado ? money(calculado.subtotal) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {estado.cortes.length > 1 && (
                      <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                        onClick={() => delCorte(i)} title="Quitar este corte">✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* La merma no entra a ningún almacén: no se puede cocinar. Pero se
                pagó, así que encarece el resto y queda en la traza de la compra. */}
            <tr style={{ background: 'rgba(245,177,51,0.08)' }}>
              <td style={{ fontWeight: 600 }}>⚠ Merma <span className="muted" style={{ fontWeight: 400, fontSize: '.74rem' }}>(no entra al inventario)</span></td>
              <td>
                <input className="input mono" type="number" min={0} step="any" value={estado.merma}
                  onChange={(e) => onChange({ ...estado, merma: e.target.value })} style={{ textAlign: 'right' }} />
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--warning)' }}>{num(calc.pctMerma)} %</td>
              <td className="muted" style={{ textAlign: 'right', fontSize: '.76rem' }}>encarece los cortes</td>
              <td className="mono muted" style={{ textAlign: 'right' }}>{calc.costoMerma > 0 ? money(calc.costoMerma) : '—'}</td>
              <td></td>
            </tr>
          </tbody>
          <tfoot>
            <tr style={{ background: 'rgba(255,138,0,0.12)' }}>
              <td style={{ fontWeight: 800 }}>
                TOTAL
                <div className="muted" style={{ fontWeight: 400, fontSize: '.72rem' }}>
                  {num(calc.kgUtiles)} kg útiles de {num(kgRecibidos)} recibidos
                </div>
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(calc.kgRepartidos)}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: calc.cuadra ? 'var(--success)' : 'var(--warning)' }}>
                {num(calc.pctUtiles + calc.pctMerma)} %
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                {calc.costoPorKg > 0 ? money(calc.costoPorKg) : '—'}
                <div className="muted" style={{ fontWeight: 400, fontSize: '.7rem' }}>se pagó {money(precioUnitario)}</div>
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{money(calc.totalCortes)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={addCorte} style={{ marginTop: '.4rem' }}>
        ＋ Agregar otro corte
      </button>
      {/* Sugerencias del catálogo: se escribe libre, pero lo ya usado se ofrece. */}
      <datalist id="cortes-conocidos">
        {conocidos.map((n) => <option key={n} value={n} />)}
      </datalist>

      {/* Lo que de verdad se quiere saber de una res: cuánto se cocina y cuánto se tira. */}
      {kgRecibidos > 0 && (
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
          <Resumen etiqueta="Carne consumible" kg={calc.kgUtiles} pct={calc.pctUtiles} color="var(--success)" />
          <Resumen etiqueta="Desperdicio / merma" kg={calc.mermaKg} pct={calc.pctMerma} color="var(--warning)" />
          <Resumen etiqueta="Total recibido" kg={kgRecibidos} pct={calc.pctUtiles + calc.pctMerma} color="var(--primary-3)" />
        </div>
      )}

      {calc.problemas.map((p) => (
        <div key={p} className="card" style={{ borderColor: 'var(--warning)', background: 'rgba(245,177,51,0.08)', margin: '.5rem 0 0', padding: '.5rem .65rem', fontSize: '.82rem' }}>
          ⚠ {p}
        </div>
      ))}
      {calc.cuadra && (
        <p className="hint muted" style={{ fontSize: '.8rem', margin: '.5rem 0 0' }}>
          ✅ Cuadra. Entran <strong>{num(calc.kgUtiles)} kg</strong> a <strong>📦 {almacenDestino || '—'}</strong> a <strong>{money(calc.costoPorKg)}/kg</strong>.
          {' '}Los cortes quedan en la categoría <strong>CARNES</strong>, así que la cocina de esa sede los ve
          en <strong>sus comidas</strong> y los descuenta al cargarlas: el reparto se refleja ahí, no acá.
        </p>
      )}

    </div>
  );
}

/** Una cifra del resumen: kg y su % de la res. */
function Resumen({ etiqueta, kg, pct, color }: { etiqueta: string; kg: number; pct: number; color: string }) {
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', flex: '1 1 150px', minWidth: 140 }}>
      <div className="muted" style={{ fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{etiqueta}</div>
      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 800, color }}>
        {num(kg)} kg <span style={{ fontSize: '.8rem', opacity: .85 }}>· {num(pct)} %</span>
      </div>
    </div>
  );
}

/** ¿Se puede confirmar? Lo dice la misma cuenta que se muestra en pantalla. */
export function despieceValido(e: EstadoDespiece, kgRecibidos: number, costoTotal: number): { ok: boolean; motivo: string } {
  const calc = calcularDespiece({
    kgRecibidos, costoTotal,
    cortes: e.cortes.map((c) => ({ nombre: c.nombre, kg: n(c.kg) })),
    mermaKg: n(e.merma),
  });
  if (!calc.cuadra) return { ok: false, motivo: calc.problemas[0] };
  return { ok: true, motivo: '' };
}
