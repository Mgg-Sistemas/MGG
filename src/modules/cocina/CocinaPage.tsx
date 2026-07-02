/* ============================================================
   MGG · Control de Alimentación (Cocina)
   - Añadir movimiento: consumo de víveres por comida (descuenta inventario).
   - Resumen / consumo: barras por día/víver, platos, promedio por plato, stock.
   - Tabla filtrable + reporte PDF con vista previa.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime, money, num } from '@/shared/lib/format';
import type { CocinaComida, TipoComida, Cocina, Almacen } from '@/shared/lib/types';
import { nombreCortoAlmacen } from '@/modules/inventario/almacenes.repository';
import {
  listComidas, crearComida, listViveres, resumirComidas,
  listCocinas, crearCocina, actualizarCocina, eliminarCocina, listAlmacenesParaCocina,
  TIPOS_COMIDA, labelTipoComida, type ViverDisponible, type ResumenCocina, type CocinaConInfo,
} from './cocina.repository';
// descargarReporteCocinaPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.
import { crearAlertaMercado, listAlertasMercadoPendientes } from './alertasMercado.repository';

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ───────────── Página: tarjetas de cocinas ───────────── */
export function CocinaPage() {
  const { user } = useSession();
  const { can } = usePermissions();
  const canWrite = can('cocina', 'escritura');
  const actor = user?.email ?? 'sistema';

  const [cocinas, setCocinas] = useState<CocinaConInfo[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);        // cocina abierta
  const [form, setForm] = useState<'nueva' | Cocina | null>(null);
  const [borrar, setBorrar] = useState<CocinaConInfo | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setCocinas(await listCocinas()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar las cocinas', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { listAlmacenesParaCocina().then(setAlmacenes).catch(() => setAlmacenes([])); }, []);
  // Incluye inventario (productos/existencias/movimientos): la cocina refleja en vivo
  // el stock del almacén vinculado.
  useRealtime(['cocinas', 'cocina_comidas', 'productos', 'existencias', 'movimientos'], () => { void reload(); });

  const selInfo = cocinas.find((c) => c.cocina.id === sel) ?? null;
  if (selInfo) {
    return <CocinaDetalle info={selInfo} canWrite={canWrite} actor={actor} userEmail={user?.email ?? null} onBack={() => setSel(null)} />;
  }

  async function confirmarBorrar() {
    const c = borrar; if (!c) return; setBorrar(null);
    try { await eliminarCocina(c.cocina.id); toast('Cocina inhabilitada', 'success'); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>🍽 Cocinas</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>Cada cocina toma sus víveres del almacén al que está vinculada. Entrá a una para registrar comidas.</p>
        </div>
        {canWrite && <button className="btn btn-primary" onClick={() => setForm('nueva')}>＋ Nueva cocina</button>}
      </div>

      {loading ? (
        <EmptyState message="Cargando cocinas…" icon="◔" />
      ) : !cocinas.length ? (
        <div className="card" style={{ marginTop: '1rem' }}><EmptyState message="No hay cocinas. Creá la primera con “＋ Nueva cocina”." icon="🍳" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {cocinas.map((info) => (
            <div key={info.cocina.id} className="card" style={{ margin: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '.35rem' }}
              onClick={() => setSel(info.cocina.id)} title="Entrar a la cocina">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                <strong style={{ fontSize: '1.05rem' }}>🍳 {info.cocina.nombre}</strong>
                <span className="badge">Entrar →</span>
              </div>
              <div className="muted" style={{ fontSize: '.82rem' }}>📦 {info.almacenNombre ?? <span style={{ color: 'var(--warning)' }}>Sin almacén vinculado</span>}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', marginTop: '.2rem' }}>
                <span className="muted">Víveres con stock</span><strong className="mono">{num(info.viveres)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem' }}>
                <span className="muted">Valor del stock</span><strong className="mono">{money(info.valorStock)}</strong>
              </div>
              {canWrite && (
                <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setForm(info.cocina)} title="Editar cocina">✎ Editar</button>
                  <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(info)} title="Inhabilitar cocina">🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {form && (
        <CocinaFormModal cocina={form === 'nueva' ? null : form} almacenes={almacenes} actor={actor}
          onClose={() => setForm(null)} onSaved={async () => { setForm(null); await reload(); }} />
      )}
      {borrar && (
        <ConfirmDialog title="Inhabilitar cocina"
          message={`¿Inhabilitar la cocina "${borrar.cocina.nombre}"? Sus comidas quedan en el histórico; podés volver a crearla luego.`}
          confirmText="Inhabilitar" danger onConfirm={confirmarBorrar} onCancel={() => setBorrar(null)} />
      )}
    </div>
  );
}

/* ───────────── Alta / edición de una cocina ───────────── */
function CocinaFormModal({ cocina, almacenes, actor, onClose, onSaved }: {
  cocina: Cocina | null; almacenes: Almacen[]; actor: string; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(cocina?.nombre ?? '');
  const [almacenId, setAlmacenId] = useState(cocina?.almacen_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opciones de almacén ordenadas por sede, mostrando el nombre corto del subalmacén.
  const opciones = useMemo(() => [...almacenes]
    .sort((a, b) => `${a.sede ?? ''} ${a.nombre}`.localeCompare(`${b.sede ?? ''} ${b.nombre}`, 'es'))
    .map((a) => ({ value: a.id, label: `${a.sede ? `${a.sede} · ` : ''}${nombreCortoAlmacen(a, almacenes)}` })), [almacenes]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!nombre.trim()) { setError('Indicá el nombre de la cocina.'); return; }
    if (!almacenId) { setError('Vinculá la cocina a un almacén / subalmacén.'); return; }
    setSaving(true);
    try {
      if (cocina) await actualizarCocina(cocina.id, { nombre, almacenId });
      else await crearCocina({ nombre, almacenId, actor });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={cocina ? 'Editar cocina' : 'Nueva cocina'} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="cocina-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : (cocina ? 'Guardar' : 'Crear cocina')}</button>
      </>
    }>
      <form id="cocina-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row">
          <label>Nombre de la cocina</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: La Esperanza" autoFocus />
        </div>
        <div className="form-row">
          <label>Almacén / subalmacén vinculado</label>
          <SearchSelect value={almacenId} onChange={setAlmacenId} options={opciones}
            placeholder="🔎 Buscá el almacén…" emptyText="No hay almacenes." />
          <small className="muted">De este almacén salen los víveres y se descuenta el stock de esta cocina.</small>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Página de UNA cocina (comidas + resumen) ───────────── */
function CocinaDetalle({ info, canWrite, actor, userEmail, onBack }: {
  info: CocinaConInfo; canWrite: boolean; actor: string; userEmail: string | null; onBack: () => void;
}) {
  const cocinaId = info.cocina.id;
  const almacen = info.almacenNombre;

  const [comidas, setComidas] = useState<CocinaComida[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'none' | 'add' | 'resumen'>('none');
  const [alertando, setAlertando] = useState(false);

  // Alerta "a restablecer el mercado": avisa a Pedidos/Compras que hay que reponer víveres.
  async function enviarAlertaMercado() {
    setAlertando(true);
    try {
      const pend = await listAlertasMercadoPendientes();
      if (pend.length) { toast('Ya hay una alerta de mercado pendiente en Pedidos/Compras', 'warning'); return; }
      await crearAlertaMercado({ actor });
      notify('🛒 La cocina solicitó RESTABLECER EL MERCADO — montar el pedido', 'warning', { link: '#/app/pedidos' });
      toast('Alerta enviada a Pedidos/Compras', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar la alerta', 'error');
    } finally { setAlertando(false); }
  }

  // Filtros de la tabla
  const [q, setQ] = useState('');
  const [fTipo, setFTipo] = useState<TipoComida | ''>('');
  const [fFecha, setFFecha] = useState('');     // YYYY-MM-DD
  const [fHora, setFHora] = useState('');       // HH

  const reload = useCallback(async () => {
    setLoading(true);
    try { setComidas(await listComidas({ cocinaId })); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, [cocinaId]);
  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['cocina_comidas', 'productos', 'existencias', 'movimientos'], () => { void reload(); });

  const horasPresentes = useMemo(() => {
    const set = new Set<string>();
    comidas.forEach((c) => set.add((c.at ?? '').slice(11, 13)));
    return Array.from(set).filter(Boolean).sort();
  }, [comidas]);

  const filtradas = useMemo(() => {
    const term = q.trim().toLowerCase();
    return comidas.filter((c) => {
      if (fTipo && c.tipo_comida !== fTipo) return false;
      if (fFecha && (c.at ?? '').slice(0, 10) !== fFecha) return false;
      if (fHora && (c.at ?? '').slice(11, 13) !== fHora) return false;
      if (term) {
        const hay = `${c.codigo} ${labelTipoComida(c.tipo_comida)} ${(c.items ?? []).map((i) => i.nombre).join(' ')}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [comidas, q, fTipo, fFecha, fHora]);

  const totalFiltrado = useMemo(() => ({
    platos: filtradas.reduce((a, c) => a + (Number(c.platos) || 0), 0),
    valor: r2(filtradas.reduce((a, c) => a + (Number(c.valor_total) || 0), 0)),
  }), [filtradas]);

  function rangoLabel(): string {
    if (fFecha) return `Día ${fFecha}${fHora ? ` · ${fHora}:00` : ''}${fTipo ? ` · ${labelTipoComida(fTipo)}` : ''}`;
    if (fTipo) return `Filtro: ${labelTipoComida(fTipo)}`;
    return 'Todas las comidas registradas';
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: '.5rem' }}>← Volver a cocinas</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.3rem' }}>
        <h1 style={{ margin: 0 }}>🍳 {info.cocina.nombre}</h1>
      </div>
      <p className="hint muted" style={{ marginTop: 0 }}>Toma precios y descuenta stock del almacén <strong>{almacen ?? '— sin almacén vinculado —'}</strong>.</p>
      {!almacen && <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem' }}>Esta cocina no tiene un almacén vinculado. Volvé y editála para asignarle uno.</div>}

      <div className="filterbar" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setModal('resumen')}>📊 Resumen / Consumo</button>
          <button className="btn btn-ghost" onClick={() => void import('./cocinaPdf').then(({ descargarReporteCocinaPdf }) => descargarReporteCocinaPdf(filtradas, rangoLabel())).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))} disabled={!filtradas.length}>↓ Reporte PDF</button>
          {canWrite && (
            <button className="btn btn-ghost" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
              onClick={enviarAlertaMercado} disabled={alertando} title="Avisar a Pedidos/Compras que hay que reponer víveres">
              🔔 Alerta a restablecer
            </button>
          )}
        </div>
        {canWrite && <button className="btn btn-primary" onClick={() => setModal('add')}>＋ Añadir movimiento</button>}
      </div>

      {/* Filtros */}
      <div className="filterbar" style={{ gap: '.5rem', flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: '1 1 220px' }} placeholder="Buscar por correlativo, comida o víver…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={fTipo} onChange={(e) => setFTipo(e.target.value as TipoComida | '')} style={{ maxWidth: 180 }}>
          <option value="">Todas las comidas</option>
          {TIPOS_COMIDA.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>
        <input className="input" type="date" value={fFecha} onChange={(e) => setFFecha(e.target.value)} style={{ maxWidth: 170 }} />
        <select className="select" value={fHora} onChange={(e) => setFHora(e.target.value)} style={{ maxWidth: 130 }}>
          <option value="">Toda hora</option>
          {horasPresentes.map((h) => <option key={h} value={h}>{h}:00 – {h}:59</option>)}
        </select>
        {(q || fTipo || fFecha || fHora) && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setFTipo(''); setFFecha(''); setFHora(''); }}>Limpiar</button>}
      </div>

      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : !filtradas.length ? (
        <div className="card"><EmptyState message="No hay comidas registradas con estos filtros." icon="🍽" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th>Correlativo</th><th>Comida</th><th>Fecha · hora</th>
              <th style={{ textAlign: 'right' }}>Platos</th><th>Víveres</th>
              <th style={{ textAlign: 'right' }}>Valor</th><th style={{ textAlign: 'right' }}>Prom./plato</th>
            </tr></thead>
            <tbody>
              {filtradas.map((c) => {
                const t = TIPOS_COMIDA.find((x) => x.value === c.tipo_comida);
                const prom = Number(c.platos) > 0 ? Number(c.valor_total) / Number(c.platos) : 0;
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.codigo}</td>
                    <td><span className="badge">{t?.icon} {labelTipoComida(c.tipo_comida)}</span></td>
                    <td>{dateTime(c.at)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(c.platos)}</td>
                    <td className="muted" style={{ fontSize: '.82rem' }}>{(c.items ?? []).map((i) => `${i.nombre} ×${num(i.cantidad)}`).join(', ')}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(c.valor_total)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(prom)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ fontWeight: 700 }}>
              <td colSpan={3} style={{ textAlign: 'right' }}>{filtradas.length} comida(s) · Total</td>
              <td className="mono" style={{ textAlign: 'right' }}>{num(totalFiltrado.platos)}</td>
              <td></td>
              <td className="mono" style={{ textAlign: 'right' }}>{money(totalFiltrado.valor)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{money(totalFiltrado.platos > 0 ? totalFiltrado.valor / totalFiltrado.platos : 0)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}

      {modal === 'add' && (
        <AnadirMovimientoModal cocinaId={cocinaId} almacen={almacen} actor={actor} actorName={userEmail}
          onClose={() => setModal('none')} onSaved={async () => { setModal('none'); await reload(); }} />
      )}
      {modal === 'resumen' && <ResumenModal cocinaId={cocinaId} almacen={almacen} onClose={() => setModal('none')} />}
    </div>
  );
}

/* ───────────── Añadir movimiento (consumo de víveres) ───────────── */
function AnadirMovimientoModal({ cocinaId, almacen, actor, actorName, onClose, onSaved }: {
  cocinaId: string; almacen: string | null; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [viveres, setViveres] = useState<ViverDisponible[]>([]);
  const [tipo, setTipo] = useState<TipoComida>('almuerzo');
  const [platos, setPlatos] = useState('');
  const [nota, setNota] = useState('');
  const [lineas, setLineas] = useState<Array<{ id: number; productoId: string; cantidad: string }>>([{ id: 1, productoId: '', cantidad: '' }]);
  const [seq, setSeq] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listViveres(almacen).then(setViveres).catch(() => setViveres([])); }, [almacen]);
  const mapV = useMemo(() => new Map(viveres.map((v) => [v.producto.id, v])), [viveres]);

  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, productoId: '', cantidad: '' }]); setSeq((s) => s + 1); };
  const setLinea = (id: number, patch: Partial<{ productoId: string; cantidad: string }>) =>
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const delLinea = (id: number) => setLineas((ls) => ls.filter((l) => l.id !== id));

  const total = useMemo(() => r2(lineas.reduce((a, l) => {
    const v = mapV.get(l.productoId);
    return a + (v ? (Number(l.cantidad) || 0) * v.precio : 0);
  }, 0)), [lineas, mapV]);
  const nPlatos = Number(platos) || 0;

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const items = lineas.filter((l) => l.productoId && (Number(l.cantidad) || 0) > 0)
      .map((l) => ({ producto_id: l.productoId, cantidad: Number(l.cantidad) || 0 }));
    if (!items.length) { setError('Agregá al menos un víver con cantidad.'); return; }
    if (nPlatos <= 0) { setError('Indicá cuántos platos se realizaron.'); return; }
    setSaving(true);
    try {
      await crearComida({ tipoComida: tipo, platos: nPlatos, items, nota: nota.trim() || null, cocinaId, almacen, actor, actorName });
      notify(`Comida registrada · ${labelTipoComida(tipo)} · ${money(total)}`, 'success', { link: '#/app/cocina' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title="Añadir movimiento · Cocina" size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="cocina-add" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : `Registrar · ${money(total)}`}</button>
      </>
    }>
      <form id="cocina-add" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Tipo de comida (check) */}
        <div className="form-row">
          <label>Tipo de comida</label>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {TIPOS_COMIDA.map((t) => (
              <label key={t.value} className="card" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: 0, padding: '.5rem .8rem', cursor: 'pointer', borderColor: tipo === t.value ? 'var(--brand, #ff8a00)' : 'var(--border)' }}>
                <input type="checkbox" checked={tipo === t.value} onChange={() => setTipo(t.value)} />
                <span style={{ fontWeight: 600 }}>{t.icon} {t.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Víveres (solo categoría VÍVERES desde el inventario) */}
        <div className="form-row">
          <label>Víveres consumidos <span className="muted" style={{ fontWeight: 400 }}>(solo categoría VÍVERES)</span></label>
          <div style={{ display: 'grid', gap: '.5rem' }}>
            {lineas.map((l) => {
              const v = mapV.get(l.productoId);
              const excede = !!v && (Number(l.cantidad) || 0) > v.stock;
              return (
                <div key={l.id} className="card" style={{ margin: 0, padding: '.6rem' }}>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-row" style={{ margin: 0, flex: '1 1 260px' }}>
                      <label style={{ fontSize: '.74rem' }}>Producto</label>
                      <SearchSelect value={l.productoId} onChange={(v) => setLinea(l.id, { productoId: v })}
                        options={viveres.map((vv) => ({ value: vv.producto.id, label: `${vv.producto.nombre} · ${money(vv.precio)} · stock ${num(vv.stock)} ${vv.producto.unidad}` }))}
                        placeholder="Buscar víver…" emptyText="Sin víveres en el inventario." />
                    </div>
                    <div className="form-row" style={{ margin: 0, flex: '0 1 130px' }}>
                      <label style={{ fontSize: '.74rem' }}>Cantidad{v ? ` (${v.producto.unidad})` : ''}</label>
                      <input className="input mono" type="number" min={0} step="any" value={l.cantidad}
                        onChange={(e) => setLinea(l.id, { cantidad: e.target.value })}
                        style={{ textAlign: 'right', borderColor: excede ? 'var(--warning)' : undefined }} />
                    </div>
                    <div style={{ fontSize: '.82rem', paddingBottom: '.4rem', minWidth: 90, textAlign: 'right' }}>
                      {v ? <strong className="mono">{money((Number(l.cantidad) || 0) * v.precio)}</strong> : <span className="muted">—</span>}
                    </div>
                    {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => delLinea(l.id)}>✕</button>}
                  </div>
                  {v && <small className="muted" style={{ fontSize: '.72rem' }}>Stock disponible: <strong className="mono">{num(v.stock)} {v.producto.unidad}</strong>{excede && <span style={{ color: 'var(--warning)' }}> · supera el stock (se descontará hasta 0)</span>}</small>}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={addLinea}>＋ Agregar producto</button>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Platos realizados</label>
            <input className="input mono" type="number" min={1} step="1" value={platos} onChange={(e) => setPlatos(e.target.value)} placeholder="Ej.: 24" required />
            {nPlatos > 0 && total > 0 && <small className="muted">Costo por plato: <strong className="mono">{money(total / nPlatos)}</strong></small>}
          </div>
          <div className="form-row">
            <label>Nota (opcional)</label>
            <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Detalle del servicio…" />
          </div>
        </div>
        <small className="muted">Se genera un correlativo con fecha y hora, y se descuenta el stock de los víveres del inventario.</small>
      </form>
    </Modal>
  );
}

/* ───────────── Resumen / consumo (barras + stock) ───────────── */
type Preset = 'hoy' | 'semana' | 'mes' | 'rango';
function ResumenModal({ cocinaId, almacen, onClose }: { cocinaId: string; almacen: string | null; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>('semana');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [comidas, setComidas] = useState<CocinaComida[]>([]);
  const [viveres, setViveres] = useState<ViverDisponible[]>([]);
  const [loading, setLoading] = useState(true);

  // Rango efectivo (ISO) según el preset.
  const rango = useMemo(() => {
    const now = new Date();
    const fin = new Date(now); fin.setHours(23, 59, 59, 999);
    const ini = new Date(now); ini.setHours(0, 0, 0, 0);
    if (preset === 'hoy') return { desde: ini, hasta: fin };
    if (preset === 'semana') { const d = new Date(ini); d.setDate(d.getDate() - 6); return { desde: d, hasta: fin }; }
    if (preset === 'mes') { const d = new Date(ini); d.setDate(d.getDate() - 29); return { desde: d, hasta: fin }; }
    // rango personalizado
    const d = desde ? new Date(`${desde}T00:00:00`) : new Date(0);
    const h = hasta ? new Date(`${hasta}T23:59:59`) : fin;
    return { desde: d, hasta: h };
  }, [preset, desde, hasta]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listComidas({ cocinaId, desde: rango.desde.toISOString(), hasta: rango.hasta.toISOString() }),
      listViveres(almacen),
    ]).then(([cs, vs]) => { setComidas(cs); setViveres(vs); }).catch(() => { /* */ }).finally(() => setLoading(false));
  }, [rango, cocinaId, almacen]);

  const resumen: ResumenCocina = useMemo(() => resumirComidas(comidas), [comidas]);
  const maxViver = Math.max(1, ...resumen.topViveres.map((v) => v.valor));
  const maxDia = Math.max(1, ...resumen.porDia.map((d) => d.valor));
  const fmtDia = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  const presets: { k: Preset; label: string }[] = [
    { k: 'hoy', label: 'Hoy' }, { k: 'semana', label: 'Últimos 7 días' },
    { k: 'mes', label: 'Últimos 30 días' }, { k: 'rango', label: 'Rango' },
  ];

  return (
    <Modal title="📊 Resumen / Consumo de cocina" size="xl" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => void import('./cocinaPdf').then(({ descargarReporteCocinaPdf }) => descargarReporteCocinaPdf(comidas, `Resumen · ${fmtDia(rango.desde.toISOString().slice(0, 10))} a ${fmtDia(rango.hasta.toISOString().slice(0, 10))}`)).catch(() => toast('No se pudo generar el PDF', 'error'))} disabled={!comidas.length}>↓ PDF</button>
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>
      }>
      <div className="view-toggle" role="tablist" style={{ marginBottom: '.6rem' }}>
        {presets.map((p) => <button key={p.k} className={preset === p.k ? 'active' : ''} onClick={() => setPreset(p.k)}>{p.label}</button>)}
      </div>
      {preset === 'rango' && (
        <div className="filterbar" style={{ gap: '.5rem' }}>
          <label className="muted" style={{ fontSize: '.8rem' }}>Desde <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="muted" style={{ fontSize: '.8rem' }}>Hasta <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
      )}

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : (
        <>
          {/* Tarjetas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.6rem', margin: '.5rem 0 .9rem' }}>
            <div className="card" style={{ margin: 0, padding: '.7rem .9rem' }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>PLATOS</div>
              <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{num(resumen.platos)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.7rem .9rem' }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>CONSUMO TOTAL</div>
              <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }}>{money(resumen.valor)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.7rem .9rem' }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>PROMEDIO POR PLATO</div>
              <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--warning)' }}>{money(resumen.promedioPorPlato)}</div>
            </div>
          </div>

          {/* Consumo por día (barras) */}
          {resumen.porDia.length > 0 && (
            <div className="card" style={{ marginBottom: '.9rem' }}>
              <div className="card-title" style={{ marginBottom: '.5rem' }}>Consumo por día</div>
              <div style={{ display: 'grid', gap: '.4rem' }}>
                {resumen.porDia.map((d) => (
                  <div key={d.dia} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.82rem' }}>
                    <span className="mono" style={{ width: 90 }}>{fmtDia(d.dia)}</span>
                    <div style={{ flex: 1, background: 'var(--bg-1, rgba(0,0,0,.06))', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(3, (d.valor / maxDia) * 100)}%`, background: 'var(--primary, #ff8a00)', height: 20, borderRadius: 6 }} />
                    </div>
                    <span className="mono" style={{ width: 150, textAlign: 'right' }}>{num(d.platos)} platos · {money(d.valor)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Víveres más consumidos (barras) */}
          <div className="card" style={{ marginBottom: '.9rem' }}>
            <div className="card-title" style={{ marginBottom: '.5rem' }}>Víveres que más se consumen</div>
            {!resumen.topViveres.length ? <p className="hint muted" style={{ margin: 0 }}>Sin consumo en el período.</p> : (
              <div style={{ display: 'grid', gap: '.4rem' }}>
                {resumen.topViveres.slice(0, 12).map((v) => (
                  <div key={v.sku} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.82rem' }}>
                    <span style={{ width: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.nombre}>{v.nombre}</span>
                    <div style={{ flex: 1, background: 'var(--bg-1, rgba(0,0,0,.06))', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(3, (v.valor / maxViver) * 100)}%`, background: 'var(--primary-3, #2ecc71)', height: 18, borderRadius: 6 }} />
                    </div>
                    <span className="mono" style={{ width: 160, textAlign: 'right' }}>{num(v.cantidad)} {v.unidad} · {money(v.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stock disponible de víveres */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: '.5rem' }}>Stock disponible de víveres</div>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '.82rem' }}>
                <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
                <tbody>
                  {viveres.map((v) => (
                    <tr key={v.producto.id}>
                      <td>{v.producto.nombre} <span className="muted mono" style={{ fontSize: '.72rem' }}>{v.producto.sku}</span></td>
                      <td className="mono" style={{ textAlign: 'right', color: v.stock <= 0 ? 'var(--danger)' : undefined }}>{num(v.stock)} {v.producto.unidad}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(v.precio)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(v.stock * v.precio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
