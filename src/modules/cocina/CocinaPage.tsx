/* ============================================================
   MGG · Control de Alimentación (Cocina)
   - Añadir movimiento: consumo de víveres por comida (descuenta inventario).
   - Resumen / consumo: barras por día/víver, platos, promedio por plato, stock.
   - Tabla filtrable + reporte PDF con vista previa.
   ============================================================ */
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { esRolCocina, RUTA_COCINA_TELEFONO } from '@/modules/usuarios/permisos.repository';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { hoyISO, money, num, dateTime } from '@/shared/lib/format';
import type { CocinaComida, TipoComida, Cocina, Almacen, TipoCocina } from '@/shared/lib/types';
import { crearAlmacen, nombreCortoAlmacen } from '@/modules/inventario/almacenes.repository';
import { agruparPorCategoria, normCategoria } from './agruparPorCategoria';
import { puedeMoverEnSede } from '@/modules/inventario/sectorizacion';
import { useSectorizacion } from '@/modules/inventario/useSectorizacion';
import {
  listComidas, crearComida, editarComida, eliminarComida, listViveresGlobal, resumirComidas,
  listCocinas, crearCocina, actualizarCocina, eliminarCocina, listAlmacenesParaCocina, esResguardo, esSedeResguardo,
  movimientoViveresDelPeriodo,
  TIPOS_COMIDA, labelTipoComida, type ViverDisponible, type ResumenCocina, type CocinaConInfo,
} from './cocina.repository';
import { totalesDeViveres, salidasDeInventario, ETIQUETA_CLASE, type FilaViver } from './movimientoViveres';
// descargarReporteCocinaPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.
import { crearAlertaMercado, listAlertasMercadoPendientes } from './alertasMercado.repository';
import {
  listMercados, resumenMercado, iniciarMercado, DURACION_MERCADO_DIAS,
  type MercadoCocina, type ResumenMercado,
} from './mercados.repository';
import { cicloQueSePisa, ventanaCicloDe } from './mercadoComparar';
import { avisoFueraDelCiclo, fueraDelCiclo } from './fechaComida';
import { MercadoPanel } from './MercadoPanel';
import { LeyendaMercado } from './LeyendaMercado';
import { MercadosHistoricoModal } from './MercadosHistorico';
import { FotosDelMovimiento } from '@/modules/combustible/FotosMovimiento';
import { MODULO_ADJUNTO_COMIDA } from '@/modules/combustible/adjuntosCombustible.repository';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fecha ISO corta a dd/mm/aaaa, que es como se lee acá. */
function fmtDiaCorto(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return d ? `${d}/${m}/${y}` : (iso || '—');
}

/* ───────────── Página: tarjetas de cocinas ───────────── */
export function CocinaPage() {
  const { user } = useSession();
  const { can, role, loading: cargandoPermisos } = usePermissions();
  const canWrite = can('cocina', 'escritura');
  const actor = user?.email ?? 'sistema';

  const [cocinas, setCocinas] = useState<CocinaConInfo[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);        // cocina abierta
  const [form, setForm] = useState<TipoCocina | Cocina | null>(null);
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

  // El rol COCINA (cocinero) trabaja desde el teléfono: no ve el módulo de PC.
  // Va acá abajo, después de los hooks, para no romper el orden con que React los identifica.
  if (!cargandoPermisos && esRolCocina(role)) return <Navigate to={`/app/${RUTA_COCINA_TELEFONO}`} replace />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>🍽 Cocinas</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>Cada cocina toma sus víveres del almacén al que está vinculada. Los <strong>resguardos</strong> (Matanzas) solo almacenan y distribuyen a las cocinas: no sirven comidas.</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {/* La vista de teléfono del cocinero: personas, consumo, fotos y WhatsApp. */}
          <Link to="/app/cocina/telefono" className="btn btn-ghost" title="Vista sencilla para cargar desayuno, almuerzo y cena desde el celular">📱 Vista teléfono</Link>
        {canWrite && (
          <>
            <button className="btn btn-ghost" onClick={() => setForm('resguardo')}>＋ Nuevo resguardo</button>
            <button className="btn btn-primary" onClick={() => setForm('cocina')}>＋ Nueva cocina</button>
          </>
        )}
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando cocinas…" icon="◔" />
      ) : !cocinas.length ? (
        <div className="card" style={{ marginTop: '1rem' }}><EmptyState message="No hay cocinas. Creá la primera con “＋ Nueva cocina”." icon="🍳" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {cocinas.map((info) => (
            /* ALCANZABLE POR TECLADO. Era un div con onClick: con Tab no se podía
               entrar a una cocina, solo con mouse — pero los botones Editar y 🗑
               SÍ recibían foco, así que se podía llegar a borrar sin poder llegar
               a entrar. `role` + `tabIndex` + Enter/Espacio lo emparejan. */
            <div key={info.cocina.id} className="card"
              role="button" tabIndex={0}
              style={{ margin: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '.35rem' }}
              onClick={() => setSel(info.cocina.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(info.cocina.id); }
              }}
              title={esResguardo(info.cocina) ? 'Entrar al resguardo' : 'Entrar a la cocina'}
              aria-label={`Entrar ${esResguardo(info.cocina) ? 'al resguardo' : 'a la cocina'} ${info.cocina.nombre}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                <strong style={{ fontSize: '1.05rem' }}>{esResguardo(info.cocina) ? '🏬' : '🍳'} {info.cocina.nombre}</strong>
                <span className="badge">Entrar →</span>
              </div>
              {esResguardo(info.cocina) && (
                <div style={{ fontSize: '.74rem', color: 'var(--info)' }}>Resguardo · almacena y distribuye, no sirve comidas</div>
              )}
              <div className="muted" style={{ fontSize: '.82rem' }}>📦 {info.almacenNombre ?? <span style={{ color: 'var(--warning)' }}>Sin almacén vinculado</span>}{info.sede && esResguardo(info.cocina) ? ` · ${info.sede}` : ''}</div>
              {/* El ciclo abierto es lo primero que se quiere saber de una cocina;
                  hasta ahora había que entrar para averiguarlo. Sin mercado se dice
                  también: un espacio vacío no distingue «no hay» de «no cargó». */}
              <div style={{ fontSize: '.78rem' }}>
                {info.mercado ? (
                  <span style={{ color: 'var(--primary, #ff8a00)' }}>
                    🛒 Mercado #{info.mercado.numero}
                    <span className="muted"> · día {Math.min(info.mercado.dia, info.mercado.dias)} de {info.mercado.dias}</span>
                  </span>
                ) : (
                  <span className="dim">Sin mercado abierto</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', marginTop: '.2rem' }}>
                <span className="muted">Víveres con stock</span><strong className="mono">{num(info.viveres)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem' }}>
                <span className="muted">Valor del stock</span><strong className="mono">{money(info.valorStock)}</strong>
              </div>
              {canWrite && (
                <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setForm(info.cocina)} title="Editar">✎ Editar</button>
                  <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(info)} title="Inhabilitar">🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {form && (
        <CocinaFormModal cocina={typeof form === 'string' ? null : form}
          tipo={typeof form === 'string' ? form : (form.tipo ?? 'cocina')}
          almacenes={almacenes} actor={actor}
          onAlmacenCreado={(a) => setAlmacenes((xs) => [...xs, a])}
          onClose={() => setForm(null)} onSaved={async () => { setForm(null); await reload(); }} />
      )}
      {borrar && (
        <ConfirmDialog title={esResguardo(borrar.cocina) ? 'Inhabilitar resguardo' : 'Inhabilitar cocina'}
          message={`¿Inhabilitar ${esResguardo(borrar.cocina) ? 'el resguardo' : 'la cocina'} "${borrar.cocina.nombre}"? Su historial queda guardado; podés volver a crearlo luego. El stock no se toca.`}
          confirmText="Inhabilitar" danger onConfirm={confirmarBorrar} onCancel={() => setBorrar(null)} />
      )}
    </div>
  );
}

/* ───────────── Alta / edición de una cocina ───────────── */
function CocinaFormModal({ cocina, tipo, almacenes, actor, onAlmacenCreado, onClose, onSaved }: {
  cocina: Cocina | null; tipo: TipoCocina; almacenes: Almacen[]; actor: string;
  onAlmacenCreado: (a: Almacen) => void; onClose: () => void; onSaved: () => void;
}) {
  const resguardo = tipo === 'resguardo';
  const palabra = resguardo ? 'el resguardo' : 'la cocina';
  // Un resguardo nuevo arranca apuntando al almacén «Resguardo» de Matanzas, si existe.
  const sugerido = resguardo && !cocina
    ? almacenes.find((a) => esSedeResguardo(a.sede) && /resguardo/i.test(a.nombre))?.id ?? ''
    : '';
  const [nombre, setNombre] = useState(cocina?.nombre ?? (resguardo ? 'Resguardo Matanzas' : ''));
  const [almacenId, setAlmacenId] = useState(cocina?.almacen_id ?? sugerido);
  const [almacenNuevo, setAlmacenNuevo] = useState('');
  const [crearAlm, setCrearAlm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sectorización: la cocina descuenta stock del almacén vinculado, así que vincularla
  // es decidir de qué almacén va a salir la comida. Un almacenista solo puede apuntarla
  // a los suyos; el consumo diario después no elige nada, sale de esta configuración.
  const { sedes: sedesPermitidas } = useSectorizacion();
  // La sede de Matanzas, tal como está escrita en los almacenes.
  const sedeMatanzas = almacenes.find((a) => esSedeResguardo(a.sede))?.sede ?? null;

  // Opciones de almacén ordenadas por sede, mostrando el nombre corto del subalmacén.
  // El resguardo vive en Matanzas: solo se ofrecen los almacenes de esa sede.
  const opciones = useMemo(() => [...almacenes]
    .filter((a) => puedeMoverEnSede(a.sede, sedesPermitidas))
    .filter((a) => !resguardo || esSedeResguardo(a.sede))
    .sort((a, b) => `${a.sede ?? ''} ${a.nombre}`.localeCompare(`${b.sede ?? ''} ${b.nombre}`, 'es'))
    .map((a) => ({ value: a.id, label: `${a.sede ? `${a.sede} · ` : ''}${nombreCortoAlmacen(a, almacenes)}` })), [almacenes, sedesPermitidas, resguardo]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!nombre.trim()) { setError(`Indicá el nombre de ${palabra}.`); return; }
    if (crearAlm && !almacenNuevo.trim()) { setError('Indicá el nombre del almacén nuevo.'); return; }
    if (!crearAlm && !almacenId) { setError(`Vinculá ${palabra} a un almacén.`); return; }
    if (crearAlm && !sedeMatanzas) { setError('No encuentro la sede de Matanzas en los almacenes.'); return; }
    const elegido = almacenes.find((a) => a.id === almacenId);
    if (!crearAlm && !puedeMoverEnSede(elegido?.sede, sedesPermitidas)) {
      setError(`Solo podés vincular ${palabra} a un almacén de ${(sedesPermitidas ?? []).join(', ')}.`);
      return;
    }
    if (!crearAlm && resguardo && !esSedeResguardo(elegido?.sede)) { setError('El resguardo va en un almacén de Matanzas.'); return; }
    setSaving(true);
    try {
      let idAlm = almacenId;
      if (crearAlm) {
        const nuevo = await crearAlmacen({ nombre: almacenNuevo, sede: sedeMatanzas }, actor);
        onAlmacenCreado(nuevo);
        idAlm = nuevo.id;
      }
      if (cocina) await actualizarCocina(cocina.id, { nombre, almacenId: idAlm, tipo });
      else await crearCocina({ nombre, almacenId: idAlm, tipo, actor });
      toast(cocina ? 'Guardado' : (resguardo ? 'Resguardo creado' : 'Cocina creada'), 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  const titulo = cocina ? (resguardo ? 'Editar resguardo' : 'Editar cocina') : (resguardo ? 'Nuevo resguardo' : 'Nueva cocina');
  return (
    <Modal title={titulo} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="cocina-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : (cocina ? 'Guardar' : titulo.replace('Nuevo', 'Crear').replace('Nueva', 'Crear'))}</button>
      </>
    }>
      <form id="cocina-form" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        {resguardo && (
          <p className="hint muted" style={{ marginTop: 0 }}>
            El resguardo <strong>almacena y distribuye</strong> a las cocinas: tiene su mercado, entradas, salidas y
            distribución, pero <strong>no se registran comidas</strong>. Vive en <strong>Matanzas</strong>.
          </p>
        )}
        <div className="form-row">
          <label>Nombre {resguardo ? 'del resguardo' : 'de la cocina'}</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={resguardo ? 'Ej.: Resguardo Matanzas' : 'Ej.: La Esperanza'} autoFocus />
        </div>
        <div className="form-row">
          <label>Almacén vinculado{resguardo ? ' (Matanzas)' : ''}</label>
          {crearAlm ? (
            <input className="input" value={almacenNuevo} onChange={(e) => setAlmacenNuevo(e.target.value)}
              placeholder="Ej.: Resguardo de víveres" />
          ) : (
            <SearchSelect value={almacenId} onChange={setAlmacenId} options={opciones}
              placeholder="🔎 Buscá el almacén…" emptyText="No hay almacenes." />
          )}
          {resguardo && (
            <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.82rem', marginTop: '.35rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={crearAlm} onChange={(e) => setCrearAlm(e.target.checked)} />
              Crear un almacén nuevo en {sedeMatanzas ?? 'Matanzas'}
            </label>
          )}
          <small className="hint muted">
            {resguardo
              ? 'Ahí entra lo que se distribuye al resguardo y de ahí sale hacia las cocinas. Cuenta todo lo que hay en Matanzas.'
              : 'De este almacén salen los víveres y se descuenta el stock de esta cocina.'}
          </small>
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
  const resguardo = esResguardo(info.cocina);

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
  const [mercados, setMercados] = useState<MercadoCocina[]>([]);
  const [resumen, setResumen] = useState<ResumenMercado | null>(null);
  const [mercadoLoading, setMercadoLoading] = useState(true);
  const [iniciando, setIniciando] = useState(false);
  const [confirmarInicio, setConfirmarInicio] = useState(false);
  // El mercado arranca en el momento en que se abre: no se elige fecha. Lo único que puede
  // impedirlo es otro ciclo que todavía corre (un descartado ya no estorba).
  const apertura = useMemo(() => {
    const hoy = hoyISO();
    const fin = new Date(`${hoy}T12:00:00`);
    fin.setDate(fin.getDate() + DURACION_MERCADO_DIAS - 1);
    const hasta = fin.toISOString().slice(0, 10);
    return { hoy, hasta, choque: cicloQueSePisa(hoy, hasta, mercados.map(ventanaCicloDe), new Date().toISOString()) };
  }, [mercados]);
  const choque = apertura.choque;
  // Qué corte se está mirando. `null` = el que está en curso, que es lo que hay que
  // ver al entrar; elegir otro en el selector es una consulta puntual, no una
  // preferencia, así que NO se recuerda entre visitas.
  const [verMercadoId, setVerMercadoId] = useState<string | null>(null);

  // `background`: recarga sin poner el panel en "Cargando…" (para no parpadear en cada
  // evento de realtime). Solo la PRIMERA carga muestra el spinner.
  const loadMercado = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setMercadoLoading(true);
    try {
      const todos = await listMercados(cocinaId);
      setMercados(todos);
      // Si el corte elegido dejó de existir (lo borraron, o se reabrió el anterior y
      // este desapareció), se vuelve al que está en curso en vez de quedar en blanco.
      const m = (verMercadoId ? todos.find((x) => x.id === verMercadoId) : null)
        ?? todos.find((x) => x.estado === 'abierto')
        ?? null;
      setMercado(m);
      setResumen(m ? await resumenMercado(m, almacen) : null);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar el mercado', 'error'); }
    finally { setMercadoLoading(false); }
  }, [cocinaId, almacen, verMercadoId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setComidas(await listComidas({ cocinaId })); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, [cocinaId]);
  useEffect(() => { void reload(); void loadMercado(); }, [reload, loadMercado]);
  // `existencias` no afecta al resumen del mercado (deriva de saldo + movimientos + comidas),
  // así que no dispara recarga. El resto recarga en segundo plano (sin borrar el panel).
  // `solicitudes_salida`: el aviso de repartos pendientes tiene que irse solo cuando Salidas
  // autoriza o ejecuta el traslado, no cuando alguien recarga la página.
  useRealtime(['cocina_comidas', 'productos', 'movimientos', 'mercados_cocina', 'solicitudes_salida'], () => { void reload(); void loadMercado({ background: true }); });

  async function iniciar() {
    setConfirmarInicio(false);
    setIniciando(true);
    try {
      await iniciarMercado({ cocinaId, almacen, actor, actorName: userEmail });
      toast('Mercado iniciado', 'success');
      await loadMercado();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo iniciar el mercado', 'error'); }
    finally { setIniciando(false); }
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: '.5rem' }}>← Volver a cocinas</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.3rem' }}>
        <h1 style={{ margin: 0 }}>{resguardo ? '🏬' : '🍳'} {info.cocina.nombre}</h1>
        {resguardo && <span className="badge" style={{ color: 'var(--info)' }}>Resguardo</span>}
      </div>
      <p className="hint muted" style={{ marginTop: 0 }}>
        {resguardo
          ? <>Almacena y distribuye a las cocinas desde <strong>{almacen ?? '— sin almacén vinculado —'}</strong>{info.sede ? <> ({info.sede})</> : null}. Acá <strong>no se registran comidas</strong>: lo que entra se reparte con «Distribución a otra cocina / resguardo».</>
          : <>Toma precios y descuenta stock del almacén <strong>{almacen ?? '— sin almacén vinculado —'}</strong>.</>}
      </p>
      {!almacen && <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem' }}>{resguardo ? 'Este resguardo' : 'Esta cocina'} no tiene un almacén vinculado. Volvé y editálo para asignarle uno.</div>}

      <div className="filterbar" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {!resguardo && <button className="btn btn-ghost" onClick={() => setModal('resumen')}>📊 Resumen detallado</button>}
          {!resguardo && <button className="btn btn-ghost" onClick={() => void import('./cocinaPdf').then(({ descargarReporteCocinaPdf }) => descargarReporteCocinaPdf(comidas, 'Todas las comidas registradas')).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))} disabled={!comidas.length}>↓ Reporte PDF</button>}
          <button className="btn btn-ghost" onClick={() => setHistOpen(true)} title="Mercados cerrados: ver, reportes, reabrir">🔒 Mercados cerrados</button>
          {canWrite && (
            <button className="btn btn-ghost" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
              onClick={enviarAlertaMercado} disabled={alertando} title="Avisar a Pedidos/Compras que hay que reponer víveres">
              🔔 Alerta a restablecer
            </button>
          )}
        </div>
        {canWrite && !resguardo && <button className="btn btn-primary" onClick={() => setModal('add')}>＋ Añadir movimiento</button>}
      </div>

      {/* Mercado (ciclo de 21 días): tarjetas + disponible + kardex, o iniciar */}
      {mercadoLoading ? (
        <EmptyState message="Cargando mercado…" icon="◔" />
      ) : !mercado ? (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-title">🛒 Iniciar mercado (ciclo de 21 días)</div>
          <p className="hint muted" style={{ marginTop: 0 }}>Todavía no hay un mercado activo para esta cocina. Al iniciarlo, <strong>lo que hay en el inventario en ese momento</strong> es el saldo inicial, y desde ese momento cuenta todo lo que entra, se traslada o se consume. Al llegar el día 22 vas a poder <strong>cerrarlo</strong> (con PDF y arrastre de lo que queda).</p>
          {canWrite ? (
            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => setConfirmarInicio(true)} disabled={iniciando || !almacen || !!choque}>{iniciando ? 'Iniciando…' : '🛒 Iniciar mercado ahora'}</button>
              <span className="muted" style={{ fontSize: '.8rem' }}>Corre del {fmtDiaCorto(apertura.hoy)} al {fmtDiaCorto(apertura.hasta)}.</span>
            </div>
          ) : <p className="hint muted" style={{ margin: 0 }}>No tenés permiso para iniciar el mercado.</p>}
          {/* Lo único que impide abrir es otro ciclo que todavía corre. Se explica ANTES de
              apretar: un botón gris que no dice por qué se lee como si estuviera roto. */}
          {canWrite && choque && (
            <div className="card" style={{ borderColor: 'var(--danger)', marginTop: '.6rem' }}>
              Todavía corre el <strong>mercado #{choque.numero}</strong>{' '}
              ({fmtDiaCorto(choque.fecha_inicio)} → {fmtDiaCorto(choque.fecha_fin)}).
              <div className="hint muted" style={{ marginTop: '.25rem' }}>
                Dos ciclos sobre los mismos días cuentan los consumos dos veces.
              </div>
            </div>
          )}
          {/* Abrir toma el inventario de ESTE momento. Apretarlo antes de terminar el conteo o de
              cargar lo que llegó hoy congela un saldo equivocado para 21 días: se pregunta. */}
          {confirmarInicio && (
            <ConfirmDialog title={`Iniciar el mercado de ${info.cocina.nombre}`}
              message="Se toma lo que hay en el inventario en este momento como saldo inicial, y desde este momento cuenta todo lo que entra, se traslada o se consume. Hacelo con el conteo y las entradas del día ya cargados."
              confirmText="Iniciar ahora" onConfirm={() => void iniciar()} onCancel={() => setConfirmarInicio(false)} />
          )}
          {/* La misma leyenda que lleva el panel: acá aplica sobre todo la duda de
              por qué el sistema no deja abrir un ciclo sobre los días de otro.
              Son ramas excluyentes del mismo ternario: nunca se ven las dos. */}
          <LeyendaMercado />
        </div>
      ) : resumen ? (
        <MercadoPanel resumen={resumen} mercados={mercados} onElegirMercado={(id) => setVerMercadoId(id)}
          cocinaNombre={info.cocina.nombre} almacen={almacen} canWrite={canWrite} actor={actor} userEmail={userEmail} resguardo={resguardo}
          onReload={async () => { await loadMercado({ background: true }); await reload(); }}
          onEditComida={(c) => setEditComida(c)} onDelComida={(c) => setDelComida(c)} />
      ) : null}

      {!resguardo && (modal === 'add' || editComida) && (
        <AnadirMovimientoModal cocinaId={cocinaId} almacen={almacen} actor={actor} actorName={userEmail}
          comida={editComida} mercado={mercado}
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
function AnadirMovimientoModal({ cocinaId, almacen, actor, actorName, comida, mercado, onClose, onSaved }: {
  cocinaId: string; almacen: string | null; actor: string; actorName: string | null;
  comida?: CocinaComida | null; mercado?: MercadoCocina | null; onClose: () => void; onSaved: () => void;
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

  // Filtro por categoría: en Los Pinos la lista son 168 artículos y las carnes
  // quedaban enterradas entre los víveres y la limpieza.
  const [cats, setCats] = useState<string[]>([]);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const elegidas = new Set(cats);
    return viveres.filter((v) => {
      if (elegidas.size && !elegidas.has(normCategoria(v.producto.categoria))) return false;
      if (!q) return true;
      return v.producto.nombre.toLowerCase().includes(q) || (v.producto.sku ?? '').toLowerCase().includes(q);
    });
  }, [viveres, busqueda, cats]);
  /* Los chips salen de lo que REALMENTE hay en este centro, no de una lista fija:
     una categoría sin artículos acá no tiene por qué ocupar lugar. */
  const chips = useMemo(() => agruparPorCategoria(viveres, (v) => v.producto.categoria), [viveres]);
  const grupos = useMemo(() => agruparPorCategoria(filtrados, (v) => v.producto.categoria), [filtrados]);
  const nSel = Object.keys(sel).length;

  const total = useMemo(() => r2(Object.entries(sel).reduce((a, [id, c]) => {
    const v = mapV.get(id);
    return a + (v ? (Number(c) || 0) * v.precio : 0);
  }, 0)), [sel, mapV]);
  const nPlatos = Number(platos) || 0;
  // Aviso de fecha: se calcula contra el mercado abierto, no contra "hoy".
  const avisoCiclo = useMemo(() => avisoFueraDelCiclo(fueraDelCiclo(fecha, mercado), mercado), [fecha, mercado]);

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
            <small className="hint muted" style={{ marginTop: '.25rem' }}>📅 Se registrará con fecha <strong>{fecha}</strong> (día desfasado).</small>
          )}
        </div>

        {/* La comida descuenta el inventario HOY, pero el libro del mercado la ordena por SU
            fecha. Si la fecha cae fuera del ciclo abierto las dos cuentas se separan, y si
            esos víveres ya pasaron por un conteo real se descuentan dos veces (pasó el
            17/09/2026: hubo que devolver 211,21 unidades a mano). No se bloquea: cargar una
            comida atrasada es legítimo, pero quien la carga tiene que saber qué implica. */}
        {avisoCiclo && (
          <div className="card" style={{ borderColor: 'var(--warning)', margin: '0 0 .75rem' }}>
            <strong style={{ color: 'var(--warning)' }}>⚠ La fecha queda fuera del mercado abierto</strong>
            <p className="muted" style={{ margin: '.35rem 0 0', fontSize: '.85rem' }}>{avisoCiclo}</p>
          </div>
        )}

        {/* Víveres: TODOS los del inventario (categoría VÍVERES), sin importar el almacén.
            Se eligen con checkboxes; al tildar aparece la cantidad. */}
        <div className="form-row">
          <label>Víveres consumidos <span className="muted" style={{ fontWeight: 400 }}>(de este centro · agrupados por categoría · {num(viveres.length)} productos{cats.length ? ` · ${num(filtrados.length)} en el filtro` : ''}{nSel > 0 ? ` · ${num(nSel)} elegido(s)` : ''})</span></label>
          <input className="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar víver por nombre o SKU…" style={{ marginBottom: '.5rem' }} />
          {chips.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginBottom: '.5rem' }}>
              <button type="button" className={`btn btn-sm ${cats.length ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => setCats([])}>Todo ({num(viveres.length)})</button>
              {chips.map((g) => {
                const activo = cats.includes(g.categoria);
                return (
                  <button key={g.categoria || 'sin'} type="button"
                    className={`btn btn-sm ${activo ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setCats((c) => (activo ? c.filter((x) => x !== g.categoria) : [...c, g.categoria]))}>
                    {g.rotulo} ({num(g.items.length)})
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ display: 'grid', gap: '.4rem', maxHeight: 340, overflowY: 'auto', paddingRight: '.15rem' }}>
            {!filtrados.length && <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>{viveres.length ? 'Ningún víver coincide con la búsqueda.' : 'No hay productos de Víveres, Carnes/Proteína, Alimentos, Hortalizas o Limpieza en este centro.'}</div>}
            {grupos.map((g) => (
            <div key={g.categoria || 'sin'} style={{ display: 'grid', gap: '.4rem' }}>
              {/* El encabezado se queda pegado arriba al desplazar: con 168 artículos,
                  si no, uno pierde de vista en qué categoría está mirando. */}
              <div className="muted" style={{
                position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-1, #111)',
                padding: '.3rem .1rem', fontSize: '.72rem', textTransform: 'uppercase',
                letterSpacing: '.06em', fontWeight: 700, borderBottom: '1px solid var(--border)',
              }}>
                {g.rotulo} <span style={{ fontWeight: 400 }}>· {num(g.items.length)}</span>
              </div>
              {g.items.map((v) => {
              const id = v.producto.id;
              const selected = id in sel;
              const cant = sel[id] ?? '';
              const excede = selected && (Number(cant) || 0) > v.stock;
              return (
                <div key={id} className="card" style={{ margin: 0, padding: '.5rem .65rem', display: 'flex', alignItems: 'center', gap: '.6rem', borderColor: selected ? 'var(--primary)' : 'var(--border)' }}>
                  <input type="checkbox" checked={selected} onChange={() => toggle(id)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: 'var(--primary)' }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggle(id)}>
                    <div style={{ fontWeight: 600, fontSize: '.88rem' }}>{v.producto.nombre}</div>
                    <small className="hint muted" style={{ fontSize: '.72rem' }}>{money(v.precio)} · stock {num(v.stock)} {v.producto.unidad}{v.almacenMasStock ? ` · 📦 ${v.almacenMasStock}` : ''}{excede ? <span style={{ color: 'var(--warning)' }}> · supera el stock</span> : null}</small>
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
            ))}
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
            {nPlatos > 0 && total > 0 && <small className="hint muted">Costo por plato: <strong className="mono">{money(total / nPlatos)}</strong></small>}
          </div>
          <div className="form-row">
            <label>Nota (opcional)</label>
            <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Detalle del servicio…" />
          </div>
        </div>
        <small className="hint muted">Se genera un correlativo con fecha y hora, y se descuenta el stock de los víveres del inventario.</small>
        {/* Las fotos que se cargaron desde el teléfono (máx. 4): acá la analista las ve,
            agrega o quita. Se guardan aparte de la comida, así que no esperan al «Guardar». */}
        {esEdicion && comida && (
          <FotosDelMovimiento movId={comida.id} actor={actor} modulo={MODULO_ADJUNTO_COMIDA}
            sinFotosTexto="Esta comida no tiene fotos." />
        )}
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
  const [movViveres, setMovViveres] = useState<FilaViver[]>([]);
  const [loading, setLoading] = useState(true);
  /** Buscador de la tabla de movimiento: la lista de víveres es larga. */
  const [qMov, setQMov] = useState('');
  /** Víveres con el detalle abierto: cada renglón del kardex, uno por uno. */
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const alternarDetalle = (id: string) => setAbiertos((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

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
      // Lo que había → lo que se comió → lo que salió por inventario → lo que queda.
      // Ya trae los víveres del centro con su stock: no hace falta pedirlos aparte.
      movimientoViveresDelPeriodo(almacen, rango.desde.toISOString(), rango.hasta.toISOString()).catch(() => [] as FilaViver[]),
    ]).then(([cs, mv]) => { setComidas(cs); setMovViveres(mv); })
      .catch(() => { /* */ }).finally(() => setLoading(false));
  }, [rango, cocinaId, almacen]);

  const resumen: ResumenCocina = useMemo(() => resumirComidas(comidas), [comidas]);

  // Movimiento de víveres: totales del pie y la lista de salidas por inventario.
  const totalesMov = useMemo(() => totalesDeViveres(movViveres), [movViveres]);
  const salidasInv = useMemo(() => salidasDeInventario(movViveres), [movViveres]);
  const movFiltrado = useMemo(() => {
    const q = qMov.trim().toLowerCase();
    if (!q) return movViveres;
    return movViveres.filter((f) => `${f.nombre} ${f.sku} ${f.unidad}`.toLowerCase().includes(q));
  }, [movViveres, qMov]);

  const maxViver = Math.max(1, ...resumen.topViveres.map((v) => v.valor));
  const maxDia = Math.max(1, ...resumen.porDia.map((d) => d.valor));
  const fmtDia = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  const presets: { k: Preset; label: string }[] = [
    { k: 'hoy', label: 'Hoy' }, { k: 'semana', label: 'Últimos 7 días' },
    { k: 'mes', label: 'Últimos 30 días' }, { k: 'rango', label: 'Rango' },
  ];

  return (
    <Modal title="📊 Resumen detallado de alimentación" size="xl" onClose={onClose}
      footer={
        <>
          {/* El PDF lleva el movimiento de víveres que se está viendo: es el
              cuadro que se firma, y si el papel no lo trae hay que volver a
              abrir el sistema para contestar «¿y cuánto quedó?». */}
          <button className="btn btn-ghost" onClick={() => void import('./cocinaPdf').then(({ descargarReporteCocinaPdf }) => descargarReporteCocinaPdf(comidas, `Resumen · ${fmtDia(rango.desde.toISOString().slice(0, 10))} a ${fmtDia(rango.hasta.toISOString().slice(0, 10))}`, movViveres)).catch(() => toast('No se pudo generar el PDF', 'error'))} disabled={!comidas.length && !movViveres.length}>↓ PDF</button>
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
      {/* Qué período se está mirando, siempre a la vista: todo lo de abajo
          —había, comido, salidas, queda— depende de estas dos fechas, y el PDF
          sale con ellas. Sin el rótulo, un reporte impreso no dice de cuándo es. */}
      <div className="mono muted" style={{ fontSize: '.78rem', margin: '.1rem 0 .3rem' }}>
        📅 Del <strong>{fmtDia(rango.desde.toISOString().slice(0, 10))}</strong> al <strong>{fmtDia(rango.hasta.toISOString().slice(0, 10))}</strong>
      </div>

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

          {/* Lo que había → lo que se comió → lo que queda.
              Reemplaza al viejo «Stock disponible», que mostraba el stock de HOY
              suelto, sin decir de dónde venía ni a dónde se fue: había que sacar
              la cuenta a mano contra el consumo y nunca daba, porque entre medio
              pasan compras, traslados, salidas manuales y ajustes. */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <div className="card-title" style={{ margin: 0 }}>
                Movimiento de víveres <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· de este centro, en el período</span>
              </div>
              <span className="muted" style={{ fontSize: '.76rem' }}>
                {totalesMov.conSalidas > 0 && <><strong style={{ color: 'var(--warning)' }}>{totalesMov.conSalidas}</strong> con salidas/ajustes · </>}
                <strong style={{ color: totalesMov.enCero > 0 ? 'var(--danger)' : undefined }}>{totalesMov.enCero}</strong> en cero
              </span>
            </div>
            <p className="hint muted" style={{ margin: '0 0 .5rem', fontSize: '.76rem' }}>
              <strong>Había + Entró ± Traslados − Comido − Salidas/ajustes = Queda.</strong> «Había» no está guardado en ningún
              lado: se reconstruye caminando el kardex hacia atrás desde el stock de hoy, así que no puede contradecirlo.
              Es la <strong>misma cuenta del ciclo de mercado</strong> —ahí «Había» es el <strong>saldo inicial</strong>, que al cerrar
              se congela en el histórico y arranca el ciclo siguiente—, pero acá por el <strong>rango de fechas que elijas</strong>.
              <strong> Tocá un víver</strong> para ver sus movimientos uno por uno.
            </p>
            {movViveres.length > 3 && (
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.45rem' }}>
                <input className="input" value={qMov} onChange={(e) => setQMov(e.target.value)}
                  placeholder="🔎 Buscar víver por nombre, SKU o unidad…" style={{ flex: '1 1 240px' }} />
                {qMov.trim() && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setQMov('')}>✕</button>}
              </div>
            )}
            {!movFiltrado.length ? (
              <p className="hint muted" style={{ margin: 0 }}>
                {qMov.trim() ? `Ningún víver coincide con «${qMov.trim()}».` : 'Sin movimiento de víveres en el período.'}
              </p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: '.8rem' }}>
                  <thead>
                    <tr>
                      <th>Víver</th>
                      <th style={{ textAlign: 'right' }}>Había</th>
                      <th style={{ textAlign: 'right' }}>Entró</th>
                      <th style={{ textAlign: 'right' }}>Traslados</th>
                      <th style={{ textAlign: 'right' }}>Comido</th>
                      <th style={{ textAlign: 'right' }}>Salidas / ajustes</th>
                      <th style={{ textAlign: 'right' }}>Queda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movFiltrado.map((f) => {
                      const abierto = abiertos.has(f.producto_id);
                      return (
                        <Fragment key={f.producto_id}>
                          <tr style={abierto ? { background: 'var(--bg-2)' } : undefined}>
                            <td>
                              {/* Tocar el víver abre su kardex del período. El total de
                                  la columna dice cuánto; el detalle, cuándo y por qué. */}
                              <button type="button" className="btn btn-sm btn-ghost"
                                onClick={() => alternarDetalle(f.producto_id)}
                                style={{ padding: '0 .3rem', marginRight: '.3rem' }}
                                title={abierto ? 'Ocultar el detalle' : `Ver los ${f.movimientos.length} movimiento(s)`}
                                disabled={!f.movimientos.length}>
                                {f.movimientos.length ? (abierto ? '▾' : '▸') : '·'}
                              </button>
                              {f.nombre} <span className="muted mono" style={{ fontSize: '.7rem' }}>{f.sku}</span>
                              {f.unidad && <span className="muted" style={{ fontSize: '.7rem' }}> · {f.unidad}</span>}
                            </td>
                            <td className="mono" style={{ textAlign: 'right' }}>{num(f.habia)}</td>
                            <td className="mono" style={{ textAlign: 'right', color: f.entradas > 0 ? 'var(--success)' : undefined }}>{f.entradas ? num(f.entradas) : '—'}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{f.traslados ? num(f.traslados) : '—'}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: f.consumido > 0 ? 700 : 400 }}>{f.consumido ? num(f.consumido) : '—'}</td>
                            <td className="mono" style={{ textAlign: 'right', color: f.salidas > 0 ? 'var(--warning)' : undefined }}>
                              {f.salidas ? num(f.salidas) : '—'}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: f.queda <= 0 ? 'var(--danger)' : undefined }}>{num(f.queda)}</td>
                          </tr>
                          {abierto && (
                            <tr>
                              <td colSpan={7} style={{ padding: '.35rem .6rem .7rem 2rem', background: 'var(--bg-2)' }}>
                                <table className="table" style={{ fontSize: '.76rem', margin: 0 }}>
                                  <thead><tr><th>Fecha</th><th>Qué fue</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Motivo</th><th>Quién</th></tr></thead>
                                  <tbody>
                                    {f.movimientos.map((m, i) => (
                                      <tr key={`${m.at}-${i}`}>
                                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dateTime(m.at)}</td>
                                        <td>
                                          <span className="badge" style={{
                                            fontSize: '.66rem',
                                            background: m.clase === 'comida' ? 'var(--primary)' : m.clase === 'salida' ? 'var(--warning)' : m.clase === 'entrada' ? 'var(--success)' : 'var(--bg-1)',
                                            color: m.clase === 'traslado' ? 'inherit' : '#1a1205', fontWeight: 700,
                                          }}>{ETIQUETA_CLASE[m.clase]}</span>
                                        </td>
                                        <td className="muted">{m.tipo}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: m.delta < 0 ? 'var(--danger)' : 'var(--success)' }}>
                                          {m.delta > 0 ? '+' : ''}{num(m.delta)}
                                        </td>
                                        <td>{m.motivo ?? <span className="muted">—</span>}</td>
                                        <td className="muted">{m.actor ?? '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700 }}>TOTAL <span className="muted" style={{ fontWeight: 400, fontSize: '.7rem' }}>· unidades mezcladas: sirve para cuadrar, no como cantidad</span></td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalesMov.habia)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalesMov.entradas)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalesMov.traslados)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalesMov.consumido)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalesMov.salidas)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(totalesMov.queda)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Las salidas y ajustes, una por una: el «Salidas / ajustes» de arriba
              es un total, y lo que se pregunta después es SIEMPRE quién y por qué. */}
          {salidasInv.length > 0 && (
            <div className="card" style={{ marginTop: '.9rem' }}>
              <div className="card-title" style={{ marginBottom: '.5rem' }}>
                Salidas y ajustes hechos por Inventario <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {salidasInv.length} en el período</span>
              </div>
              <p className="hint muted" style={{ margin: '0 0 .5rem', fontSize: '.76rem' }}>
                Lo que salió del almacén <strong>sin ser una comida ni un traslado</strong>: una pérdida, una salida manual,
                un conteo físico, un ajuste a la baja. No suben el costo por plato, pero sí explican por qué queda menos.
              </p>
              <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: '.8rem' }}>
                  <thead><tr><th>Fecha</th><th>Víver</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Motivo</th><th>Quién</th></tr></thead>
                  <tbody>
                    {salidasInv.map((s, i) => (
                      <tr key={`${s.producto_id}-${s.at}-${i}`}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dateTime(s.at)}</td>
                        <td>{s.nombre} <span className="muted mono" style={{ fontSize: '.7rem' }}>{s.sku}</span></td>
                        <td><span className="badge" style={{ fontSize: '.68rem' }}>{s.tipo}</span></td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--warning)', fontWeight: 700 }}>−{num(s.cantidad)} {s.unidad}</td>
                        <td>{s.motivo ?? <span className="muted">—</span>}</td>
                        <td className="muted">{s.actor ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
