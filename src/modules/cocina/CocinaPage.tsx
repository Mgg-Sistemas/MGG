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
import { money, num } from '@/shared/lib/format';
import type { CocinaComida, TipoComida, Cocina, Almacen } from '@/shared/lib/types';
import { nombreCortoAlmacen } from '@/modules/inventario/almacenes.repository';
import { puedeMoverEnSede } from '@/modules/inventario/sectorizacion';
import { useSectorizacion } from '@/modules/inventario/useSectorizacion';
import {
  listComidas, crearComida, editarComida, eliminarComida, listViveresGlobal, resumirComidas,
  listCocinas, crearCocina, actualizarCocina, eliminarCocina, listAlmacenesParaCocina,
  TIPOS_COMIDA, labelTipoComida, type ViverDisponible, type ResumenCocina, type CocinaConInfo,
} from './cocina.repository';
// descargarReporteCocinaPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.
import { crearAlertaMercado, listAlertasMercadoPendientes } from './alertasMercado.repository';
import { mercadoActivo, resumenMercado, iniciarMercado, type MercadoCocina, type ResumenMercado } from './mercados.repository';
import { MercadoPanel } from './MercadoPanel';
import { MercadosHistoricoModal } from './MercadosHistorico';

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

  // Sectorización: la cocina descuenta stock del almacén vinculado, así que vincularla
  // es decidir de qué almacén va a salir la comida. Un almacenista solo puede apuntarla
  // a los suyos; el consumo diario después no elige nada, sale de esta configuración.
  const { sedes: sedesPermitidas } = useSectorizacion();

  // Opciones de almacén ordenadas por sede, mostrando el nombre corto del subalmacén.
  const opciones = useMemo(() => [...almacenes]
    .filter((a) => puedeMoverEnSede(a.sede, sedesPermitidas))
    .sort((a, b) => `${a.sede ?? ''} ${a.nombre}`.localeCompare(`${b.sede ?? ''} ${b.nombre}`, 'es'))
    .map((a) => ({ value: a.id, label: `${a.sede ? `${a.sede} · ` : ''}${nombreCortoAlmacen(a, almacenes)}` })), [almacenes, sedesPermitidas]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!nombre.trim()) { setError('Indicá el nombre de la cocina.'); return; }
    if (!almacenId) { setError('Vinculá la cocina a un almacén / subalmacén.'); return; }
    const elegido = almacenes.find((a) => a.id === almacenId);
    if (!puedeMoverEnSede(elegido?.sede, sedesPermitidas)) {
      setError(`Solo podés vincular la cocina a un almacén de ${(sedesPermitidas ?? []).join(', ')}.`);
      return;
    }
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
  const [, setLoading] = useState(true);   // se carga en segundo plano (para PDF y edición); el mercado tiene su propio loading
  const [modal, setModal] = useState<'none' | 'add' | 'resumen'>('none');
  const [editComida, setEditComida] = useState<CocinaComida | null>(null);
  const [delComida, setDelComida] = useState<CocinaComida | null>(null);
  const [alertando, setAlertando] = useState(false);
  const [histOpen, setHistOpen] = useState(false);

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

  // Mercado (ciclo de 21 días) de esta cocina.
  const [mercado, setMercado] = useState<MercadoCocina | null>(null);
  const [resumen, setResumen] = useState<ResumenMercado | null>(null);
  const [mercadoLoading, setMercadoLoading] = useState(true);
  const [iniciando, setIniciando] = useState(false);
  const [fechaInicioMercado, setFechaInicioMercado] = useState(() => new Date().toISOString().slice(0, 10));

  // `background`: recarga sin poner el panel en "Cargando…" (para no parpadear en cada
  // evento de realtime). Solo la PRIMERA carga muestra el spinner.
  const loadMercado = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setMercadoLoading(true);
    try {
      const m = await mercadoActivo(cocinaId);
      setMercado(m);
      setResumen(m ? await resumenMercado(m, almacen) : null);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar el mercado', 'error'); }
    finally { setMercadoLoading(false); }
  }, [cocinaId, almacen]);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setComidas(await listComidas({ cocinaId })); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, [cocinaId]);
  useEffect(() => { void reload(); void loadMercado(); }, [reload, loadMercado]);
  // `existencias` no afecta al resumen del mercado (deriva de saldo + movimientos + comidas),
  // así que no dispara recarga. El resto recarga en segundo plano (sin borrar el panel).
  useRealtime(['cocina_comidas', 'productos', 'movimientos', 'mercados_cocina'], () => { void reload(); void loadMercado({ background: true }); });

  async function iniciar() {
    setIniciando(true);
    try {
      await iniciarMercado({ cocinaId, almacen, fechaInicio: fechaInicioMercado, actor, actorName: userEmail });
      toast('Mercado iniciado', 'success');
      await loadMercado();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo iniciar el mercado', 'error'); }
    finally { setIniciando(false); }
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
          <button className="btn btn-ghost" onClick={() => void import('./cocinaPdf').then(({ descargarReporteCocinaPdf }) => descargarReporteCocinaPdf(comidas, 'Todas las comidas registradas')).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))} disabled={!comidas.length}>↓ Reporte PDF</button>
          <button className="btn btn-ghost" onClick={() => setHistOpen(true)} title="Mercados cerrados: ver, reportes, reabrir">🔒 Mercados cerrados</button>
          {canWrite && (
            <button className="btn btn-ghost" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
              onClick={enviarAlertaMercado} disabled={alertando} title="Avisar a Pedidos/Compras que hay que reponer víveres">
              🔔 Alerta a restablecer
            </button>
          )}
        </div>
        {canWrite && <button className="btn btn-primary" onClick={() => setModal('add')}>＋ Añadir movimiento</button>}
      </div>

      {/* Mercado (ciclo de 21 días): tarjetas + disponible + kardex, o iniciar */}
      {mercadoLoading ? (
        <EmptyState message="Cargando mercado…" icon="◔" />
      ) : !mercado ? (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-title">🛒 Iniciar mercado (ciclo de 21 días)</div>
          <p className="hint muted" style={{ marginTop: 0 }}>Todavía no hay un mercado activo para esta cocina. Al iniciarlo, el <strong>stock actual de víveres</strong> cuenta como saldo inicial y arranca el conteo de 21 días. Al llegar el día 22 vas a poder <strong>cerrarlo</strong> (con PDF y arrastre de lo que queda).</p>
          {canWrite ? (
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ margin: 0, maxWidth: 200 }}>
                <label style={{ fontSize: '.75rem' }}>Fecha de inicio</label>
                <input className="input" type="date" value={fechaInicioMercado} onChange={(e) => setFechaInicioMercado(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={iniciar} disabled={iniciando || !almacen}>{iniciando ? 'Iniciando…' : '🛒 Iniciar mercado'}</button>
            </div>
          ) : <p className="hint muted" style={{ margin: 0 }}>No tenés permiso para iniciar el mercado.</p>}
        </div>
      ) : resumen ? (
        <MercadoPanel resumen={resumen} cocinaNombre={info.cocina.nombre} almacen={almacen} canWrite={canWrite} actor={actor} userEmail={userEmail}
          onReload={async () => { await loadMercado({ background: true }); await reload(); }}
          onEditComida={(c) => setEditComida(c)} onDelComida={(c) => setDelComida(c)} />
      ) : null}

      {(modal === 'add' || editComida) && (
        <AnadirMovimientoModal cocinaId={cocinaId} almacen={almacen} actor={actor} actorName={userEmail}
          comida={editComida}
          onClose={() => { setModal('none'); setEditComida(null); }}
          onSaved={async () => { setModal('none'); setEditComida(null); await reload(); await loadMercado({ background: true }); }} />
      )}
      {delComida && (
        <ConfirmDialog title="Eliminar movimiento"
          message={`¿Eliminar el movimiento ${delComida.codigo}? Se devuelve al inventario el stock de los víveres consumidos.`}
          confirmText="Eliminar" danger
          onCancel={() => setDelComida(null)}
          onConfirm={async () => {
            const c = delComida; setDelComida(null);
            try { await eliminarComida(c.id, actor, userEmail); toast('Movimiento eliminado', 'success'); await reload(); await loadMercado({ background: true }); }
            catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
          }} />
      )}
      {modal === 'resumen' && <ResumenModal cocinaId={cocinaId} almacen={almacen} onClose={() => setModal('none')} />}
      {histOpen && (
        <MercadosHistoricoModal cocinaId={cocinaId} cocinaNombre={info.cocina.nombre} almacen={almacen}
          canWrite={canWrite} actor={actor} userEmail={userEmail}
          onClose={() => setHistOpen(false)}
          onChanged={async () => { await loadMercado({ background: true }); await reload(); }} />
      )}
    </div>
  );
}

/* ───────────── Añadir movimiento (consumo de víveres) ───────────── */
function AnadirMovimientoModal({ cocinaId, almacen, actor, actorName, comida, onClose, onSaved }: {
  cocinaId: string; almacen: string | null; actor: string; actorName: string | null;
  comida?: CocinaComida | null; onClose: () => void; onSaved: () => void;
}) {
  const esEdicion = !!comida;
  const [viveres, setViveres] = useState<ViverDisponible[]>([]);
  const [tipo, setTipo] = useState<TipoComida>(comida?.tipo_comida ?? 'almuerzo');
  const [platos, setPlatos] = useState(comida ? String(comida.platos) : '');
  // Fecha de la comida: por defecto hoy, pero se puede cargar/editar una comida de un día desfasado.
  const [fecha, setFecha] = useState(() => (comida?.at ?? new Date().toISOString()).slice(0, 10));
  const [nota, setNota] = useState(comida?.nota ?? '');
  const [busqueda, setBusqueda] = useState('');
  // Selección tipo check: productoId → cantidad (string). Si la clave existe, está tildado.
  const [sel, setSel] = useState<Record<string, string>>(() =>
    comida ? Object.fromEntries((comida.items ?? []).map((it) => [it.producto_id, String(it.cantidad)])) : {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODOS los víveres del inventario general (categoría VÍVERES), sin importar el almacén.
  useEffect(() => { listViveresGlobal(almacen).then(setViveres).catch(() => setViveres([])); }, [almacen]);
  const mapV = useMemo(() => new Map(viveres.map((v) => [v.producto.id, v])), [viveres]);

  const toggle = (id: string) => setSel((s) => {
    const n = { ...s };
    if (id in n) delete n[id]; else n[id] = '';
    return n;
  });
  const setCant = (id: string, c: string) => setSel((s) => ({ ...s, [id]: c }));

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return viveres;
    return viveres.filter((v) => v.producto.nombre.toLowerCase().includes(q) || (v.producto.sku ?? '').toLowerCase().includes(q));
  }, [viveres, busqueda]);
  const nSel = Object.keys(sel).length;

  const total = useMemo(() => r2(Object.entries(sel).reduce((a, [id, c]) => {
    const v = mapV.get(id);
    return a + (v ? (Number(c) || 0) * v.precio : 0);
  }, 0)), [sel, mapV]);
  const nPlatos = Number(platos) || 0;

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const items = Object.entries(sel).filter(([, c]) => (Number(c) || 0) > 0)
      .map(([producto_id, c]) => ({ producto_id, cantidad: Number(c) || 0 }));
    if (!items.length) { setError('Marcá al menos un víver e indicá su cantidad.'); return; }
    if (nPlatos <= 0) { setError('Indicá cuántos platos se realizaron.'); return; }
    if (!fecha) { setError('Indicá la fecha de la comida.'); return; }
    setSaving(true);
    try {
      const payload = { tipoComida: tipo, platos: nPlatos, items, nota: nota.trim() || null, cocinaId, almacen, fecha, actor, actorName };
      if (esEdicion && comida) {
        await editarComida(comida.id, payload);
        notify(`Comida actualizada · ${labelTipoComida(tipo)} · ${money(total)}`, 'success', { link: '#/app/cocina' });
      } else {
        await crearComida(payload);
        notify(`Comida registrada · ${labelTipoComida(tipo)} · ${money(total)}`, 'success', { link: '#/app/cocina' });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={esEdicion ? 'Editar movimiento · Cocina' : 'Añadir movimiento · Cocina'} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="cocina-add" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : `${esEdicion ? 'Guardar' : 'Registrar'} · ${money(total)}`}</button>
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

        {/* Fecha de la comida: por defecto hoy; se puede cargar una comida de un día desfasado. */}
        <div className="form-row" style={{ maxWidth: 220 }}>
          <label>Fecha de la comida</label>
          <input className="input" type="date" value={fecha} max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setFecha(e.target.value)} />
          {fecha && fecha !== new Date().toISOString().slice(0, 10) && (
            <small className="muted" style={{ marginTop: '.25rem' }}>📅 Se registrará con fecha <strong>{fecha}</strong> (día desfasado).</small>
          )}
        </div>

        {/* Víveres: TODOS los del inventario (categoría VÍVERES), sin importar el almacén.
            Se eligen con checkboxes; al tildar aparece la cantidad. */}
        <div className="form-row">
          <label>Víveres consumidos <span className="muted" style={{ fontWeight: 400 }}>(de este centro · Víveres, Carnes/Proteína, Alimentos, Hortalizas y Limpieza · {num(viveres.length)} productos{nSel > 0 ? ` · ${num(nSel)} elegido(s)` : ''})</span></label>
          <input className="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar víver por nombre o SKU…" style={{ marginBottom: '.5rem' }} />
          <div style={{ display: 'grid', gap: '.4rem', maxHeight: 340, overflowY: 'auto', paddingRight: '.15rem' }}>
            {!filtrados.length && <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>{viveres.length ? 'Ningún víver coincide con la búsqueda.' : 'No hay productos de Víveres, Carnes/Proteína, Alimentos, Hortalizas o Limpieza en este centro.'}</div>}
            {filtrados.map((v) => {
              const id = v.producto.id;
              const selected = id in sel;
              const cant = sel[id] ?? '';
              const excede = selected && (Number(cant) || 0) > v.stock;
              return (
                <div key={id} className="card" style={{ margin: 0, padding: '.5rem .65rem', display: 'flex', alignItems: 'center', gap: '.6rem', borderColor: selected ? 'var(--primary)' : 'var(--border)' }}>
                  <input type="checkbox" checked={selected} onChange={() => toggle(id)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: 'var(--primary)' }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggle(id)}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem' }}>{v.producto.nombre}</div>
                    <small className="muted" style={{ fontSize: '.72rem' }}>{money(v.precio)} · stock {num(v.stock)} {v.producto.unidad}{v.almacenMasStock ? ` · 📦 ${v.almacenMasStock}` : ''}{excede ? <span style={{ color: 'var(--warning)' }}> · supera el stock</span> : null}</small>
                  </div>
                  {selected && (
                    <>
                      <input className="input mono" type="number" min={0} step="any" value={cant} autoFocus
                        onChange={(e) => setCant(id, e.target.value)} placeholder={`Cant. (${v.producto.unidad})`}
                        style={{ width: 120, textAlign: 'right', borderColor: excede ? 'var(--warning)' : undefined }} />
                      <span className="mono" style={{ minWidth: 78, textAlign: 'right', fontSize: '.82rem', color: 'var(--primary-3)' }}>{money((Number(cant) || 0) * v.precio)}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {nSel > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem', marginTop: '.55rem', padding: '.5rem .75rem', background: 'rgba(255,138,0,.08)', border: '1px solid var(--primary)', borderRadius: 8, fontSize: '.9rem' }}>
              <span><strong className="mono">{num(nSel)}</strong> artículo(s) seleccionado(s)</span>
              <span>Monto: <strong className="mono" style={{ color: 'var(--primary-3)', fontSize: '1.02rem' }}>{money(total)}</strong></span>
            </div>
          )}
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
      // Todos los víveres del inventario general (sin importar el almacén), igual que en "Añadir movimiento".
      listViveresGlobal(almacen),
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
            <div className="card-title" style={{ marginBottom: '.5rem' }}>Stock disponible de víveres <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· de este centro</span></div>
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
