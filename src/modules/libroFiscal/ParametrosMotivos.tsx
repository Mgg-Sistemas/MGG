/* ============================================================
   Golden Touch · Retenciones · Parámetros › Motivos de «No aplica» (R6)
   Por qué una factura no lleva retención: por impuesto o para todos, con
   vigencia y, si hace falta, un detalle escrito. Nada se borra: se desactiva.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { activarMotivo, faltaEnMotivo, guardarMotivo, listMotivos, vigenteEn, type MotivoDatos, type MotivoNoAplica } from './motivosSupuestos.repository';
import { opcionesImpuestoEnte } from './entes.repository';
import { fechaCorta, labelClave } from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { AYUDA_ORDEN, ROTULO_ORDEN } from './rotulos';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

export function ParametrosMotivos({ puedeEditar }: { puedeEditar: boolean }) {
  const [motivos, setMotivos] = useState<MotivoNoAplica[] | null>(null);
  const [impuestos, setImpuestos] = useState<{ clave: string; nombre: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<MotivoNoAplica | 'nuevo' | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [ms, imps] = await Promise.all([listMotivos(), opcionesImpuestoEnte().catch(() => [])]);
      setMotivos(ms); setImpuestos(imps); setError(null);
    } catch (e) { setError(mensaje(e, 'No se pudieron leer los motivos.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_motivos_no_aplica'], () => { void cargar(); });

  const nombre = (c: string | null) => (c ? impuestos.find((i) => i.clave === c)?.nombre ?? labelClave(c) : 'Todos');

  async function alternar(m: MotivoNoAplica) {
    const nota = window.prompt(m.activo ? '¿Por qué se desactiva este motivo?' : '¿Por qué se reactiva este motivo?');
    if (!nota?.trim()) return;
    try { await activarMotivo(m.id, !m.activo, nota); toast(m.activo ? 'Motivo desactivado.' : 'Motivo activado.', 'success'); void cargar(); } catch (e) { toast(mensaje(e, 'No se pudo cambiar.'), 'error'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>Los motivos que se eligen al marcar que una factura no lleva retención. La retención guarda el texto elegido tal como estaba ese día.</p>
        {puedeEditar && <button type="button" className="btn btn-primary" onClick={() => setEditar('nuevo')}>Nuevo motivo</button>}
      </div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!motivos && !error && <p className="muted">Leyendo los motivos…</p>}
      {motivos?.length === 0 && <p className="muted">No hay motivos cargados.</p>}
      {motivos && motivos.length > 0 && (
        <table className="table" style={{ fontSize: '.84rem', width: '100%' }}>
          <thead><tr><th>Motivo</th><th>Impuesto</th><th>Vigencia</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {motivos.map((m) => (
              <tr key={m.id} style={vigenteEn(m) ? undefined : { opacity: 0.6 }}>
                <td>{m.texto}{m.requiereTexto && <span className="muted"> · pide detalle</span>}{m.fuente && <div className="muted" style={{ fontSize: '.74rem' }}>{m.fuente}</div>}</td>
                <td>{nombre(m.impuestoClave)}</td>
                <td>{fechaCorta(m.desde)} – {m.hasta ? fechaCorta(m.hasta) : 'sin fin'}</td>
                <td>{!m.activo ? 'Inactivo' : vigenteEn(m) ? 'Vigente' : 'Fuera de vigencia'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {puedeEditar && <button type="button" className="btn btn-sm" onClick={() => setEditar(m)}>Editar</button>}
                  {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void alternar(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editar && <MotivoModal motivo={editar === 'nuevo' ? null : editar} impuestos={impuestos} onClose={() => setEditar(null)} onHecho={() => { setEditar(null); void cargar(); }} />}
    </div>
  );
}

function MotivoModal({ motivo, impuestos, onClose, onHecho }: {
  motivo: MotivoNoAplica | null; impuestos: { clave: string; nombre: string | null }[]; onClose: () => void; onHecho: () => void;
}) {
  const [m, setM] = useState<MotivoDatos>(motivo
    ? { impuestoClave: motivo.impuestoClave, texto: motivo.texto, requiereTexto: motivo.requiereTexto, orden: motivo.orden, desde: motivo.desde, hasta: motivo.hasta, fuente: motivo.fuente, activo: motivo.activo }
    : { impuestoClave: null, texto: '', requiereTexto: false, orden: 10, desde: hoyIso(), hasta: null, fuente: null, activo: true });
  const [nota, setNota] = useState(motivo ? '' : 'Alta del motivo');
  const [guardando, setGuardando] = useState(false);
  const falta = faltaEnMotivo(m, nota);
  const set = (p: Partial<MotivoDatos>) => setM((x) => ({ ...x, ...p }));

  async function guardar() {
    setGuardando(true);
    try { await guardarMotivo(m, nota, motivo?.id); toast('Motivo guardado.', 'success'); onHecho(); } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); setGuardando(false); }
  }

  return (
    <Modal title={motivo ? 'Editar motivo' : 'Nuevo motivo'} onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-row"><label>Motivo</label><input className="input" value={m.texto} onChange={(e) => set({ texto: e.target.value })} placeholder="Ej.: el pago no supera el mínimo exento" /></div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 160px' }}>
            <label>Impuesto</label>
            <select className="select" value={m.impuestoClave ?? ''} onChange={(e) => set({ impuestoClave: e.target.value || null })}>
              <option value="">Todos</option>
              {impuestos.map((i) => <option key={i.clave} value={i.clave}>{i.nombre ?? labelClave(i.clave)}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 180px' }}><label>{ROTULO_ORDEN}</label><input className="input mono" inputMode="numeric" value={String(m.orden)} onChange={(e) => set({ orden: Number(e.target.value.replace(/\D/g, '')) || 0 })} /><small className="hint muted">{AYUDA_ORDEN}</small></div>
          <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.86rem' }}><input type="checkbox" checked={m.requiereTexto} onChange={(e) => set({ requiereTexto: e.target.checked })} /> Pide un detalle escrito</label>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '0 1 160px' }}><label>Desde</label><input className="input" type="date" value={m.desde} onChange={(e) => set({ desde: e.target.value })} /></div>
          <div className="form-row" style={{ flex: '0 1 160px' }}><label>Hasta</label><input className="input" type="date" value={m.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value || null })} /></div>
          <div className="form-row" style={{ flex: '2 1 200px' }}><label>Fuente</label><input className="input" value={m.fuente ?? ''} onChange={(e) => set({ fuente: e.target.value })} /></div>
        </div>
        <div className="form-row"><label>Motivo del cambio</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: m.texto || nota ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}
