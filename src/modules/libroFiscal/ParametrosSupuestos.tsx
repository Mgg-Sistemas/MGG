/* ============================================================
   Golden Touch · Retenciones · Parámetros › Supuestos con % propio (R6)
   Los casos que imponen un porcentaje de retención (el 100 % del art. 5 del
   IVA), por impuesto y con vigencia. El registro muestra los vigentes a la
   fecha de la factura y guarda el texto elegido. Nada se borra: se desactiva.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  activarSupuesto, faltaEnSupuesto, guardarSupuesto, listSupuestos, supuestoRepetido, vigenteEn, type Supuesto, type SupuestoDatos,
} from './motivosSupuestos.repository';
import { opcionesImpuestoEnte } from './entes.repository';
import { fechaCorta, labelClave } from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { numeroATexto } from './validarCarga';
import { AYUDA_ORDEN, ROTULO_ORDEN } from './rotulos';
import { leerSupuestoNumeros, normalizarCodigoSupuesto, pistaClave, pistaLeido } from './parametrosNumeros';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

export function ParametrosSupuestos({ puedeEditar }: { puedeEditar: boolean }) {
  const [supuestos, setSupuestos] = useState<Supuesto[] | null>(null);
  const [impuestos, setImpuestos] = useState<{ clave: string; nombre: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<Supuesto | 'nuevo' | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [ss, imps] = await Promise.all([listSupuestos(), opcionesImpuestoEnte().catch(() => [])]);
      setSupuestos(ss); setImpuestos(imps); setError(null);
    } catch (e) { setError(mensaje(e, 'No se pudieron leer los supuestos.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_supuestos'], () => { void cargar(); });

  const nombre = (c: string) => impuestos.find((i) => i.clave === c)?.nombre ?? labelClave(c);

  async function alternar(s: Supuesto) {
    const nota = window.prompt(s.activo ? '¿Por qué se desactiva este supuesto?' : '¿Por qué se reactiva este supuesto?');
    if (!nota?.trim()) return;
    try { await activarSupuesto(s.id, !s.activo, nota); toast(s.activo ? 'Supuesto desactivado.' : 'Supuesto activado.', 'success'); void cargar(); } catch (e) { toast(mensaje(e, 'No se pudo cambiar.'), 'error'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>Los supuestos que imponen un % de retención. Al registrar se ofrecen los vigentes a la fecha de la factura; si se marca más de uno, manda el % mayor.</p>
        {puedeEditar && <button type="button" className="btn btn-primary" onClick={() => setEditar('nuevo')}>Nuevo supuesto</button>}
      </div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!supuestos && !error && <p className="muted">Leyendo los supuestos…</p>}
      {supuestos?.length === 0 && <p className="muted">No hay supuestos cargados.</p>}
      {supuestos && supuestos.length > 0 && (
        <table className="table" style={{ fontSize: '.84rem', width: '100%' }}>
          <thead><tr><th>Supuesto</th><th>Impuesto</th><th>%</th><th>Vigencia</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {supuestos.map((s) => (
              <tr key={s.id} style={vigenteEn(s) ? undefined : { opacity: 0.6 }}>
                <td>{s.texto}{s.fuente && <div className="muted" style={{ fontSize: '.72rem' }}>{s.fuente}</div>}</td>
                <td>{nombre(s.impuestoClave)}</td>
                <td className="mono">{s.pct} %</td>
                <td>{fechaCorta(s.desde)} – {s.hasta ? fechaCorta(s.hasta) : 'sin fin'}</td>
                <td>{!s.activo ? 'Inactivo' : vigenteEn(s) ? 'Vigente' : 'Fuera de vigencia'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {puedeEditar && <button type="button" className="btn btn-sm" onClick={() => setEditar(s)}>Editar</button>}
                  {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void alternar(s)}>{s.activo ? 'Desactivar' : 'Activar'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editar && <SupuestoModal supuesto={editar === 'nuevo' ? null : editar} supuestos={supuestos ?? []} impuestos={impuestos} onClose={() => setEditar(null)} onHecho={() => { setEditar(null); void cargar(); }} />}
    </div>
  );
}

function SupuestoModal({ supuesto, supuestos, impuestos, onClose, onHecho }: {
  supuesto: Supuesto | null;
  /** Los que ya hay: para avisar si el código se repite cambiando solo mayúsculas. */
  supuestos: Supuesto[];
  impuestos: { clave: string; nombre: string | null }[]; onClose: () => void; onHecho: () => void;
}) {
  const [s, setS] = useState<SupuestoDatos>(supuesto
    ? { impuestoClave: supuesto.impuestoClave, codigo: supuesto.codigo, texto: supuesto.texto, pct: supuesto.pct, orden: supuesto.orden, desde: supuesto.desde, hasta: supuesto.hasta, fuente: supuesto.fuente, activo: supuesto.activo }
    : { impuestoClave: 'IVA', codigo: '', texto: '', pct: 100, orden: 10, desde: hoyIso(), hasta: null, fuente: null, activo: true });
  const [pctTexto, setPctTexto] = useState(numeroATexto(s.pct));
  const [ordenTexto, setOrdenTexto] = useState(numeroATexto(s.orden));
  // El código se escribe libre y se guarda sin acentos y con «_» en vez de espacios (camelCase, como las semillas).
  const [codigoEscrito, setCodigoEscrito] = useState(s.codigo);
  const pistaCodigo = supuesto ? null : pistaClave(codigoEscrito, s.codigo);
  const [nota, setNota] = useState(supuesto ? '' : 'Alta del supuesto');
  const [guardando, setGuardando] = useState(false);
  // Un solo lector: % vacío falta (no se guarda 0 %) y lo ilegible bloquea.
  const numeros = leerSupuestoNumeros(pctTexto, ordenTexto);
  const datos: SupuestoDatos = { ...s, ...('error' in numeros ? {} : numeros.valor) };
  const falta = 'error' in numeros ? numeros.error
    : faltaEnSupuesto(datos, nota) ?? (supuesto ? null : supuestoRepetido(datos, supuestos));
  const set = (p: Partial<SupuestoDatos>) => setS((x) => ({ ...x, ...p }));

  async function guardar() {
    if (falta) { toast(falta, 'error'); return; }
    setGuardando(true);
    try { await guardarSupuesto(datos, nota, supuesto?.id); toast('Supuesto guardado.', 'success'); onHecho(); } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); setGuardando(false); }
  }

  return (
    <Modal title={supuesto ? 'Editar supuesto' : 'Nuevo supuesto'} onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-row"><label>Supuesto</label><input className="input" value={s.texto} onChange={(e) => set({ texto: e.target.value })} /></div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 150px' }}>
            <label>Impuesto</label>
            <select className="select" value={s.impuestoClave} onChange={(e) => set({ impuestoClave: e.target.value })} disabled={!!supuesto}>
              {impuestos.map((i) => <option key={i.clave} value={i.clave}>{i.nombre ?? labelClave(i.clave)}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 160px' }}>
            <label>Código</label>
            <input className="input mono" value={codigoEscrito} disabled={!!supuesto} onChange={(e) => { setCodigoEscrito(e.target.value); set({ codigo: normalizarCodigoSupuesto(e.target.value) }); }} />
            {pistaCodigo && <small className="hint muted">{pistaCodigo}</small>}
          </div>
          <div className="form-row" style={{ flex: '0 1 100px' }}><label>%</label><input className="input mono" type="text" inputMode="decimal" value={pctTexto} onChange={(e) => setPctTexto(e.target.value)} />{pistaLeido(pctTexto, 0) && <small className="hint muted">{pistaLeido(pctTexto, 0)}</small>}</div>
          <div className="form-row" style={{ flex: '1 1 180px' }}><label>{ROTULO_ORDEN}</label><input className="input mono" type="text" inputMode="numeric" value={ordenTexto} onChange={(e) => setOrdenTexto(e.target.value)} /><small className="hint muted">{AYUDA_ORDEN} Vacío = 10.</small></div>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '0 1 160px' }}><label>Desde</label><input className="input" type="date" value={s.desde} onChange={(e) => set({ desde: e.target.value })} /></div>
          <div className="form-row" style={{ flex: '0 1 160px' }}><label>Hasta</label><input className="input" type="date" value={s.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value || null })} /></div>
          <div className="form-row" style={{ flex: '2 1 200px' }}><label>Fuente</label><input className="input" value={s.fuente ?? ''} onChange={(e) => set({ fuente: e.target.value })} placeholder="Providencia y artículo" /></div>
        </div>
        <div className="form-row"><label>Motivo del cambio</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: s.texto || s.codigo || nota || 'error' in numeros ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}
