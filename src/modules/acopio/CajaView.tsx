import { useMemo, useState } from 'react';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { date, money, num } from '@/shared/lib/format';
import type { CajaCierre, CajaMovimiento, ClasificacionAcopio, CostoClase, GrupoClasificacion } from '@/shared/lib/types';
import {
  GRUPOS, grupoColor, grupoLabel,
  crearMovimientoCaja, actualizarMovimientoCaja, eliminarMovimientoCaja, addClasificacion,
  cerrarCaja, reabrirCaja, crearCaja, addCostoClase, resumirCierre,
  type CajaMovimientoInput,
} from './caja.repository';

function Chip({ grupo, valor }: { grupo?: string | null; valor?: string | null }) {
  if (!grupo) return <span className="muted">—</span>;
  return (
    <span title={grupoLabel(grupo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.74rem' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: grupoColor(grupo), flex: '0 0 auto' }} />
      <span>{valor || grupoLabel(grupo)}</span>
    </span>
  );
}

export function CajaView({ movimientos, clasificaciones, cajas, costoClases, canWrite, actor, actorName, onReload }: {
  movimientos: CajaMovimiento[];
  clasificaciones: ClasificacionAcopio[];
  cajas: CajaCierre[];
  costoClases: CostoClase[];
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onReload: () => Promise<void>;
}) {
  const abierta = cajas.find((c) => c.estado === 'abierta') ?? cajas[0] ?? null;
  const [cajaId, setCajaId] = useState<string>(abierta?.id ?? '');
  const caja = cajas.find((c) => c.id === cajaId) ?? abierta;
  const [modal, setModal] = useState<CajaMovimiento | 'nuevo' | null>(null);
  const [nuevaCaja, setNuevaCaja] = useState(false);

  const movs = useMemo(() => movimientos.filter((m) => (caja ? m.caja_id === caja.id : true)), [movimientos, caja]);
  const resumen = useMemo(() => resumirCierre(caja, movs), [caja, movs]);

  async function cerrar() {
    if (!caja) return;
    if (!window.confirm(`¿Cerrar ${caja.numero}? Quedará como cierre con saldo final ${money(resumen.saldoUsd)}.`)) return;
    try { await cerrarCaja(caja.id, resumen.saldoUsd, actor); toast('Caja cerrada', 'success'); await onReload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); }
  }
  async function reabrir() {
    if (!caja) return;
    try { await reabrirCaja(caja.id); toast('Caja reabierta', 'success'); await onReload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); }
  }

  return (
    <div>
      {/* Cabecera del cierre */}
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <SearchSelect value={cajaId} onChange={setCajaId} style={{ maxWidth: 280 }} placeholder="🔍 Buscar cierre…"
              options={cajas.map((c) => ({ value: c.id, label: `${c.numero}${c.nombre ? ` · ${c.nombre}` : ''} ${c.estado === 'cerrada' ? '🔒' : '●'}` }))} />
            {caja && (
              <span className="muted" style={{ fontSize: '.82rem' }}>
                {date(caja.fecha_inicio)} → {caja.fecha_fin ? date(caja.fecha_fin) : 'hoy'}
                {caja.recepcion ? ` · ${caja.recepcion}` : ''} · <strong>{resumen.dias} días</strong>
              </span>
            )}
          </div>
          {canWrite && (
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setNuevaCaja(true)}>+ Nueva caja</button>
              {caja?.estado === 'abierta'
                ? <button className="btn btn-sm btn-ghost" onClick={cerrar}>🔒 Cerrar caja</button>
                : caja && <button className="btn btn-sm btn-ghost" onClick={reabrir}>Reabrir</button>}
            </div>
          )}
        </div>
      </div>

      {/* Resumen del cierre (calculado) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '.6rem', marginBottom: '.75rem' }}>
        <div className="card" style={{ borderColor: 'var(--primary)' }}><div className="muted" style={{ fontSize: '.72rem' }}>Tasa del material</div><div className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary-3)' }}>{money(resumen.tasa)}/Kg</div></div>
        <div className="card"><div className="muted" style={{ fontSize: '.72rem' }}>Total gastado</div><div className="mono" style={{ fontWeight: 700 }}>{money(resumen.totalGastado)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: '.72rem' }}>Saldo de caja</div><div className="mono" style={{ fontWeight: 700 }}>{money(resumen.saldoUsd)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: '.72rem' }}>Kg cerrados</div><div className="mono" style={{ fontWeight: 700 }}>{num(resumen.kgCerrados)} Kg</div></div>
      </div>

      {/* Distribución por categoría */}
      {resumen.porGrupo.length > 0 && (
        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title"><span>Distribución del gasto por categoría</span></div>
          {resumen.porGrupo.map((g) => (
            <div key={g.grupo} style={{ marginBottom: '.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: g.color, marginRight: 6 }} />{g.label}</span>
                <span className="mono">{money(g.monto)} · {g.pct.toFixed(1)}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, g.pct)}%`, height: '100%', background: g.color }} />
              </div>
            </div>
          ))}
          {resumen.porCosto.length > 0 && (
            <details style={{ marginTop: '.5rem' }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: '.78rem' }}>Por clasificación de costo (2 niveles)</summary>
              <div className="table-wrap" style={{ marginTop: '.4rem' }}>
              <table className="table" style={{ fontSize: '.78rem' }}>
                <thead><tr><th>Clasificación</th><th>Sub-clasificación</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
                <tbody>{resumen.porCosto.map((c, i) => <tr key={i}><td>{c.clasificacion}</td><td>{c.subclasificacion || '—'}</td><td className="mono" style={{ textAlign: 'right' }}>{money(c.monto)}</td><td className="mono" style={{ textAlign: 'right' }}>{c.pct.toFixed(1)}%</td></tr>)}</tbody>
              </table>
              </div>
            </details>
          )}
        </div>
      )}

      <div className="filterbar" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {GRUPOS.map((g) => (
            <span key={g.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.74rem' }} className="muted">
              <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color }} /> {g.label}
            </span>
          ))}
        </div>
        {canWrite && caja?.estado === 'abierta' && <button className="btn btn-primary btn-sm" onClick={() => setModal('nuevo')}>+ Movimiento de caja</button>}
      </div>

      {!movs.length ? (
        <div className="card"><p className="hint muted" style={{ margin: 0 }}>Sin movimientos en esta caja.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead>
              <tr>
                <th>Fecha</th><th>Descripción</th><th>Clasificación</th>
                <th style={{ textAlign: 'right' }}>$ Entregado</th><th style={{ textAlign: 'right' }}>Kg Cerr.</th>
                <th style={{ textAlign: 'right' }} title="Compra de material (egreso que baja el Saldo $)">Compra Material</th>
                <th style={{ textAlign: 'right' }}>Gastos</th>
                <th style={{ textAlign: 'right' }}>Saldo $</th>{canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id} style={canWrite ? { cursor: 'pointer' } : undefined} onClick={canWrite ? () => setModal(m) : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>{date(m.fecha)}</td>
                  <td style={{ maxWidth: 280, whiteSpace: 'pre-wrap' }}>{m.descripcion || '—'}{m.costo_subclasificacion && <div className="muted" style={{ fontSize: '.7rem' }}>↳ {m.costo_subclasificacion}</div>}</td>
                  <td><Chip grupo={m.clasif_grupo} valor={m.clasif_valor} /></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.usd_entregado ? money(m.usd_entregado) : ''}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.kg_cerrados ? num(m.kg_cerrados) : ''}</td>
                  {/* Compra de material (egreso ingresado por el usuario que baja el Saldo $). */}
                  <td className="mono" style={{ textAlign: 'right', color: m.compra_material ? 'var(--primary-3)' : undefined }}>{m.compra_material ? money(m.compra_material) : ''}</td>
                  {/* Gastos = gastos + nómina (unificados en una sola columna). */}
                  <td className="mono" style={{ textAlign: 'right', color: (m.gastos || m.nominas) ? 'var(--danger)' : undefined }}>{((Number(m.gastos) || 0) + (Number(m.nominas) || 0)) ? money((Number(m.gastos) || 0) + (Number(m.nominas) || 0)) : ''}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{money(m.saldo_usd ?? 0)}</td>
                  {canWrite && <td style={{ textAlign: 'center' }}>✎</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <MovimientoModal
          mov={modal === 'nuevo' ? null : modal}
          cajaId={caja?.id ?? null}
          clasificaciones={clasificaciones}
          costoClases={costoClases}
          actor={actor}
          actorName={actorName}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await onReload(); }}
        />
      )}
      {nuevaCaja && <NuevaCajaModal actor={actor} onClose={() => setNuevaCaja(false)} onSaved={async (id) => { setNuevaCaja(false); setCajaId(id); await onReload(); }} />}
    </div>
  );
}

function NuevaCajaModal({ actor, onClose, onSaved }: { actor: string; onClose: () => void; onSaved: (id: string) => void }) {
  const [numero, setNumero] = useState('');
  const [nombre, setNombre] = useState('');
  const [recepcion, setRecepcion] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  async function guardar() {
    if (!numero.trim()) { toast('Indicá el número de caja', 'error'); return; }
    setSaving(true);
    try { const c = await crearCaja({ numero, nombre, recepcion, fecha_inicio: fecha }, actor); toast('Caja creada', 'success'); onSaved(c.id); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); setSaving(false); }
  }
  return (
    <Modal title="Nueva caja / cierre" size="md" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn btn-primary" onClick={guardar} disabled={saving}>Crear</button></>}>
      <div className="form-grid">
        <div className="form-row"><label>Número</label><input className="input" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Caja #13" /></div>
        <div className="form-row"><label>Fecha de inicio</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      </div>
      <div className="form-row"><label>Nombre (opcional)</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
      <div className="form-row"><label>Recepción asociada (opcional)</label><input className="input" value={recepcion} onChange={(e) => setRecepcion(e.target.value)} placeholder="RECEPCION 69" /></div>
    </Modal>
  );
}

function MovimientoModal({ mov, cajaId, clasificaciones, costoClases, actor, actorName, onClose, onSaved }: {
  mov: CajaMovimiento | null;
  cajaId: string | null;
  clasificaciones: ClasificacionAcopio[];
  costoClases: CostoClase[];
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const esNuevo = !mov;
  const [fecha, setFecha] = useState(mov?.fecha ?? new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState(mov?.descripcion ?? '');
  const [grupo, setGrupo] = useState<GrupoClasificacion | ''>(mov?.clasif_grupo ?? '');
  const [valor, setValor] = useState(mov?.clasif_valor ?? '');
  const [costoCl, setCostoCl] = useState(mov?.costo_clasificacion ?? '');
  const [costoSub, setCostoSub] = useState(mov?.costo_subclasificacion ?? '');
  const [usdEntregado, setUsdEntregado] = useState(mov?.usd_entregado ? String(mov.usd_entregado) : '');
  const [kgCerrados, setKgCerrados] = useState(mov?.kg_cerrados ? String(mov.kg_cerrados) : '');
  const [facturados, setFacturados] = useState(mov?.facturados ? String(mov.facturados) : '');
  const [gastos, setGastos] = useState(mov?.gastos ? String(mov.gastos) : '');
  const [nominas, setNominas] = useState(mov?.nominas ? String(mov.nominas) : '');
  const [traslado, setTraslado] = useState(mov?.traslado ? String(mov.traslado) : '');
  const [compraMaterial, setCompraMaterial] = useState(mov?.compra_material ? String(mov.compra_material) : '');
  const [compraMaterialKg, setCompraMaterialKg] = useState(mov?.compra_material_kg ? String(mov.compra_material_kg) : '');
  const [compraMaterialTasa, setCompraMaterialTasa] = useState(mov?.compra_material_tasa ? String(mov.compra_material_tasa) : '');
  const [kgRecibidos, setKgRecibidos] = useState(mov?.kg_recibidos ? String(mov.kg_recibidos) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nuevoValor, setNuevoValor] = useState('');

  const valoresGrupo = useMemo(() => clasificaciones.filter((c) => c.grupo === grupo), [clasificaciones, grupo]);
  const clasifCosto = useMemo(() => [...new Set(costoClases.map((c) => c.clasificacion))], [costoClases]);
  const subsCosto = useMemo(() => costoClases.filter((c) => c.clasificacion === costoCl), [costoClases, costoCl]);

  async function agregarValor() {
    if (!grupo) { setError('Elegí primero el grupo.'); return; }
    const v = nuevoValor.trim();
    if (!v) return;
    try { await addClasificacion(grupo, v); setValor(v); setNuevoValor(''); toast('Clasificación agregada', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
  }
  async function agregarSub() {
    if (!costoCl.trim()) { setError('Indicá la clasificación de costo.'); return; }
    const v = nuevoValor.trim();
    if (!v) return;
    try { await addCostoClase(costoCl, v); setCostoSub(v); setNuevoValor(''); toast('Sub-clasificación agregada', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
  }

  function buildInput(): CajaMovimientoInput {
    return {
      fecha, descripcion,
      usd_entregado: Number(usdEntregado) || 0, kg_cerrados: Number(kgCerrados) || 0,
      facturados: Number(facturados) || 0, gastos: Number(gastos) || 0, nominas: Number(nominas) || 0,
      traslado: Number(traslado) || 0, compra_material: Number(compraMaterial) || 0,
      compra_material_kg: Number(compraMaterialKg) || 0, compra_material_tasa: Number(compraMaterialTasa) || 0,
      kg_recibidos: Number(kgRecibidos) || 0,
      clasif_grupo: grupo || null, clasif_valor: valor || null,
      costo_clasificacion: costoCl || null, costo_subclasificacion: costoSub || null,
      caja_id: cajaId,
    };
  }
  async function guardar() {
    setError(null); setSaving(true);
    try {
      if (esNuevo) { await crearMovimientoCaja(buildInput(), actor, actorName); toast('Movimiento registrado', 'success'); }
      else { await actualizarMovimientoCaja(mov!.id, buildInput()); toast('Movimiento actualizado', 'success'); }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); setSaving(false); }
  }
  async function eliminar() {
    if (!mov) return;
    if (!window.confirm('¿Eliminar este movimiento?')) return;
    setSaving(true);
    try { await eliminarMovimientoCaja(mov.id); toast('Eliminado', 'success'); onSaved(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      {!esNuevo && <button className="btn btn-danger" onClick={eliminar} disabled={saving}>Eliminar</button>}
      <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : (esNuevo ? 'Registrar' : 'Guardar')}</button>
    </>
  );
  const fld = (label: string, val: string, set: (v: string) => void, hint?: string) => (
    <div className="form-row"><label>{label}</label><input className="input mono" type="number" min={0} step="any" value={val} onChange={(e) => set(e.target.value)} />{hint && <small className="muted">{hint}</small>}</div>
  );

  return (
    <Modal title={esNuevo ? 'Nuevo movimiento de caja' : 'Movimiento de caja'} size="lg" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-grid">
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="form-row">
          <label>Clasificación (grupo de caja)</label>
          <select className="select" value={grupo} onChange={(e) => { setGrupo(e.target.value as GrupoClasificacion); setValor(''); }}>
            <option value="">— sin clasificar —</option>
            {GRUPOS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
      </div>
      {grupo && (
        <div className="form-row">
          <label>Categoría <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: grupoColor(grupo), verticalAlign: 'middle' }} /></label>
          <select className="select" value={valor} onChange={(e) => setValor(e.target.value)}>
            <option value="">— elegí —</option>
            {valoresGrupo.map((c) => <option key={c.id} value={c.valor}>{c.valor}</option>)}
          </select>
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
            <input className="input" style={{ flex: 1 }} value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value)} placeholder="+ nueva categoría a este grupo" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={agregarValor}>Agregar</button>
          </div>
        </div>
      )}

      {/* Clasificación de costo (2 niveles) — análisis del cierre */}
      <div className="form-grid">
        <div className="form-row">
          <label>Costo · Clasificación</label>
          <select className="select" value={costoCl} onChange={(e) => { setCostoCl(e.target.value); setCostoSub(''); }}>
            <option value="">— sin costo —</option>
            {clasifCosto.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Costo · Sub-clasificación</label>
          <select className="select" value={costoSub} onChange={(e) => setCostoSub(e.target.value)} disabled={!costoCl}>
            <option value="">— elegí —</option>
            {subsCosto.map((c) => <option key={c.id} value={c.subclasificacion}>{c.subclasificacion}</option>)}
          </select>
          {costoCl && (
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
              <input className="input" style={{ flex: 1 }} value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value)} placeholder="+ nueva sub-clasificación" />
              <button type="button" className="btn btn-sm btn-ghost" onClick={agregarSub}>Agregar</button>
            </div>
          )}
        </div>
      </div>

      <div className="form-row">
        <label>Descripción</label>
        <textarea className="input" rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Detalle del movimiento…" />
      </div>
      <div className="form-grid">
        {fld('$ Entregado (entrada)', usdEntregado, setUsdEntregado)}
        {fld('Kg Cerrados', kgCerrados, setKgCerrados)}
        {fld('$ Facturados', facturados, setFacturados)}
        {fld('Gastos GT', gastos, setGastos, 'suma a la tasa')}
        {fld('Nóminas GT', nominas, setNominas, 'suma a la tasa')}
        {fld('Compra Material ($)', compraMaterial, setCompraMaterial, 'egreso · baja el Saldo $')}
        {fld('Kg comprados', compraMaterialKg, setCompraMaterialKg, 'suman al Saldo en Kg')}
        {fld('Tasa material ($/Kg)', compraMaterialTasa, setCompraMaterialTasa, 'informativa')}
        {fld('Traslado de caja', traslado, setTraslado)}
        {fld('Kg Recibidos por MGG', kgRecibidos, setKgRecibidos)}
      </div>
    </Modal>
  );
}
