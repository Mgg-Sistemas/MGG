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
  registrarCondicion, actualizarCondicion, eliminarCondicion, aplicarRegimenMaestro,
  type CondicionAgente, type CondicionRegistrada,
} from './agenteCondiciones.repository';
import type { ClaveImpuesto } from './entes.repository';
import { regimenPorEmpresaDisponible } from './disponibilidad';
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
  {
    impuesto: 'MUNICIPAL', condicion: 'agente_retencion', titulo: 'Agente de retención municipal (ISAE)',
    ayuda: 'Con esta designación formal de la Alcaldía, la empresa retiene Impuesto sobre Actividades Económicas (ISAE) a proveedores.',
  },
  {
    impuesto: 'IGTF', condicion: 'agente_percepcion', titulo: 'Agente de percepción de IGTF',
    ayuda: 'Condición específica de percepción de IGTF sobre pagos en divisas o criptoactivos.',
  },
];

export function ParametrosRegimen({ puedeEditar, empresas = [], empresaIdInicial = null, puedeBorrar = false, onRegimenCambiado }: {
  puedeEditar: boolean;
  /** D2: empresas (datos planos) para elegir de quién se edita el régimen. Vacío = single-empresa. */
  empresas?: { id: string; nombre: string }[];
  empresaIdInicial?: string | null;
  /** Borrar una fila del régimen es admin-only (la tabla no tiene política DELETE para otros). */
  puedeBorrar?: boolean;
  onRegimenCambiado?: () => void;
}) {
  const [historial, setHistorial] = useState<CondicionRegistrada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // D2: el régimen por empresa (la base trae empresa_id). Sin esto, todo es GT como hoy.
  const [d2, setD2] = useState(false);
  useEffect(() => { regimenPorEmpresaDisponible().then(setD2).catch(() => setD2(false)); }, []);
  const porEmpresa = d2 && empresas.length > 1;
  const [empresaId, setEmpresaId] = useState<string | null>(empresaIdInicial ?? empresas[0]?.id ?? null);

  const cargar = useCallback(async () => {
    try { setHistorial(await listCondiciones(porEmpresa ? empresaId : null)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el régimen.'); }
  }, [porEmpresa, empresaId]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_agente_condiciones'], () => { void cargar(); });

  const hoy = hoyIso();
  const empresaNombre = empresas.find((e) => e.id === empresaId)?.nombre ?? 'Golden Touch 1127 C.A.';

  // Condiciones vigentes hoy: en Venezuela, solo la calificación formal como Contribuyente Especial otorga la cualidad
  const vIva = historial ? condicionVigente(historial, 'IVA', 'agente_retencion', hoy) : null;
  const vEsp = historial ? condicionVigente(historial, null, 'contribuyente_especial', hoy) : null;
  const esEspecialActual = Boolean(vEsp?.valor);
  const esOrdinarioActual = !esEspecialActual;

  const [targetRegimen, setTargetRegimen] = useState<'ordinario' | 'especial'>('ordinario');
  const [fechaDesde, setFechaDesde] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const [fuente, setFuente] = useState('');
  const [guardandoRegimen, setGuardandoRegimen] = useState(false);

  // Sincronizar targetRegimen cuando carga o cambia la empresa
  useEffect(() => {
    if (historial) {
      setTargetRegimen(esEspecialActual ? 'especial' : 'ordinario');
      setFechaDesde(hoy);
    }
  }, [historial, esEspecialActual, hoy]);

  async function handleAplicarRegimen() {
    if (!fechaDesde) {
      toast('Indica la fecha de vigencia del régimen.', 'warning');
      return;
    }
    const mot = motivo.trim() || (targetRegimen === 'especial'
      ? 'Designación como Contribuyente Especial por el SENIAT'
      : 'Contribuyente Ordinario (No retiene IVA)');
    setGuardandoRegimen(true);
    try {
      await aplicarRegimenMaestro({
        empresaId: porEmpresa ? empresaId : null,
        esEspecial: targetRegimen === 'especial',
        desde: fechaDesde,
        motivo: mot,
        fuente: fuente.trim() || (targetRegimen === 'especial' ? 'Providencia SENIAT' : null),
      });
      toast(`Régimen aplicado con éxito: ${empresaNombre} ahora opera como ${targetRegimen === 'especial' ? 'Contribuyente Especial' : 'Contribuyente Ordinario'}.`, 'success');
      setMotivo('');
      setFuente('');
      await cargar();
      onRegimenCambiado?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo aplicar el régimen.', 'error');
    } finally {
      setGuardandoRegimen(false);
    }
  }

  return (
    <div>
      {porEmpresa && (
        <div className="form-row" style={{ marginBottom: '.75rem' }}>
          <label style={{ fontWeight: 600 }}>Empresa receptora</label>
          <select className="select" value={empresaId ?? ''} onChange={(e) => setEmpresaId(e.target.value)} style={{ maxWidth: 360 }}>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <small className="muted" style={{ display: 'block', marginTop: 2 }}>El régimen se administra por empresa: cada designación afecta a esta razón social.</small>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}

      {!historial && !error && <p className="muted">Consultando el régimen vigente…</p>}

      {historial && (
        <>
          {/* Banner de Estado Actual */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem',
            padding: '.85rem 1.15rem',
            background: esEspecialActual ? 'rgba(245, 158, 11, 0.08)' : 'rgba(56, 189, 248, 0.08)',
            border: `1.5px solid ${esEspecialActual ? 'rgba(245, 158, 11, 0.35)' : 'rgba(56, 189, 248, 0.3)'}`,
            borderRadius: 12, marginBottom: '1rem',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '.96rem' }}>
                  {empresaNombre} opera hoy como: {esEspecialActual ? '⭐ Contribuyente Especial' : '🏢 Contribuyente Ordinario'}
                </strong>
                <span className={`lfv8-regimen-badge ${esEspecialActual ? 'especial' : 'ordinario'}`}>
                  {esEspecialActual ? 'Sujeto Pasivo Especial' : 'Régimen General'}
                </span>
              </div>
              <div className="muted" style={{ fontSize: '.8rem', marginTop: '.25rem', lineHeight: 1.4 }}>
                {esEspecialActual
                  ? 'La empresa es Agente de Retención de IVA (75 % / 100 %) y perceptor de IGTF (3 %). Retiene ISLR e ISAE Municipal.'
                  : 'La empresa NO retiene IVA a sus proveedores (el IVA se paga íntegro) y no percibe IGTF · Retiene ISLR (Decreto 1.808) e ISAE Municipal.'}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '.76rem', color: 'var(--text-muted)' }}>
              <div>Vigente desde: <strong>{fechaCorta(vIva?.desde ?? vEsp?.desde ?? '2026-10-01')}</strong></div>
              <div>{vIva?.fuente ?? vEsp?.fuente ? `Acto: ${vIva?.fuente ?? vEsp?.fuente}` : 'Sin providencia registrada'}</div>
            </div>
          </div>

          {/* Selector Maestro de Régimen Tributario */}
          <div style={{ marginBottom: '.5rem' }}>
            <h4 style={{ margin: '0 0 .25rem', fontSize: '1rem', fontWeight: 700 }}>
              Selector de Régimen Tributario ante el SENIAT
            </h4>
            <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>
              Escoge el tipo de contribuyente para gobernar en 1 clic todas las retenciones que aplican a las facturas de compras de {empresaNombre}:
            </p>
          </div>

          <div className="lfv8-regimen-grid">
            {/* Opción 1: Contribuyente Ordinario */}
            <button
              type="button"
              className={`lfv8-regimen-card ${targetRegimen === 'ordinario' ? 'active' : ''}`}
              onClick={() => {
                setTargetRegimen('ordinario');
                if (!motivo || motivo.includes('Especial')) setMotivo('Contribuyente Ordinario (No retiene IVA)');
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                <span className="lfv8-regimen-badge ordinario">Régimen General</span>
                {esOrdinarioActual && (
                  <span style={{ fontSize: '.72rem', color: '#38bdf8', fontWeight: 700 }}>● Activo hoy</span>
                )}
              </div>
              <div className="lfv8-regimen-title">
                <span>🏢 Contribuyente Ordinario</span>
                {targetRegimen === 'ordinario' && <span style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>✓</span>}
              </div>
              <div className="lfv8-regimen-desc">
                Empresa sujeta al régimen tributario general. No ha sido designada Sujeto Pasivo Especial por el SENIAT.
              </div>
              <ul className="lfv8-regimen-bullets">
                <li>
                  <span style={{ color: 'var(--danger, #ef4444)', fontWeight: 800 }}>✕</span>
                  <span><strong>No retiene IVA:</strong> Paga el 100 % del IVA facturado al proveedor. No emite comprobantes de IVA.</span>
                </li>
                <li>
                  <span style={{ color: 'var(--danger, #ef4444)', fontWeight: 800 }}>✕</span>
                  <span><strong>No percibe IGTF:</strong> No actúa como agente de percepción del 3 % sobre cobros en divisas.</span>
                </li>
                <li>
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 800 }}>✓</span>
                  <span><strong>Sí retiene ISLR:</strong> Practica retenciones según Decreto 1.808 a personas jurídicas y naturales.</span>
                </li>
                <li>
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 800 }}>✓</span>
                  <span><strong>Sí retiene ISAE Municipal:</strong> Practica retención de actividades económicas de la Alcaldía de Caroní (1 %).</span>
                </li>
              </ul>
            </button>

            {/* Opción 2: Contribuyente Especial */}
            <button
              type="button"
              className={`lfv8-regimen-card ${targetRegimen === 'especial' ? 'active' : ''}`}
              onClick={() => {
                setTargetRegimen('especial');
                if (!motivo || motivo.includes('Ordinario')) setMotivo('Designación como Contribuyente Especial por el SENIAT');
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                <span className="lfv8-regimen-badge especial">Sujeto Pasivo Especial</span>
                {esEspecialActual && (
                  <span style={{ fontSize: '.72rem', color: '#fbbf24', fontWeight: 700 }}>● Activo hoy</span>
                )}
              </div>
              <div className="lfv8-regimen-title">
                <span>⭐ Contribuyente Especial</span>
                {targetRegimen === 'especial' && <span style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>✓</span>}
              </div>
              <div className="lfv8-regimen-desc">
                Designación formal del SENIAT mediante Providencia Administrativa notificada a la empresa.
              </div>
              <ul className="lfv8-regimen-bullets">
                <li>
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 800 }}>✓</span>
                  <span><strong>Sí retiene IVA:</strong> Retiene el 75 % de alícuota general o 100 % en supuestos especiales (Art. 5 / sin RIF).</span>
                </li>
                <li>
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 800 }}>✓</span>
                  <span><strong>Sí percibe IGTF:</strong> Agente perceptor del 3 % sobre transacciones en moneda extranjera.</span>
                </li>
                <li>
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 800 }}>✓</span>
                  <span><strong>Sí retiene ISLR:</strong> Aplica retención según Decreto 1.808.</span>
                </li>
                <li>
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 800 }}>✓</span>
                  <span><strong>Sí retiene ISAE Municipal:</strong> Aplica retención de actividades económicas.</span>
                </li>
              </ul>
            </button>
          </div>

          {/* Formulario de Confirmación y Aplicación */}
          <div className="lfv8-regimen-action-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.65rem' }}>
              <strong style={{ fontSize: '.88rem' }}>
                Aplicar configuración: {targetRegimen === 'especial' ? '⭐ Contribuyente Especial (Designado SENIAT)' : '🏢 Contribuyente Ordinario (No retiene IVA)'}
              </strong>
              <span className="hint muted" style={{ fontSize: '.76rem' }}>
                Queda asentado en el historial con fecha y justificación.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
                <label style={{ fontSize: '.78rem' }}>Fecha de vigencia</label>
                <input className="input" type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
              </div>
              {targetRegimen === 'especial' && (
                <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
                  <label style={{ fontSize: '.78rem' }}>Providencia Administrativa SENIAT</label>
                  <input
                    className="input"
                    placeholder="Ej. SNAT/2026/000054 (N° y fecha)"
                    value={fuente}
                    onChange={(e) => setFuente(e.target.value)}
                  />
                </div>
              )}
              <div className="form-row" style={{ flex: '2 1 230px', margin: 0 }}>
                <label style={{ fontSize: '.78rem' }}>Motivo / Justificación</label>
                <input
                  className="input"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={targetRegimen === 'especial' ? 'Designación como Contribuyente Especial por el SENIAT' : 'Contribuyente ordinario (no designado agente de retención de IVA)'}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAplicarRegimen()}
                disabled={guardandoRegimen || !puedeEditar}
                style={{ minHeight: '36px', padding: '0 1.25rem', fontWeight: 600 }}
              >
                {guardandoRegimen ? 'Aplicando cambios…' : `⚡ Aplicar como ${targetRegimen === 'especial' ? 'Especial' : 'Ordinario'}`}
              </button>
            </div>
          </div>

          {/* Desplegable de Auditoría Detallada */}
          <details style={{ marginTop: '1.25rem', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 12, padding: '.75rem 1rem', background: 'rgba(255, 255, 255, 0.015)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.84rem', color: 'var(--text-muted)', userSelect: 'none' }}>
              ⚙️ Ver / Ajustar condiciones individuales e historial por tributo (Auditoría fiscal)
            </summary>
            <p className="muted" style={{ fontSize: '.78rem', margin: '.5rem 0 .75rem' }}>
              Permite a los administradores fiscales y auditores consultar, editar o borrar registros históricos específicos por cada impuesto.
            </p>
            {RENGLONES.map((r) => (
              <RenglonRegimen
                key={`${r.condicion}:${r.impuesto ?? '*'}`}
                {...r}
                historial={historial.filter((h) => h.condicion === r.condicion && h.impuestoClave === r.impuesto)}
                puedeEditar={puedeEditar}
                puedeBorrar={puedeBorrar}
                porEmpresa={porEmpresa}
                empresaId={porEmpresa ? empresaId : null}
                onCambio={() => { void cargar(); onRegimenCambiado?.(); }}
              />
            ))}
          </details>
        </>
      )}
    </div>
  );
}

function RenglonRegimen({ impuesto, condicion, titulo, ayuda, historial, puedeEditar, puedeBorrar, porEmpresa, empresaId, onCambio }: {
  impuesto: ClaveImpuesto | null; condicion: CondicionAgente; titulo: string; ayuda: string;
  historial: CondicionRegistrada[]; puedeEditar: boolean; puedeBorrar: boolean; porEmpresa: boolean; empresaId: string | null; onCambio: () => void;
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
    const actualFila = historial.find((x) => x.id === id);
    if (actualFila?.hasta && editDesde > actualFila.hasta) {
      toast('La fecha «desde» no puede ser posterior a la fecha «hasta» de ese período.', 'error');
      return;
    }
    if (historial.some((x) => x.id !== id && x.desde === editDesde)) {
      toast('Ya existe otro registro en el historial que inicia en esa misma fecha.', 'error');
      return;
    }
    setGuardandoFila(true);
    try {
      await actualizarCondicion(id, {
        desde: editDesde,
        hasta: actualFila?.hasta ?? undefined,
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

  // Lo que aplica hoy. Por empresa (D2): el vigente de SU historial (cliente), una sola
  // fuente. Single-empresa/degradación: consultarCondicion de GT (con la vuelta al JSON).
  useEffect(() => {
    if (porEmpresa) { setValorBase(condicionVigente(historial, impuesto, condicion, hoy)?.valor ?? false); return; }
    let vivo = true;
    consultarCondicion(impuesto, condicion, hoy).then((v) => { if (vivo) setValorBase(v); }).catch(() => { if (vivo) setValorBase(null); });
    return () => { vivo = false; };
  }, [impuesto, condicion, hoy, historial, porEmpresa]);
  // Propone el cambio contrario al vigente; solo cuando cambia el vigente, para no pisar lo elegido.
  const vigenteId = vigente?.id; const vigenteValor = vigente?.valor;
  useEffect(() => { if (vigenteId) setValor(vigenteValor ? 'no' : 'si'); }, [vigenteId, vigenteValor]);

  const nueva = { impuestoClave: impuesto, condicion, valor: valor === 'si', desde, motivo, fuente };
  const falta = faltaEnCondicion(nueva);

  async function registrar() {
    setGuardando(true);
    try {
      await registrarCondicion(nueva, empresaId);
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
                          {puedeBorrar && (
                            <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => void borrarFila(h.id)} disabled={guardandoFila} title="Eliminar registro (solo administrador)">
                              ✕
                            </button>
                          )}
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
