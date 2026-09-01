/* ============================================================
   MGG · Cocina · Panel del Mercado (ciclo de 21 días)
   Tarjetas KPI del mercado actual + "Disponible a consumir" (saldo+entradas−consumos)
   con drill-down por víver + kardex (entradas verde / consumos rojo) + cierre.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import type { CocinaComida } from '@/shared/lib/types';
import { labelTipoComida, TIPOS_COMIDA } from './cocina.repository';
import {
  cerrarMercado, type ResumenMercado, type DisponibleItem, type KardexEntrada, type KardexConsumo,
} from './mercados.repository';

function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function diaAntes(iso: string): string { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

export function MercadoPanel({ resumen, cocinaNombre, almacen, canWrite, actor, userEmail, onReload, onEditComida, onDelComida }: {
  resumen: ResumenMercado;
  cocinaNombre: string;
  almacen: string | null;
  canWrite: boolean;
  actor: string;
  userEmail: string | null;
  onReload: () => void | Promise<void>;
  onEditComida: (c: CocinaComida) => void;
  onDelComida: (c: CocinaComida) => void;
}) {
  const { mercado, dia, dias, puedeCerrar, kpis, disponible, kardex } = resumen;
  const [drill, setDrill] = useState<DisponibleItem | null>(null);
  const [cerrar, setCerrar] = useState(false);
  const [busca, setBusca] = useState('');

  const conMovimiento = useMemo(
    () => disponible.filter((d) => d.saldoInicial || d.entradas || d.consumos),
    [disponible],
  );
  const kardexFiltrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return kardex;
    return kardex.filter((k) => {
      if (k.kind === 'entrada') return k.nombre.toLowerCase().includes(q);
      return `${k.comida.codigo} ${labelTipoComida(k.comida.tipo_comida)} ${(k.comida.items ?? []).map((i) => i.nombre).join(' ')}`.toLowerCase().includes(q);
    });
  }, [kardex, busca]);

  return (
    <div>
      {/* Tarjetas KPI del mercado actual */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.7rem', margin: '.3rem 0 .9rem' }}>
        <div className="card" style={{ margin: 0, padding: '.8rem 1rem' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.03em' }}>MERCADO #{mercado.numero} · DÍA</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800 }}>{Math.min(dia, dias)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>de {dias}</span></div>
          <div className="muted" style={{ fontSize: '.72rem' }}>{fmtDia(mercado.fecha_inicio)} → {fmtDia(mercado.fecha_fin)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.8rem 1rem' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.03em' }}>CONSUMO DEL MERCADO</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--danger)' }}>{money(kpis.consumoValor)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>entradas: {money(kpis.entradasValor)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.8rem 1rem' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.03em' }}>PLATOS DEL MERCADO</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800 }}>{num(kpis.platos)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.8rem 1rem', borderColor: 'var(--primary-3, #2ecc71)' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.03em' }}>DISPONIBLE / LO QUE QUEDA</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary-3, #2ecc71)' }}>{money(kpis.disponibleValor)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>valor del remanente</div>
        </div>
      </div>

      {/* Botón de cierre (resaltado desde el día 22) */}
      {canWrite && (
        <div style={{ marginBottom: '.8rem' }}>
          <button
            className={`btn ${puedeCerrar ? 'btn-primary' : 'btn-ghost'}`}
            style={puedeCerrar ? {} : { borderStyle: 'dashed' }}
            onClick={() => setCerrar(true)}
            title={puedeCerrar ? 'Cerrar el mercado y arrastrar lo que queda al próximo' : 'Todavía no llega el día 22; podés cerrar igual si hace falta'}
          >
            {puedeCerrar ? '🔒 Cerrar mercado (día 22) — genera PDF y arrastra saldo' : '🔒 Cerrar mercado anticipadamente'}
          </button>
        </div>
      )}

      {/* Disponible a consumir (saldo + entradas − consumos) */}
      <div className="card" style={{ marginBottom: '.9rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}>Disponible a consumir <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· saldo inicial + entradas − consumos · tocá un víver para el detalle</span></div>
        {!conMovimiento.length ? (
          <p className="hint muted" style={{ margin: 0 }}>Sin víveres en este mercado todavía.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.83rem' }}>
              <thead><tr>
                <th>Víver</th>
                <th style={{ textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ textAlign: 'right' }}>Entradas</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th style={{ textAlign: 'right' }}>Consumido</th>
                <th style={{ textAlign: 'right' }}>Queda</th>
              </tr></thead>
              <tbody>
                {conMovimiento.map((d) => (
                  <tr key={d.producto_id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => setDrill(d)} title="Ver saldo, entradas y consumos">
                    <td>{d.nombre} <span className="muted mono" style={{ fontSize: '.72rem' }}>{d.sku}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(d.saldoInicial)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--primary-3, #2ecc71)' }}>+{num(d.entradas)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(d.disponible)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>−{num(d.consumos)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: d.queda <= 0 ? 'var(--danger)' : 'var(--primary-3, #2ecc71)' }}>{num(d.queda)} {d.unidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Kardex de movimientos: entradas (verde) y consumos (rojo) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
          <div className="card-title" style={{ margin: 0 }}>Movimientos del mercado <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· entradas y consumos</span></div>
          <input className="input" style={{ maxWidth: 240 }} placeholder="Buscar en el kardex…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {!kardexFiltrado.length ? (
          <p className="hint muted" style={{ margin: 0 }}>Sin movimientos en este mercado.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {kardexFiltrado.map((k, i) => k.kind === 'entrada'
              ? <FilaEntrada key={`e${i}`} row={k} />
              : <FilaConsumo key={`c${k.comida.id}`} row={k} canWrite={canWrite} onEdit={() => onEditComida(k.comida)} onDel={() => onDelComida(k.comida)} />)}
          </div>
        )}
      </div>

      {drill && (
        <DrillModal item={drill} kardex={kardex} fechaInicio={mercado.fecha_inicio} onClose={() => setDrill(null)} />
      )}
      {cerrar && (
        <CierreModal resumen={resumen} cocinaNombre={cocinaNombre} almacen={almacen} actor={actor} userEmail={userEmail}
          onClose={() => setCerrar(false)}
          onDone={async () => { setCerrar(false); await onReload(); }} />
      )}
    </div>
  );
}

/* ───────── Fila de kardex: ENTRADA (verde) ───────── */
function FilaEntrada({ row }: { row: KardexEntrada }) {
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--primary-3, #2ecc71)', display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.86rem' }}><span style={{ color: 'var(--primary-3, #2ecc71)' }}>⬇ Entrada</span> · {row.nombre}</div>
        <div className="muted" style={{ fontSize: '.74rem' }}>{dateTime(row.at)}{row.almacen ? ` · 📦 ${row.almacen}` : ''}{row.detalle ? ` · ${row.detalle}` : ''}</div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="mono" style={{ fontWeight: 800, color: 'var(--primary-3, #2ecc71)' }}>+{num(row.cantidad)} {row.unidad}</div>
        {row.valor > 0 && <div className="muted mono" style={{ fontSize: '.74rem' }}>{money(row.valor)}</div>}
      </div>
    </div>
  );
}

/* ───────── Fila de kardex: CONSUMO (rojo, expandible) ───────── */
function FilaConsumo({ row, canWrite, onEdit, onDel }: { row: KardexConsumo; canWrite: boolean; onEdit: () => void; onDel: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const c = row.comida;
  const t = TIPOS_COMIDA.find((x) => x.value === c.tipo_comida);
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--danger)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setAbierto((v) => !v)}>
          <div style={{ fontWeight: 600, fontSize: '.86rem' }}>
            <span style={{ color: 'var(--danger)' }}>⬆ Consumo</span> · <span className="mono">{c.codigo}</span> · {t?.icon} {labelTipoComida(c.tipo_comida)}
          </div>
          <div className="muted" style={{ fontSize: '.74rem' }}>{dateTime(c.at)} · {num(c.platos)} platos · {(c.items ?? []).length} víver(es) {abierto ? '▾' : '▸'}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <span className="mono" style={{ fontWeight: 800, color: 'var(--danger)' }}>{money(c.valor_total)}</span>
          {canWrite && <>
            <button className="btn btn-sm btn-ghost" onClick={onEdit} title="Editar comida">✎</button>
            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onDel} title="Eliminar comida">🗑</button>
          </>}
        </div>
      </div>
      {abierto && (
        <ul className="muted" style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', fontSize: '.78rem' }}>
          {(c.items ?? []).map((it, j) => <li key={j}>{it.nombre} · {num(it.cantidad)} {it.unidad} · {money(it.subtotal)}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ───────── Drill-down de un víver: saldo inicial + entradas + consumos ───────── */
function DrillModal({ item, kardex, fechaInicio, onClose }: {
  item: DisponibleItem; kardex: (KardexEntrada | KardexConsumo)[]; fechaInicio: string; onClose: () => void;
}) {
  const entradas = kardex.filter((k): k is KardexEntrada => k.kind === 'entrada' && k.producto_id === item.producto_id);
  const consumos = kardex
    .filter((k): k is KardexConsumo => k.kind === 'consumo')
    .map((k) => ({ comida: k.comida, item: (k.comida.items ?? []).find((it) => it.producto_id === item.producto_id) }))
    .filter((x) => x.item);

  return (
    <Modal title={`Víver · ${item.nombre}`} size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ margin: '0 0 .8rem', background: 'var(--bg-2)', fontSize: '.9rem' }}>
        <div>Hasta el <strong>{fmtDia(diaAntes(fechaInicio))}</strong>: quedaban <strong className="mono">{num(item.saldoInicial)} {item.unidad}</strong></div>
        <div>+ entradas desde el <strong>{fmtDia(fechaInicio)}</strong>: <strong className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>{num(item.entradas)} {item.unidad}</strong></div>
        <div style={{ marginTop: '.2rem' }}>= <strong>TOTAL DISPONIBLE A CONSUMIR</strong>: <strong className="mono" style={{ fontSize: '1.05rem' }}>{num(item.disponible)} {item.unidad}</strong></div>
        <div className="muted">− consumido: <strong className="mono" style={{ color: 'var(--danger)' }}>{num(item.consumos)} {item.unidad}</strong> · queda: <strong className="mono" style={{ color: item.queda <= 0 ? 'var(--danger)' : 'var(--primary-3, #2ecc71)' }}>{num(item.queda)} {item.unidad}</strong></div>
      </div>

      <h4 style={{ margin: '.6rem 0 .35rem', color: 'var(--primary-3, #2ecc71)' }}>Entradas ({entradas.length})</h4>
      {!entradas.length ? <p className="hint muted" style={{ margin: 0 }}>Sin entradas nuevas en este mercado.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {entradas.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span className="muted">{dateTime(e.at)}{e.almacen ? ` · 📦 ${e.almacen}` : ''}</span>
              <span className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>+{num(e.cantidad)} {e.unidad}</span>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ margin: '.8rem 0 .35rem', color: 'var(--danger)' }}>Consumos ({consumos.length})</h4>
      {!consumos.length ? <p className="hint muted" style={{ margin: 0 }}>Sin consumos de este víver.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {consumos.map(({ comida, item: it }, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span><span className="mono">{comida.codigo}</span> · {labelTipoComida(comida.tipo_comida)} · <span className="muted">{dateTime(comida.at)}</span></span>
              <span className="mono" style={{ color: 'var(--danger)' }}>−{num(it?.cantidad ?? 0)} {it?.unidad ?? ''}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ───────── Modal de cierre: preview PDF + correo + confirmar ───────── */
function CierreModal({ resumen, cocinaNombre, almacen, actor, userEmail, onClose, onDone }: {
  resumen: ResumenMercado; cocinaNombre: string; almacen: string | null; actor: string; userEmail: string | null;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const { mercado, kpis, disponible } = resumen;
  const remanente = disponible.filter((d) => d.queda > 0);
  const [correos, setCorreos] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot "previo" para la vista previa del PDF (mismos datos que persiste el cierre).
  const snapshotPreview = useMemo(() => ({
    generado_en: new Date().toISOString(),
    desde: `${mercado.fecha_inicio}T00:00:00`, hasta: `${mercado.fecha_fin}T23:59:59`,
    totales: { platos: kpis.platos, valor: kpis.consumoValor, entradasValor: kpis.entradasValor },
    consumos: disponible.filter((d) => d.consumos > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.consumos, valor: Math.round(d.consumos * d.precio * 100) / 100 })),
    entradas: disponible.filter((d) => d.entradas > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.entradas, valor: Math.round(d.entradas * d.precio * 100) / 100 })),
    remanente: remanente.map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.queda })),
  }), [mercado, kpis, disponible, remanente]);

  async function verPdf() {
    try {
      const { descargarCierrePdf } = await import('./mercadoCierrePdf');
      await descargarCierrePdf(cocinaNombre, mercado, snapshotPreview);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmar() {
    setError(null); setSaving(true);
    try {
      const { cerrado, snapshot } = await cerrarMercado(mercado, almacen, actor, userEmail);
      // Siempre genera el PDF del cierre (vista previa).
      try {
        const { descargarCierrePdf } = await import('./mercadoCierrePdf');
        await descargarCierrePdf(cocinaNombre, cerrado, snapshot);
      } catch { /* si el PDF falla, el cierre igual quedó hecho */ }
      // Correo OPCIONAL: solo si se cargaron destinatarios.
      const lista = correos.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (lista.length) {
        try {
          const { enviarCierrePorCorreo } = await import('./enviarCierreCocina');
          const { destinatarios } = await enviarCierrePorCorreo(cocinaNombre, cerrado, snapshot, lista);
          toast(`Mercado cerrado · PDF generado · enviado a ${destinatarios.join(', ')}`, 'success');
        } catch (e) {
          toast(`Mercado cerrado y PDF generado, pero el correo falló: ${e instanceof Error ? e.message : ''}`, 'warning');
        }
      } else {
        toast('Mercado cerrado · PDF generado. Se abrió el siguiente con el saldo arrastrado.', 'success');
      }
      notify(`🔒 Cocina · mercado #${mercado.numero} de ${cocinaNombre} cerrado`, 'info', { link: '#/app/cocina' });
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar el mercado'); setSaving(false); }
  }

  return (
    <Modal title={`Cerrar mercado #${mercado.numero} · ${cocinaNombre}`} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-ghost" onClick={verPdf} disabled={saving}>↓ Ver PDF</button>
        <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving}>{saving ? 'Cerrando…' : '🔒 Cerrar mercado'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p className="hint muted" style={{ marginTop: 0 }}>
        Se cierra el mercado <strong>#{mercado.numero}</strong> ({fmtDia(mercado.fecha_inicio)} → {fmtDia(mercado.fecha_fin)}), se <strong>genera el PDF</strong> del cierre y <strong>lo que queda pasa como saldo inicial del próximo mercado</strong>. No mueve el inventario real. El correo es opcional.
      </p>
      <div className="card" style={{ margin: '0 0 .8rem', background: 'var(--bg-2)' }}>
        <div style={{ fontSize: '.88rem' }}>Platos: <strong className="mono">{num(kpis.platos)}</strong> · Consumo: <strong className="mono" style={{ color: 'var(--danger)' }}>{money(kpis.consumoValor)}</strong> · Remanente: <strong className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>{money(kpis.disponibleValor)}</strong></div>
        <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>{remanente.length} víver(es) pasan al próximo mercado.</div>
      </div>
      <div className="form-row">
        <label>📧 Enviar por correo <span className="muted" style={{ fontWeight: 400 }}>· opcional (dejalo vacío para solo cerrar y generar el PDF)</span></label>
        <input className="input" value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="correo1@mgg.com, correo2@mgg.com" />
      </div>
    </Modal>
  );
}
