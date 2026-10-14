/* ============================================================
   MGG · RRHH · Empresas / nóminas: gestionar y transferir personal
   - EmpresasModal: la lista de nóminas, crear una nueva, editar nombre/razón
     social/RIF/icono/color, deshabilitar (si no tiene gente) o volver a habilitar.
   - TransferirEmpresaModal: pasar a una persona de su nómina a otra.
   ============================================================ */
import { useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Personal } from '@/shared/lib/types';
import {
  DATOS_EMPRESA_VACIOS, datosDeEmpresa, definicionEmpresa, destinosDeTransferencia, errorDeshabilitarEmpresa,
  normalizarCodigoEmpresa, validarEmpresa, type DatosEmpresa, type DefinicionEmpresa,
} from './empresa';
import { actualizarEmpresa, cambiarEstadoEmpresa, crearEmpresa, transferirPersonal } from './empresas.repository';

const ICONOS = ['🏢', '⛏', '🔧', '🚚', '🏭', '🧪', '🌾', '⚙', '🏗', '🧱'];

export function EmpresasModal({ empresas, conteo, actor, actorName, onClose, onChanged }: {
  empresas: DefinicionEmpresa[]; conteo: Record<string, number> | null;
  actor: string; actorName: string | null; onClose: () => void; onChanged: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState<DatosEmpresa>(DATOS_EMPRESA_VACIOS);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function abrirNueva() { setEditando(null); setNueva(true); setForm(DATOS_EMPRESA_VACIOS); setError(null); }
  function abrirEditar(e: DefinicionEmpresa) { setNueva(false); setEditando(e.key); setForm(datosDeEmpresa(e)); setError(null); }
  function cerrarForm() { setNueva(false); setEditando(null); setError(null); }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    const err = validarEmpresa(form, empresas, editando);
    if (err) { setError(err); return; }
    setGuardando(true);
    try {
      if (editando) await actualizarEmpresa(editando, form, actor, actorName);
      else await crearEmpresa(form, actor, actorName, empresas.length);
      toast(editando ? 'Empresa actualizada' : `Nómina ${normalizarCodigoEmpresa(form.codigo)} creada`, 'success');
      cerrarForm(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  async function cambiarEstado(e: DefinicionEmpresa) {
    if (e.activa) {
      const err = errorDeshabilitarEmpresa(e, conteo?.[e.key] ?? 0);
      if (err) { toast(err, 'error'); return; }
    }
    try {
      await cambiarEstadoEmpresa(e.key, !e.activa, actor, actorName);
      toast(e.activa ? `Nómina ${e.label} deshabilitada` : `Nómina ${e.label} habilitada`, 'success');
      onChanged();
    } catch (x) { toast(x instanceof Error ? x.message : 'No se pudo cambiar', 'error'); }
  }

  const abierto = nueva || editando != null;

  return (
    <Modal title="⚙ Empresas / nóminas" size="lg" onClose={() => !guardando && onClose()}
      footer={<button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0 }}>
        Cada empresa es una <strong>nómina aparte</strong>: su personal, anticipos, períodos, recibos y descansos.
        Con dos o menos, arriba se ven como pastillas; con tres o más, como lista buscable.
        Una persona se pasa de una a otra con <strong>↔ Transferir</strong> en su ficha.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr><th>Nómina</th><th>Razón social</th><th>RIF</th><th style={{ textAlign: 'right' }}>Activos</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.key} style={{ opacity: e.activa ? 1 : .55 }}>
                <td><span aria-hidden="true">{e.icono}</span> <strong style={{ color: e.color }}>{e.label}</strong> <span className="muted mono" style={{ fontSize: '.8em' }}>{e.key}</span></td>
                <td>{e.razonSocial}</td>
                <td className="mono">{e.rif ?? '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{conteo?.[e.key] ?? '—'}</td>
                <td><span className="badge" style={{ color: e.activa ? 'var(--success)' : 'var(--muted)' }}>{e.activa ? 'Activa' : 'Deshabilitada'}</span></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => abrirEditar(e)} title="Editar">✎</button>
                  {e.key !== 'MGG' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => void cambiarEstado(e)}
                      title={e.activa ? 'Deshabilitar (solo si no tiene gente activa)' : 'Volver a habilitar'}>
                      {e.activa ? '⏸' : '▶'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!abierto && (
        <div style={{ marginTop: '.75rem' }}>
          <button className="btn btn-primary" onClick={abrirNueva}>+ Nueva empresa / nómina</button>
        </div>
      )}

      {abierto && (
        <form onSubmit={(ev) => void guardar(ev)} className="card" style={{ marginTop: '.75rem', display: 'grid', gap: '.6rem' }}>
          <strong>{editando ? `✎ Editar ${definicionEmpresa(editando).label}` : '+ Nueva empresa / nómina'}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.6rem' }}>
            <label>Código <span className="muted">(2 a 10 letras/números)</span>
              <input className="input mono" value={form.codigo} disabled={editando != null} maxLength={10} autoFocus={!editando}
                onChange={(ev) => setForm((f) => ({ ...f, codigo: normalizarCodigoEmpresa(ev.target.value) }))} placeholder="MTO" />
            </label>
            <label>Nombre corto <span className="muted">(el del switch)</span>
              <input className="input" value={form.nombre} maxLength={30} autoFocus={editando != null}
                onChange={(ev) => setForm((f) => ({ ...f, nombre: ev.target.value }))} placeholder="MTO" />
            </label>
            <label>RIF
              <input className="input mono" value={form.rif} onChange={(ev) => setForm((f) => ({ ...f, rif: ev.target.value.toUpperCase() }))} placeholder="J-12345678-9" />
            </label>
          </div>
          <label>Razón social <span className="muted">(sale en los recibos y PDF)</span>
            <input className="input" value={form.razonSocial} maxLength={120}
              onChange={(ev) => setForm((f) => ({ ...f, razonSocial: ev.target.value }))} placeholder="Mantenimiento y Transporte Oriente C.A." />
          </label>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="muted" style={{ fontSize: '.85em' }}>Icono</div>
              <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
                {ICONOS.map((i) => (
                  <button key={i} type="button" className={`btn btn-sm ${form.icono === i ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setForm((f) => ({ ...f, icono: i }))} aria-label={`Icono ${i}`}>{i}</button>
                ))}
                <input className="input" value={form.icono} maxLength={4} style={{ width: 64 }}
                  onChange={(ev) => setForm((f) => ({ ...f, icono: ev.target.value }))} title="O escribe otro" />
              </div>
            </div>
            <label>Color
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#ff8a00'}
                onChange={(ev) => setForm((f) => ({ ...f, color: ev.target.value }))} style={{ display: 'block', width: 64, height: 36 }} />
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={cerrarForm} disabled={guardando}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
          {error && <div className="alert alert-danger" style={{ margin: 0 }}>{error}</div>}
        </form>
      )}
    </Modal>
  );
}

/* ───────── Transferir a una persona de una nómina a otra ───────── */
export function TransferirEmpresaModal({ persona, empresas, actor, actorName, onClose, onDone }: {
  persona: Personal; empresas: DefinicionEmpresa[]; actor: string; actorName: string | null;
  onClose: () => void; onDone: () => void;
}) {
  const destinos = destinosDeTransferencia(persona.empresa, empresas);
  const [destino, setDestino] = useState<string>(destinos.length === 1 ? destinos[0].key : '');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const actual = definicionEmpresa(persona.empresa);
  const elegida = destino ? definicionEmpresa(destino) : null;

  async function confirmar() {
    if (!destino) { toast('Elige la nómina de destino', 'error'); return; }
    setGuardando(true);
    try {
      await transferirPersonal(persona.id, destino, motivo, actor, actorName);
      toast(`${persona.nombre} ${persona.apellido} pasó a la nómina ${elegida?.label ?? destino}`, 'success');
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo transferir', 'error'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title={`↔ Transferir a otra nómina · ${persona.nombre} ${persona.apellido}`} size="md" onClose={() => !guardando && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void confirmar()} disabled={guardando || !destino}>
            {guardando ? 'Transfiriendo…' : `Transferir a ${elegida?.label ?? '…'}`}
          </button>
        </>
      }>
      <p style={{ marginTop: 0 }}>
        Hoy está en la nómina <strong style={{ color: actual.color }}>{actual.icono} {actual.label}</strong>
        {persona.numero_ficha ? <> (ficha <span className="mono">{persona.numero_ficha}</span>)</> : null}.
      </p>
      <div style={{ display: 'grid', gap: '.5rem' }}>
        <div className="muted" style={{ fontSize: '.85em' }}>Pasar a</div>
        <div role="radiogroup" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {destinos.map((e) => (
            <button key={e.key} type="button" role="radio" aria-checked={destino === e.key}
              className={`btn ${destino === e.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDestino(e.key)}>
              <span aria-hidden="true">{e.icono}</span> {e.label} <span className="muted" style={{ fontSize: '.8em' }}>· {e.razonSocial}</span>
            </button>
          ))}
          {!destinos.length && <span className="muted">No hay otra nómina activa: créala en ⚙ Empresas.</span>}
        </div>
        <label>Motivo <span className="muted">(opcional, queda en el expediente)</span>
          <textarea className="input" rows={2} value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
            placeholder="Ej.: pasa al equipo de mantenimiento desde el 16/10" />
        </label>
      </div>
      <div className="alert" style={{ marginTop: '.75rem', marginBottom: 0 }}>
        Se lleva su <strong>ficha</strong>, sus <strong>anticipos y préstamos activos</strong> (se siguen descontando en la nómina nueva)
        y sus <strong>vacaciones, permisos y notas</strong>. Los <strong>recibos ya cargados o pagados</strong> se quedan en la nómina
        {' '}{actual.label}: son historia de esa empresa. Su N° de ficha no cambia.
      </div>
    </Modal>
  );
}
