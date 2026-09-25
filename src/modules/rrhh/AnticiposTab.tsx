/* ============================================================
   MGG · RRHH · Préstamos y anticipos

   Tres cosas en una pantalla:

   1. CARGAR, incluso lo viejo. Un préstamo lleva la fecha en que se DIO, que
      puede ser de hace meses, y puede entrar con lo que ya se había abonado.
      Sin eso, cargar el historial de alguien metería todo fechado hoy.

   2. VER DE UN GOLPE cuánto hay prestado y a cuánta gente. Las dos tarjetas de
      arriba se tocan y abren el detalle; no son adornos.

   3. BUSCAR. Por trabajador, tipo, estado, rango de fechas, rango de monto y
      texto libre. Los filtros mandan sobre las tarjetas, la tabla y el PDF: lo
      que se ve es lo que se imprime.

   El SALDO no se escribe nunca a mano: sale de los abonos, que los mantiene la
   base. Lo que descuenta la nómina entra solo, por un puente en la base.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, AnticipoPrestamo, PagoAnticipo } from '@/shared/lib/types';
import { listPersonal } from './personal.repository';
import {
  listAnticipos, listPagosAnticipos, crearAnticipo, editarAnticipo, eliminarAnticipo,
  agregarPagoAnticipo, eliminarPagoAnticipo, type AnticipoInput,
} from './anticipos.repository';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';
import { nombreDeCarnet, numeroFicha } from './fichaPersonal';
import {
  FILTRO_PRESTAMOS_VACIO, deudaPorTrabajador, errorPago, esHistorico, estadoDeCuenta,
  fechaDePrestamo, filtrarPagos, filtrarPrestamos, hayFiltro, labelOrigen, pagosPorPrestamo,
  rangosRapidos, resumenPrestamos,
  type DeudaTrabajador, type FiltroPrestamos,
} from './prestamos';

const hoyIso = () => new Date().toISOString().slice(0, 10);

const VACIO = (): AnticipoInput => ({
  personal_id: '', tipo: 'anticipo', monto_total: 0, cuota_sugerida: null, motivo: '',
  fecha: hoyIso(), ya_pagado: null,
});

export function AnticiposTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName: string | null; empresa?: Empresa;
}) {
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [lista, setLista] = useState<AnticipoPrestamo[]>([]);
  const [pagos, setPagos] = useState<PagoAnticipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<AnticipoInput>(VACIO);
  const [abrirForm, setAbrirForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroPrestamos>(FILTRO_PRESTAMOS_VACIO);
  const [masFiltros, setMasFiltros] = useState(false);
  const [verPendientes, setVerPendientes] = useState(false);
  const [verTrabajadores, setVerTrabajadores] = useState(false);
  const [detalle, setDetalle] = useState<AnticipoPrestamo | null>(null);
  const [cuentaDe, setCuentaDe] = useState<string | null>(null);
  const [porBorrar, setPorBorrar] = useState<AnticipoPrestamo | null>(null);

  const recargar = useCallback(async () => {
    setLoading(true);
    const [ps, as] = await Promise.all([
      listPersonal(false, empresa).catch((e) => { toast(e instanceof Error ? e.message : 'No se pudo cargar el personal', 'error'); return [] as Personal[]; }),
      listAnticipos(undefined, false, empresa).catch(() => [] as AnticipoPrestamo[]),
    ]);
    // Los abonos se piden después, ya sabiendo de qué préstamos: sin filtrar
    // traería los de toda la historia de la empresa para nada.
    const gs = as.length ? await listPagosAnticipos(as.map((a) => a.id)).catch(() => [] as PagoAnticipo[]) : [];
    setPersonal(ps); setLista(as); setPagos(gs);
    setLoading(false);
  }, [empresa]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['anticipos_prestamos', 'anticipos_pagos', 'personal'], () => { void recargar(); });

  const personaPorId = useMemo(() => new Map(personal.map((p) => [p.id, p])), [personal]);
  const nombreDe = useCallback((id: string) => {
    const p = personaPorId.get(id);
    return p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '—';
  }, [personaPorId]);

  /* Lo filtrado manda en TODO: tarjetas, tabla y PDF. Que la tarjeta diga una
     cosa y la tabla otra es la forma más rápida de que nadie confíe en ninguna. */
  const visibles = useMemo(() => filtrarPrestamos(lista, filtro, nombreDe), [lista, filtro, nombreDe]);
  const pagosVisibles = useMemo(
    () => filtrarPagos(pagos, filtro).filter((g) => visibles.some((p) => p.id === g.anticipo_id)),
    [pagos, filtro, visibles],
  );
  const resumen = useMemo(() => resumenPrestamos(visibles, pagos), [visibles, pagos]);
  const deudas = useMemo(() => deudaPorTrabajador(visibles, pagos, nombreDe), [visibles, pagos, nombreDe]);
  const pagosDe = useMemo(() => pagosPorPrestamo(pagos), [pagos]);
  const rangos = useMemo(() => rangosRapidos(), []);

  const cuotaDe = (a: AnticipoPrestamo) => (a.cuota_sugerida != null ? money(a.cuota_sugerida) : '—');

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.personal_id) { setError('Elegí el trabajador.'); return; }
    if (!(Number(form.monto_total) > 0)) { setError('Indicá el monto.'); return; }
    if ((form.ya_pagado ?? 0) > Number(form.monto_total)) { setError('Lo ya pagado no puede superar el monto del préstamo.'); return; }
    setGuardando(true);
    try {
      await crearAnticipo(form, actor, actorName);
      toast('Registrado', 'success');
      setForm(VACIO()); setAbrirForm(false);
      await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  async function confirmarBorrado() {
    if (!porBorrar) return;
    try { await eliminarAnticipo(porBorrar.id); setPorBorrar(null); await recargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setPorBorrar(null); }
  }

  async function verConsolidado() {
    try {
      const { verConsolidadoPrestamosPdf } = await import('./prestamosPdf');
      await verConsolidadoPrestamosPdf(deudas, { desde: filtro.desde, hasta: filtro.hasta }, empresa);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const esHistoricoForm = !!form.fecha && form.fecha < hoyIso();

  return (
    <div>
      {/* ── Las dos tarjetas. Se tocan. ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '.7rem', marginBottom: '.9rem' }}>
        <TarjetaPrestamos
          rotulo="Total préstamos pendientes"
          valor={money(resumen.totalPendiente)}
          pie={`${resumen.prestamosAbiertos} préstamo(s) sin saldar`}
          color="var(--danger)"
          onClick={() => setVerPendientes(true)}
        />
        <TarjetaPrestamos
          rotulo="Trabajadores con préstamos pendientes"
          valor={String(resumen.trabajadoresConSaldo)}
          pie={resumen.trabajadoresConSaldo === 1 ? 'persona debiendo' : 'personas debiendo'}
          color="var(--warning)"
          onClick={() => setVerTrabajadores(true)}
        />
        <TarjetaPrestamos
          rotulo="Prestado / cobrado en lo filtrado"
          valor={money(resumen.totalPrestado)}
          pie={`cobrado ${money(resumen.totalPagado)}`}
          color="var(--primary)"
        />
      </div>

      {/* ── Filtros ── */}
      <div className="card" style={{ padding: '.7rem .85rem', marginBottom: '.8rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ flex: '2 1 220px', margin: 0 }}>
            <label>Buscar</label>
            <input className="input" value={filtro.texto ?? ''} placeholder="Nombre del trabajador o motivo…"
              onChange={(e) => setFiltro((f) => ({ ...f, texto: e.target.value }))} />
          </div>
          <div className="form-row" style={{ flex: '1 1 180px', margin: 0 }}>
            <label>Trabajador</label>
            <select className="select" value={filtro.trabajadorId ?? ''} onChange={(e) => setFiltro((f) => ({ ...f, trabajadorId: e.target.value }))}>
              <option value="">— todos —</option>
              {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '0 1 130px', margin: 0 }}>
            <label>Tipo</label>
            <select className="select" value={filtro.tipo ?? ''} onChange={(e) => setFiltro((f) => ({ ...f, tipo: e.target.value as FiltroPrestamos['tipo'] }))}>
              <option value="">Todos</option>
              <option value="anticipo">Anticipo</option>
              <option value="prestamo">Préstamo</option>
            </select>
          </div>
          <div className="form-row" style={{ flex: '0 1 130px', margin: 0 }}>
            <label>Estado</label>
            <select className="select" value={filtro.estado ?? 'todos'} onChange={(e) => setFiltro((f) => ({ ...f, estado: e.target.value as FiltroPrestamos['estado'] }))}>
              <option value="todos">Todos</option>
              <option value="activos">Con saldo</option>
              <option value="saldados">Saldados</option>
            </select>
          </div>
          <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
            <label>Desde</label>
            <input className="input" type="date" value={filtro.desde ?? ''} onChange={(e) => setFiltro((f) => ({ ...f, desde: e.target.value }))} />
          </div>
          <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
            <label>Hasta</label>
            <input className="input" type="date" value={filtro.hasta ?? ''} onChange={(e) => setFiltro((f) => ({ ...f, hasta: e.target.value }))} />
          </div>
        </div>

        {/* Los rangos que se piden siempre, ya calculados: escribir dos fechas
            a mano para ver «este mes» es pedirle la cuenta del calendario. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.5rem', alignItems: 'center' }}>
          {rangos.map((r) => (
            <button key={r.key} type="button"
              className={`btn btn-sm ${filtro.desde === r.desde && filtro.hasta === r.hasta ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltro((f) => ({ ...f, desde: r.desde, hasta: r.hasta }))}>{r.label}</button>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMasFiltros((v) => !v)}>
            {masFiltros ? '▴ Menos filtros' : '▾ Más filtros'}
          </button>
          {hayFiltro(filtro) && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
              onClick={() => setFiltro(FILTRO_PRESTAMOS_VACIO)}>✕ Limpiar</button>
          )}
          <span className="muted" style={{ marginLeft: 'auto', fontSize: '.82rem' }}>
            {visibles.length} de {lista.length} · {pagosVisibles.length} abono(s) en el rango
          </span>
        </div>

        {masFiltros && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.5rem', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
              <label>Monto desde</label>
              <input className="input mono" type="number" step="any" min={0} value={filtro.montoMin ?? ''}
                onChange={(e) => setFiltro((f) => ({ ...f, montoMin: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
            </div>
            <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
              <label>Monto hasta</label>
              <input className="input mono" type="number" step="any" min={0} value={filtro.montoMax ?? ''}
                onChange={(e) => setFiltro((f) => ({ ...f, montoMax: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
            </div>
            <div className="form-row" style={{ flex: '0 1 170px', margin: 0 }}>
              <label>Debe al menos</label>
              <input className="input mono" type="number" step="any" min={0} value={filtro.saldoMin ?? ''}
                onChange={(e) => setFiltro((f) => ({ ...f, saldoMin: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
            </div>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem', paddingBottom: '.4rem' }}>
              <input type="checkbox" checked={!!filtro.soloHistoricos}
                onChange={(e) => setFiltro((f) => ({ ...f, soloHistoricos: e.target.checked }))} />
              Solo cargas históricas
            </label>
          </div>
        )}
      </div>

      {/* ── Acciones ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.7rem' }}>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => { setForm(VACIO()); setError(null); setAbrirForm(true); }}>
            + Registrar préstamo o anticipo
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => void verConsolidado()} disabled={!deudas.length}>
          📄 Consolidado en PDF
        </button>
      </div>

      {/* ── Tabla ── */}
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead>
            <tr>
              <th>Trabajador</th><th>Tipo</th><th>Fecha</th><th>Motivo</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Pagado</th>
              <th style={{ textAlign: 'right' }}>Debe</th>
              <th style={{ textAlign: 'center' }}>Cuota</th>
              <th style={{ textAlign: 'center' }}>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !visibles.length && (
              <tr><td colSpan={10}>
                <EmptyState message={hayFiltro(filtro) ? 'Nada con esos filtros' : 'Sin préstamos ni anticipos'} icon="💵" />
              </td></tr>
            )}
            {!loading && visibles.map((a) => {
              const pagado = (pagosDe.get(a.id) ?? []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
              return (
                <tr key={a.id} style={{ opacity: Number(a.saldo) > 0 ? 1 : 0.6 }}>
                  <td>
                    <button className="btn-link" style={{ padding: 0, textAlign: 'left' }} onClick={() => setCuentaDe(a.personal_id)}>
                      {nombreDe(a.personal_id)}
                    </button>
                  </td>
                  <td>
                    <span className="badge">{a.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'}</span>
                    {esHistorico(a) && <span className="badge" title="Cargado después de que se dio" style={{ marginLeft: '.25rem' }}>histórico</span>}
                  </td>
                  <td className="muted mono">{date(fechaDePrestamo(a))}</td>
                  <td className="muted">{a.motivo || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(a.monto_total)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(pagado)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: Number(a.saldo) > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{money(a.saldo)}</td>
                  <td className="mono muted" style={{ textAlign: 'center' }}>{cuotaDe(a)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="badge" style={{ color: Number(a.saldo) > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {Number(a.saldo) > 0 ? 'Activo' : 'Saldado'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setDetalle(a)} title="Abonos y detalle">💵 Abonos</button>
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setPorBorrar(a)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Alta ── */}
      {abrirForm && (
        <Modal title="Registrar préstamo o anticipo" size="lg" onClose={() => setAbrirForm(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAbrirForm(false)} disabled={guardando}>Cancelar</button>
            <button type="submit" form="form-anticipo" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : '+ Registrar'}
            </button>
          </>}>
          <form id="form-anticipo" onSubmit={guardar}>
            {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
            <div className="form-grid">
              <div className="form-row">
                <label>Trabajador</label>
                <select className="select" value={form.personal_id} onChange={(e) => setForm((f) => ({ ...f, personal_id: e.target.value }))} required>
                  <option value="">— elegir —</option>
                  {personal.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Tipo</label>
                <select className="select" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as 'anticipo' | 'prestamo' }))}>
                  <option value="anticipo">Anticipo</option>
                  <option value="prestamo">Préstamo</option>
                </select>
              </div>
              <div className="form-row">
                <label>Fecha en que se dio</label>
                <input className="input" type="date" max={hoyIso()} value={form.fecha ?? hoyIso()}
                  onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
                <small className="muted">
                  {esHistoricoForm
                    ? 'Queda marcado como carga histórica. Los filtros por fecha lo ubican en el mes en que se dio, no en hoy.'
                    : 'Poné una fecha anterior para cargar un préstamo viejo.'}
                </small>
              </div>
              <div className="form-row">
                <label>Monto total (USD)</label>
                <input className="input mono" type="number" min={0} step="any" value={form.monto_total || ''} required
                  onChange={(e) => setForm((f) => ({ ...f, monto_total: Number(e.target.value) || 0 }))} placeholder="0,00" />
              </div>
              <div className="form-row">
                <label>Ya pagado a la fecha (opcional)</label>
                <input className="input mono" type="number" min={0} step="any" value={form.ya_pagado ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, ya_pagado: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
                <small className="muted">
                  Para el histórico: entra como un abono, no como un monto más chico. Así queda en el estado de cuenta.
                </small>
              </div>
              <div className="form-row">
                <label>Cuota sugerida por quincena (opcional)</label>
                <input className="input mono" type="number" min={0} step="any" value={form.cuota_sugerida ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, cuota_sugerida: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
              </div>
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label>Motivo</label>
                <input className="input" value={form.motivo ?? ''} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
                  placeholder="Adelanto de quincena, préstamo personal…" />
              </div>
            </div>
            {Number(form.monto_total) > 0 && (
              <div className="card" style={{ padding: '.5rem .7rem', marginTop: '.5rem', background: 'var(--bg-1)', borderLeft: '3px solid var(--primary)' }}>
                <span className="mono" style={{ fontSize: '.85rem' }}>
                  Total {money(form.monto_total)} · pagado {money(form.ya_pagado ?? 0)} ·{' '}
                  <strong>debe {money(Math.max(0, Number(form.monto_total) - Number(form.ya_pagado ?? 0)))}</strong>
                </span>
              </div>
            )}
            <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>
              El saldo se descuenta solo al pagar la nómina, hasta saldar. Los abonos por fuera se cargan desde 💵 Abonos.
            </small>
          </form>
        </Modal>
      )}

      {/* ── Detalle de las tarjetas ── */}
      {verPendientes && (
        <Modal title={`Préstamos pendientes · ${money(resumen.totalPendiente)}`} size="lg" onClose={() => setVerPendientes(false)}>
          <ListaPendientes
            prestamos={visibles.filter((p) => Number(p.saldo) > 0)}
            pagosDe={pagosDe} nombreDe={nombreDe}
            onAbrir={(a) => { setVerPendientes(false); setDetalle(a); }}
            onPersona={(id) => { setVerPendientes(false); setCuentaDe(id); }}
          />
        </Modal>
      )}

      {verTrabajadores && (
        <Modal title={`Trabajadores con préstamos pendientes · ${resumen.trabajadoresConSaldo}`} size="lg" onClose={() => setVerTrabajadores(false)}>
          <ListaTrabajadores
            deudas={deudas.filter((d) => d.debe > 0)}
            personaPorId={personaPorId}
            onPersona={(id) => { setVerTrabajadores(false); setCuentaDe(id); }}
          />
        </Modal>
      )}

      {/* ── Abonos de un préstamo ── */}
      {detalle && (
        <AbonosModal
          prestamo={detalle}
          pagos={pagosDe.get(detalle.id) ?? []}
          nombre={nombreDe(detalle.personal_id)}
          canWrite={canWrite} actor={actor} actorName={actorName}
          onClose={() => setDetalle(null)}
          onCambio={() => void recargar()}
        />
      )}

      {/* ── Estado de cuenta de una persona ── */}
      {cuentaDe && personaPorId.get(cuentaDe) && (
        <EstadoCuentaModal
          persona={personaPorId.get(cuentaDe)!}
          prestamos={lista}
          pagos={pagos}
          rango={{ desde: filtro.desde, hasta: filtro.hasta }}
          onAbrirPrestamo={(a) => { setCuentaDe(null); setDetalle(a); }}
          onClose={() => setCuentaDe(null)}
        />
      )}

      {porBorrar && (
        <ConfirmDialog
          title="Eliminar préstamo"
          message={`¿Eliminar este ${porBorrar.tipo === 'anticipo' ? 'anticipo' : 'préstamo'} de ${nombreDe(porBorrar.personal_id)}? Se borran también sus abonos, incluidos los descontados en la nómina.`}
          confirmText="Eliminar" danger
          onConfirm={() => void confirmarBorrado()}
          onCancel={() => setPorBorrar(null)} />
      )}
    </div>
  );
}

/* ───────────────────── Piezas ───────────────────── */

/** Una tarjeta del tablero. Con `onClick` se ve y se comporta como un botón. */
function TarjetaPrestamos({ rotulo, valor, pie, color, onClick }: {
  rotulo: string; valor: string; pie: string; color: string; onClick?: () => void;
}) {
  const contenido = (
    <>
      <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{rotulo}</div>
      <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color, margin: '.15rem 0' }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.78rem' }}>{pie}{onClick ? ' · tocá para ver el detalle' : ''}</div>
    </>
  );
  if (!onClick) return <div className="card" style={{ padding: '.75rem .9rem' }}>{contenido}</div>;
  return (
    <button type="button" className="card" onClick={onClick}
      style={{ padding: '.75rem .9rem', textAlign: 'left', cursor: 'pointer', borderLeft: `3px solid ${color}`, width: '100%' }}>
      {contenido}
    </button>
  );
}

/** El detalle de la tarjeta de pendientes: cada préstamo abierto, clickeable. */
function ListaPendientes({ prestamos, pagosDe, nombreDe, onAbrir, onPersona }: {
  prestamos: AnticipoPrestamo[];
  pagosDe: Map<string, { monto: number }[]>;
  nombreDe: (id: string) => string;
  onAbrir: (a: AnticipoPrestamo) => void;
  onPersona: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const filtrados = prestamos.filter((p) => {
    const t = q.trim().toLowerCase();
    return !t || `${nombreDe(p.personal_id)} ${p.motivo ?? ''}`.toLowerCase().includes(t);
  });
  if (!prestamos.length) return <EmptyState message="No hay préstamos pendientes" icon="✅" />;
  return (
    <>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por trabajador o motivo…" style={{ marginBottom: '.6rem' }} />
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Trabajador</th><th>Tipo</th><th>Fecha</th><th>Motivo</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Pagado</th><th style={{ textAlign: 'right' }}>Debe</th><th></th></tr></thead>
          <tbody>
            {!filtrados.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Nada con esa búsqueda</td></tr>}
            {filtrados.map((a) => (
              <tr key={a.id}>
                <td><button className="btn-link" style={{ padding: 0 }} onClick={() => onPersona(a.personal_id)}>{nombreDe(a.personal_id)}</button></td>
                <td><span className="badge">{a.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'}</span></td>
                <td className="muted mono">{date(fechaDePrestamo(a))}</td>
                <td className="muted">{a.motivo || '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(a.monto_total)}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>
                  {money((pagosDe.get(a.id) ?? []).reduce((s, p) => s + (Number(p.monto) || 0), 0))}
                </td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 700 }}>{money(a.saldo)}</td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => onAbrir(a)}>💵 Abonos</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** El detalle de la tarjeta de trabajadores: la lista buscable de quién debe. */
function ListaTrabajadores({ deudas, personaPorId, onPersona }: {
  deudas: DeudaTrabajador[];
  personaPorId: Map<string, Personal>;
  onPersona: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const filtradas = deudas.filter((d) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const p = personaPorId.get(d.personalId);
    return `${d.nombre} ${p?.cedula ?? ''} ${p?.cargo ?? ''} ${p?.departamento ?? ''} ${p?.numero_ficha ?? ''}`.toLowerCase().includes(t);
  });
  if (!deudas.length) return <EmptyState message="Nadie tiene préstamos pendientes" icon="✅" />;
  return (
    <>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, cédula, ficha, cargo o departamento…" style={{ marginBottom: '.6rem' }} />
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Trabajador</th><th>Ficha</th><th>Cargo</th><th style={{ textAlign: 'center' }}>Préstamos</th><th>Desde</th><th style={{ textAlign: 'right' }}>Prestado</th><th style={{ textAlign: 'right' }}>Pagado</th><th style={{ textAlign: 'right' }}>Debe</th></tr></thead>
          <tbody>
            {!filtradas.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Nadie con esa búsqueda</td></tr>}
            {filtradas.map((d) => {
              const p = personaPorId.get(d.personalId);
              return (
                <tr key={d.personalId}>
                  <td><button className="btn-link" style={{ padding: 0, textAlign: 'left' }} onClick={() => onPersona(d.personalId)}>{d.nombre}</button></td>
                  <td className="mono muted">{p?.numero_ficha || '—'}</td>
                  <td className="muted">{p?.cargo || <span style={{ color: 'var(--warning)' }}>Sin cargo</span>}</td>
                  <td style={{ textAlign: 'center' }}>{d.abiertos}</td>
                  <td className="muted mono">{d.desde ? date(d.desde) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(d.total)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(d.pagado)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 700 }}>{money(d.debe)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Los abonos de UN préstamo: los que hay, y el formulario para cargar otro. */
function AbonosModal({ prestamo, pagos, nombre, canWrite, actor, actorName, onClose, onCambio }: {
  prestamo: AnticipoPrestamo;
  pagos: PagoAnticipo[];
  nombre: string;
  canWrite: boolean; actor: string; actorName: string | null;
  onClose: () => void; onCambio: () => void;
}) {
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoyIso());
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [porBorrar, setPorBorrar] = useState<PagoAnticipo | null>(null);
  const [editando, setEditando] = useState(false);
  const [edFecha, setEdFecha] = useState(fechaDePrestamo(prestamo));
  const [edMonto, setEdMonto] = useState(String(prestamo.monto_total ?? ''));
  const [edMotivo, setEdMotivo] = useState(prestamo.motivo ?? '');

  const pagado = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const debe = Number(prestamo.saldo) || 0;

  async function guardarEdicion(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await editarAnticipo(prestamo.id, {
        fecha: edFecha, monto_total: Number(edMonto) || 0, motivo: edMotivo,
      });
      setEditando(false);
      toast('Préstamo corregido', 'success');
      onCambio();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'No se pudo corregir'); }
    finally { setBusy(false); }
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const malo = errorPago(monto, debe, fecha);
    if (malo) { setErr(malo); return; }
    setBusy(true); setErr(null);
    try {
      await agregarPagoAnticipo({
        anticipo_id: prestamo.id, monto: Number(monto), fecha,
        origen: fecha < hoyIso() ? 'historico' : 'manual',
        nota,
      }, actor, actorName);
      setMonto(''); setNota(''); setFecha(hoyIso());
      toast('Abono cargado', 'success');
      onCambio();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'No se pudo cargar el abono'); }
    finally { setBusy(false); }
  }

  async function borrar() {
    if (!porBorrar) return;
    try { await eliminarPagoAnticipo(porBorrar); setPorBorrar(null); toast('Abono borrado', 'success'); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); setPorBorrar(null); }
  }

  return (
    <Modal title={`Abonos · ${nombre}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ padding: '.6rem .8rem', marginBottom: '.7rem', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'baseline' }}>
          <div className="mono" style={{ fontSize: '.9rem' }}>
            {prestamo.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'} del <strong>{date(fechaDePrestamo(prestamo))}</strong> ·{' '}
            total {money(prestamo.monto_total)} · pagado <span style={{ color: 'var(--success)' }}>{money(pagado)}</span> ·{' '}
            debe <strong style={{ color: debe > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(debe)}</strong>
          </div>
          {canWrite && !editando && (
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setEditando(true)}>✎ Corregir</button>
          )}
        </div>
        {prestamo.motivo && !editando && <div className="muted" style={{ fontSize: '.82rem', marginTop: '.2rem' }}>{prestamo.motivo}</div>}

        {/* Corregir el préstamo. Con carga histórica, equivocarse en la fecha o
            en el monto es lo más probable que pase, y sin esto habría que
            borrar todo y volver a cargar los abonos uno por uno. */}
        {editando && (
          <form onSubmit={guardarEdicion} style={{ marginTop: '.5rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
              <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
                <label>Fecha en que se dio</label>
                <input className="input" type="date" max={hoyIso()} value={edFecha} onChange={(e) => setEdFecha(e.target.value)} />
              </div>
              <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
                <label>Monto total</label>
                <input className="input mono" type="number" min={0} step="any" value={edMonto} onChange={(e) => setEdMonto(e.target.value)} />
              </div>
              <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
                <label>Motivo</label>
                <input className="input" value={edMotivo} onChange={(e) => setEdMotivo(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Guardar</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditando(false); setErr(null); }}>Cancelar</button>
            </div>
            <small className="muted">El monto no puede quedar por debajo de lo ya abonado ({money(pagado)}).</small>
          </form>
        )}
      </div>

      {/* Fuera de los dos formularios: un error al corregir con el préstamo ya
          saldado no tendría dónde mostrarse, porque el de abonar no se dibuja. */}
      {err && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {err}</div>}

      {canWrite && debe > 0 && (
        <form onSubmit={agregar} style={{ marginBottom: '.8rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
              <label>Monto del abono</label>
              <input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" required />
            </div>
            <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
              <label>Fecha</label>
              <input className="input" type="date" max={hoyIso()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: '1 1 220px', margin: 0 }}>
              <label>Nota (opcional)</label>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Efectivo, transferencia…" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '…' : '+ Abonar'}</button>
          </div>
          <small className="muted">Con una fecha anterior queda marcado como carga histórica. Máximo {money(debe)}.</small>
        </form>
      )}

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Fecha</th><th>Origen</th><th>Nota</th><th style={{ textAlign: 'right' }}>Monto</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {!pagos.length && <tr><td colSpan={5}><EmptyState message="Todavía no se abonó nada" icon="💵" /></td></tr>}
            {pagos.map((p) => (
              <tr key={p.id}>
                <td className="mono muted">{date(p.fecha)}</td>
                <td><span className="badge">{labelOrigen(p.origen)}</span></td>
                <td className="muted">{p.nota || '—'}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(p.monto)}</td>
                {canWrite && (
                  <td style={{ textAlign: 'right' }}>
                    {/* Los de nómina no se borran acá: los generó un pago real
                        del sueldo y borrarlos diría que se debe plata que sí
                        se descontó. Eso se revierte anulando ese pago. */}
                    {p.origen === 'nomina'
                      ? <span className="muted" title="Se revierte anulando el pago de la nómina" style={{ fontSize: '.78rem' }}>de nómina</span>
                      : <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setPorBorrar(p)} title="Borrar abono">🗑</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {porBorrar && (
        <ConfirmDialog
          title="Borrar abono"
          message={`¿Borrar el abono de ${money(porBorrar.monto)} del ${date(porBorrar.fecha)}? El saldo del préstamo vuelve a subir.`}
          confirmText="Borrar" danger
          onConfirm={() => void borrar()} onCancel={() => setPorBorrar(null)} />
      )}
    </Modal>
  );
}

/** El estado de cuenta de una persona, con su PDF. */
function EstadoCuentaModal({ persona, prestamos, pagos, rango, onAbrirPrestamo, onClose }: {
  persona: Personal;
  prestamos: AnticipoPrestamo[];
  pagos: PagoAnticipo[];
  rango: { desde?: string; hasta?: string };
  onAbrirPrestamo: (a: AnticipoPrestamo) => void;
  onClose: () => void;
}) {
  const [abriendo, setAbriendo] = useState(false);
  // Sin filtrar por fecha: el estado de cuenta de una persona es TODO lo que
  // debe. Recortarlo a un mes daría un «debe» que no es el que se le cobra.
  const ec = useMemo(() => estadoDeCuenta(persona.id, prestamos, pagos), [persona.id, prestamos, pagos]);

  async function pdf() {
    setAbriendo(true);
    try {
      const { verEstadoCuentaPrestamosPdf } = await import('./prestamosPdf');
      await verEstadoCuentaPrestamosPdf(persona, prestamos, pagos, rango);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setAbriendo(false); }
  }

  return (
    <Modal title={`Estado de cuenta · ${nombreDeCarnet(persona.nombre, persona.apellido)}`} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={() => void pdf()} disabled={abriendo}>
          {abriendo ? 'Generando…' : '📄 Ver en PDF'}
        </button>
      </>}>
      <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.6rem' }}>
        {numeroFicha(persona.numero_ficha)}
        {persona.cedula ? ` · C.I. ${persona.cedula}` : ''}
        {persona.cargo ? ` · ${persona.cargo}` : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem', marginBottom: '.8rem' }}>
        <TarjetaPrestamos rotulo="Total prestado" valor={money(ec.total)} pie={`${ec.renglones.length} movimiento(s)`} color="var(--text)" />
        <TarjetaPrestamos rotulo="Total pagado" valor={money(ec.pagado)} pie="abonado hasta hoy" color="var(--success)" />
        <TarjetaPrestamos rotulo="Debe" valor={money(ec.debe)} pie={`${ec.abiertos} sin saldar`} color={ec.debe > 0 ? 'var(--danger)' : 'var(--success)'} />
      </div>

      {!ec.renglones.length && <EmptyState message="Sin préstamos ni anticipos" icon="💵" />}

      {ec.renglones.map((r) => (
        <div key={r.prestamo.id} className="card" style={{ padding: '.6rem .8rem', marginBottom: '.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'baseline' }}>
            <strong>{r.prestamo.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'}</strong>
            <span className="muted mono">{date(fechaDePrestamo(r.prestamo))}</span>
            <span className="mono" style={{ marginLeft: 'auto' }}>
              {money(r.prestamo.monto_total)} · pagado <span style={{ color: 'var(--success)' }}>{money(r.pagado)}</span> ·{' '}
              debe <strong style={{ color: r.debe > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(r.debe)}</strong>
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => onAbrirPrestamo(r.prestamo as AnticipoPrestamo)}>💵 Abonos</button>
          </div>
          {r.prestamo.motivo && <div className="muted" style={{ fontSize: '.82rem' }}>{r.prestamo.motivo}</div>}
          {!!r.pagos.length && (
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>
              {r.pagos.map((p) => `${date(p.fecha)} ${money(p.monto)} (${labelOrigen(p.origen)})`).join(' · ')}
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}
