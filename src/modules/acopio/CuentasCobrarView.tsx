import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { CuentaCobrarAcopio } from '@/shared/lib/types';
import {
  listCuentasCobrar, crearCuentaCobrar, eliminarCuentaCobrar,
  getCobrarLedger, crearAbonoCobrar, eliminarAbonoCobrar, resumenPorCobrar,
  type CobrarLedger, type CobrarFila, type ResumenCobrar,
} from './subledgers.repository';

/**
 * Vista «Cuentas por cobrar»: réplica de la hoja «CUENTA POR COBRAR {CLIENTE}» + su RESUMEN.
 * Deuda en $ que se paga con mineral: cada abono (en Kg) baja la deuda y, opcionalmente,
 * suma los Kg al stock de CASITERITA. Arriba, el resumen de saldos por cobrar.
 */
export function CuentasCobrarView({ canWrite, actor, actorName, centro = 'LA ESPERANZA', onVolver }: {
  canWrite: boolean; actor: string; actorName: string | null; centro?: string; onVolver?: () => void;
}) {
  const [cuentas, setCuentas] = useState<CuentaCobrarAcopio[]>([]);
  const [resumen, setResumen] = useState<ResumenCobrar | null>(null);
  const [loading, setLoading] = useState(true);
  const [nueva, setNueva] = useState(false);
  const [verCuenta, setVerCuenta] = useState<CuentaCobrarAcopio | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, r] = await Promise.all([listCuentasCobrar(centro), resumenPorCobrar(centro)]);
      setCuentas(cs); setResumen(r);
    } finally { setLoading(false); }
  }, [centro]);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error')); }, [cargar]);
  useRealtime(['acopio_cuentas_cobrar', 'acopio_cobrar_abonos'], cargar);

  const deudaDe = (id: string) => resumen?.items.find((i) => i.cuenta.id === id)?.deuda ?? 0;
  const kgDe = (id: string) => resumen?.items.find((i) => i.cuenta.id === id)?.saldoKg ?? 0;

  async function borrar(c: CuentaCobrarAcopio) {
    if (!window.confirm(`¿Eliminar la cuenta por cobrar de ${c.cliente}? Se borran también sus abonos.`)) return;
    try { await eliminarCuentaCobrar(c.id); toast('Cuenta eliminada', 'success'); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      {onVolver && (
        <div className="page-head">
          <div>
            <h1>📥 Cuentas por Cobrar · Centro de Costo {centro}</h1>
            <p className="hint muted">Deuda en $ que se cobra con mineral: cada abono (en Kg × $/Kg) baja la deuda y, opcional, suma los Kg al stock de casiterita.</p>
          </div>
          <button className="btn btn-ghost" onClick={onVolver}>← Volver a Acopio</button>
        </div>
      )}
      {/* Resumen (réplica de la hoja RESUMEN) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-title"><span>Total por cobrar ($)</span></div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--danger)' }}>{money(resumen?.totalDeuda ?? 0)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>deuda viva de todas las cuentas</div>
        </div>
        <div className="card"><div className="card-title"><span>Kg recibidos (abonos)</span></div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success, #45c08a)' }}>{num(resumen?.totalKg ?? 0)} Kg</div></div>
        <div className="card"><div className="card-title"><span>Cuentas abiertas</span></div>
          <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{num(resumen?.abiertas ?? 0)}</div></div>
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {canWrite && <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva cuenta por cobrar</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span>📥 Cuentas por cobrar</span></div>
        {loading ? <EmptyState message="Cargando…" icon="◔" /> : !cuentas.length ? (
          <EmptyState message="Sin cuentas por cobrar. Creá una con + Nueva cuenta por cobrar." icon="📥" />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr><th>Cliente</th><th>Descripción</th><th>Factura</th><th>$/Kg</th><th>Deuda</th><th>Kg recibidos</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {cuentas.map((c) => {
                  const deuda = deudaDe(c.id);
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setVerCuenta(c)} title="Ver abonos">
                      <td style={{ fontWeight: 700 }}>{c.cliente}</td>
                      <td>{c.descripcion || '—'}</td>
                      <td className="mono">{money(c.monto_factura)}</td>
                      <td className="mono">{c.precio_usd_kg ? money(c.precio_usd_kg) : '—'}</td>
                      <td className="mono" style={{ fontWeight: 800, color: deuda > 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{money(deuda)}</td>
                      <td className="mono">{num(kgDe(c.id))} Kg</td>
                      <td><span className={`badge ${c.estado === 'saldada' ? 'success' : 'warning'}`}>{c.estado === 'saldada' ? '✔ Saldada' : '● Abierta'}</span></td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setVerCuenta(c)}>Abonos</button>
                        {canWrite && <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => borrar(c)}>✕</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nueva && <NuevaCuentaModal actor={actor} actorName={actorName} centro={centro} onClose={() => setNueva(false)} onSaved={async () => { setNueva(false); await cargar(); }} />}
      {verCuenta && <AbonosCuentaModal cuenta={verCuenta} canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setVerCuenta(null)} onChanged={cargar} />}
    </div>
  );
}

/* ───────────── Modales ───────────── */

function NuevaCuentaModal({ actor, actorName, centro, onClose, onSaved }: { actor: string; actorName: string | null; centro: string; onClose: () => void; onSaved: () => void }) {
  const [cliente, setCliente] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [precio, setPrecio] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      await crearCuentaCobrar({ cliente, descripcion, montoFactura: Number(monto) || 0, precioUsdKg: Number(precio) || 0, centroNombre: centro }, actor, actorName);
      toast('Cuenta por cobrar creada', 'success'); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear'); setSaving(false); }
  }
  return (
    <Modal title="Nueva cuenta por cobrar" size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="nueva-cuenta" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear'}</button></>
    }>
      <form id="nueva-cuenta" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Cliente</label><input className="input" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Ej. Juan Bodega" autoFocus required /></div>
        <div className="form-row"><label>Descripción</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Venta de Camión NHR" /></div>
        <div className="form-grid">
          <div className="form-row"><label>Monto de la factura ($)</label><input className="input mono" type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" required /></div>
          <div className="form-row"><label>Precio referencia $/Kg</label><input className="input mono" type="number" min={0} step="0.0001" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" /></div>
        </div>
        <small className="muted">La deuda se paga con abonos en Kg de mineral (Kg × $/Kg baja la deuda).</small>
      </form>
    </Modal>
  );
}

function AbonosCuentaModal({ cuenta, canWrite, actor, actorName, onClose, onChanged }: {
  cuenta: CuentaCobrarAcopio; canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void;
}) {
  const [led, setLed] = useState<CobrarLedger | null>(null);
  const [agregar, setAgregar] = useState(false);

  const cargar = useCallback(async () => { setLed(await getCobrarLedger(cuenta)); }, [cuenta]);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error')); }, [cargar]);
  useRealtime(['acopio_cobrar_abonos'], cargar);

  async function borrarFila(f: CobrarFila) {
    if (f.esFactura) { toast('La factura inicial no se elimina por aquí; borrá la cuenta entera.', 'warning'); return; }
    if (!window.confirm('¿Eliminar este abono?')) return;
    try {
      // eliminarAbonoCobrar solo usa id, kg_entregados y si hubo reflejo a casiterita (para revertir el stock).
      await eliminarAbonoCobrar({
        id: f.id, cuenta_id: cuenta.id, fecha: f.fecha, kg_entregados: f.kgEntregados,
        recepcion_mov_id: f.reflejoCasiterita ? 'reverted' : null,
        created_by: actor, actor_name: actorName, reflejo_casiterita: !!f.reflejoCasiterita,
        descripcion: f.descripcion, monto_factura: f.montoFactura, precio_usd_kg: f.precioUsdKg, orden: 0, created_at: f.fecha,
      });
      toast('Abono eliminado', 'success'); await cargar(); onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title={`Cuenta por cobrar · ${cuenta.cliente}`} size="lg" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      {canWrite && cuenta.estado === 'abierta' && <button className="btn btn-primary" onClick={() => setAgregar(true)}>+ Registrar abono</button>}</>
    }>
      {!led ? <EmptyState message="Cargando…" icon="◔" /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
            <div className="card"><div className="card-title"><span>Factura</span></div><div className="mono" style={{ fontWeight: 800 }}>{money(cuenta.monto_factura)}</div></div>
            <div className="card"><div className="card-title"><span>Abonado</span></div><div className="mono" style={{ fontWeight: 800, color: 'var(--success, #45c08a)' }}>{money(led.totalAbonado)}</div></div>
            <div className="card" style={{ borderColor: 'var(--primary)' }}><div className="card-title"><span>Deuda</span></div><div className="mono" style={{ fontWeight: 800, color: led.deuda > 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{money(led.deuda)}</div></div>
            <div className="card"><div className="card-title"><span>Kg recibidos</span></div><div className="mono" style={{ fontWeight: 800 }}>{num(led.totalKg)} Kg</div></div>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Cargo</th><th>Kg</th><th>$/Kg</th><th>Total $</th><th>Deuda</th><th>Saldo Kg</th>{canWrite && <th></th>}</tr>
              </thead>
              <tbody>
                {led.filas.map((f) => (
                  <tr key={f.id} style={f.esFactura ? { background: 'var(--surface-2)' } : undefined}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(f.fecha)}</td>
                    <td style={{ fontWeight: f.esFactura ? 700 : 600 }}>
                      {f.descripcion}{f.reflejoCasiterita && <span className="badge primary" style={{ marginLeft: '.4rem', fontSize: '.68rem' }}>→ casiterita</span>}
                    </td>
                    <td className="mono">{f.montoFactura ? money(f.montoFactura) : '—'}</td>
                    <td className="mono">{f.kgEntregados ? num(f.kgEntregados) : '—'}</td>
                    <td className="mono">{f.precioUsdKg ? money(f.precioUsdKg) : '—'}</td>
                    <td className="mono">{f.totalUsd ? money(f.totalUsd) : '—'}</td>
                    <td className="mono"><strong>{money(f.deuda)}</strong></td>
                    <td className="mono" style={{ color: 'var(--success, #45c08a)' }}>{num(f.saldoKg)}</td>
                    {canWrite && <td>{!f.esFactura && <button className="btn btn-sm btn-ghost" title="Eliminar abono" onClick={() => borrarFila(f)}>✕</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {agregar && <AgregarAbonoModal cuenta={cuenta} actor={actor} actorName={actorName} onClose={() => setAgregar(false)} onSaved={async () => { setAgregar(false); await cargar(); onChanged(); }} />}
    </Modal>
  );
}

function AgregarAbonoModal({ cuenta, actor, actorName, onClose, onSaved }: {
  cuenta: CuentaCobrarAcopio; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [kg, setKg] = useState('');
  const [precio, setPrecio] = useState(cuenta.precio_usd_kg ? String(cuenta.precio_usd_kg) : '');
  const [descripcion, setDescripcion] = useState('');
  const [sumar, setSumar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalUsd = (Number(kg) || 0) * (Number(precio) || 0);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      await crearAbonoCobrar({ cuentaId: cuenta.id, fecha, descripcion, kgEntregados: Number(kg) || 0, precioUsdKg: Number(precio) || 0, sumarCasiterita: sumar }, actor, actorName);
      toast('Abono registrado', 'success'); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }
  return (
    <Modal title={`Registrar abono · ${cuenta.cliente}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="abono-cobrar" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Registrar abono'}</button></>
    }>
      <form id="abono-cobrar" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div className="form-row"><label>Kg entregados</label><input className="input mono" type="number" min={0} step="any" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="0" autoFocus /></div>
          <div className="form-row"><label>Precio $/Kg</label><input className="input mono" type="number" min={0} step="0.0001" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" /></div>
        </div>
        <p className="hint muted" style={{ fontSize: '.8rem', marginTop: 0 }}>Baja la deuda en (Kg × $/Kg): <strong className="mono">{money(totalUsd)}</strong></p>
        <div className="form-row"><label>Descripción (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ABONO" /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
          <input type="checkbox" checked={sumar} onChange={(e) => setSumar(e.target.checked)} />
          Sumar estos Kg al <strong>stock real de CASITERITA</strong>
        </label>
        <small className="muted">Marcá solo si estos Kg NO entraron ya por una recepción aparte (evita doble conteo).</small>
      </form>
    </Modal>
  );
}
