/* ============================================================
   MGG · Formulario de despiece de la res en canal

   Al recibir una RES EN CANAL no entra «la res»: entran sus CORTES. Acá se
   dice en qué se convirtió, cuánto se perdió como merma y cuánto va a cada
   cocina.

   El costo se ve en vivo mientras se carga, porque es el número que sorprende:
   pagaste $5,30 el kilo de res, pero como la merma no se cocina, el kilo de
   carne que queda cuesta más.
   ============================================================ */
import { useMemo } from 'react';
import { money, num } from '@/shared/lib/format';
import {
  CORTES_SUGERIDOS, calcularDespiece, calcularReparto, normalizarCorte,
  type CorteDespiece,
} from './despieceRes';

export interface CocinaDestino { nombre: string; almacen: string }
export interface LineaRepartoUI { corte: string; almacen: string; kg: string }

export interface EstadoDespiece {
  cortes: Array<{ nombre: string; kg: string }>;
  merma: string;
  reparto: LineaRepartoUI[];
}

/** Arranca con los tres cortes de siempre, en blanco. */
export function despieceInicial(): EstadoDespiece {
  return { cortes: CORTES_SUGERIDOS.map((nombre) => ({ nombre, kg: '' })), merma: '', reparto: [] };
}

const n = (v: string) => Number(String(v).replace(',', '.')) || 0;

export function DespieceResForm({
  nombreRes, kgRecibidos, precioUnitario, almacenDestino, cocinas, estado, onChange,
}: {
  nombreRes: string;
  kgRecibidos: number;
  /** $/kg pagado por la res. */
  precioUnitario: number;
  /** Almacén al que entran los cortes. */
  almacenDestino: string;
  /** Cocinas a las que se puede mandar parte (sin la del almacén que recibe). */
  cocinas: CocinaDestino[];
  estado: EstadoDespiece;
  onChange: (e: EstadoDespiece) => void;
}) {
  const costoTotal = Math.round(kgRecibidos * precioUnitario * 100) / 100;

  const calc = useMemo(() => calcularDespiece({
    kgRecibidos, costoTotal,
    cortes: estado.cortes.map((c) => ({ nombre: c.nombre, kg: n(c.kg) })) as CorteDespiece[],
    mermaKg: n(estado.merma),
  }), [kgRecibidos, costoTotal, estado.cortes, estado.merma]);

  const rep = useMemo(
    () => calcularReparto(calc.cortes, estado.reparto.map((r) => ({ corte: r.corte, cocinaId: r.almacen, kg: n(r.kg) }))),
    [calc.cortes, estado.reparto],
  );

  const setCorte = (i: number, patch: Partial<{ nombre: string; kg: string }>) =>
    onChange({ ...estado, cortes: estado.cortes.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const addCorte = () => onChange({ ...estado, cortes: [...estado.cortes, { nombre: '', kg: '' }] });
  const delCorte = (i: number) => onChange({ ...estado, cortes: estado.cortes.filter((_, k) => k !== i) });

  /* El reparto se carga como una MATRIZ: una fila por corte, una columna por
     cocina. Por dentro sigue siendo la misma lista de líneas (corte, almacén,
     kg); la celda solo busca la suya y la escribe. Así el analista distribuye
     de un vistazo —5 kg a Los Pinos, 10 a La Esperanza— sin ir agregando
     renglones de a uno. */
  const celda = (corte: string, almacen: string): string =>
    estado.reparto.find((r) => r.corte === corte && r.almacen === almacen)?.kg ?? '';
  const setCelda = (corte: string, almacen: string, kg: string) => {
    const i = estado.reparto.findIndex((r) => r.corte === corte && r.almacen === almacen);
    if (i >= 0) {
      const lista = [...estado.reparto];
      if (kg.trim() === '') lista.splice(i, 1); else lista[i] = { ...lista[i], kg };
      onChange({ ...estado, reparto: lista });
      return;
    }
    if (kg.trim() === '') return;
    onChange({ ...estado, reparto: [...estado.reparto, { corte, almacen, kg }] });
  };
  /** Cuánto de ese corte ya se repartió a todas las cocinas. */
  const repartidoDe = (corte: string) =>
    Math.round(estado.reparto.filter((r) => r.corte === corte).reduce((a, r) => a + n(r.kg), 0) * 10000) / 10000;


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
                      onChange={(e) => setCorte(i, { nombre: e.target.value })} style={{ textTransform: 'uppercase' }} />
                  </td>
                  <td>
                    <input className="input mono" type="number" min={0} step="any" value={c.kg}
                      onChange={(e) => setCorte(i, { kg: e.target.value })} style={{ textAlign: 'right' }} />
                  </td>
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

      {calc.problemas.map((p) => (
        <div key={p} className="card" style={{ borderColor: 'var(--warning)', background: 'rgba(245,177,51,0.08)', margin: '.5rem 0 0', padding: '.5rem .65rem', fontSize: '.82rem' }}>
          ⚠ {p}
        </div>
      ))}
      {calc.cuadra && (
        <p className="hint muted" style={{ fontSize: '.8rem', margin: '.5rem 0 0' }}>
          ✅ Cuadra. Entran <strong>{num(calc.kgUtiles)} kg</strong> a <strong>📦 {almacenDestino || '—'}</strong> a <strong>{money(calc.costoPorKg)}/kg</strong>.
        </p>
      )}

      {/* DISTRIBUCIÓN a las cocinas: matriz corte × cocina, en la misma pantalla */}
      {cocinas.length > 0 && calc.cortes.length > 0 && (
        <div style={{ marginTop: '.9rem', paddingTop: '.7rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '.86rem' }}>🍳 Distribución a las cocinas</div>
          <p className="hint muted" style={{ fontSize: '.78rem', margin: '.15rem 0 .5rem' }}>
            Escribí los kg de cada corte que van a cada cocina: <strong>entran directo a su almacén</strong>, con su traza.
            Lo que no repartas <strong>queda en {almacenDestino || 'el almacén que recibe'}</strong>.
          </p>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th>Corte</th>
                  <th style={{ textAlign: 'right' }}>Obtenido</th>
                  {cocinas.map((c) => <th key={c.almacen} style={{ textAlign: 'right' }}>🍳 {c.nombre}</th>)}
                  <th style={{ textAlign: 'right' }}>Queda en {almacenDestino || 'el almacén'}</th>
                </tr>
              </thead>
              <tbody>
                {calc.cortes.map((c) => {
                  const repartido = repartidoDe(c.nombre);
                  const queda = Math.round((c.kg - repartido) * 10000) / 10000;
                  return (
                    <tr key={c.nombre}>
                      <td>{c.nombre}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(c.kg)}</td>
                      {cocinas.map((k) => (
                        <td key={k.almacen} style={{ textAlign: 'right' }}>
                          <input className="input mono" type="number" min={0} step="any" placeholder="0"
                            value={celda(c.nombre, k.almacen)}
                            onChange={(e) => setCelda(c.nombre, k.almacen, e.target.value)}
                            style={{ width: 90, textAlign: 'right' }} />
                        </td>
                      ))}
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: queda < -0.01 ? 'var(--danger)' : undefined }}>
                        {num(queda)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rep.problemas.map((p) => (
            <div key={p} className="card" style={{ borderColor: 'var(--danger)', background: 'rgba(239,79,94,0.08)', margin: '.5rem 0 0', padding: '.5rem .65rem', fontSize: '.82rem' }}>
              ⚠ {p}
            </div>
          ))}
          {rep.cuadra && rep.porCocina.size > 0 && (
            <div className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}>
              Entrará a {Array.from(rep.porCocina.entries()).map(([alm, ls]) => (
                `${cocinas.find((c) => c.almacen === alm)?.nombre ?? alm}: ${ls.map((l) => `${num(l.kg)} kg ${l.corte}`).join(', ')}`
              )).join(' · ')}.
              {' '}Queda en {almacenDestino}: {rep.quedaEnOrigen.map((x) => `${num(x.kg)} kg ${x.corte}`).join(', ') || 'nada'}.
            </div>
          )}
        </div>
      )}
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
  const rep = calcularReparto(calc.cortes, e.reparto.map((r) => ({ corte: r.corte, cocinaId: r.almacen, kg: n(r.kg) })));
  if (!rep.cuadra) return { ok: false, motivo: rep.problemas[0] };
  return { ok: true, motivo: '' };
}
