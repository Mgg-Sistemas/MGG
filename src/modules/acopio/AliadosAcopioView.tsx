import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { AliadoAcopio } from '@/shared/lib/types';
import {
  crearAliado,
  listAliadosConResumen, listAliadoMovimientos, resumirAliado,
  crearCierreAliado, crearAbonoAliado, eliminarAliadoMovimiento,
  type AliadoFila, type AliadoResumen, type AliadoConResumen,
} from './subledgers.repository';

/**
 * Vista «Por aliado»: una TARJETA por aliado (con su saldo $ y los Kg que aún debe).
 * Al tocar la tarjeta se abre su LIBRO (réplica de la hoja «CENTRO ACOPIO - {ALIADO}»)
 * con los movimientos: CIERRE (entrega $ + compromete Kg) y ABONO (entrega Kg).
 * Cada cierre refleja un TRASLADO en la caja general; los Kg de un abono entran a
 * casiterita solo si se marca.
 */
export function AliadosAcopioView({ canWrite, actor, actorName }: {
  canWrite: boolean; actor: string; actorName: string | null;
}) {
  const [items, setItems] = useState<AliadoConResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [abrir, setAbrir] = useState<AliadoAcopio | null>(null);
  const [busca, setBusca] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setItems(await listAliadosConResumen()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error')); }, [cargar]);
  useRealtime(['acopio_aliados', 'acopio_aliado_movimientos'], cargar);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? items.filter((i) => i.aliado.nombre.toLowerCase().includes(q)) : items;
  }, [items, busca]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
          <input className="input" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar aliado…" style={{ width: '100%' }} />
        </div>
        <span className="muted" style={{ fontSize: '.82rem' }}>{filtrados.length} aliado(s)</span>
        {canWrite && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setNuevo(true)}>+ Nuevo aliado</button>}
      </div>

      {loading ? <EmptyState message="Cargando aliados…" icon="◔" /> : !filtrados.length ? (
        <EmptyState message="Sin aliados. Creá uno con + Nuevo aliado." icon="🤝" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {filtrados.map(({ aliado, resumen }) => (
            <button key={aliado.id} className="card" onClick={() => setAbrir(aliado)}
              style={{ textAlign: 'left', cursor: 'pointer', borderColor: resumen.saldoKg > 0 ? 'var(--primary)' : undefined, display: 'flex', flexDirection: 'column', gap: '.5rem' }}
              title="Ver el libro de este aliado">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                <strong style={{ fontSize: '1rem' }}>🤝 {aliado.nombre}</strong>
                {!aliado.activo && <span className="badge" style={{ fontSize: '.66rem' }}>inactivo</span>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '.74rem' }}>Kg que aún debe</span>
                <span className="mono" style={{ fontSize: '1.3rem', fontWeight: 800, color: resumen.saldoKg < 0 ? 'var(--danger)' : 'var(--primary-3)' }}>{num(resumen.saldoKg)} Kg</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
                <span className="muted">Saldo $ Usd</span>
                <span className="mono" style={{ fontWeight: 700, color: resumen.saldoUsd < 0 ? 'var(--danger)' : undefined }}>{money(resumen.saldoUsd)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.74rem' }} className="muted">
                <span>Entregado {money(resumen.totalEntregado)}</span>
                <span>Facturado {money(resumen.totalFacturado)}</span>
              </div>
              <div style={{ marginTop: '.2rem', fontSize: '.72rem', color: 'var(--primary-3)', fontWeight: 600 }}>Ver libro →</div>
            </button>
          ))}
        </div>
      )}

      {nuevo && <NuevoAliadoModal actor={actor} onClose={() => setNuevo(false)} onSaved={async () => { setNuevo(false); await cargar(); }} />}
      {abrir && <LibroAliadoModal aliado={abrir} canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setAbrir(null)} onChanged={cargar} />}
    </div>
  );
}

/* ───────────── Libro del aliado (movimientos dentro de la tarjeta) ───────────── */

function LibroAliadoModal({ aliado, canWrite, actor, actorName, onClose, onChanged }: {
  aliado: AliadoAcopio; canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void;
}) {
  const [filas, setFilas] = useState<AliadoFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'cierre' | 'abono' | null>(null);
  const resumen = useMemo<AliadoResumen>(() => resumirAliado(filas), [filas]);
  const hayGastos = useMemo(() => filas.some((f) => Number(f.gastos) > 0), [filas]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setFilas(await listAliadoMovimientos(aliado.id)); }
    finally { setLoading(false); }
  }, [aliado.id]);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error')); }, [cargar]);
  useRealtime(['acopio_aliado_movimientos'], cargar);

  async function borrar(f: AliadoFila) {
    if (!window.confirm(`¿Eliminar este movimiento del ${date(f.fecha)}? Se revierte su reflejo en la caja general/casiterita.`)) return;
    try { await eliminarAliadoMovimiento(f); toast('Movimiento eliminado', 'success'); await cargar(); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title={`📒 Libro · ${aliado.nombre}`} size="xl" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        {canWrite && <button className="btn btn-ghost" onClick={() => setModal('abono')}>↓ Registrar abono (Kg)</button>}
        {canWrite && <button className="btn btn-primary" onClick={() => setModal('cierre')}>+ Registrar cierre</button>}
      </>
    }>
      {/* Tarjetas resumen del aliado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <Kpi t="Kg que aún debe" v={`${num(resumen.saldoKg)} Kg`} c={resumen.saldoKg < 0 ? 'var(--danger)' : 'var(--primary-3)'} destacar />
        <Kpi t="Saldo $ Usd" v={money(resumen.saldoUsd)} c={resumen.saldoUsd < 0 ? 'var(--danger)' : undefined} />
        <Kpi t="Total $ entregado" v={money(resumen.totalEntregado)} c="var(--success)" />
        <Kpi t="$Usd Facturados" v={money(resumen.totalFacturado)} />
        {hayGastos && <Kpi t="Gastos" v={money(resumen.totalGastos)} c="var(--danger)" />}
      </div>

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !filas.length ? (
        <EmptyState message="Sin movimientos. Registrá un cierre o un abono." icon="📒" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.78rem' }}>
            <thead>
              <tr>
                <th>Fecha</th><th>Corte</th><th>Descripción</th>
                <th>$Usd entregado</th><th>Kg Cerrados</th><th>$/Kg</th><th>$Usd Facturados</th>
                {hayGastos && <th>Gastos</th>}
                <th>Saldo $ Usd</th><th>Kg Recibidos</th><th title="Kg que el aliado aún debe">Saldo en Kg ⓘ</th>
                {canWrite && <th style={{ width: 36 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(f.fecha)}</td>
                  <td className="mono" style={{ textAlign: 'center' }}>{f.corte ?? '—'}</td>
                  <td style={{ fontWeight: 600 }}>
                    {f.descripcion}
                    {f.tipo === 'abono' && f.reflejo_casiterita && <span className="badge primary" style={{ marginLeft: '.4rem', fontSize: '.66rem' }}>→ casiterita</span>}
                  </td>
                  <td className="mono">{f.usd_entregado ? money(f.usd_entregado) : '—'}</td>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--primary-3)' }}>{f.kg_cerrados ? num(f.kg_cerrados) : '—'}</td>
                  <td className="mono">{f.precio_usd_kg ? money(f.precio_usd_kg) : '—'}</td>
                  <td className="mono">{f.facturado ? money(f.facturado) : '—'}</td>
                  {hayGastos && <td className="mono" style={{ color: f.gastos ? 'var(--danger)' : undefined }}>{f.gastos ? money(f.gastos) : '—'}</td>}
                  <td className="mono"><strong>{money(f.saldoUsd)}</strong></td>
                  <td className="mono" style={{ color: 'var(--success, #45c08a)' }}>{f.kg_recibidos ? num(f.kg_recibidos) : '—'}</td>
                  <td className="mono" style={{ fontWeight: 800, color: f.saldoKg < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{num(f.saldoKg)}</td>
                  {canWrite && <td><button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => borrar(f)}>✕</button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border, rgba(255,255,255,.15))', fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'right' }}>Totales</td>
                <td className="mono" style={{ color: 'var(--success, #45c08a)' }}>{money(resumen.totalEntregado)}</td>
                <td className="mono" style={{ color: 'var(--primary-3)' }}>{num(resumen.totalKgCerrados)}</td>
                <td></td>
                <td className="mono">{money(resumen.totalFacturado)}</td>
                {hayGastos && <td className="mono" style={{ color: 'var(--danger)' }}>{money(resumen.totalGastos)}</td>}
                <td className="mono">{money(resumen.saldoUsd)}</td>
                <td className="mono">{num(resumen.totalKgRecibidos)}</td>
                <td className="mono" style={{ color: resumen.saldoKg < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{num(resumen.saldoKg)}</td>
                {canWrite && <td></td>}
              </tr>
            </tfoot>
          </table>
          <p className="hint muted" style={{ fontSize: '.74rem', marginTop: '.5rem' }}>
            <strong>Saldo en Kg</strong> = saldo anterior + Kg Cerrados − Kg Recibidos (lo que el aliado aún debe en mineral). Cada <strong>cierre</strong> refleja un traslado en la caja general.
          </p>
        </div>
      )}

      {modal === 'cierre' && (
        <CierreModal aliado={aliado} sugCorte={(filas.reduce((m, f) => Math.max(m, f.corte ?? 0), 0)) + 1}
          actor={actor} actorName={actorName} onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await cargar(); onChanged(); }} />
      )}
      {modal === 'abono' && (
        <AbonoModal aliado={aliado} actor={actor} actorName={actorName} onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await cargar(); onChanged(); }} />
      )}
    </Modal>
  );
}

function Kpi({ t, v, c, destacar }: { t: string; v: string; c?: string; destacar?: boolean }) {
  return (
    <div className="card" style={destacar ? { borderColor: 'var(--primary)' } : undefined}>
      <div className="card-title"><span>{t}</span></div>
      <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800, color: c }}>{v}</div>
    </div>
  );
}

/* ───────────── Modales de alta ───────────── */

function NuevoAliadoModal({ actor, onClose, onSaved }: { actor: string; onClose: () => void; onSaved: () => void }) {
  const [nombre, setNombre] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try { const a = await crearAliado(nombre, actor); toast(`Aliado ${a.nombre} creado`, 'success'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear'); setSaving(false); }
  }
  return (
    <Modal title="Nuevo aliado" size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="nuevo-aliado" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear'}</button></>
    }>
      <form id="nuevo-aliado" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Nombre del aliado</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Juan Bodega" autoFocus required /></div>
      </form>
    </Modal>
  );
}

function CierreModal({ aliado, sugCorte, actor, actorName, onClose, onSaved }: {
  aliado: AliadoAcopio; sugCorte: number; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [corte, setCorte] = useState(String(sugCorte));
  const [usd, setUsd] = useState('');
  const [kg, setKg] = useState('');
  const [precio, setPrecio] = useState('');
  const [gastos, setGastos] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [reflejar, setReflejar] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facturado = (Number(kg) || 0) * (Number(precio) || 0);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      await crearCierreAliado({
        aliadoId: aliado.id, aliadoNombre: aliado.nombre, fecha,
        corte: Number(corte) || null, descripcion,
        usdEntregado: Number(usd) || 0, kgCerrados: Number(kg) || 0, precioUsdKg: Number(precio) || 0, gastos: Number(gastos) || 0,
        reflejarCajaGeneral: reflejar,
      }, actor, actorName);
      toast('Cierre registrado', 'success'); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }
  return (
    <Modal title={`Registrar cierre · ${aliado.nombre}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cierre-aliado" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Registrar cierre'}</button></>
    }>
      <form id="cierre-aliado" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div className="form-row"><label>Corte N°</label><input className="input mono" type="number" min={1} value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="form-row"><label>$ Entregado</label><input className="input mono" type="number" min={0} step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0.00" /></div>
          <div className="form-row"><label>Kg Cerrados (comprometidos)</label><input className="input mono" type="number" min={0} step="any" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="0" /></div>
          <div className="form-row"><label>Precio $/Kg</label><input className="input mono" type="number" min={0} step="0.0001" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" /></div>
          <div className="form-row"><label>$ Gastos (opcional)</label><input className="input mono" type="number" min={0} step="0.01" value={gastos} onChange={(e) => setGastos(e.target.value)} placeholder="0.00" /></div>
        </div>
        <p className="hint muted" style={{ fontSize: '.8rem', marginTop: 0 }}>Facturado (Kg × $/Kg): <strong className="mono">{money(facturado)}</strong></p>
        <div className="form-row"><label>Descripción (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder={`CENTRO DE ACOPIO ${aliado.nombre}`} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
          <input type="checkbox" checked={reflejar} onChange={(e) => setReflejar(e.target.checked)} />
          Reflejar la entrega como <strong>traslado en la caja general</strong> (recomendado)
        </label>
      </form>
    </Modal>
  );
}

function AbonoModal({ aliado, actor, actorName, onClose, onSaved }: {
  aliado: AliadoAcopio; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [kg, setKg] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [sumar, setSumar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      await crearAbonoAliado({ aliadoId: aliado.id, fecha, descripcion, kgRecibidos: Number(kg) || 0, sumarCasiterita: sumar }, actor, actorName);
      toast('Abono registrado', 'success'); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }
  return (
    <Modal title={`Registrar abono (Kg) · ${aliado.nombre}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="abono-aliado" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Registrar abono'}</button></>
    }>
      <form id="abono-aliado" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div className="form-row"><label>Kg entregados</label><input className="input mono" type="number" min={0} step="any" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="0" autoFocus /></div>
        </div>
        <div className="form-row"><label>Descripción (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ABONO DE CIERRES" /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
          <input type="checkbox" checked={sumar} onChange={(e) => setSumar(e.target.checked)} />
          Sumar estos Kg al <strong>stock real de CASITERITA</strong>
        </label>
        <small className="muted">Marcá solo si estos Kg NO entraron ya por una recepción aparte (evita doble conteo).</small>
      </form>
    </Modal>
  );
}
