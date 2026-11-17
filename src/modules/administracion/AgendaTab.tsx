/* ============================================================
   Golden Touch · Administración · pestaña «Agenda»
   El tablero de «qué se viene»: junta documentos, gastos/cuentas por pagar
   y gestiones por su fecha de vencimiento, ordenados por urgencia, con
   KPIs (vencidos / por vencer / vigentes) y filtros.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { STATUS_VENCIMIENTO_COLOR, STATUS_VENCIMIENTO_LABEL, type AdminRepo, type Empresa } from './admin.repository';
import { agendaVencimientos, filtrarAgenda, resumenAgenda, textoDiasRestantes, type ItemAgenda, type OrigenAgenda } from './administracionAgenda';

const num2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORIGEN_LABEL: Record<OrigenAgenda, string> = { documento: '📄 Documento', gasto: '💵 Cuenta por pagar', gestion: '💼 Gestión' };
const PRIORIDAD_LABEL: Record<string, string> = { alta: '🔴 Alta', media: '🟠 Media', baja: '🟢 Baja' };

export function AgendaTab({ repo, empresaClave }: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
}) {
  const [items, setItems] = useState<ItemAgenda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [origen, setOrigen] = useState<OrigenAgenda | 'todos'>('todos');

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      await repo.refrescarEnvios();
      const [documentos, movimientos, gestiones, envios] = await Promise.all([
        repo.listDocumentos(empresaClave ?? undefined),
        repo.listMovimientos(empresaClave ?? undefined),
        repo.listGestiones(empresaClave ?? undefined),
        repo.listEnvios(),
      ]);
      setItems(agendaVencimientos({ documentos, movimientos, gestiones, envios }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo armar la agenda.');
    } finally { setCargando(false); }
  }, [repo, empresaClave]);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => filtrarAgenda(items, { origen: origen === 'todos' ? null : origen }), [items, origen]);
  const resumen = useMemo(() => resumenAgenda(visibles), [visibles]);

  return (
    <div style={{ display: 'grid', gap: '.75rem' }}>
      <div className="adm-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="adm-kpi" style={{ borderColor: STATUS_VENCIMIENTO_COLOR.vencido.border }}>
          <span className="adm-kpi-lbl">Vencidos</span><span className="adm-kpi-num" style={{ color: STATUS_VENCIMIENTO_COLOR.vencido.color }}>{resumen.vencidos}</span>
        </div>
        <div className="adm-kpi" style={{ borderColor: STATUS_VENCIMIENTO_COLOR.por_vencer.border }}>
          <span className="adm-kpi-lbl">Por vencer</span><span className="adm-kpi-num" style={{ color: STATUS_VENCIMIENTO_COLOR.por_vencer.color }}>{resumen.porVencer}</span>
        </div>
        <div className="adm-kpi" style={{ borderColor: STATUS_VENCIMIENTO_COLOR.vigente.border }}>
          <span className="adm-kpi-lbl">Vigentes</span><span className="adm-kpi-num" style={{ color: STATUS_VENCIMIENTO_COLOR.vigente.color }}>{resumen.vigentes}</span>
        </div>
      </div>

      <div className="view-toggle" role="tablist" aria-label="Filtrar por origen">
        {(['todos', 'documento', 'gasto', 'gestion'] as const).map((o) => (
          <button key={o} className={origen === o ? 'active' : ''} onClick={() => setOrigen(o)}>
            {o === 'todos' ? 'Todo' : ORIGEN_LABEL[o]}
          </button>
        ))}
      </div>

      {error && <div className="adm-aviso">No se pudo armar la agenda: {/relation|does not exist|schema cache|jwt|sesi|permission/i.test(error) ? 'inicia sesión o la base aún no tiene las tablas del módulo.' : error}</div>}

      {cargando ? (
        <p className="muted">Armando la agenda…</p>
      ) : visibles.length === 0 ? (
        <EmptyState icon="🗓" message="No hay nada por vencer con este filtro." />
      ) : (
        <div className="adm-tabla" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
          <table>
            <thead>
              <tr>
                <th>Qué</th><th>Origen</th><th>Vence</th><th>Estado</th><th>Prioridad</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((i) => {
                const cfg = STATUS_VENCIMIENTO_COLOR[i.status];
                const cuenta = textoDiasRestantes(i.diasRestantes);
                return (
                  <tr key={`${i.origen}-${i.id}`}>
                    <td>
                      <strong style={{ fontSize: '.84rem', color: 'var(--text)' }}>{i.titulo}</strong>
                      {i.monto != null && <span className="muted hint" style={{ display: 'block', fontSize: '.7rem' }}>{num2(i.monto)} {i.moneda}</span>}
                    </td>
                    <td style={{ fontSize: '.8rem' }}>{ORIGEN_LABEL[i.origen]}</td>
                    <td style={{ fontSize: '.8rem' }} title={cuenta}>{i.fecha ?? '—'}</td>
                    <td>
                      <span className="adm-badge" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }} title={cuenta}>
                        {STATUS_VENCIMIENTO_LABEL[i.status]}{i.diasRestantes != null ? ` · ${cuenta}` : ''}
                      </span>
                    </td>
                    <td style={{ fontSize: '.8rem' }}>{i.prioridad ? PRIORIDAD_LABEL[i.prioridad] : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
