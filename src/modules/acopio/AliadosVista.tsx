import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, money, num, hoyISO } from '@/shared/lib/format';
import { notify } from '@/shared/lib/notify';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { AliadoAcopio, AliadoCierre } from '@/shared/lib/types';
import {
  crearAliado, actualizarAliado,
  listAliados, listAliadoMovimientos, resumirAliado,
  crearMovimientoAliado, eliminarAliadoMovimiento,
  openPeriodoAliado, cerrarYAbrirCajaAliado, listAliadoCierres,
  type AliadoFila, type AliadoResumen, type AliadoConResumen,
} from './subledgers.repository';

/** Prefijo de los aliados de esta vista (los legados quedan ocultos). */
const PREFIJO_ALIADO = 'CENTRO ACOPIO';

/**
 * Vista «Aliados» (NO modal): pantalla propia dentro del módulo de Acopio.
 *   · Lista de aliados como tarjetas (editables) + «Agregar aliado» + «Volver» a Acopio.
 *   · Al tocar una tarjeta → vista de detalle del aliado: las mismas tarjetas de Acopio
 *     ($Usd entregados, Kg cerrados, $/Kg, $Usd facturados, Saldo $, Kg recibidos MGG,
 *     Saldo Kg) + la tabla de movimientos con saldos corridos + «Agregar movimiento».
 */
export function AliadosVista({ canWrite, actor, actorName, centro = 'LA ESPERANZA', onVolver }: {
  canWrite: boolean; actor: string; actorName: string | null; centro?: string; onVolver: () => void;
}) {
  const [seleccion, setSeleccion] = useState<AliadoAcopio | null>(null);

  if (seleccion) {
    return <AliadoDetalle aliado={seleccion} canWrite={canWrite} actor={actor} actorName={actorName} centro={centro} onVolver={() => setSeleccion(null)} />;
  }
  return <AliadosLista canWrite={canWrite} actor={actor} centro={centro} onVolverAcopio={onVolver} onAbrir={setSeleccion} />;
}

/* ───────────── Lista de aliados (tarjetas) ───────────── */

function AliadosLista({ canWrite, actor, centro, onVolverAcopio, onAbrir }: {
  canWrite: boolean; actor: string; centro: string; onVolverAcopio: () => void; onAbrir: (a: AliadoAcopio) => void;
}) {
  const [items, setItems] = useState<AliadoConResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [editar, setEditar] = useState<AliadoAcopio | null>(null);
  const [busca, setBusca] = useState('');

  // Mostramos solo los aliados de esta vista (convención «CENTRO ACOPIO …»). Filtramos
  // ANTES de calcular el resumen y resolvemos en paralelo → no recorre todos los legados.
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const todos = await listAliados(centro);
      const propios = todos.filter((a) => a.nombre.toUpperCase().startsWith(PREFIJO_ALIADO));
      // El resumen de cada tarjeta se acota al PERIODO de caja abierto (los cierres
      // anteriores no se vuelven a sumar).
      const conResumen = await Promise.all(
        propios.map(async (a) => {
          const p = await openPeriodoAliado(a.id);
          return { aliado: a, resumen: resumirAliado(await listAliadoMovimientos(a.id, p)) };
        }),
      );
      setItems(conResumen);
    }
    finally { setLoading(false); }
  }, [centro]);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error')); }, [cargar]);
  useRealtime(['acopio_aliados', 'acopio_aliado_movimientos', 'acopio_aliado_cierres'], cargar);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? items.filter((i) => i.aliado.nombre.toLowerCase().includes(q)) : items;
  }, [items, busca]);

  // Peramanal (Ender) = compra de ORO: las tarjetas muestran gramos (Gm) de oro (AU).
  const esOroLista = centro === 'PERAMANAL ENDER MEJIAS';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{centro === 'PERAMANAL ENDER MEJIAS' ? '🪙 Compra de ORO · Centro de Costo' : '🤝 Aliados · Centro de Costo'}</h1>
          <p className="muted">Cada aliado lleva su propio libro con la misma estructura del acopio (entregado, Kg cerrados, $/Kg, facturado, Kg recibidos y saldos corridos).</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button className="btn btn-ghost" onClick={onVolverAcopio}>← Volver a Acopio</button>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
          <input className="input" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar aliado…" style={{ width: '100%' }} />
        </div>
        <span className="muted" style={{ fontSize: '.82rem' }}>{filtrados.length} aliado(s)</span>
        {canWrite && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setNuevo(true)}>+ Agregar aliado</button>}
      </div>

      {loading ? <EmptyState message="Cargando aliados…" icon="◔" /> : !filtrados.length ? (
        <EmptyState message="Sin aliados. Creá uno con + Agregar aliado." icon="🤝" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1rem' }}>
          {filtrados.map(({ aliado, resumen }) => (
            <div key={aliado.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', borderColor: resumen.saldoKg > 0 ? 'var(--primary)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem' }}>
                <strong style={{ fontSize: '.95rem', lineHeight: 1.25 }}>{esOroLista ? '🪙' : '🤝'} {aliado.nombre}</strong>
                <div style={{ display: 'flex', gap: '.25rem', flex: '0 0 auto' }}>
                  {!aliado.activo && <span className="badge" style={{ fontSize: '.66rem' }}>inactivo</span>}
                  {canWrite && <button className="btn btn-sm btn-ghost" title="Editar aliado" onClick={() => setEditar(aliado)}>✎</button>}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '.74rem' }}>Saldo en {esOroLista ? 'Gm oro (AU)' : 'Kg casiterita'}</span>
                <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: resumen.saldoKg < 0 ? 'var(--danger)' : 'var(--primary-3)' }}>{num(resumen.saldoKg)} {esOroLista ? 'Gm' : 'Kg'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
                <span className="muted">Saldo $ Usd</span>
                <span className="mono" style={{ fontWeight: 700, color: resumen.saldoUsd < 0 ? 'var(--danger)' : undefined }}>{money(resumen.saldoUsd)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.74rem' }} className="muted">
                <span>Entregado {money(resumen.totalEntregado)}</span>
                <span>Facturado {money(resumen.totalFacturado)}</span>
              </div>
              <button className="btn btn-sm btn-primary" style={{ marginTop: '.3rem' }} onClick={() => onAbrir(aliado)}>Ver movimientos →</button>
            </div>
          ))}
        </div>
      )}

      {nuevo && <NuevoAliadoModal actor={actor} centro={centro} onClose={() => setNuevo(false)} onSaved={async () => { setNuevo(false); await cargar(); }} />}
      {editar && <EditarAliadoModal aliado={editar} onClose={() => setEditar(null)} onSaved={async () => { setEditar(null); await cargar(); }} />}
    </div>
  );
}

/* ───────────── Detalle del aliado (vista con tarjetas + tabla) ───────────── */

function AliadoDetalle({ aliado, canWrite, actor, actorName, centro, onVolver }: {
  aliado: AliadoAcopio; canWrite: boolean; actor: string; actorName: string | null; centro: string; onVolver: () => void;
}) {
  const [filas, setFilas] = useState<AliadoFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [agregar, setAgregar] = useState(false);
  const [cerrar, setCerrar] = useState(false);
  const [cierres, setCierres] = useState(false);
  const [periodo, setPeriodo] = useState(1);
  const resumen = useMemo<AliadoResumen>(() => resumirAliado(filas), [filas]);
  const hayGastos = useMemo(() => filas.some((f) => Number(f.gastos) > 0), [filas]);

  // La vista viva se acota al PERIODO de caja abierto del aliado; los cierres
  // anteriores quedan en el historial (🗂 Cierres).
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = await openPeriodoAliado(aliado.id);
      setPeriodo(p);
      setFilas(await listAliadoMovimientos(aliado.id, p));
    }
    finally { setLoading(false); }
  }, [aliado.id]);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error')); }, [cargar]);
  useRealtime(['acopio_aliado_movimientos', 'acopio_aliado_cierres'], cargar);

  async function borrar(f: AliadoFila) {
    if (!window.confirm(`¿Eliminar este movimiento del ${date(f.fecha)}? Se revierte su reflejo en la caja general/casiterita.`)) return;
    try { await eliminarAliadoMovimiento(f); toast('Movimiento eliminado', 'success'); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const sugCorte = (filas.reduce((m, f) => Math.max(m, f.corte ?? 0), 0)) + 1;
  // Peramanal (Ender) compra ORO: el material es oro (AU) y la unidad son gramos (Gm).
  const esOro = centro === 'PERAMANAL ENDER MEJIAS';
  const U = esOro ? 'Gm' : 'Kg';
  const material = esOro ? 'oro (AU)' : 'casiterita';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{esOro ? '🪙' : '🤝'} {aliado.nombre}</h1>
          <p className="muted">Libro del aliado · misma estructura del acopio. El <strong>Saldo en {U}</strong> = saldo anterior + {U} Cerrados − {U} Recibidos.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
        <button className="btn btn-ghost" onClick={onVolver}>← Volver a Aliados</button>
        {!aliado.activo && <span className="badge" style={{ fontSize: '.7rem' }}>inactivo</span>}
        <button className="btn btn-ghost" onClick={() => setCierres(true)}>🗂 Cierres de caja</button>
        {canWrite && <button className="btn btn-ghost" onClick={() => setCerrar(true)}>🔒 Cerrar caja</button>}
        {canWrite && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setAgregar(true)}>+ Agregar Movimiento</button>}
      </div>

      {/* Tarjetas (las mismas de acopio) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <Kpi titulo="💵 USD entregados" valor={money(resumen.totalEntregado)} color="var(--success)" />
        <Kpi titulo={`⚖ ${U} cerrados`} valor={`${num(resumen.totalKgCerrados)} ${U}`} color="var(--primary-3)" />
        <Kpi titulo={`💲 Precio $Usd por ${U}`} valor={`${money(resumen.precioProm)} /${U}`} color="var(--primary-3)" />
        <Kpi titulo="🧾 $Usd Facturados" valor={money(resumen.totalFacturado)} />
        <Kpi titulo="🏦 Saldo en $ Usd" valor={money(resumen.saldoUsd)} color={resumen.saldoUsd < 0 ? 'var(--danger)' : undefined} />
        <Kpi titulo={`📥 ${U} Recibidos por MGG`} valor={`${num(resumen.totalKgRecibidos)} ${U}`} />
        <Kpi titulo={`📦 Saldo en ${U} de ${material}`} valor={`${num(resumen.saldoKg)} ${U}`} color={resumen.saldoKg < 0 ? 'var(--danger)' : 'var(--primary)'} destacar />
      </div>

      {/* Tabla de movimientos (réplica de acopio) */}
      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !filas.length ? (
        <EmptyState message="Sin movimientos. Registrá uno con + Agregar Movimiento." icon="📒" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead>
              <tr>
                <th>Fecha</th><th>Corte</th><th>Descripción</th>
                <th style={{ textAlign: 'right' }}>$Usd entregado</th>
                <th style={{ textAlign: 'right' }}>{U} Cerrados</th>
                <th style={{ textAlign: 'right' }}>$/{U}</th>
                <th style={{ textAlign: 'right' }}>$Usd Facturados</th>
                {hayGastos && <th style={{ textAlign: 'right' }}>Gastos</th>}
                <th style={{ textAlign: 'right' }}>Saldo $ Usd</th>
                <th style={{ textAlign: 'right' }}>{U} Recibidos por MGG</th>
                <th style={{ textAlign: 'right' }} title={`${U} de ${material} que el aliado aún debe`}>Saldo en {U} de {material} ⓘ</th>
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
                  <td className="mono" style={{ textAlign: 'right' }}>{f.usd_entregado ? money(f.usd_entregado) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary-3)' }}>{f.kg_cerrados ? num(f.kg_cerrados) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{f.precio_usd_kg ? money(f.precio_usd_kg) : '—'}</td>
                  {/* $Usd Facturados = Kg Cerrados × Precio $/Kg (computado, igual que acopio: siempre visible) */}
                  <td className="mono" style={{ textAlign: 'right' }}>{money(f.facturado)}</td>
                  {hayGastos && <td className="mono" style={{ textAlign: 'right', color: f.gastos ? 'var(--danger)' : undefined }}>{f.gastos ? money(f.gastos) : '—'}</td>}
                  <td className="mono" style={{ textAlign: 'right' }}><strong>{money(f.saldoUsd)}</strong></td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success, #45c08a)' }}>{f.kg_recibidos ? num(f.kg_recibidos) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: f.saldoKg < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{num(f.saldoKg)}</td>
                  {canWrite && <td><button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => borrar(f)}>✕</button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border, rgba(255,255,255,.15))', fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'right' }}>Totales</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--success, #45c08a)' }}>{money(resumen.totalEntregado)}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--primary-3)' }}>{num(resumen.totalKgCerrados)}</td>
                <td></td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(resumen.totalFacturado)}</td>
                {hayGastos && <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{money(resumen.totalGastos)}</td>}
                <td className="mono" style={{ textAlign: 'right' }}>{money(resumen.saldoUsd)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(resumen.totalKgRecibidos)}</td>
                <td className="mono" style={{ textAlign: 'right', color: resumen.saldoKg < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{num(resumen.saldoKg)}</td>
                {canWrite && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {agregar && (
        <MovimientoAliadoModal aliado={aliado} sugCorte={sugCorte} actor={actor} actorName={actorName} centro={centro}
          onClose={() => setAgregar(false)} onSaved={async () => { setAgregar(false); await cargar(); }} />
      )}
      {cerrar && (
        <CerrarCajaAliadoModal aliado={aliado} resumen={resumen} esOro={esOro} unidad={U} actor={actor} actorName={actorName} centro={centro}
          onClose={() => setCerrar(false)} onDone={async () => { setCerrar(false); await cargar(); }} />
      )}
      {cierres && (
        <CierresAliadoModal aliado={aliado} periodoActual={periodo} unidad={U}
          onClose={() => setCierres(false)} />
      )}
    </div>
  );
}

/* ───────────── Cerrar caja del aliado (cierre + apertura) ───────────── */

function CerrarCajaAliadoModal({ aliado, resumen, esOro, unidad, actor, actorName, centro, onClose, onDone }: {
  aliado: AliadoAcopio; resumen: AliadoResumen; esOro: boolean; unidad: string;
  actor: string; actorName: string | null; centro: string; onClose: () => void; onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saldoUsd = resumen.saldoUsd;
  const saldoKg = resumen.saldoKg;
  const tasa = resumen.precioProm;
  const valor = saldoKg > 0 ? saldoKg * tasa : 0;
  const almacen = esOro ? `ORO · ${centro}` : (centro === 'LA ESPERANZA' ? 'CASITERITA' : `CASITERITA · ${centro}`);
  const material = esOro ? 'ORO (AU)' : 'CASITERITA';

  async function confirmar() {
    setSaving(true); setError(null);
    try {
      const res = await cerrarYAbrirCajaAliado({ aliadoId: aliado.id, centro, actor, actorName });
      notify(`Cierre #${res.periodoCerrado} de ${aliado.nombre} · nuevo periodo #${res.periodoNuevo}`, 'success', { link: '#/app/acopio' });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar.'); setSaving(false); }
  }

  return (
    <Modal title={`🔒 Cerrar caja · ${aliado.nombre}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving}>{saving ? 'Cerrando…' : '🔒 Cerrar y abrir nuevo'}</button></>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <p className="muted" style={{ marginTop: 0, fontSize: '.84rem' }}>Se cierra el periodo actual y se abre uno nuevo automáticamente.</p>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.84rem' }}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>Saldo en $ → apertura del periodo nuevo</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: saldoUsd < 0 ? 'var(--danger)' : 'var(--primary-3)' }}>{money(saldoUsd)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Saldo en {unidad} → inventario ({material})</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(saldoKg)} {unidad}</td>
            </tr>
            {saldoKg > 0 && (
              <>
                <tr><td className="muted">Almacén destino</td><td className="mono" style={{ textAlign: 'right' }}>{almacen}</td></tr>
                <tr><td className="muted">Tasa (precio promedio)</td><td className="mono" style={{ textAlign: 'right' }}>{money(tasa)}/{unidad}</td></tr>
                <tr><td className="muted">Valor que entra al inventario</td><td className="mono" style={{ textAlign: 'right' }}>{money(valor)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.76rem', marginBottom: 0 }}>
        {saldoKg > 0
          ? `Los ${num(saldoKg)} ${unidad} pasan a ${material} en «${almacen}» a la tasa del aliado. El saldo en $ arranca el periodo nuevo como «$ entregado»; lo demás se reinicia.`
          : 'No hay saldo para enviar al inventario. El saldo en $ arranca el periodo nuevo como «$ entregado»; lo demás se reinicia.'}
      </p>
    </Modal>
  );
}

/* ───────────── Historial de cierres del aliado (buscable) ───────────── */

function CierresAliadoModal({ aliado, periodoActual, unidad, onClose }: {
  aliado: AliadoAcopio; periodoActual: number; unidad: string; onClose: () => void;
}) {
  const [cierres, setCierres] = useState<AliadoCierre[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<AliadoCierre | null>(null);
  const [movs, setMovs] = useState<AliadoFila[]>([]);
  const [cargandoMovs, setCargandoMovs] = useState(false);

  const cargar = useCallback(() => { listAliadoCierres(aliado.id).then(setCierres).catch(() => setCierres([])); }, [aliado.id]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['acopio_aliado_cierres'], cargar);

  const etiqueta = (c: AliadoCierre) => `Cierre #${c.periodo} · ${date(c.fecha_inicio ?? c.fecha_fin)} → ${date(c.fecha_fin)}`;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    return t ? cierres.filter((c) => norm(etiqueta(c)).includes(t)) : cierres;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cierres, q]);

  function abrir(c: AliadoCierre) {
    setSel(c); setCargandoMovs(true); setMovs([]);
    listAliadoMovimientos(aliado.id, c.periodo).then(setMovs).catch(() => setMovs([])).finally(() => setCargandoMovs(false));
  }

  return (
    <Modal title={`🗂 Cierres de caja · ${aliado.nombre}`} size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {!sel ? (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: '.82rem' }}>Periodo en curso: <strong>#{periodoActual}</strong> (no cerrado). Los cierres anteriores se listan abajo.</p>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar cierre (fecha, número…)" style={{ marginBottom: '.6rem' }} />
          {!filtradas.length ? (
            <p className="muted" style={{ margin: 0 }}>Sin cierres registrados todavía.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead><tr><th>Cierre / período</th><th style={{ textAlign: 'right' }}>Saldo $</th><th style={{ textAlign: 'right' }}>Saldo {unidad}</th><th></th></tr></thead>
                <tbody>
                  {filtradas.map((c) => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => abrir(c)} title="Ver los movimientos de este período">
                      <td style={{ fontWeight: 600 }}>{etiqueta(c)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.saldo_usd != null ? money(Number(c.saldo_usd)) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.saldo_kg != null ? `${num(Number(c.saldo_kg))} ${unidad}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.6rem' }}>
            <strong>{etiqueta(sel)}{sel.almacen ? ` · → ${sel.almacen}` : ''}</strong>
            <button className="btn btn-sm btn-ghost" onClick={() => { setSel(null); setMovs([]); }}>← Volver al listado</button>
          </div>
          {cargandoMovs ? (
            <p className="muted" style={{ margin: 0 }}>Cargando movimientos…</p>
          ) : !movs.length ? (
            <p className="muted" style={{ margin: 0 }}>Sin movimientos en este período.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.8rem' }}>
                <thead><tr>
                  <th>Fecha</th><th>Descripción</th>
                  <th style={{ textAlign: 'right' }}>$ Entreg.</th><th style={{ textAlign: 'right' }}>{unidad} Cerr.</th>
                  <th style={{ textAlign: 'right' }}>Facturado</th><th style={{ textAlign: 'right' }}>Saldo $</th><th style={{ textAlign: 'right' }}>Saldo {unidad}</th>
                </tr></thead>
                <tbody>
                  {movs.map((f) => (
                    <tr key={f.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{date(f.fecha)}</td>
                      <td style={{ maxWidth: 240, whiteSpace: 'pre-wrap' }}>{f.descripcion || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.usd_entregado ? money(f.usd_entregado) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.kg_cerrados ? num(f.kg_cerrados) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.facturado ? money(f.facturado) : ''}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{money(f.saldoUsd)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{num(f.saldoKg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Kpi({ titulo, valor, color, destacar }: { titulo: string; valor: string; color?: string; destacar?: boolean }) {
  return (
    <div className="card" style={destacar ? { borderColor: 'var(--primary)', background: 'linear-gradient(135deg, var(--surface-2), var(--surface))' } : undefined}>
      <div className="card-title"><span>{titulo}</span></div>
      <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color }}>{valor}</div>
    </div>
  );
}

/* ───────────── Modales (alta / edición / movimiento) ───────────── */

function NuevoAliadoModal({ actor, centro, onClose, onSaved }: { actor: string; centro: string; onClose: () => void; onSaved: () => void }) {
  const [nombre, setNombre] = useState(`CENTRO ACOPIO ${centro} - `);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try { const a = await crearAliado(nombre, actor, centro); toast(`Aliado ${a.nombre} creado`, 'success'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear'); setSaving(false); }
  }
  return (
    <Modal title="Agregar aliado" size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="nuevo-aliado" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear'}</button></>
    }>
      <form id="nuevo-aliado" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Nombre del aliado</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. CENTRO ACOPIO LA ESPERANZA - JUAN BODEGA P-MGG06-B" autoFocus required /></div>
      </form>
    </Modal>
  );
}

function EditarAliadoModal({ aliado, onClose, onSaved }: { aliado: AliadoAcopio; onClose: () => void; onSaved: () => void }) {
  const [nombre, setNombre] = useState(aliado.nombre);
  const [activo, setActivo] = useState(aliado.activo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try { await actualizarAliado(aliado.id, { nombre, activo }); toast('Aliado actualizado', 'success'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }
  return (
    <Modal title={`Editar · ${aliado.nombre}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="editar-aliado" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></>
    }>
      <form id="editar-aliado" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Nombre del aliado</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Aliado activo
        </label>
      </form>
    </Modal>
  );
}

function MovimientoAliadoModal({ aliado, sugCorte, actor, actorName, centro, onClose, onSaved }: {
  aliado: AliadoAcopio; sugCorte: number; actor: string; actorName: string | null; centro: string; onClose: () => void; onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  const [corte, setCorte] = useState(String(sugCorte));
  const [descripcion, setDescripcion] = useState('');
  const [usd, setUsd] = useState('');
  const [kgCerrados, setKgCerrados] = useState('');
  const [precio, setPrecio] = useState('');
  const [kgRecibidos, setKgRecibidos] = useState('');
  const [gastos, setGastos] = useState('');
  const [reflejar, setReflejar] = useState(true);
  const [sumar, setSumar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facturado = (Number(kgCerrados) || 0) * (Number(precio) || 0);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      await crearMovimientoAliado({
        aliadoId: aliado.id, aliadoNombre: aliado.nombre, fecha, corte: Number(corte) || null, descripcion,
        usdEntregado: Number(usd) || 0, kgCerrados: Number(kgCerrados) || 0, precioUsdKg: Number(precio) || 0,
        kgRecibidos: Number(kgRecibidos) || 0, gastos: Number(gastos) || 0,
        reflejarCajaGeneral: reflejar, sumarCasiterita: sumar, centroNombre: centro,
      }, actor, actorName);
      toast('Movimiento registrado', 'success'); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={`Agregar movimiento · ${aliado.nombre}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="mov-aliado" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Registrar'}</button></>
    }>
      <form id="mov-aliado" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div className="form-row"><label>Corte N°</label><input className="input mono" type="number" min={1} value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
        </div>
        <div className="form-row"><label>Descripción (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder={`CENTRO DE ACOPIO ${aliado.nombre}`} /></div>
        <div className="form-grid">
          <div className="form-row"><label>$Usd entregado</label><input className="input mono" type="number" min={0} step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0.00" /></div>
          <div className="form-row"><label>Kg Cerrados</label><input className="input mono" type="number" min={0} step="any" value={kgCerrados} onChange={(e) => setKgCerrados(e.target.value)} placeholder="0" /></div>
          <div className="form-row"><label>Precio $/Kg</label><input className="input mono" type="number" min={0} step="0.0001" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" /></div>
          <div className="form-row"><label>Kg Recibidos por MGG</label><input className="input mono" type="number" min={0} step="any" value={kgRecibidos} onChange={(e) => setKgRecibidos(e.target.value)} placeholder="0" /></div>
          <div className="form-row"><label>$ Gastos (opcional)</label><input className="input mono" type="number" min={0} step="0.01" value={gastos} onChange={(e) => setGastos(e.target.value)} placeholder="0.00" /></div>
        </div>
        <p className="muted" style={{ fontSize: '.8rem', marginTop: 0 }}>$Usd Facturados (Kg × $/Kg): <strong className="mono">{money(facturado)}</strong></p>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
          <input type="checkbox" checked={reflejar} onChange={(e) => setReflejar(e.target.checked)} />
          Reflejar el $ entregado como <strong>traslado en la caja general</strong>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem', marginTop: '.3rem' }}>
          <input type="checkbox" checked={sumar} onChange={(e) => setSumar(e.target.checked)} />
          Sumar los <strong>Kg Recibidos</strong> al stock real de CASITERITA
        </label>
        <small className="muted">Marcá «sumar a casiterita» solo si esos Kg NO entraron ya por una recepción aparte (evita doble conteo).</small>
      </form>
    </Modal>
  );
}
