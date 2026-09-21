/* ============================================================
   MGG · Cocina · Control de distribución (modelo EOQ)

   El formato de la planilla del pollo, para TODO el mercado: una fila por víver
   con su stock, su consumo, su ratio por comensal y su lote óptimo de compra;
   al tocarla se abre el registro diario (inv. inicial → entradas → salidas →
   teórico → físico → merma), que es la hoja de Excel de ese víver.

   No hay libro nuevo: todo se calcula del mismo resumen del mercado.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import { guardarParametrosEoq, parametrosEoqDeCocina } from './cocina.repository';
import {
  distribucionPorViver, etiquetaEstado, totalesDistribucion,
  PARAMETROS_EOQ_DEFECTO,
  type EstadoStock, type ParametrosEoq, type ResumenDistribucion,
} from './distribucionEoq';
import { etiquetaSeleccion, filtrarDistribucion, type SeleccionKpi } from './distribucionFiltro';
import type { ResumenMercado } from './mercados.repository';

const colorEstado: Record<EstadoStock, string> = {
  NORMAL: 'var(--success, #16a34a)',
  ALERTA: 'var(--warning, #f59e0b)',
  REORDENAR: 'var(--danger, #ef4444)',
};

function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
/** Un cero en una tabla larga es ruido: se muestra un punto tenue. */
function cifra(n: number): string { return n === 0 ? '·' : num(n); }

export function DistribucionPanel({ resumen, cocinaId, cocinaNombre, canWrite }: {
  resumen: ResumenMercado;
  cocinaId: string;
  cocinaNombre: string;
  canWrite: boolean;
}) {
  const [params, setParams] = useState<ParametrosEoq>(PARAMETROS_EOQ_DEFECTO);
  const [editarParams, setEditarParams] = useState(false);
  const [detalle, setDetalle] = useState<ResumenDistribucion | null>(null);
  const [filtro, setFiltro] = useState('');
  const [soloReponer, setSoloReponer] = useState(false);
  // Tarjeta tocada: la tabla se queda con esos víveres. Tocarla de nuevo la suelta.
  const [seleccion, setSeleccion] = useState<SeleccionKpi>('todos');

  const cargarParams = useCallback(() => {
    parametrosEoqDeCocina(cocinaId).then(setParams).catch(() => setParams(PARAMETROS_EOQ_DEFECTO));
  }, [cocinaId]);
  useEffect(() => { cargarParams(); }, [cargarParams]);

  const items = useMemo(
    () => distribucionPorViver(resumen.disponible, resumen.kardex, params),
    [resumen.disponible, resumen.kardex, params],
  );
  const totales = useMemo(() => totalesDistribucion(items), [items]);

  const lista = useMemo(
    () => filtrarDistribucion(items, { q: filtro, seleccion, soloReponer }),
    [items, filtro, seleccion, soloReponer],
  );

  async function verPdf() {
    try {
      const { verDistribucionPdf } = await import('./distribucionPdf');
      await verDistribucionPdf(items, {
        cocina: cocinaNombre,
        mercado: resumen.mercado.numero,
        desde: resumen.mercado.fecha_inicio,
        hasta: resumen.mercado.fecha_fin,
        params,
      });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <strong>📊 Control de distribución</strong>
        <span className="muted" style={{ fontSize: '.78rem' }}>
          Consumo por comensal y lote óptimo de compra (EOQ) de cada víver del mercado.
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void verPdf()}>↓ PDF</button>
        {canWrite && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditarParams(true)} title="Costo de ordenar, de almacenar y tiempo de entrega">
            ⚙ Parámetros
          </button>
        )}
      </div>

      {/* Tarjetas del ciclo: son BOTONES. Al tocar una, la tabla se queda con esos
          víveres; al tocarla de nuevo, se suelta y vuelven todos. */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        {([
          ['todos', 'Víveres', String(totales.viveres), 'var(--text)', 'Ver todos los víveres del mercado'],
          ['reponer', 'Por reponer', String(totales.reordenar), colorEstado.REORDENAR, 'Ver solo los que están en el punto de reorden'],
          ['alerta', 'En alerta', String(totales.alerta), colorEstado.ALERTA, 'Ver solo los que están por caer'],
          ['consumido', 'Consumido', num(totales.consumoTotal), 'var(--text)', 'Ver solo los que se consumieron en el ciclo'],
          ['mermas', 'Mermas', num(totales.mermas), totales.mermas > 0 ? colorEstado.ALERTA : 'var(--text)', 'Ver solo los que tuvieron mermas'],
        ] as Array<[SeleccionKpi, string, string, string, string]>).map(([clave, label, valor, color, ayuda]) => {
          const activa = seleccion === clave || (clave === 'todos' && seleccion === 'todos');
          return (
            <button key={clave} type="button" className="card" title={ayuda}
              aria-pressed={activa}
              onClick={() => setSeleccion(seleccion === clave ? 'todos' : clave)}
              style={{
                padding: '.5rem .75rem', minWidth: 110, background: 'var(--bg-2)', cursor: 'pointer',
                textAlign: 'left', font: 'inherit',
                borderColor: activa ? color : 'var(--border)',
                borderWidth: activa ? 2 : 1,
                boxShadow: activa ? `inset 0 -3px 0 ${color}` : undefined,
              }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>{label}</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{valor}</div>
            </button>
          );
        })}
        <div className="card" style={{ padding: '.5rem .75rem', background: 'var(--bg-2)', flex: '1 1 220px' }}>
          <div className="muted" style={{ fontSize: '.7rem' }}>Parámetros de compra (cocina)</div>
          <div className="mono" style={{ fontSize: '.8rem' }}>
            Ordenar $ {num(params.costoOrden)} · Almacenar $ {num(params.costoAlmacenar)}/año · Entrega {num(params.leadTimeDias)} días
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: '1 1 200px' }} value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="🔍 Buscar víver…" />
        <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.82rem' }}>
          <input type="checkbox" checked={soloReponer} onChange={(e) => setSoloReponer(e.target.checked)} />
          Solo los que hay que reponer
        </label>
      </div>

      {/* Qué se está viendo. Sin esto, una tabla recortada parece una tabla vacía. */}
      <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.4rem', display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
        <span>Mostrando <strong className="mono">{num(lista.length)}</strong> de <strong className="mono">{num(items.length)}</strong> víveres</span>
        {seleccion !== 'todos' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSeleccion('todos')}
            title="Quitar el filtro de la tarjeta">
            {etiquetaSeleccion(seleccion)} ✕
          </button>
        )}
      </div>

      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr>
              <th>Víver</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th style={{ textAlign: 'right' }}>Consumo</th>
              <th style={{ textAlign: 'right' }}>Prom./día</th>
              <th style={{ textAlign: 'right' }}>Ratio x comensal</th>
              <th style={{ textAlign: 'right' }} title="Demanda anual estimada = promedio diario × 365">D anual</th>
              <th style={{ textAlign: 'right' }} title="Lote óptimo de compra">Lote EOQ</th>
              <th style={{ textAlign: 'right' }} title="Punto de reorden: stock con el que hay que pedir">Reorden</th>
              <th style={{ textAlign: 'right' }} title="Cada cuántos días toca pedir">Ciclo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {!lista.length && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center' }}>
                {items.length ? 'Ningún víver coincide con el filtro.' : 'El mercado todavía no tiene víveres.'}
              </td></tr>
            )}
            {lista.map((i) => (
              <tr key={i.producto_id} className="row-selectable" style={{ cursor: 'pointer' }}
                onClick={() => setDetalle(i)} title="Ver el registro diario de este víver">
                <td>
                  <div>{i.nombre}</div>
                  <div className="muted mono" style={{ fontSize: '.7rem' }}>{i.sku} · {i.unidad}</div>
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(i.stock)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(i.consumoTotal)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(i.promedioDia)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{i.ratioPromedio ? i.ratioPromedio.toFixed(3) : '·'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(i.demandaAnual)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{cifra(i.eoq)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(i.puntoReorden)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{i.cicloDias ? `${i.cicloDias} d` : '·'}</td>
                <td style={{ color: colorEstado[i.estado], whiteSpace: 'nowrap', fontWeight: i.estado === 'NORMAL' ? 400 : 700 }}>
                  {etiquetaEstado(i.estado)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint muted" style={{ fontSize: '.74rem', marginTop: '.4rem' }}>
        Tocá una <strong>tarjeta de arriba</strong> para dejar en la tabla solo esos víveres (de nuevo para soltarla), y un
        <strong> víver</strong> para ver su <strong>registro diario</strong>. El <strong>lote EOQ</strong> es cuánto conviene comprar de una vez
        y el <strong>reorden</strong> es el stock con el que hay que pedirlo, para que no falte mientras llega.
      </div>

      {detalle && <DetalleDiarioModal item={detalle} onClose={() => setDetalle(null)} />}
      {editarParams && (
        <ParametrosModal
          params={params}
          cocinaNombre={cocinaNombre}
          onClose={() => setEditarParams(false)}
          onGuardar={async (p) => {
            await guardarParametrosEoq(cocinaId, p);
            setParams(p);
            setEditarParams(false);
            toast('Parámetros guardados', 'success');
          }}
        />
      )}
    </div>
  );
}

/** La hoja del víver: un renglón por día y turno, como en la planilla. */
function DetalleDiarioModal({ item, onClose }: { item: ResumenDistribucion; onClose: () => void }) {
  return (
    <Modal title={`📋 Registro diario · ${item.nombre}`} size="xl" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        {[
          ['📦 Stock actual', `${num(item.stock)} ${item.unidad}`],
          ['🍽 Consumo total', `${num(item.consumoTotal)} (${num(item.promedioDia)}/día)`],
          ['👥 Comensales', num(item.comensales)],
          ['📉 Ratio x comensal', item.ratioPromedio ? item.ratioPromedio.toFixed(3) : '—'],
          ['🎯 Lote EOQ', item.eoq ? `${num(item.eoq)} · cada ${item.cicloDias} días` : '—'],
          ['🚦 Punto de reorden', item.puntoReorden ? num(item.puntoReorden) : '—'],
        ].map(([l, v]) => (
          <div key={l} className="card" style={{ padding: '.45rem .7rem', background: 'var(--bg-2)', minWidth: 130 }}>
            <div className="muted" style={{ fontSize: '.7rem' }}>{l}</div>
            <div className="mono" style={{ fontSize: '.9rem', fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: '.5rem', color: colorEstado[item.estado], fontWeight: 700 }}>
        {etiquetaEstado(item.estado)}
        {item.estado !== 'NORMAL' && item.eoq > 0 && (
          <span className="muted" style={{ fontWeight: 400, marginLeft: '.4rem', fontSize: '.8rem' }}>
            · conviene pedir {num(item.eoq)} {item.unidad}
          </span>
        )}
      </div>

      <div className="table-wrap" style={{ maxHeight: 400, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.8rem' }}>
          <thead>
            <tr>
              <th>Fecha</th><th>Turno</th>
              <th style={{ textAlign: 'right' }}>Inv. inicial</th>
              <th style={{ textAlign: 'right' }}>Entradas</th>
              <th style={{ textAlign: 'right' }}>Salidas</th>
              <th style={{ textAlign: 'right' }}>Teórico</th>
              <th style={{ textAlign: 'right' }}>Merma</th>
              <th style={{ textAlign: 'right' }}>Físico</th>
              <th style={{ textAlign: 'right' }}>Comensales</th>
              <th style={{ textAlign: 'right' }}>Ratio</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {!item.filas.length && (
              <tr><td colSpan={11} className="muted" style={{ textAlign: 'center' }}>Este víver no se movió en el ciclo.</td></tr>
            )}
            {item.filas.map((f, i) => (
              <tr key={`${f.fecha}-${f.turno}-${i}`}>
                <td className="mono">{fmtDia(f.fecha)}</td>
                <td style={{ textTransform: 'capitalize' }}>{f.turno}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(f.invInicial)}</td>
                <td className="mono" style={{ textAlign: 'right', color: f.entradas ? 'var(--success, #16a34a)' : undefined }}>{cifra(f.entradas)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(f.salidas)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(f.teorico)}</td>
                <td className="mono" style={{ textAlign: 'right', color: f.mermas ? colorEstado.REORDENAR : undefined }}>{cifra(f.mermas)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{cifra(f.fisico)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{cifra(f.comensales)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{f.ratio ? f.ratio.toFixed(3) : '·'}</td>
                <td style={{ color: colorEstado[f.estado], whiteSpace: 'nowrap' }}>{etiquetaEstado(f.estado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint muted" style={{ fontSize: '.74rem', marginTop: '.4rem' }}>
        <strong>Teórico</strong> = inicial + entradas − salidas. El <strong>físico</strong> le resta las mermas del día
        (pérdidas, salidas manuales y lo enviado a otra cocina), y esa diferencia es lo que no se fue en comida.
      </div>
    </Modal>
  );
}

/** Los tres parámetros del lote óptimo, por cocina. */
function ParametrosModal({ params, cocinaNombre, onClose, onGuardar }: {
  params: ParametrosEoq; cocinaNombre: string; onClose: () => void; onGuardar: (p: ParametrosEoq) => Promise<void>;
}) {
  const [orden, setOrden] = useState(String(params.costoOrden));
  const [almacenar, setAlmacenar] = useState(String(params.costoAlmacenar));
  const [lead, setLead] = useState(String(params.leadTimeDias));
  const [saving, setSaving] = useState(false);

  const n = (v: string) => Number(String(v).replace(',', '.')) || 0;

  async function guardar() {
    setSaving(true);
    try { await onGuardar({ costoOrden: n(orden), costoAlmacenar: n(almacenar), leadTimeDias: n(lead) }); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`⚙ Parámetros de compra · ${cocinaNombre}`} size="sm" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </>
      }>
      <div className="form-row">
        <label>Costo de emitir una orden ($)</label>
        <input className="input mono" value={orden} onChange={(e) => setOrden(e.target.value)} inputMode="decimal" />
        <small className="muted">Lo que cuesta hacer una compra: viaje, tiempo, gestión.</small>
      </div>
      <div className="form-row">
        <label>Costo de almacenar una unidad al año ($)</label>
        <input className="input mono" value={almacenar} onChange={(e) => setAlmacenar(e.target.value)} inputMode="decimal" />
        <small className="muted">Refrigeración, espacio y lo que se pierde por guardar de más.</small>
      </div>
      <div className="form-row">
        <label>Tiempo de entrega (días)</label>
        <input className="input mono" value={lead} onChange={(e) => setLead(e.target.value)} inputMode="numeric" />
        <small className="muted">Cuánto tarda en llegar el pedido. Define el punto de reorden.</small>
      </div>
      <div className="hint muted" style={{ fontSize: '.76rem' }}>
        Con estos tres números se calcula el <strong>lote óptimo</strong> de cada víver:
        comprar de más cuesta almacenarlo, comprar de menos obliga a pedir seguido.
      </div>
    </Modal>
  );
}
