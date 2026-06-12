import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import {
  listMovimientosMartillos, crearMovimientoMartillo, actualizarMovimientoMartillo, eliminarMovimientoMartillo,
  resumirMartillos, type MartilloMovimiento, type MartilloInput,
} from './martillos.repository';
import { descargarMartillosPdf, enviarMartillosPorCorreo } from './martillosPdf';

/**
 * Consumo de Martillos del Molino H66 (réplica de la hoja «CONSUMO MAZOS MARTILLOS GT»).
 * Libro tipo caja: dinero (entregados/facturados → saldo $) y unidades
 * (entregados − entregados a GT → restantes), ambos corrientes. Realtime.
 */
export function ConsumoMartillosModal({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('acopio', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  const [movs, setMovs] = useState<MartilloMovimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ editar: MartilloMovimiento | null } | null>(null);
  const [aBorrar, setABorrar] = useState<MartilloMovimiento | null>(null);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [bajando, setBajando] = useState(false);

  const cargar = useCallback(async () => { setMovs(await listMovimientosMartillos()); }, []);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    cargar().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [cargar]);
  useRealtime(['acopio_martillos_movimientos'], () => { void cargar(); });

  const resumen = useMemo(() => resumirMartillos(movs), [movs]);

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-ghost" disabled={!movs.length} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
      <button className="btn btn-ghost" disabled={!movs.length || bajando}
        onClick={async () => { setBajando(true); try { await descargarMartillosPdf(movs); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); } finally { setBajando(false); } }}>
        {bajando ? 'Generando…' : '↓ PDF'}
      </button>
      {canWrite && <button className="btn btn-primary" onClick={() => setForm({ editar: null })}>+ Agregar</button>}
    </>
  );

  const Kpi = ({ titulo, valor, color, destacar }: { titulo: string; valor: string; color?: string; destacar?: boolean }) => (
    <div className="card" style={destacar ? { borderColor: 'var(--primary)', borderWidth: 2, background: 'linear-gradient(135deg, var(--surface-2), var(--surface))' } : undefined}>
      <div className="card-title"><span>{titulo}</span></div>
      <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, color }}>{valor}</div>
    </div>
  );

  return (
    <Modal title="🔨 Consumo de Martillos · Molino H66" size="xl" onClose={onClose} footer={footer}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <Kpi titulo="Saldo en moneda $ Usd" valor={money(resumen.saldoUsd)} color={resumen.saldoUsd < 0 ? 'var(--danger)' : undefined} destacar />
        <Kpi titulo="Martillos restantes" valor={`${num(resumen.restantes)}`} color="var(--primary-3)" />
        <Kpi titulo="Consumidos (uso)" valor={`${num(resumen.totalConsumidos)}`} color="var(--warning)" />
        <Kpi titulo="Gasto por uso ($)" valor={money(resumen.gastoConsumoUsd)} color="var(--danger)" />
        <Kpi titulo="Total entregados ($)" valor={money(resumen.totalEntregadoUsd)} color="var(--success)" />
        <Kpi titulo="Total facturado ($)" valor={money(resumen.totalFacturadoUsd)} color="var(--danger)" />
      </div>

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !movs.length ? (
        <EmptyState message="Sin movimientos de martillos." icon="🔨" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead>
              <tr>
                <th>Fecha</th><th>Descripción</th><th>$Usd Entregados</th><th>Cant. entregados</th>
                <th>Precio $/Martillo</th><th>$Usd Facturados</th><th>Saldo $ Usd</th>
                <th>Martillos a GT</th><th>Consumidos</th><th>Martillos restantes</th>{canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{m.fecha}</td>
                  <td style={{ maxWidth: 240, whiteSpace: 'pre-line' }}>{m.descripcion || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{m.usd_entregados ? money(m.usd_entregados) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.cantidad_entregados ? num(m.cantidad_entregados) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.precio_usd_martillo ? money(m.precio_usd_martillo) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{m.usd_facturados ? money(m.usd_facturados) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(m.saldo_usd)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.martillos_a_gt ? num(m.martillos_a_gt) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', color: m.consumidos ? 'var(--warning)' : undefined }}>{m.consumidos ? num(m.consumidos) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--primary-3)' }}>{num(m.martillos_restantes)}</td>
                  {canWrite && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setForm({ editar: m })}>✎</button>
                      <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setABorrar(m)}>🗑</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <MartilloFormModal actor={actor} actorName={actorName} precioVigente={resumen.precioVigente} editar={form.editar}
          onClose={() => setForm(null)} onSaved={async () => { setForm(null); await cargar(); }} />
      )}
      {aBorrar && (
        <ConfirmDialog
          title="Eliminar movimiento"
          message={aBorrar.consumidos
            ? '¿Eliminar este movimiento de martillos? Se recalculan el saldo $ y los restantes, y se elimina el gasto «USO DE MARTILLOS» asociado en la caja de Acopio.'
            : '¿Eliminar este movimiento de martillos? Se recalculan el saldo $ y los martillos restantes.'}
          confirmText="Eliminar" danger
          onCancel={() => setABorrar(null)}
          onConfirm={async () => {
            const m = aBorrar; setABorrar(null);
            try { await eliminarMovimientoMartillo(m.id); await cargar(); toast('Movimiento eliminado', 'success'); }
            catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
          }}
        />
      )}
      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar Consumo de Martillos"
          descripcion={`Se enviará el PDF del consumo de martillos del Molino H66 (${movs.length} movimiento(s)).`}
          defaultEmail={user?.email ?? ''}
          onEnviar={async (emails) => { const { destinatarios } = await enviarMartillosPorCorreo(movs, emails); return destinatarios; }}
          onClose={() => setCorreoOpen(false)}
        />
      )}
    </Modal>
  );
}

/* ───────────── Agregar / editar movimiento de martillos ───────────── */

type TipoMartillo = 'entrega' | 'consumo';

function MartilloFormModal({ actor, actorName, precioVigente, editar, onClose, onSaved }: {
  actor: string; actorName: string | null; precioVigente: number;
  editar: MartilloMovimiento | null; onClose: () => void; onSaved: () => void;
}) {
  const esEdicion = !!editar;
  const [tipo, setTipo] = useState<TipoMartillo>(editar && Number(editar.consumidos) > 0 ? 'consumo' : 'entrega');
  const [fecha, setFecha] = useState(editar?.fecha ?? new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState(editar?.descripcion ?? '');
  const [usdEntregados, setUsdEntregados] = useState(editar?.usd_entregados ? String(editar.usd_entregados) : '');
  const [cantEntregados, setCantEntregados] = useState(editar?.cantidad_entregados ? String(editar.cantidad_entregados) : '');
  const [usdFacturados, setUsdFacturados] = useState(editar?.usd_facturados ? String(editar.usd_facturados) : '');
  const [martillosAGt, setMartillosAGt] = useState(editar?.martillos_a_gt ? String(editar.martillos_a_gt) : '');
  const [consumidos, setConsumidos] = useState(editar?.consumidos ? String(editar.consumidos) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const r2 = (s: string) => Math.round((Number(s) || 0) * 100) / 100;
  // Entrega: precio por martillo sobre lo FACTURADO de esta fila (igual que el Excel).
  const precioEntrega = Number(cantEntregados) > 0 ? r2(usdFacturados) / Number(cantEntregados) : 0;
  // Consumo: se valora al PRECIO VIGENTE del martillo; gasto = cantidad × precio.
  const cantConsumo = Number(consumidos) || 0;
  const gastoConsumo = cantConsumo * precioVigente;

  async function guardar() {
    setError(null);
    let input: MartilloInput;
    if (tipo === 'consumo') {
      if (cantConsumo <= 0) { setError('Ingresá la cantidad de martillos consumidos.'); return; }
      if (precioVigente <= 0) { setError('No hay precio vigente del martillo: registrá primero una entrega facturada.'); return; }
      input = { fecha, descripcion, consumidos: cantConsumo };
    } else {
      const ent = r2(usdEntregados), fac = r2(usdFacturados);
      const cant = Number(cantEntregados) || 0, aGt = Number(martillosAGt) || 0;
      if (ent <= 0 && fac <= 0 && cant <= 0 && aGt <= 0) { setError('Ingresá al menos un valor.'); return; }
      input = { fecha, descripcion, usd_entregados: ent, cantidad_entregados: cant, usd_facturados: fac, martillos_a_gt: aGt, consumidos: 0 };
    }
    setSaving(true);
    try {
      if (esEdicion) await actualizarMovimientoMartillo(editar!.id, input);
      else await crearMovimientoMartillo(input, actor, actorName);
      toast(esEdicion ? 'Movimiento actualizado' : 'Movimiento registrado', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Registrar'}</button>
    </>
  );
  const destacado = { background: 'rgba(255,165,0,.12)', borderColor: 'var(--warning)', fontWeight: 700 } as const;
  const campoUsd = (label: string, val: string, set: (v: string) => void) => (
    <div className="form-row"><label>{label}</label><input className="input mono" type="number" min={0} step="0.01" value={val} onChange={(e) => set(e.target.value)} placeholder="0.00" /></div>
  );
  const campoNum = (label: string, val: string, set: (v: string) => void) => (
    <div className="form-row"><label>{label}</label><input className="input mono" type="number" min={0} step="any" value={val} onChange={(e) => set(e.target.value)} placeholder="0" /></div>
  );

  return (
    <Modal title={esEdicion ? 'Editar movimiento de martillos' : 'Agregar movimiento de martillos'} size="md" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-grid">
        <div className="form-row">
          <label>Tipo de movimiento</label>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" className={`btn btn-sm ${tipo === 'entrega' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTipo('entrega')}>⬇ Entrega</button>
            <button type="button" className={`btn btn-sm ${tipo === 'consumo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTipo('consumo')}>🔨 Consumo (uso)</button>
          </div>
        </div>
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Descripción</label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            placeholder={tipo === 'consumo' ? 'USO DE MARTILLOS EN…' : 'ENTREGA DE MARTILLOS A…'} />
        </div>
      </div>

      {tipo === 'entrega' ? (
        <>
          <div className="form-grid">
            {campoUsd('$ Usd Entregados', usdEntregados, setUsdEntregados)}
            {campoNum('Cantidad de martillos entregados', cantEntregados, setCantEntregados)}
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Precio $Usd por Martillo</label>
              <input className="input mono" value={precioEntrega ? money(precioEntrega) : ''} readOnly placeholder="se calcula" style={destacado} />
            </div>
            {campoUsd('$ Usd Facturados', usdFacturados, setUsdFacturados)}
          </div>
          <div className="form-grid">
            {campoNum('Martillos entregados a GT', martillosAGt, setMartillosAGt)}
            <div />
          </div>
        </>
      ) : (
        <>
          <div className="form-grid">
            {campoNum('Martillos consumidos (uso)', consumidos, setConsumidos)}
            <div className="form-row">
              <label>Precio vigente $/Martillo</label>
              <input className="input mono" value={precioVigente ? money(precioVigente) : ''} readOnly placeholder="—" />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Gasto generado (cantidad × precio)</label>
              <input className="input mono" value={gastoConsumo ? money(gastoConsumo) : ''} readOnly placeholder="se calcula" style={destacado} />
            </div>
            <div />
          </div>
          <p className="muted" style={{ fontSize: '.8rem', margin: '.4rem 0 0' }}>
            El consumo <strong>descuenta</strong> los martillos del inventario y registra el gasto <strong>«USO DE MARTILLOS»</strong> en la caja de Acopio.
          </p>
        </>
      )}
    </Modal>
  );
}
