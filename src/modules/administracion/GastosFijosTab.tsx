/* ============================================================
   Golden Touch · Administración · pestaña «Gastos fijos»
   Lista de PLANTILLAS de la empresa elegida (o de todas), con alta/edición.
   El próximo vencimiento sale de administracionCalculo.ts (de Master); la
   tabla tiene scroll horizontal en móvil (regla ui-ux). Sin recurrencia aún.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { proximoVencimiento, type Periodicidad } from './administracionCalculo';
import type { AdminRepo, Empresa, GastoFijo, OpcionRef } from './admin.repository';
import { GastoFijoModal } from './GastoFijoModal';
import { TableroAdmin } from './TableroAdmin';
import { filasTablero } from './administracionTablero';
import { cargarTasaBcv, TASA_FALLBACK } from './administracionTasa';
import { reporteGastosFijosTxt } from './administracionWhatsApp';
import { WhatsAppReporteModal } from './WhatsAppReporteModal';
import { type CentroAcopio } from './administracionCentrosResponsables';

const PERIOD_LABEL: Record<Periodicidad, string> = {
  mensual: 'Mensual', bimensual: 'Bimensual', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual',
};
const fFecha = new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const montoFmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** '' normal · 'pronto' vence en ≤7 días · 'vencido' ya pasó. */
function urgencia(venc: Date, hoy = new Date()): string {
  const dias = Math.ceil((venc.getTime() - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()) / 86400000);
  return dias < 0 ? 'vencido' : dias <= 7 ? 'pronto' : '';
}
/** Etiqueta del período actual, p. ej. «Noviembre 2026». */
const periodoLabel = (() => {
  const s = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric' }).format(new Date()).replace(' de ', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
})();

export function GastosFijosTab({ repo, empresaClave, empresas, puedeEscribir = true }: {
  repo: AdminRepo;
  /** Clave de la empresa elegida, o null = todas. */
  empresaClave: string | null;
  empresas: Empresa[];
  /** Si no puede escribir, la vista queda de solo lectura (sin alta/edición). */
  puedeEscribir?: boolean;
}) {
  const [gastos, setGastos] = useState<GastoFijo[]>([]);
  const [categorias, setCategorias] = useState<OpcionRef[]>([]);
  const [proveedores, setProveedores] = useState<OpcionRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ gasto: GastoFijo | null } | null>(null);
  const [wsp, setWsp] = useState<string | null>(null);
  const [tasa, setTasa] = useState(TASA_FALLBACK);
  // Los centros viven en la base (Configuracion los crea). Antes se leia una lista
  // fija del codigo, asi que lo que la lider creaba no aparecia aqui nunca.
  const [centros, setCentros] = useState<CentroAcopio[]>([]);
  useEffect(() => { repo.listCentros().then(setCentros).catch(() => setCentros([])); }, [repo]);

  const nombreCat = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);
  const nombreEmp = useMemo(() => new Map(empresas.map((e) => [e.clave, e.nombre])), [empresas]);
  const mapaCentros = useMemo(() => new Map(centros.map((c) => [c.id, c.nombre])), [centros]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [gs, cats, provs, t] = await Promise.all([
        repo.listGastosFijos(empresaClave ?? undefined),
        repo.listCategorias().catch(() => [] as OpcionRef[]),
        repo.listProveedores().catch(() => [] as OpcionRef[]),
        cargarTasaBcv(),
      ]);
      setGastos(gs);
      setCategorias(cats);
      setProveedores(provs);
      setTasa(t.tasa);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer los gastos fijos.');
    } finally {
      setCargando(false);
    }
  }, [repo, empresaClave]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function alternarEstado(g: GastoFijo) {
    const nuevo = g.estado === 'activo' ? 'suspendido' : 'activo';
    try {
      await repo.setEstadoGastoFijo(g.id, nuevo);
      toast(nuevo === 'activo' ? 'Gasto fijo reactivado.' : 'Gasto fijo suspendido.', 'success');
      await cargar();
    } catch (e) {
      toast(`No se pudo cambiar el estado: ${e instanceof Error ? e.message : 'error'}`, 'error');
    }
  }

  /**
   * Quita una plantilla cargada por error (por ejemplo, de otra empresa).
   *
   * Solo si todavia no genero movimientos: borrarla con historial los dejaria
   * huerfanos. En ese caso el repositorio explica por que no se puede y se
   * ofrece suspenderla, que es lo que corta la generacion sin perder nada.
   */
  async function quitar(g: GastoFijo) {
    const usados = await repo.contarMovimientosDeGasto(g.id).catch(() => 0);
    const aviso = usados > 0
      ? `«${g.concepto}» ya generó ${usados} movimiento(s), así que no se puede borrar. ¿Quieres suspenderla para que deje de generar?`
      : `¿Quitar «${g.concepto}»? Todavía no generó nada, así que no se pierde historial.`;
    if (!window.confirm(aviso)) return;
    if (usados > 0) { await alternarEstado({ ...g, estado: 'activo' }); return; }
    try { await repo.borrarGastoFijo(g.id); toast('Plantilla eliminada.', 'success'); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar.', 'error'); }
  }

  function abrirWhatsApp() {
    const filas = filasTablero(gastos, empresas, nombreCat);
    const empresaNombre = empresaClave ? nombreEmp.get(empresaClave) ?? empresaClave : null;
    setWsp(reporteGastosFijosTxt(filas, { empresaNombre, periodoLabel, tasa }));
  }

  const mostrarEmpresa = empresaClave == null;

  return (
    <>
      {!cargando && !error && gastos.length > 0 && (
        <TableroAdmin gastos={gastos} empresas={empresas} nombreCat={nombreCat} tasa={tasa} />
      )}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>Gastos fijos {empresaClave ? `· ${nombreEmp.get(empresaClave) ?? empresaClave}` : '· todas las empresas'}</span>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={abrirWhatsApp} disabled={gastos.length === 0}
              title="Enviar el resumen por WhatsApp (o copiarlo)">💬 WhatsApp</button>
            {puedeEscribir && <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ gasto: null })}>+ Nuevo gasto fijo</button>}
          </div>
        </div>

        {error && <div className="adm-aviso" style={{ marginTop: '.5rem' }}>No se pudo leer: {/sesi|jwt|auth|401|permission|relation|does not exist/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>}

        {cargando ? (
          <p className="muted" style={{ marginTop: '.5rem' }}>Leyendo gastos fijos…</p>
        ) : gastos.length === 0 && !error ? (
          <EmptyState icon="🧾" message={empresaClave ? 'Esta empresa no tiene gastos fijos aún.' : 'No hay gastos fijos cargados.'} />
        ) : (
          <div className="adm-tabla" style={{ marginTop: '.6rem' }}>
            <table>
              <thead>
                <tr>
                  {mostrarEmpresa && <th>Empresa</th>}
                  <th>Concepto</th>
                  <th>Proveedor</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th>Periodicidad</th>
                  <th>Próx. vencimiento</th>
                  <th>Categoría</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {gastos.map((g) => {
                  const venc = proximoVencimiento(g);
                  const urg = g.estado === 'activo' ? urgencia(venc) : '';
                  return (
                    <tr key={g.id} className={g.estado === 'activo' ? undefined : 'adm-fila-off'}>
                      {mostrarEmpresa && <td className="mono">{g.empresaClave}</td>}
                      <td>
                        <strong>{g.concepto}</strong>
                        {(g.centroAcopioId || g.responsable) && (
                          <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center', marginTop: '.2rem', flexWrap: 'wrap' }}>
                            {g.centroAcopioId && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: '.66rem',
                                  background: 'rgba(234, 179, 8, 0.12)',
                                  color: '#eab308',
                                  borderColor: '#eab308',
                                  padding: '.05rem .3rem',
                                }}
                                title="Centro de acopio asignado"
                              >
                                🏭 {mapaCentros.get(g.centroAcopioId) || g.centroAcopioId}
                              </span>
                            )}
                            {g.responsable && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: '.66rem',
                                  background: 'rgba(168, 85, 247, 0.12)',
                                  color: '#c084fc',
                                  borderColor: '#c084fc',
                                  padding: '.05rem .3rem',
                                }}
                                title="Responsable / Analista asignado"
                              >
                                👤 {g.responsable}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{g.proveedorNombre ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{montoFmt(g.monto)} {g.moneda}</td>
                      <td>{PERIOD_LABEL[g.periodicidad]}</td>
                      <td style={{ whiteSpace: 'nowrap' }}><span className={`adm-venc ${urg}`}>{fFecha.format(venc)}</span></td>
                      <td>{g.categoriaGastoId && nombreCat.get(g.categoriaGastoId) ? <span className="adm-chip">{nombreCat.get(g.categoriaGastoId)}</span> : '—'}</td>
                      <td><span className={`adm-badge ${g.estado}`}>{g.estado === 'activo' ? 'Activo' : 'Suspendido'}</span></td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {puedeEscribir ? (
                          <>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal({ gasto: g })}>Editar</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void alternarEstado(g)}>{g.estado === 'activo' ? 'Suspender' : 'Activar'}</button>
                            <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#ef4444' }}
                              onClick={() => void quitar(g)}
                              title="Quitar una plantilla cargada por error. Solo se puede si todavía no generó movimientos.">
                              Eliminar
                            </button>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <GastoFijoModal
          repo={repo}
          empresas={empresas}
          empresaClaveFija={empresaClave}
          categorias={categorias}
          proveedores={proveedores}
          gasto={modal.gasto}
          onClose={() => setModal(null)}
          onSaved={() => void cargar()}
        />
      )}

      {wsp != null && (
        <WhatsAppReporteModal
          titulo={`Gastos fijos · ${empresaClave ? nombreEmp.get(empresaClave) ?? empresaClave : 'todas'}`}
          texto={wsp}
          onClose={() => setWsp(null)}
        />
      )}
    </>
  );
}
