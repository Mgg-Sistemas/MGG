/* ============================================================
   Golden Touch · Administración · pestaña «Tablero» (apertura visual)
   La capa primaria: KPIs y semáforos de un vistazo (vencimientos, pendiente
   por profesional, cuentas por enviar, carga por analista y cobertura/fase por
   centro). Agrega las funciones puras de las fases 2-4. Desde aquí se baja al
   detalle. La cobertura N de M coexiste con la etiqueta de fase operativa.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import type { Usuario } from '@/shared/lib/types';
import { TIPO_DOCUMENTO_LABEL, type AdminRepo, type Aviso, type CentroRequerido, type Empresa, type TipoDocumento } from './admin.repository';
import { resumenTablero, colorSemaforoCobertura, type ResumenTablero } from './administracionTableroModulo';
import { nombrePorEmail } from './administracionResponsabilidad';
import { type CentroAcopio } from './administracionCentrosResponsables';
import { leerCarpetasPersonalizadas } from './GestionarCarpetasModal';
import { TIPO_AVISO_LABEL, sincronizarAvisos } from './administracionAvisos';
import { agendaVencimientos } from './administracionAgenda';

const num2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SEMAFORO_COLOR: Record<'critico' | 'atencion' | 'al_dia', string> = { critico: '#ef4444', atencion: '#eab308', al_dia: '#10b981' };

export function TableroModuloTab({ repo, empresaClave, puedeEscribir = true }: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
  puedeEscribir?: boolean;
}) {
  const [resumen, setResumen] = useState<ResumenTablero | null>(null);
  const [centros, setCentros] = useState<CentroAcopio[]>([]);
  const [requeridos, setRequeridos] = useState<CentroRequerido[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [centroSel, setCentroSel] = useState('');
  const [tipoSel, setTipoSel] = useState<TipoDocumento>('rupdae');

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      await repo.refrescarEnvios();
      const cs = (await repo.listCentros(empresaClave ?? undefined)).filter((c) => c.activo !== false);
      const [documentos, movimientos, gestiones, envios, profesionales, responsabilidades, reqs, us, avs] = await Promise.all([
        repo.listDocumentos(empresaClave ?? undefined),
        repo.listMovimientos(empresaClave ?? undefined),
        repo.listGestiones(empresaClave ?? undefined),
        repo.listEnvios(),
        repo.listProfesionales(),
        repo.listResponsabilidades(empresaClave ?? undefined),
        repo.listCentroRequeridos(empresaClave ?? undefined),
        listUsuarios().catch(() => [] as Usuario[]),
        repo.listAvisos(empresaClave ?? undefined).catch(() => [] as Aviso[]),
      ]);

      const carpetasCustom = leerCarpetasPersonalizadas(empresaClave);
      const carpetasMap = new Map(carpetasCustom.map((c) => [c.id, { responsable: c.responsable }]));
      const itemsAgenda = agendaVencimientos({ documentos, movimientos, gestiones, envios });
      const docPorId = new Map(documentos.map((d) => [d.id, d]));

      let avisosConsolidados = avs;
      if (puedeEscribir) {
        try {
          avisosConsolidados = await sincronizarAvisos(repo, itemsAgenda, responsabilidades, docPorId, avs, carpetasMap);
        } catch {
          // best-effort
        }
      }

      setCentros(cs); setRequeridos(reqs); setUsuarios(us); setAvisos(avisosConsolidados);
      setResumen(resumenTablero({
        documentos, movimientos, gestiones, envios, profesionales, responsabilidades,
        centros: cs.map((c) => ({ id: c.id, nombre: c.nombre })), requeridos: reqs,
        // El documento puede heredar el centro y responsable de su carpeta.
        carpetas: carpetasCustom.map((c) => ({ id: c.id, centroAcopioId: c.centroAcopioId, responsable: c.responsable })),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo armar el tablero.');
    } finally { setCargando(false); }
  }, [repo, empresaClave, puedeEscribir]);
  useEffect(() => { void cargar(); }, [cargar]);

  const nombres = useMemo(() => nombrePorEmail(usuarios), [usuarios]);
  const faseCentro = useMemo(() => new Map(centros.map((c) => [c.id, c.fasePredeterminada])), [centros]);

  async function agregarReq() {
    if (!puedeEscribir) { toast('Sin permiso de escritura.', 'warning', { silent: true }); return; }
    if (!centroSel) { toast('Elige el centro.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try {
      await repo.agregarCentroRequerido({ empresaClave: empresaClave || 'GT', centroId: centroSel, tipoDocumento: tipoSel });
      toast('Requerido agregado al checklist.', 'success');
      await cargar();
    } catch (e) { toast(`No se pudo agregar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }
  async function quitarReq(id: string) {
    if (!puedeEscribir) { toast('Sin permiso de escritura.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try { await repo.quitarCentroRequerido(id); await cargar(); }
    catch (e) { toast(`No se pudo quitar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  async function marcarLeido(a: Aviso) {
    if (!puedeEscribir) return;
    try {
      await repo.marcarAvisoLeido(a.id, true);
      setAvisos((prev) => prev.map((x) => (x.id === a.id ? { ...x, leido: true } : x)));
      toast('Aviso marcado como leído.', 'info', { silent: true });
    } catch (e) {
      toast(`No se pudo marcar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    }
  }

  async function eliminarAviso(a: Aviso) {
    if (!puedeEscribir) return;
    try {
      await repo.borrarAviso(a.id);
      setAvisos((prev) => prev.filter((x) => x.id !== a.id));
      toast('Aviso descartado.', 'info', { silent: true });
    } catch (e) {
      toast(`No se pudo eliminar aviso: ${e instanceof Error ? e.message : 'error'}`, 'error');
    }
  }

  async function marcarTodosLeidos() {
    if (!puedeEscribir) return;
    const sinLeer = avisos.filter((a) => !a.leido);
    if (!sinLeer.length) return;
    try {
      for (const a of sinLeer) {
        await repo.marcarAvisoLeido(a.id, true);
      }
      setAvisos((prev) => prev.map((x) => ({ ...x, leido: true })));
      toast('Todos los avisos marcados como leídos.', 'success');
    } catch (e) {
      toast(`No se pudieron marcar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    }
  }

  if (cargando) return <p className="muted">Armando el tablero…</p>;
  if (error) return <div className="adm-aviso">No se pudo armar el tablero: {/relation|does not exist|schema cache|jwt|sesi|permission/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>;
  if (!resumen) return <EmptyState icon="📊" message="Sin datos para el tablero todavía." />;

  const nombreCentro = (id: string) => centros.find((c) => c.id === id)?.nombre ?? id;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {/* KPIs principales */}
      <div className="adm-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="adm-kpi" style={{ borderColor: '#ef4444' }}>
          <span className="adm-kpi-lbl">Vencidos</span><span className="adm-kpi-num" style={{ color: '#ef4444' }}>{resumen.agenda.vencidos}</span><span className="adm-kpi-sub">documentos/gastos/gestiones</span>
        </div>
        <div className="adm-kpi" style={{ borderColor: '#eab308' }}>
          <span className="adm-kpi-lbl">Por vencer</span><span className="adm-kpi-num" style={{ color: '#eab308' }}>{resumen.agenda.porVencer}</span>
        </div>
        <div className="adm-kpi oro">
          <span className="adm-kpi-lbl">Pendiente a profesionales</span>
          <span className="adm-kpi-num" style={{ fontSize: '1rem' }}>{resumen.pendientePorMoneda.length ? resumen.pendientePorMoneda.map((m) => `${num2(m.saldo)} ${m.moneda}`).join(' · ') : '—'}</span>
        </div>
        <div className="adm-kpi oro">
          <span className="adm-kpi-lbl">Por enviar a Tesorería</span>
          <span className="adm-kpi-num" style={{ fontSize: '1rem' }}>{resumen.porEnviar.length ? resumen.porEnviar.map((m) => `${num2(m.monto)} ${m.moneda}`).join(' · ') : '—'}</span>
          <span className="adm-kpi-sub">{resumen.porEnviar.reduce((a, m) => a + m.n, 0)} gestión(es)</span>
        </div>
      </div>

      {/* Avisos sin leer: sincronizados automáticamente de la agenda de vencimientos */}
      {avisos.filter((a) => !a.leido).length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid #eab308' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <div className="card-title" style={{ fontSize: '.9rem' }}>
              🔔 Avisos sin leer ({avisos.filter((a) => !a.leido).length})
            </div>
            {puedeEscribir && (
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => void marcarTodosLeidos()}
                title="Marcar todos los avisos como leídos"
              >
                ✓ Marcar todos leídos
              </button>
            )}
          </div>
          <div className="adm-tabla" style={{ marginTop: '.4rem', maxHeight: 220, overflowY: 'auto' }}>
            <table><tbody>
              {avisos.filter((a) => !a.leido).slice(0, 8).map((a) => (
                <tr key={a.id}>
                  <td style={{ width: 1, whiteSpace: 'nowrap' }}>
                    <span className={`adm-badge ${a.tipo === 'vencido' || a.tipo === 'incumplido' ? 'suspendido' : ''}`}>
                      {TIPO_AVISO_LABEL[a.tipo] ?? a.tipo}
                    </span>
                  </td>
                  <td style={{ fontSize: '.82rem' }}>{a.texto}</td>
                  <td style={{ textAlign: 'right', fontSize: '.78rem' }} className="muted">
                    {a.responsableEmail ? (nombres.get(a.responsableEmail) ?? a.responsableEmail) : 'Sin responsable'}
                  </td>
                  {puedeEscribir && (
                    <td style={{ textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => void marcarLeido(a)}
                        title="Marcar como leído"
                        style={{ marginRight: '.25rem' }}
                      >
                        ✓ Leído
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => void eliminarAviso(a)}
                        title="Descartar y eliminar aviso"
                        style={{ color: '#ef4444' }}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody></table>
          </div>
          {avisos.filter((a) => !a.leido).length > 8 && (
            <p className="muted hint" style={{ fontSize: '.72rem', margin: '.3rem 0 0' }}>
              Se muestran los 8 primeros. El resto está en la pestaña Responsabilidad.
            </p>
          )}
        </div>
      )}

      {/* Carga por analista (top) */}
      {resumen.cargaTop.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ fontSize: '.9rem' }}>👥 Carga por analista</div>
          <div className="adm-tabla" style={{ marginTop: '.4rem' }}>
            <table><tbody>
              {resumen.cargaTop.map((c) => (
                <tr key={c.usuarioEmail}>
                  <td style={{ fontSize: '.82rem' }}>{nombres.get(c.usuarioEmail) ?? c.usuarioEmail}</td>
                  <td style={{ textAlign: 'right' }}><span className="adm-badge suspendido">{c.vencidos} vencidos</span></td>
                  <td style={{ textAlign: 'right', fontSize: '.8rem' }} className="muted">{c.total} a cargo</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}

      {/* Cobertura / fase por centro */}
      <div className="card">
        <div className="card-title" style={{ fontSize: '.9rem' }}>🏭 Fase por centro de acopio (cobertura de documentos)</div>
        <p className="muted hint" style={{ marginTop: '.2rem', fontSize: '.76rem' }}>
          Cuántos de los documentos requeridos del centro están al día (N de M). Coexiste con la etiqueta de fase operativa.
        </p>
        {resumen.cobertura.length === 0 ? (
          <p className="muted hint" style={{ marginTop: '.5rem', fontSize: '.8rem' }}>No hay centros de acopio para esta empresa.</p>
        ) : (
          <div style={{ display: 'grid', gap: '.5rem', marginTop: '.6rem' }}>
            {resumen.cobertura.map((c) => {
              const color = SEMAFORO_COLOR[colorSemaforoCobertura(c.pct)];
              return (
                <div key={c.centroId} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '.55rem .75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '.84rem' }}>{c.nombre}</strong>
                    <span style={{ fontSize: '.78rem', color }}>{c.cubiertos}/{c.requeridos} al día · {c.pct}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden', margin: '.35rem 0' }}>
                    <div style={{ width: `${c.pct}%`, height: '100%', background: color, transition: 'width .3s' }} />
                  </div>
                  {faseCentro.get(c.centroId) && <span className="muted hint" style={{ fontSize: '.7rem' }}>Fase operativa: {faseCentro.get(c.centroId)}</span>}
                  {c.faltantes.length > 0 && (
                    <div style={{ marginTop: '.2rem', fontSize: '.72rem' }} className="muted">
                      Falta: {c.faltantes.map((t) => TIPO_DOCUMENTO_LABEL[t] ?? t).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Editar el checklist por centro */}
        {puedeEscribir && centros.length > 0 && (
          <div style={{ marginTop: '.75rem', borderTop: '1px solid var(--border)', paddingTop: '.6rem' }}>
            <div style={{ fontWeight: 600, fontSize: '.82rem', marginBottom: '.4rem' }}>Documentos requeridos del centro</div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input input-sm" value={centroSel} onChange={(e) => setCentroSel(e.target.value)} disabled={ocupado}>
                <option value="">Elige el centro…</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <select className="input input-sm" value={tipoSel} onChange={(e) => setTipoSel(e.target.value as TipoDocumento)} disabled={ocupado}>
                {(Object.keys(TIPO_DOCUMENTO_LABEL) as TipoDocumento[]).map((t) => <option key={t} value={t}>{TIPO_DOCUMENTO_LABEL[t]}</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-primary" style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }} onClick={() => void agregarReq()} disabled={ocupado}>+ Requerir</button>
            </div>
            {requeridos.length > 0 && (
              <div className="adm-tabla" style={{ marginTop: '.5rem' }}>
                <table><tbody>
                  {requeridos.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontSize: '.8rem' }}>{nombreCentro(r.centroId)}</td>
                      <td style={{ fontSize: '.8rem' }}>{TIPO_DOCUMENTO_LABEL[r.tipoDocumento] ?? r.tipoDocumento}</td>
                      <td style={{ textAlign: 'right' }}><button type="button" className="btn btn-xs btn-ghost" style={{ color: '#ef4444' }} onClick={() => void quitarReq(r.id)} disabled={ocupado}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
