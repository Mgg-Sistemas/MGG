/* ============================================================
   Golden Touch · Retenciones · Parámetros: Régimen de la empresa (R1)
   Agente de retención de IVA y contribuyente especial, cada uno desde una
   fecha, con motivo e historial. Escribe solo en retencion_agente_condiciones;
   la base copia el valor de hoy al JSON de Parámetros mientras convivan.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  condicionVigente, consultarCondicion, faltaEnCondicion, listCondiciones,
  registrarCondicion, actualizarCondicion, eliminarCondicion, type CondicionAgente, type CondicionRegistrada,
} from './agenteCondiciones.repository';
import type { ClaveImpuesto } from './entes.repository';
import { fechaCorta } from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { rotuloAutor, rotuloMotivo } from './rotulos';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

const RENGLONES: { impuesto: ClaveImpuesto | null; condicion: CondicionAgente; titulo: string; ayuda: string }[] = [
  {
    impuesto: 'IVA', condicion: 'agente_retencion', titulo: 'Agente de retención de IVA',
    ayuda: 'Con esta designación la empresa retiene IVA a sus proveedores (75 % o 100 %).',
  },
  {
    impuesto: null, condicion: 'contribuyente_especial', titulo: 'Contribuyente especial',
    ayuda: 'El especial también retiene IVA y percibe el IGTF.',
  },
];

export function ParametrosRegimen({ puedeEditar }: { puedeEditar: boolean }) {
  const [historial, setHistorial] = useState<CondicionRegistrada[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setHistorial(await listCondiciones()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el régimen.'); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_agente_condiciones'], () => { void cargar(); });

  return (
    <div>
      <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>
        Cada cambio vale desde su fecha. Una retención se valida con el régimen vigente a la fecha de su factura.
      </p>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}
      {!historial && !error && <p className="muted">Leyendo el régimen…</p>}
      {historial && RENGLONES.map((r) => (
        <RenglonRegimen key={r.condicion} {...r} historial={historial.filter((h) => h.condicion === r.condicion && h.impuestoClave === r.impuesto)}
          puedeEditar={puedeEditar} onCambio={() => void cargar()} />
      ))}
    </div>
  );
}

function RenglonRegimen({ impuesto, condicion, titulo, ayuda, historial, puedeEditar, onCambio }: {
  impuesto: ClaveImpuesto | null; condicion: CondicionAgente; titulo: string; ayuda: string;
  historial: CondicionRegistrada[]; puedeEditar: boolean; onCambio: () => void;
}) {
  const hoy = hoyIso();
  const vigente = condicionVigente(historial, impuesto, condicion, hoy);
  const [valorBase, setValorBase] = useState<boolean | null>(null);
  const [valor, setValor] = useState<'si' | 'no'>('si');
  const [desde, setDesde] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const [fuente, setFuente] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Edición inline de filas en el historial
  const [editId, setEditId] = useState<string | null>(null);
  const [editDesde, setEditDesde] = useState('');
  const [editValor, setEditValor] = useState<'si' | 'no'>('si');
  const [editMotivo, setEditMotivo] = useState('');
  const [editFuente, setEditFuente] = useState('');
  const [guardandoFila, setGuardandoFila] = useState(false);

  function empezarEdicion(h: CondicionRegistrada) {
    setEditId(h.id);
    setEditDesde(h.desde);
    setEditValor(h.valor ? 'si' : 'no');
    setEditMotivo(h.motivo);
    setEditFuente(h.fuente ?? '');
  }

  async function guardarFila(id: string) {
    if (!editDesde) { toast('Indica la fecha desde.', 'error'); return; }
    if (!editMotivo.trim()) { toast('Indica el motivo del cambio.', 'error'); return; }
    setGuardandoFila(true);
    try {
      await actualizarCondicion(id, {
        desde: editDesde,
        valor: editValor === 'si',
        motivo: editMotivo.trim(),
        fuente: editFuente.trim() || null,
      });
      toast('Régimen actualizado.', 'success');
      setEditId(null);
      onCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo actualizar el registro.', 'error');
    } finally {
      setGuardandoFila(false);
    }
  }

  async function borrarFila(id: string) {
    if (!window.confirm('¿Seguro que deseas eliminar este registro del historial del régimen?')) return;
    setGuardandoFila(true);
    try {
      await eliminarCondicion(id);
      toast('Registro eliminado del régimen.', 'success');
      setEditId(null);
      onCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar el registro.', 'error');
    } finally {
      setGuardandoFila(false);
    }
  }

  // Lo que la base aplica hoy (incluye la vuelta al JSON de Parámetros si no hay registro vigente).
  useEffect(() => {
    let vivo = true;
    consultarCondicion(impuesto, condicion, hoy).then((v) => { if (vivo) setValorBase(v); }).catch(() => { if (vivo) setValorBase(null); });
    return () => { vivo = false; };
  }, [impuesto, condicion, hoy, historial.length]);
  // Propone el cambio contrario al vigente; solo cuando cambia el vigente, para no pisar lo elegido.
  const vigenteId = vigente?.id; const vigenteValor = vigente?.valor;
  useEffect(() => { if (vigenteId) setValor(vigenteValor ? 'no' : 'si'); }, [vigenteId, vigenteValor]);

  const nueva = { impuestoClave: impuesto, condicion, valor: valor === 'si', desde, motivo, fuente };
  const falta = faltaEnCondicion(nueva);

  async function registrar() {
    setGuardando(true);
    try {
      await registrarCondicion(nueva);
      toast(`${titulo}: cambio registrado.`, 'success');
      setMotivo(''); setFuente('');
      onCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo registrar el cambio.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const actual = vigente ? vigente.valor : valorBase;
  return (
    <div className="card" style={{ marginBottom: '.7rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{titulo}</strong>
        <span style={{ fontWeight: 700, color: actual ? 'var(--success)' : 'var(--text-muted)' }}>
          Hoy: {actual == null ? '—' : actual ? 'Sí' : 'No'}
        </span>
      </div>
      <p className="muted" style={{ fontSize: '.78rem', margin: '.2rem 0 .4rem' }}>
        {ayuda} {vigente ? `Vigente desde ${fechaCorta(vigente.desde)}${vigente.fuente ? ` · ${vigente.fuente}` : ''}.` : 'Sin cambios registrados todavía: vale lo cargado en Parámetros.'}
      </p>

      {puedeEditar && (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ flex: '0 1 110px', margin: 0 }}>
            <label>Pasa a</label>
            <select className="select" value={valor} onChange={(e) => setValor(e.target.value as 'si' | 'no')}>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
            <label>Desde</label>
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
            <label>Motivo</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
            <label>Providencia o acto</label>
            <input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="N° y fecha" />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void registrar()} disabled={!!falta || guardando}>
            {guardando ? 'Guardando…' : 'Registrar cambio'}
          </button>
        </div>
      )}
      {puedeEditar && falta && <small className="hint" style={{ color: motivo || fuente ? 'var(--warning)' : undefined }}>{falta}</small>}

      {historial.length > 0 && (
        <details style={{ marginTop: '.5rem' }} open={historial.length <= 3}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: '.8rem' }}>Historial ({historial.length})</summary>
          <table className="table" style={{ fontSize: '.78rem', width: '100%', marginTop: '.3rem' }}>
            <thead>
              <tr>
                <th>Desde</th><th>Hasta</th><th>Valor</th><th>Motivo</th><th>Fuente</th><th>Quién</th>
                {puedeEditar && <th>Acción</th>}
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => {
                const enEdicion = editId === h.id;
                if (enEdicion) {
                  return (
                    <tr key={h.id} style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <td>
                        <input className="input" type="date" value={editDesde} onChange={(e) => setEditDesde(e.target.value)} style={{ width: '130px', padding: '2px 6px', fontSize: '.78rem' }} />
                      </td>
                      <td>{h.hasta ? fechaCorta(h.hasta) : '—'}</td>
                      <td>
                        <select className="select" value={editValor} onChange={(e) => setEditValor(e.target.value as 'si' | 'no')} style={{ width: '65px', padding: '2px 4px', fontSize: '.78rem' }}>
                          <option value="si">Sí</option>
                          <option value="no">No</option>
                        </select>
                      </td>
                      <td>
                        <input className="input" value={editMotivo} onChange={(e) => setEditMotivo(e.target.value)} placeholder="Motivo" style={{ padding: '2px 6px', fontSize: '.78rem' }} />
                      </td>
                      <td>
                        <input className="input" value={editFuente} onChange={(e) => setEditFuente(e.target.value)} placeholder="Providencia/Acto" style={{ padding: '2px 6px', fontSize: '.78rem' }} />
                      </td>
                      <td>{rotuloAutor(h.actualizadoPor)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => void guardarFila(h.id)} disabled={guardandoFila}>
                            Guardar
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditId(null)} disabled={guardandoFila}>
                            Cancelar
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => void borrarFila(h.id)} disabled={guardandoFila} title="Eliminar registro">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={h.id}>
                    <td><strong>{fechaCorta(h.desde)}</strong></td>
                    <td>{h.hasta ? fechaCorta(h.hasta) : '—'}</td>
                    <td><span style={{ fontWeight: 600, color: h.valor ? 'var(--success)' : 'var(--text-muted)' }}>{h.valor ? 'Sí' : 'No'}</span></td>
                    <td>{rotuloMotivo(h.motivo)}</td>
                    <td>{h.fuente ?? '—'}</td>
                    <td>{rotuloAutor(h.actualizadoPor)}</td>
                    {puedeEditar && (
                      <td>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => empezarEdicion(h)}>
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
