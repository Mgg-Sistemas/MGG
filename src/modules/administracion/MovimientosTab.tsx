/* ============================================================
   Golden Touch · Administración · pestaña «Movimientos / Histórico»
   El histórico de egresos: lista con búsqueda y filtro por estado, «Generar
   pendientes» (→ Tesorería), alta/edición manual, anular, marcar pagado e
   importación (Excel/CSV con validación). Estilo del sistema.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { norm } from '@/shared/lib/texto';
import { tokenPeriodo, type Moneda } from './administracionCalculo';
import { cargarTasaBcv } from './administracionTasa';
import { ImportarAdminModal } from './ImportarAdminModal';
import { ParafiscalModal } from './ParafiscalModal';
import { ExportarAdministracionModal } from './ExportarAdministracionModal';
import type { AdminRepo, Empresa, Movimiento, OpcionRef } from './admin.repository';

const fFecha = new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const montoFmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORIGEN_LABEL: Record<Movimiento['origen'], string> = { generado: 'Generado', importado: 'Importado', manual: 'Manual' };
const ESTADO_LABEL: Record<Movimiento['estadoPago'], string> = { pagado: 'Pagado', pendiente: 'Pendiente', anulado: 'Anulado' };
const periodoLabel = (() => {
  const s = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric' }).format(new Date()).replace(' de ', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
})();

export function MovimientosTab({ repo, empresaClave, empresas, puedeEscribir = true }: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
  /** Sin escritura: lista de solo lectura (sin generar/importar/registrar/editar/anular/pagar). */
  puedeEscribir?: boolean;
}) {
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [categorias, setCategorias] = useState<OpcionRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [form, setForm] = useState<{ mov: Movimiento | null } | null>(null);
  const [importar, setImportar] = useState(false);
  const [reporteModal, setReporteModal] = useState(false);
  const [tasaBcv, setTasaBcv] = useState(50);
  const [parafiscal, setParafiscal] = useState(false);
  const [anular, setAnular] = useState<Movimiento | null>(null);
  const [borrar, setBorrar] = useState<Movimiento | null>(null);
  const [buscar, setBuscar] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | Movimiento['estadoPago']>('todos');

  const nombreCat = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);
  const nombreEmp = useMemo(() => new Map(empresas.map((e) => [e.clave, e.nombre])), [empresas]);
  const mostrarEmpresa = empresaClave == null;

  const cargar = useCallback(async () => {
    // Tesoreria es quien paga: antes de pintar, se trae de alla el estado de lo ya
    // enviado. Si no, Administracion mostraria «pendiente» algo ya pagado.
    await repo.refrescarMovimientos(empresaClave || undefined).catch(() => { /* sin conexion: se vera el estado guardado */ });
    setCargando(true);
    setError(null);
    try {
      const [ms, cats, tasa] = await Promise.all([
        repo.listMovimientos(empresaClave ?? undefined),
        repo.listCategorias().catch(() => [] as OpcionRef[]),
        cargarTasaBcv().catch(() => ({ tasa: 50 })),
      ]);
      setMovs(ms);
      setCategorias(cats);
      setTasaBcv(tasa.tasa);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer los movimientos.');
    } finally {
      setCargando(false);
    }
  }, [repo, empresaClave]);
  useEffect(() => { void cargar(); }, [cargar]);

  const vista = useMemo(() => {
    const q = norm(buscar);
    return movs.filter((m) =>
      (filtroEstado === 'todos' || m.estadoPago === filtroEstado)
      && (!q || norm(`${m.concepto} ${m.empresaClave} ${m.proveedorNombre ?? ''} ${m.periodo}`).includes(q)));
  }, [movs, buscar, filtroEstado]);

  async function generar() {
    setGenerando(true);
    try {
      const { creados, enTesoreria } = await repo.generarPendientes(empresaClave ?? undefined);
      // Se dice lo que PASO, no lo que se esperaba que pasara.
      if (!creados) toast('No había pendientes nuevos para este período.', 'info');
      else if (enTesoreria === creados) toast(`Se generaron ${creados} pendiente(s) y llegaron a Tesorería.`, 'success');
      else if (enTesoreria === 0) toast(`Se generaron ${creados} pendiente(s), pero NINGUNO llegó a Tesorería. Envíalos con el botón «Enviar a Tesorería».`, 'warning');
      else toast(`Se generaron ${creados} pendiente(s); ${enTesoreria} llegaron a Tesorería y ${creados - enTesoreria} no. Envía esos con el botón «Enviar a Tesorería».`, 'warning');
      if (creados) await cargar();
    } catch (e) {
      toast(`No se pudieron generar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setGenerando(false);
    }
  }
  /**
   * Administracion NO paga: manda el pendiente a Tesoreria y despues mira el
   * estado y el comprobante. Antes habia un boton «Pagar» que marcaba el
   * movimiento como pagado sin que Tesoreria se enterara.
   */
  async function enviarATesoreria(m: Movimiento) {
    try {
      await repo.enviarMovimientoATesoreria(m);
      toast('Enviado a Tesorería como cuenta por pagar.', 'success');
      await cargar();
    } catch (e) {
      toast(`No se pudo enviar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    }
  }

  async function verComprobante(m: Movimiento) {
    try {
      const url = await repo.urlComprobanteMovimiento(m);
      if (!url) { toast('Tesorería todavía no cargó el comprobante.', 'info'); return; }
      window.open(url, '_blank', 'noopener');
    } catch { toast('No se pudo abrir el comprobante.', 'error'); }
  }
  async function confirmarAnular() {
    if (!anular) return;
    try { await repo.anularMovimiento(anular.id); toast('Movimiento anulado.', 'success'); await cargar(); }
    catch (e) { toast(`No se pudo anular: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setAnular(null); }
  }
  async function confirmarBorrar() {
    if (!borrar) return;
    try { await repo.borrarMovimiento(borrar.id); toast('Movimiento eliminado.', 'success'); await cargar(); }
    catch (e) { toast(`No se pudo eliminar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setBorrar(null); }
  }

  return (
    <>
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>Movimientos / Histórico {empresaClave ? `· ${nombreEmp.get(empresaClave) ?? empresaClave}` : '· todas las empresas'}</span>
          {puedeEscribir && (
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void generar()} disabled={generando}
                title={`Crea los pendientes que falten hasta ${periodoLabel} y los manda a Tesorería`}>⚙ Generar pendientes</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportar(true)}>⬆ Importar</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReporteModal(true)} disabled={!movs.length} title="Abrir reporte dinámico y exportación">📊 Reporte Dinámico</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParafiscal(true)}
                title="Calcular y registrar un parafiscal (FAOV / BANAVIH)">⚖ Parafiscal</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm({ mov: null })}>+ Registrar</button>
            </div>
          )}
        </div>

        {/* Búsqueda + filtro por estado */}
        {!cargando && movs.length > 0 && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.5rem' }}>
            <input className="input" style={{ maxWidth: 280 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="🔍 Buscar concepto, empresa, proveedor…" aria-label="Buscar movimiento" />
            <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)} style={{ maxWidth: 150 }} aria-label="Filtrar por estado">
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendientes</option>
              <option value="pagado">Pagados</option>
              <option value="anulado">Anulados</option>
            </select>
            <span className="muted mono" style={{ marginLeft: 'auto', fontSize: '.78rem' }}>{vista.length} de {movs.length}</span>
          </div>
        )}

        {error && <div className="adm-aviso" style={{ marginTop: '.5rem' }}>No se pudo leer: {/sesi|jwt|auth|401|permission|relation|does not exist/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>}

        {cargando ? (
          <p className="muted" style={{ marginTop: '.5rem' }}>Leyendo movimientos…</p>
        ) : movs.length === 0 && !error ? (
          <EmptyState icon="📒" message="No hay movimientos. Use «Generar pendientes», «Importar» o «Registrar»." />
        ) : vista.length === 0 ? (
          <p className="muted" style={{ marginTop: '.6rem' }}>Ningún movimiento coincide con el filtro.</p>
        ) : (
          <div className="adm-tabla" style={{ marginTop: '.6rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  {mostrarEmpresa && <th>Empresa</th>}
                  <th>Concepto</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th>Período</th>
                  <th>Categoría</th>
                  <th>Estado</th>
                  <th>Origen</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {vista.map((m) => (
                  <tr key={m.id} className={m.estadoPago === 'anulado' ? 'adm-fila-off' : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fFecha.format(new Date(`${m.fecha}T00:00:00`))}</td>
                    {mostrarEmpresa && <td className="mono">{m.empresaClave}</td>}
                    <td>{m.concepto}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{montoFmt(m.monto)} {m.moneda}</td>
                    <td className="mono">{m.periodo}</td>
                    <td>{m.categoriaGastoId && nombreCat.get(m.categoriaGastoId) ? <span className="adm-chip">{nombreCat.get(m.categoriaGastoId)}</span> : '—'}</td>
                    <td><span className={`adm-badge pago-${m.estadoPago}`}>{ESTADO_LABEL[m.estadoPago]}</span></td>
                    <td className="muted" style={{ fontSize: '.82rem' }}>{ORIGEN_LABEL[m.origen]}{m.servicioDirectoId ? ' · en Tesorería' : ''}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {puedeEscribir && (
                        <>
                          {m.estadoPago !== 'anulado' && (
                            <>
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm({ mov: m })}>Editar</button>
                              {m.estadoPago === 'pendiente' && !m.servicioDirectoId && (
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void enviarATesoreria(m)}
                                  title="Lo manda a Tesorería como cuenta por pagar. Administración no paga.">
                                  Enviar a Tesorería
                                </button>
                              )}
                              {m.servicioDirectoId && (
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void verComprobante(m)}
                                  title="Comprobante que cargó Tesorería al pagar">
                                  Comprobante
                                </button>
                              )}
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAnular(m)}>Anular</button>
                            </>
                          )}
                          {!m.servicioDirectoId && (
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              style={{ color: '#ef4444' }}
                              onClick={() => setBorrar(m)}
                              title="Eliminar movimiento definitivamente"
                            >
                              Eliminar
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <MovimientoFormModal repo={repo} empresas={empresas} empresaClaveFija={empresaClave} categorias={categorias}
          movimiento={form.mov} onClose={() => setForm(null)} onSaved={() => void cargar()} />
      )}
      {reporteModal && (
        <ExportarAdministracionModal
          movimientos={movs}
          empresas={empresas}
          categorias={categorias}
          empresaClaveInicial={empresaClave}
          tasaBcvHoy={tasaBcv}
          onClose={() => setReporteModal(false)}
        />
      )}

      {importar && (
        <ImportarAdminModal repo={repo} empresas={empresas} categorias={categorias}
          existentes={movs.map((m) => ({ empresaClave: m.empresaClave, periodo: m.periodo, concepto: m.concepto }))}
          onClose={() => setImportar(false)} onImportado={() => void cargar()} />
      )}
      {parafiscal && (
        <ParafiscalModal repo={repo} empresas={empresas} empresaClaveFija={empresaClave} categorias={categorias}
          onClose={() => setParafiscal(false)} onSaved={() => void cargar()} />
      )}
      {anular && (
        <ConfirmDialog
          title="Anular movimiento"
          danger
          message={<>Se anulará <strong>{anular.concepto}</strong> ({montoFmt(anular.monto)} {anular.moneda}, {anular.periodo}). Queda registrado pero sale de los totales del reporte.</>}
          confirmText="Anular"
          onCancel={() => setAnular(null)}
          onConfirm={() => void confirmarAnular()}
        />
      )}
      {borrar && (
        <ConfirmDialog
          title="Eliminar movimiento"
          danger
          message={<>¿Estás seguro de que deseas eliminar permanentemente <strong>{borrar.concepto}</strong> ({montoFmt(borrar.monto)} {borrar.moneda}, {borrar.periodo})? Esta acción lo borra de la base de datos y de la agenda de vencimientos.</>}
          confirmText="Eliminar definitivamente"
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      )}
    </>
  );
}

/* ───────── Alta / edición manual ───────── */
function MovimientoFormModal({ repo, empresas, empresaClaveFija, categorias, movimiento, onClose, onSaved }: {
  repo: AdminRepo; empresas: Empresa[]; empresaClaveFija: string | null; categorias: OpcionRef[];
  movimiento: Movimiento | null; onClose: () => void; onSaved: () => void;
}) {
  const edit = movimiento != null;
  const activas = empresas.filter((e) => e.activa || e.clave === movimiento?.empresaClave);
  const [empresaClave, setEmpresaClave] = useState(movimiento?.empresaClave ?? empresaClaveFija ?? activas[0]?.clave ?? '');
  const [concepto, setConcepto] = useState(movimiento?.concepto ?? '');
  const [proveedor, setProveedor] = useState(movimiento?.proveedorNombre ?? '');
  const [monto, setMonto] = useState(movimiento ? String(movimiento.monto) : '');
  const [moneda, setMoneda] = useState<Moneda>(movimiento?.moneda ?? 'USD');
  const [fecha, setFecha] = useState(movimiento?.fecha ?? new Date().toISOString().slice(0, 10));
  const [categoriaGastoId, setCategoria] = useState(movimiento?.categoriaGastoId ?? '');
  const [tasaRef, setTasaRef] = useState(movimiento?.tasaRef == null ? '' : String(movimiento.tasaRef));
  const [estadoPago, setEstado] = useState<'pagado' | 'pendiente'>(movimiento?.estadoPago === 'pendiente' ? 'pendiente' : 'pagado');
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [bcv, setBcv] = useState<number | null>(null);

  // Tasa BCV del día: precarga (alta nueva en USD) y equivalente.
  useEffect(() => {
    let vivo = true;
    void cargarTasaBcv().then((t) => {
      if (!vivo) return;
      setBcv(t.tasa);
      if (!edit && moneda === 'USD') setTasaRef((prev) => (prev.trim() === '' ? String(t.tasa) : prev));
    });
    return () => { vivo = false; };
  }, [edit, moneda]);

  const montoNum = Number(monto.replace(',', '.'));
  const tasaNum = tasaRef.trim() === '' ? null : Number(tasaRef.replace(',', '.'));
  const err = {
    empresa: !empresaClave ? 'Elija la empresa.' : '',
    concepto: !concepto.trim() ? 'El concepto es obligatorio.' : '',
    monto: !Number.isFinite(montoNum) || montoNum <= 0 ? 'Indique un monto mayor que cero.' : '',
    tasa: tasaNum != null && (!Number.isFinite(tasaNum) || tasaNum <= 0) ? 'La tasa debe ser un número positivo.' : '',
  };
  const hayError = Object.values(err).some(Boolean);
  const E = (campo: keyof typeof err) => (intento && err[campo] ? <small className="adm-err">{err[campo]}</small> : null);
  const equivBs = moneda === 'USD' && montoNum > 0 && tasaNum && tasaNum > 0 ? montoNum * tasaNum : null;

  async function guardar() {
    setIntento(true);
    if (hayError) { toast('Revise los campos marcados.', 'warning', { silent: true }); return; }
    setGuardando(true);
    try {
      const campos = {
        empresaClave, concepto: concepto.trim(), proveedorNombre: proveedor.trim() || null,
        categoriaGastoId: categoriaGastoId || null, fecha, monto: Math.round(montoNum * 100) / 100, moneda, tasaRef: tasaNum, estadoPago,
      };
      if (edit && movimiento) {
        await repo.editarMovimiento(movimiento.id, campos); // conserva período, origen y el enlace a Tesorería
        toast('Movimiento actualizado.', 'success');
      } else {
        await repo.crearMovimiento({ ...campos, gastoFijoId: null, periodo: tokenPeriodo(fecha, 'mensual'), origen: 'manual', servicioDirectoId: null });
        toast('Movimiento registrado.', 'success');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title={edit ? '✏ Editar movimiento' : '📒 Registrar movimiento'} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : edit ? 'Guardar cambios' : 'Registrar'}</button>
      </>}>
      <div className="form-grid-2">
        <div className="form-row">
          <label htmlFor="mv-empresa">Empresa</label>
          <select id="mv-empresa" className="input" value={empresaClave} onChange={(e) => setEmpresaClave(e.target.value)}>{activas.map((e) => <option key={e.id} value={e.clave}>{e.nombre}</option>)}</select>
          {E('empresa')}
        </div>
        <div className="form-row">
          <label htmlFor="mv-fecha">Fecha</label>
          <input id="mv-fecha" type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="mv-concepto">Concepto</label>
          <input id="mv-concepto" className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Agua, alquiler, honorarios…" autoFocus />
          {E('concepto')}
        </div>
        <div className="form-row">
          <label htmlFor="mv-prov">Proveedor / beneficiario <span className="muted">(opcional)</span></label>
          <input id="mv-prov" className="input" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="mv-cat">Categoría</label>
          <select id="mv-cat" className="input" value={categoriaGastoId} onChange={(e) => setCategoria(e.target.value)}><option value="">Sin categoría</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </div>
        <div className="form-row">
          <label htmlFor="mv-monto">Monto</label>
          <input id="mv-monto" className="input" type="number" min="0" step="0.01" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" />
          {equivBs != null ? <small className="muted">≈ Bs {equivBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a la tasa de referencia</small> : null}
          {E('monto')}
        </div>
        <div className="form-row">
          <label htmlFor="mv-moneda">Moneda</label>
          <select id="mv-moneda" className="input" value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}><option value="USD">USD</option><option value="Bs">Bs</option></select>
        </div>
        <div className="form-row">
          <label htmlFor="mv-tasa">Tasa de referencia <span className="muted">(Bs/USD, opcional)</span></label>
          <input id="mv-tasa" className="input" type="number" min="0" step="0.01" inputMode="decimal" value={tasaRef} onChange={(e) => setTasaRef(e.target.value)} placeholder="p. ej. 40,00" />
          {bcv != null && tasaRef.trim() !== '' && Number(tasaRef.replace(',', '.')) === bcv
            ? <small className="muted">Tasa BCV de hoy ({bcv.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).</small>
            : bcv != null ? <button type="button" className="btn-linkish" onClick={() => setTasaRef(String(bcv))}>Usar la tasa BCV de hoy ({bcv.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</button> : null}
          {E('tasa')}
        </div>
        <div className="form-row">
          <label htmlFor="mv-estado">Estado</label>
          <select id="mv-estado" className="input" value={estadoPago} onChange={(e) => setEstado(e.target.value as 'pagado' | 'pendiente')}><option value="pagado">Pagado</option><option value="pendiente">Pendiente</option></select>
        </div>
      </div>
      {edit && movimiento?.origen === 'generado' && (
        <p className="muted hint" style={{ marginTop: '.5rem', fontSize: '.78rem' }}>
          Este movimiento se generó de un gasto fijo{movimiento.servicioDirectoId ? ' y ya está en Tesorería' : ''}. Editarlo aquí no reescribe el pendiente en Tesorería.
        </p>
      )}
    </Modal>
  );
}
