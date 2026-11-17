/* ============================================================
   Golden Touch · Administración · Pago atómico de una gestión
   Administración DECIDE y ENVÍA a Tesorería (genera cuenta por pagar);
   no paga. Envíos completo/parcial, reversibles mientras no estén pagados.
   Prórroga/renegociación = editar costo/fecha pactada + nota (no envía).
   El comprobante del pago se lee del servicio directo (adjunto único).
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { AdminRepo, EnvioTesoreria, Gestion } from './admin.repository';
import { saldoGestion, disponibleParaEnviar, estadoGestion, puedeReversarEnvio } from './administracionHonorarios';

const n2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fFechaHora = (s: string | null) => (s ? new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s)) : '—');

const ESTADO_ENVIO_LABEL: Record<EnvioTesoreria['estado'], string> = {
  enviado: 'Enviado (por pagar)', pagado: 'Pagado', reversado: 'Reversado',
};
const ESTADO_GESTION_LABEL: Record<string, string> = {
  abierta: 'Abierta', parcial: 'Pago parcial', saldada: 'Saldada', anulada: 'Anulada',
};

export function PagoGestionModal({ repo, gestion, profesionalNombre, puedeEscribir, onClose, onChanged }: {
  repo: AdminRepo;
  gestion: Gestion;
  profesionalNombre: string;
  puedeEscribir: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [envios, setEnvios] = useState<EnvioTesoreria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [monto, setMonto] = useState('');
  const [editCosto, setEditCosto] = useState(String(gestion.costoTotal));
  const [editFecha, setEditFecha] = useState(gestion.fechaPactada ?? '');
  const [editNota, setEditNota] = useState(gestion.notaAcuerdo ?? '');
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try { await repo.refrescarEnvios(gestion.id); setEnvios(await repo.listEnvios(gestion.id)); }
    catch { setEnvios([]); }
    finally { setCargando(false); }
  }, [repo, gestion.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const saldo = saldoGestion(gestion, envios);
  const disponible = disponibleParaEnviar(gestion, envios);
  const est = estadoGestion(gestion, envios);
  const anulada = gestion.estado === 'anulada';

  async function enviar() {
    const m = Math.round((Number(monto) || 0) * 100) / 100;
    if (m <= 0) { toast('Indica el monto a enviar a Tesorería.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try {
      await repo.crearEnvio({ gestion, monto: m, profesionalNombre });
      toast('Enviado a Tesorería como cuenta por pagar.', 'success');
      setMonto('');
      await cargar(); onChanged();
    } catch (e) { toast(`No se pudo enviar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  async function reversar(env: EnvioTesoreria) {
    setOcupado(true);
    try { await repo.reversarEnvio(env.id); toast('Envío reversado.', 'info'); await cargar(); onChanged(); }
    catch (e) { toast(`No se pudo reversar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  async function guardarAcuerdo() {
    const costo = Math.round((Number(editCosto) || 0) * 100) / 100;
    if (costo <= 0) { toast('El costo debe ser mayor que cero.', 'warning', { silent: true }); return; }
    setOcupado(true);
    try {
      await repo.editarGestion(gestion.id, { costoTotal: costo, fechaPactada: editFecha || null, notaAcuerdo: editNota.trim() || null });
      toast('Acuerdo actualizado (prórroga / renegociación).', 'success');
      onChanged(); onClose();
    } catch (e) { toast(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setOcupado(false); }
  }

  async function eliminarGestion() {
    setOcupado(true);
    try {
      await repo.borrarGestion(gestion.id);
      toast(`Gestión «${gestion.concepto}» eliminada correctamente.`, 'success');
      setConfirmarEliminar(false);
      onChanged();
      onClose();
    } catch (e) {
      toast(`No se pudo eliminar la gestión: ${e instanceof Error ? e.message : 'error'}`, 'error');
      setConfirmarEliminar(false);
    } finally {
      setOcupado(false);
    }
  }

  async function verComprobante(env: EnvioTesoreria) {
    try {
      const url = await repo.urlAdjuntoEnvio(env);
      if (url) window.open(url, '_blank', 'noopener');
      else toast('Este pago todavía no tiene comprobante adjunto en Tesorería.', 'info', { silent: true });
    } catch { toast('No se pudo abrir el comprobante.', 'error'); }
  }

  return (
    <Modal title={`💼 ${gestion.concepto}`} onClose={onClose} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
        {/* Resumen de la gestión */}
        <div className="adm-kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <div className="adm-kpi"><span className="adm-kpi-lbl">Profesional</span><span className="adm-kpi-num" style={{ fontSize: '.95rem' }}>{profesionalNombre}</span></div>
          <div className="adm-kpi oro"><span className="adm-kpi-lbl">Costo total</span><span className="adm-kpi-num">{n2(gestion.costoTotal)}</span><span className="adm-kpi-sub">{gestion.moneda}</span></div>
          <div className="adm-kpi oro"><span className="adm-kpi-lbl">Saldo pendiente</span><span className="adm-kpi-num">{n2(saldo)}</span><span className="adm-kpi-sub">{gestion.moneda}</span></div>
          <div className="adm-kpi"><span className="adm-kpi-lbl">Estado</span><span className="adm-kpi-num" style={{ fontSize: '.95rem' }}>{ESTADO_GESTION_LABEL[est] ?? est}</span></div>
        </div>

        {/* Enviar a Tesorería */}
        {puedeEscribir && !anulada && disponible > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.75rem', background: 'var(--surface-2)' }}>
            <div className="card-title" style={{ fontSize: '.9rem' }}>Enviar a Tesorería (cuenta por pagar)</div>
            <p className="muted hint" style={{ margin: '.2rem 0 .5rem', fontSize: '.76rem' }}>
              Administración decide y envía; Tesorería paga. Puedes enviar el total o un parcial. Mientras no lo paguen, puedes reversarlo. Disponible para enviar: <b>{n2(disponible)} {gestion.moneda}</b> (descuenta lo ya enviado y pendiente).
            </p>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                className="input input-sm"
                type="number" min="0" step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder={`Monto en ${gestion.moneda} (disponible ${n2(disponible)})`}
                disabled={ocupado}
                style={{ flex: '1 1 200px' }}
              />
              <button type="button" className="btn btn-xs btn-ghost" onClick={() => setMonto(String(disponible))} disabled={ocupado}>Todo lo disponible</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void enviar()} disabled={ocupado} style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}>
                Enviar a Tesorería
              </button>
            </div>
          </div>
        )}

        {/* Envíos existentes */}
        <div>
          <div className="card-title" style={{ fontSize: '.9rem' }}>Envíos a Tesorería</div>
          {cargando ? (
            <p className="muted" style={{ marginTop: '.4rem' }}>Leyendo envíos…</p>
          ) : envios.length === 0 ? (
            <p className="muted hint" style={{ marginTop: '.4rem', fontSize: '.8rem' }}>Todavía no se ha enviado nada a Tesorería por esta gestión.</p>
          ) : (
            <div className="adm-tabla" style={{ marginTop: '.4rem', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table>
                <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
                <tbody>
                  {envios.map((env) => (
                    <tr key={env.id} className={env.estado === 'reversado' ? 'adm-fila-off' : undefined}>
                      <td style={{ fontSize: '.8rem' }}>{fFechaHora(env.fechaEnvio)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{n2(env.monto)} {env.moneda}</td>
                      <td><span className={`adm-badge ${env.estado === 'pagado' ? 'activo' : env.estado === 'reversado' ? 'suspendido' : ''}`}>{ESTADO_ENVIO_LABEL[env.estado]}</span></td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {env.estado === 'pagado' && (
                          <button type="button" className="btn btn-xs btn-ghost" onClick={() => void verComprobante(env)}>📎 Comprobante</button>
                        )}
                        {puedeEscribir && puedeReversarEnvio(env) && (
                          <button type="button" className="btn btn-xs btn-ghost" style={{ color: '#ef4444' }} onClick={() => void reversar(env)} disabled={ocupado}>Reversar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Prórroga / renegociación */}
        {puedeEscribir && !anulada && (
          <details style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.5rem .75rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.84rem' }}>Prórroga / renegociación</summary>
            <p className="muted hint" style={{ margin: '.3rem 0 .5rem', fontSize: '.74rem' }}>
              Cambia el costo acordado o la fecha pactada y deja una nota del acuerdo. No envía nada a Tesorería.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: '.5rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint" style={{ fontSize: '.7rem' }}>Costo acordado ({gestion.moneda})</span>
                <input className="input input-sm" type="number" min="0" step="0.01" value={editCosto} onChange={(e) => setEditCosto(e.target.value)} disabled={ocupado} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint" style={{ fontSize: '.7rem' }}>Fecha pactada</span>
                <input className="input input-sm" type="date" value={editFecha} onChange={(e) => setEditFecha(e.target.value)} disabled={ocupado} />
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', marginTop: '.5rem' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>Nota del acuerdo</span>
              <textarea className="input input-sm" rows={2} value={editNota} onChange={(e) => setEditNota(e.target.value)} disabled={ocupado} style={{ resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.5rem' }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void guardarAcuerdo()} disabled={ocupado}>Guardar acuerdo</button>
            </div>
          </details>
        )}

        {/* Zona de peligro / eliminación de gestión */}
        {puedeEscribir && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.5rem', paddingTop: '.6rem', borderTop: '1px solid var(--border)' }}>
            <span className="muted hint" style={{ fontSize: '.74rem' }}>
              {envios.some((e) => e.estado === 'pagado')
                ? '⚠️ Esta gestión no se puede eliminar porque ya tiene pagos registrados en Tesorería.'
                : '¿Esta gestión se cargó por error o no procede? Puedes eliminarla del sistema.'}
            </span>
            {envios.every((e) => e.estado !== 'pagado') && (
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                style={{ color: '#ef4444', fontWeight: 600 }}
                onClick={() => setConfirmarEliminar(true)}
                disabled={ocupado}
              >
                🗑️ Eliminar gestión
              </button>
            )}
          </div>
        )}
      </div>

      {confirmarEliminar && (
        <ConfirmDialog
          title="Eliminar gestión / honorario"
          danger
          confirmText={ocupado ? 'Eliminando…' : 'Eliminar gestión'}
          onCancel={() => setConfirmarEliminar(false)}
          onConfirm={() => void eliminarGestion()}
          message={
            <p style={{ margin: 0 }}>
              ¿Estás seguro de que deseas eliminar la gestión <strong>«{gestion.concepto}»</strong> del profesional <strong>{profesionalNombre}</strong> por un costo de <strong>{n2(gestion.costoTotal)} {gestion.moneda}</strong>? Esta acción no se puede deshacer.
            </p>
          }
        />
      )}
    </Modal>
  );
}
