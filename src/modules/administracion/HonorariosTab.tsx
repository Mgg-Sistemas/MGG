/* ============================================================
   Golden Touch · Administración · pestaña «Honorarios»
   El «job B» del diseño: estado de cuenta POR PROFESIONAL, para que la
   diferencia con la cuenta del profesional se explique sola. Agrupa las
   gestiones (concepto libre con costo) por profesional, con subtotales por
   MONEDA NATIVA (USD/Bs sin reconvertir) y el pago atómico cedido a Tesorería.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { SeccionColapsable } from './SeccionColapsable';
import { PagoGestionModal } from './PagoGestionModal';
import { agrupaPorProfesional } from './administracionHonorarios';
import type { AdminRepo, Empresa, EnvioTesoreria, Gestion, OpcionRef, Profesional } from './admin.repository';
import type { Moneda } from './administracionCalculo';

const n2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ESTADO_GESTION_LABEL: Record<string, string> = {
  abierta: 'Abierta', parcial: 'Pago parcial', saldada: 'Saldada', anulada: 'Anulada',
};
const BADGE_CLASS: Record<string, string> = { saldada: 'activo', anulada: 'suspendido' };

export function HonorariosTab({ repo, empresaClave, empresas, puedeEscribir = true }: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
  puedeEscribir?: boolean;
}) {
  const [profs, setProfs] = useState<Profesional[]>([]);
  const [gestiones, setGestiones] = useState<Gestion[]>([]);
  const [envios, setEnvios] = useState<EnvioTesoreria[]>([]);
  const [cats, setCats] = useState<OpcionRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pago, setPago] = useState<{ gestion: Gestion; profesionalNombre: string } | null>(null);
  const [nueva, setNueva] = useState(false);
  const [gestionABorrar, setGestionABorrar] = useState<{ gestion: Gestion; pagado: number; profesionalNombre: string } | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroProf, setFiltroProf] = useState<'todos' | 'activos' | 'pendientes'>('todos');

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      await repo.refrescarEnvios(); // trae de Tesorería lo que se haya pagado
      const [p, g, e, c] = await Promise.all([
        repo.listProfesionales(),
        repo.listGestiones(empresaClave ?? undefined),
        repo.listEnvios(),
        repo.listCategorias(),
      ]);
      setProfs(p); setGestiones(g); setEnvios(e); setCats(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer los honorarios.');
    } finally { setCargando(false); }
  }, [repo, empresaClave]);
  useEffect(() => { void cargar(); }, [cargar]);

  const grupos = useMemo(() => agrupaPorProfesional(gestiones, envios, profs), [gestiones, envios, profs]);

  const gruposFiltrados = useMemo(() => {
    let res = grupos;
    if (filtroProf === 'activos') {
      res = res.filter((g) => g.profesional.activo);
    } else if (filtroProf === 'pendientes') {
      res = res.filter((g) => g.cuenta.porMoneda.some((s) => s.saldo > 0));
    }
    const q = busqueda.trim().toLowerCase();
    if (q) {
      res = res.filter((g) => {
        const nom = g.profesional.nombre.toLowerCase();
        const pro = (g.profesional.profesion ?? '').toLowerCase();
        const tieneConcepto = g.cuenta.lineas.some((l) => l.gestion.concepto.toLowerCase().includes(q));
        return nom.includes(q) || pro.includes(q) || tieneConcepto;
      });
    }
    return res;
  }, [grupos, filtroProf, busqueda]);

  const activas = useMemo(() => empresas.filter((e) => e.activa), [empresas]);

  async function confirmarBorrado() {
    if (!gestionABorrar) return;
    if (gestionABorrar.pagado > 0) {
      toast('No se puede eliminar una gestión que ya tiene pagos registrados.', 'warning');
      setGestionABorrar(null);
      return;
    }
    setBorrando(true);
    try {
      await repo.borrarGestion(gestionABorrar.gestion.id);
      toast(`Gestión «${gestionABorrar.gestion.concepto}» eliminada correctamente.`, 'success');
      setGestionABorrar(null);
      await cargar();
    } catch (e) {
      toast(`No se pudo eliminar la gestión: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setBorrando(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
        <p className="muted hint" style={{ margin: 0 }}>
          Estado de cuenta por profesional: cada gestión con su costo, lo enviado, lo pagado y el saldo. Los montos se muestran por su propia moneda (sin mezclar).
        </p>
        {puedeEscribir && (
          <button type="button" className="btn btn-primary btn-sm" style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }} onClick={() => setNueva(true)}>
            + Nueva gestión
          </button>
        )}
      </div>

      {error && <div className="adm-aviso">No se pudieron leer los honorarios: {/relation|does not exist|schema cache|jwt|sesi|permission/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>}

      {/* Filtros y búsqueda de honorarios */}
      {!cargando && grupos.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', margin: '.2rem 0' }}>
          <input
            type="search"
            className="input input-sm"
            placeholder="🔍 Buscar por profesional o concepto…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ maxWidth: 280, fontSize: '.78rem', padding: '.25rem .5rem' }}
          />
          <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
            <button
              type="button"
              className={`btn btn-xs ${filtroProf === 'todos' ? 'btn-primary' : 'btn-ghost'}`}
              style={filtroProf === 'todos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
              onClick={() => setFiltroProf('todos')}
            >
              Todos ({grupos.length})
            </button>
            <button
              type="button"
              className={`btn btn-xs ${filtroProf === 'activos' ? 'btn-primary' : 'btn-ghost'}`}
              style={filtroProf === 'activos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
              onClick={() => setFiltroProf('activos')}
            >
              Solo activos ({grupos.filter((g) => g.profesional.activo).length})
            </button>
            <button
              type="button"
              className={`btn btn-xs ${filtroProf === 'pendientes' ? 'btn-primary' : 'btn-ghost'}`}
              style={filtroProf === 'pendientes' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
              onClick={() => setFiltroProf('pendientes')}
            >
              Con saldo ({grupos.filter((g) => g.cuenta.porMoneda.some((s) => s.saldo > 0)).length})
            </button>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="muted">Leyendo honorarios…</p>
      ) : grupos.length === 0 ? (
        <EmptyState icon="💼" message={puedeEscribir ? 'Sin gestiones todavía. Crea la primera con «Nueva gestión».' : 'No hay gestiones registradas.'} />
      ) : gruposFiltrados.length === 0 ? (
        <div style={{ padding: '1rem', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <p className="muted" style={{ margin: '0 0 .5rem', fontSize: '.84rem' }}>
            No hay honorarios que coincidan con la búsqueda «{busqueda}» o el filtro seleccionado.
          </p>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setFiltroProf('todos'); setBusqueda(''); }}>
            Mostrar todos ({grupos.length})
          </button>
        </div>
      ) : (
        gruposFiltrados.map(({ profesional, cuenta }) => (
          <SeccionColapsable
            key={profesional.id}
            titulo={`👤 ${profesional.nombre}${profesional.profesion ? ` · ${profesional.profesion}` : ''}`}
            subtitulo={cuenta.porMoneda.map((s) => `${n2(s.saldo)} ${s.moneda} pendiente`).join(' · ') || 'Al día'}
          >
            {/* Subtotales por moneda */}
            <div className="adm-kpis" style={{ gridTemplateColumns: `repeat(${Math.max(1, cuenta.porMoneda.length)}, minmax(0,1fr))`, marginBottom: '.6rem' }}>
              {cuenta.porMoneda.map((s) => (
                <div key={s.moneda} className="adm-kpi oro">
                  <span className="adm-kpi-lbl">Pendiente {s.moneda}</span>
                  <span className="adm-kpi-num">{n2(s.saldo)}</span>
                  <span className="adm-kpi-sub">de {n2(s.costo)} · pagado {n2(s.pagado)}</span>
                </div>
              ))}
            </div>

            <div className="adm-tabla" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
              <table>
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th style={{ textAlign: 'right' }}>Costo</th>
                    <th style={{ textAlign: 'right' }}>Pagado</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {cuenta.lineas.map((l) => (
                    <tr key={l.gestion.id} className={l.gestion.estado === 'anulada' ? 'adm-fila-off' : undefined}>
                      <td><strong style={{ fontSize: '.84rem', color: 'var(--text)' }}>{l.gestion.concepto}</strong>{l.gestion.fechaPactada ? <span className="muted hint" style={{ fontSize: '.7rem', display: 'block' }}>pactado {l.gestion.fechaPactada}</span> : null}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{n2(l.gestion.costoTotal)} {l.gestion.moneda}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{n2(l.pagado)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{n2(l.saldo)}</td>
                      <td><span className={`adm-badge ${BADGE_CLASS[l.estado] ?? ''}`}>{ESTADO_GESTION_LABEL[l.estado] ?? l.estado}</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
                          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setPago({ gestion: l.gestion, profesionalNombre: profesional.nombre })}>
                            {puedeEscribir ? 'Pagar / detalle' : 'Detalle'}
                          </button>
                          {puedeEscribir && (
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost"
                              title="Eliminar gestión"
                              style={{ color: '#ef4444' }}
                              onClick={() => setGestionABorrar({ gestion: l.gestion, pagado: l.pagado, profesionalNombre: profesional.nombre })}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SeccionColapsable>
        ))
      )}

      {gestionABorrar && (
        <ConfirmDialog
          title="Eliminar gestión / honorario"
          danger
          confirmText={borrando ? 'Eliminando…' : 'Eliminar gestión'}
          onCancel={() => setGestionABorrar(null)}
          onConfirm={() => void confirmarBorrado()}
          message={
            gestionABorrar.pagado > 0 ? (
              <p style={{ margin: 0, color: '#ef4444' }}>
                Esta gestión tiene pagos registrados (<strong>{n2(gestionABorrar.pagado)} {gestionABorrar.gestion.moneda}</strong>). No se puede eliminar directamente para resguardar la consistencia contable. Si necesitas anularla, reversa sus envíos en Tesorería.
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                ¿Estás seguro de que deseas eliminar la gestión <strong>«{gestionABorrar.gestion.concepto}»</strong> del profesional <strong>{gestionABorrar.profesionalNombre}</strong> por <strong>{n2(gestionABorrar.gestion.costoTotal)} {gestionABorrar.gestion.moneda}</strong>?
              </p>
            )
          }
        />
      )}

      {pago && (
        <PagoGestionModal
          repo={repo}
          gestion={pago.gestion}
          profesionalNombre={pago.profesionalNombre}
          puedeEscribir={puedeEscribir}
          onClose={() => setPago(null)}
          onChanged={() => void cargar()}
        />
      )}

      {nueva && puedeEscribir && (
        <NuevaGestionModal
          repo={repo}
          profesionales={profs}
          categorias={cats}
          empresasActivas={activas}
          empresaClave={empresaClave}
          onClose={() => setNueva(false)}
          onCreada={() => { setNueva(false); void cargar(); }}
        />
      )}
    </div>
  );
}

function NuevaGestionModal({ repo, profesionales, categorias, empresasActivas, empresaClave, onClose, onCreada }: {
  repo: AdminRepo;
  profesionales: Profesional[];
  categorias: OpcionRef[];
  empresasActivas: Empresa[];
  empresaClave: string | null;
  onClose: () => void;
  onCreada: () => void;
}) {
  const [empresa, setEmpresa] = useState<string>(empresaClave ?? empresasActivas[0]?.clave ?? '');
  const [profId, setProfId] = useState('');
  const [catId, setCatId] = useState('');
  const [concepto, setConcepto] = useState('');
  const [costo, setCosto] = useState('');
  const [moneda, setMoneda] = useState<Moneda>('USD');
  const [fechaPactada, setFechaPactada] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const optProf = profesionales.filter((p) => p.activo).map((p) => ({ value: p.id, label: p.nombre, hint: p.profesion ?? undefined }));
  const optCat = categorias.map((c) => ({ value: c.id, label: c.nombre }));

  async function crear() {
    if (!empresa) { toast('Elige la empresa.', 'warning', { silent: true }); return; }
    if (!profId) { toast('Elige el profesional.', 'warning', { silent: true }); return; }
    const c = concepto.trim();
    if (!c) { toast('Escribe el concepto de la gestión.', 'warning', { silent: true }); return; }
    const monto = Math.round((Number(costo) || 0) * 100) / 100;
    if (monto <= 0) { toast('Indica el costo de la gestión.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try {
      await repo.crearGestion({
        empresaClave: empresa, profesionalId: profId, categoriaId: catId || null,
        centroAcopioId: null, documentoId: null, concepto: c, costoTotal: monto, moneda,
        tasaRef: null, fecha: new Date().toISOString().slice(0, 10), fechaPactada: fechaPactada || null,
        estado: 'abierta', notaAcuerdo: null,
      });
      toast('Gestión creada.', 'success');
      onCreada();
    } catch (e) { toast(`No se pudo crear: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  return (
    <Modal title="➕ Nueva gestión / honorario" onClose={onClose} size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', width: '100%' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={ocupado}>Cancelar</button>
          <button type="button" className="btn btn-primary btn-sm" style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }} onClick={() => void crear()} disabled={ocupado}>Crear gestión</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
        {!empresaClave && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
            <span className="muted hint" style={{ fontSize: '.72rem' }}>Empresa *</span>
            <select className="input input-sm" value={empresa} onChange={(e) => setEmpresa(e.target.value)} disabled={ocupado}>
              {empresasActivas.map((e) => <option key={e.id} value={e.clave}>{e.nombre}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          <span className="muted hint" style={{ fontSize: '.72rem' }}>Profesional *</span>
          <SearchSelect options={optProf} value={profId} onChange={setProfId} placeholder="Elige el profesional…" />
          {optProf.length === 0 && <span className="muted hint" style={{ fontSize: '.68rem' }}>No hay profesionales. Agrégalos en Configuración → Profesionales.</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          <span className="muted hint" style={{ fontSize: '.72rem' }}>Categoría (opcional)</span>
          <SearchSelect options={optCat} value={catId} onChange={setCatId} placeholder="Categoría del módulo…" />
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          <span className="muted hint" style={{ fontSize: '.72rem' }}>Concepto * (nombre libre)</span>
          <input className="input input-sm" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: Redacción de poder, Solvencia municipal…" disabled={ocupado} autoFocus />
        </label>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '2 1 140px' }}>
            <span className="muted hint" style={{ fontSize: '.72rem' }}>Costo *</span>
            <input className="input input-sm" type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} disabled={ocupado} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 90px' }}>
            <span className="muted hint" style={{ fontSize: '.72rem' }}>Moneda</span>
            <select className="input input-sm" value={moneda} onChange={(e) => setMoneda(e.target.value === 'Bs' ? 'Bs' : 'USD')} disabled={ocupado}>
              <option value="USD">USD</option>
              <option value="Bs">Bs</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 140px' }}>
            <span className="muted hint" style={{ fontSize: '.72rem' }}>Fecha pactada</span>
            <input className="input input-sm" type="date" value={fechaPactada} onChange={(e) => setFechaPactada(e.target.value)} disabled={ocupado} />
          </label>
        </div>
      </div>
    </Modal>
  );
}
