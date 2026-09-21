/* ============================================================
   MGG · Retenciones · Libro fiscal

   El libro contesta una sola pregunta: ¿cuánto impuesto está adelantado y
   cuánto se debe? Y para eso hay que separar las dos direcciones, porque el
   mismo monto significa cosas opuestas:

   · NOS LA PRACTICARON → anticipo a favor. Se descuenta en la declaración.
   · LA PRACTICAMOS     → plata ajena que hay que enterar al fisco.
   · IGTF               → ni una ni otra: se paga y no se recupera. Es costo.

   Tres piezas:
   · LibroFiscalView        — el libro con sus cuatro números y sus filtros.
   · RegistrarRetencionModal — carga una retención, en cualquiera de las dos
                               direcciones (calculando, o copiando el
                               comprobante que nos entregaron).
   · ConfiguracionFiscalModal — los parámetros del agente y el catálogo.

   La cuenta no se hace acá: viene de `retencionesCalculo.ts`.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { supabase } from '@/shared/lib/supabase';
import {
  CONFIG_RETENCION_DEFECTO, DIRECCIONES, ESTADOS_RETENCION, SUJETOS, TIPOS_IMPUESTO,
  calcularIgtf, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal,
  labelDireccion, labelEstadoRetencion, labelImpuesto, labelPeriodo, labelSujeto,
  periodoDe, quincenaDe, resumenLibro, significadoRetencion,
  type CalculoRetencion, type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type EstadoRetencion, type MotivosIvaCien, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';
import {
  activarConcepto, adjuntarComprobante, anularRetencion, getConfigRetencion, guardarConcepto,
  guardarConfigRetencion, listConceptos, listRetenciones, marcarDeclarada, registrarRetencion,
  type RetencionPracticada,
} from './retencionesFiscal.repository';

const BUCKET = 'compras-oc';

function monto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}
const nDec = (v: string) => Number(String(v).replace(',', '.')) || 0;
const hoyIso = () => new Date().toISOString().slice(0, 10);
const primeroDelMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

/* ═══════════════════════ Libro fiscal ═══════════════════════ */

export function LibroFiscalView({ canWrite, actor, actorName }: {
  canWrite: boolean; actor: string; actorName: string | null;
}) {
  const [direccion, setDireccion] = useState<'' | DireccionRetencion>('recibida');
  const [tipo, setTipo] = useState<'' | TipoImpuesto>('');
  const [estado, setEstado] = useState<'' | EstadoRetencion | 'anulada'>('');
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoyIso());
  const [texto, setTexto] = useState('');

  const [filas, setFilas] = useState<RetencionPracticada[]>([]);
  const [config, setConfig] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [loading, setLoading] = useState(true);
  const [anular, setAnular] = useState<RetencionPracticada | null>(null);
  const [motivo, setMotivo] = useState('');
  const [registrar, setRegistrar] = useState<SemillaRetencion | null>(null);
  const [parametros, setParametros] = useState(false);

  const reload = useCallback(async () => {
    const [rs, cfg] = await Promise.all([
      listRetenciones({
        direccion: direccion || undefined,
        tipo: tipo || undefined,
        estado: estado === 'anulada' ? undefined : (estado || undefined),
        desde: desde || undefined,
        hasta: hasta || undefined,
        incluirAnuladas: true,
      }).catch(() => [] as RetencionPracticada[]),
      getConfigRetencion().catch(() => CONFIG_RETENCION_DEFECTO),
    ]);
    setFilas(rs); setConfig(cfg);
  }, [direccion, tipo, estado, desde, hasta]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // El estado «anulada» y la búsqueda se filtran acá: no son columnas del query.
  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return filas.filter((r) => {
      if (estado === 'anulada' && !r.anulada) return false;
      if (estado && estado !== 'anulada' && r.anulada) return false;
      if (!q) return true;
      const hay = `${r.contraparteNombre ?? ''} ${r.contraparteRif ?? ''} ${r.numeroComprobante ?? ''} ${r.facturaNumero ?? ''} ${r.docCodigo ?? ''} ${r.conceptoNombre ?? ''}`;
      return hay.toLowerCase().includes(q);
    });
  }, [filas, estado, texto]);

  const resumen = useMemo(() => resumenLibro(visibles.map((r) => ({
    tipo: r.tipo, direccion: r.direccion, estado: r.estado, monto: r.montoRetenido, anulada: r.anulada,
  }))), [visibles]);

  const moneda = visibles[0]?.moneda ?? 'Bs';
  const limpiar = () => {
    setDireccion(''); setTipo(''); setEstado(''); setTexto('');
    setDesde(primeroDelMes()); setHasta(hoyIso());
  };

  async function verComprobante(r: RetencionPracticada) {
    try {
      const { verComprobanteRetencionPdf } = await import('./comprobanteRetencionPdf');
      await verComprobanteRetencionPdf(r, config);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante', 'error'); }
  }

  async function verAdjunto(r: RetencionPracticada) {
    if (!r.comprobantePath) return;
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.comprobantePath, 600);
      if (error) throw error;
      await previewFileUrl(data.signedUrl, r.comprobanteNombre ?? 'comprobante', 'Comprobante de retención');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error'); }
  }

  async function verLibroPdf() {
    try {
      const { verLibroFiscalPdf } = await import('./libroFiscalPdf');
      await verLibroFiscalPdf(visibles, config, { desde, hasta, direccion: direccion || null, resumen, moneda });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el libro', 'error'); }
  }

  const razon = config.razonSocial || 'La empresa';

  return (
    <div>
      {/* Qué es la empresa frente al fisco: cambia la lectura de todo el libro */}
      <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '1rem' }}>
        {config.esContribuyenteEspecial ? (
          <p style={{ margin: 0, fontSize: '.9rem' }}>
            <strong>{razon} es contribuyente especial y agente de retención.</strong> Lo que retiene
            no es suyo: hay que <strong>enterarlo al fisco</strong> en la quincena. Lo que le retengan
            a ella es un <strong>anticipo de impuesto</strong> que se descuenta en la declaración.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: '.9rem' }}>
            <strong>{razon} no es agente de retención.</strong> Lo normal es que le retengan: cada
            comprobante que entra es un <strong>anticipo de impuesto</strong> que se descuenta en la
            declaración. El IGTF que le cobran al pagar en divisas no se recupera: es costo.
          </p>
        )}
        {!config.rif && (
          <p className="muted" style={{ margin: '.4rem 0 0', fontSize: '.82rem' }}>
            Falta cargar el <strong>RIF</strong> en ⚙ Parámetros: los comprobantes salen sin él.
          </p>
        )}
      </div>

      {/* Los cuatro números */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <Kpi titulo="A favor (nos retuvieron)" valor={monto(resumen.aFavor, moneda)} color="var(--success)"
          pie="Se descuenta del impuesto a pagar" />
        <Kpi titulo="IGTF pagado" valor={monto(resumen.igtfPagado, moneda)} color="var(--danger)"
          pie="No se recupera: es costo" />
        <Kpi titulo="Por enterar al fisco" valor={monto(resumen.porEnterar, moneda)}
          color={resumen.porEnterar > 0 ? 'var(--warning)' : undefined}
          pie="Lo que la empresa retuvo y todavía no declaró" />
        <Kpi titulo="Registros" valor={String(resumen.registros)}
          pie={resumen.anulados ? `${resumen.anulados} anulada${resumen.anulados === 1 ? '' : 's'} aparte` : 'Todos con comprobante'} />
      </div>

      {/* Filtros */}
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Quién retuvo</label>
            <select className="select" value={direccion} onChange={(e) => setDireccion(e.target.value as '' | DireccionRetencion)}>
              <option value="">Todas</option>
              {DIRECCIONES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Impuesto</label>
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as '' | TipoImpuesto)}>
              <option value="">Todos</option>
              {TIPOS_IMPUESTO.map((t) => <option key={t.key} value={t.key}>{t.corto}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Estado</label>
            <select className="select" value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoRetencion | 'anulada')}>
              <option value="">Todos</option>
              {ESTADOS_RETENCION.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              <option value="anulada">Anuladas</option>
            </select>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Desde</label>
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Hasta</label>
            <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="form-row" style={{ margin: 0, flex: '1 1 200px' }}>
            <label>Buscar</label>
            <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)}
              placeholder="Contraparte, RIF, comprobante, factura…" />
          </div>
          <button className="btn btn-ghost" onClick={limpiar}>Limpiar</button>
          <button className="btn btn-ghost" onClick={() => void verLibroPdf()} disabled={!visibles.length}>↓ PDF del libro</button>
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
            <button className="btn btn-ghost" onClick={() => setParametros(true)}>⚙ Parámetros</button>
            <button className="btn btn-primary" onClick={() => setRegistrar({})}>+ Registrar retención</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead>
              <tr>
                <th>N° comprobante</th><th>Impuesto</th><th>Contraparte</th><th>Documento</th>
                <th style={{ textAlign: 'right' }}>Base</th>
                <th style={{ textAlign: 'right' }}>%</th>
                <th style={{ textAlign: 'right' }}>Retenido</th>
                <th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9}><EmptyState icon="◔" message="Cargando el libro…" /></td></tr>}
              {!loading && !visibles.length && (
                <tr><td colSpan={9}><EmptyState icon="🧾" message="Sin retenciones en ese rango" /></td></tr>
              )}
              {!loading && visibles.map((r) => (
                <tr key={r.id} style={{ opacity: r.anulada ? 0.55 : 1 }}>
                  <td className="mono" style={{ fontSize: '.8rem' }}>
                    {r.numeroComprobante ?? '—'}
                    <div className="muted" style={{ fontSize: '.7rem' }}>
                      {labelPeriodo(r.periodo)}{r.quincena ? ` · ${r.quincena}.ª quincena` : ''}
                    </div>
                  </td>
                  <td>
                    <span className="badge">{TIPOS_IMPUESTO.find((t) => t.key === r.tipo)?.corto ?? r.tipo}</span>
                    <div className="muted" style={{ fontSize: '.7rem' }}>
                      {r.direccion === 'recibida' ? '← nos retuvieron' : '→ retuvimos'}
                    </div>
                  </td>
                  <td>
                    <div>{r.contraparteNombre ?? '—'}</div>
                    <div className="muted mono" style={{ fontSize: '.72rem' }}>{r.contraparteRif ?? ''}</div>
                  </td>
                  <td>
                    <div>{r.facturaNumero ? `Fact. ${r.facturaNumero}` : (r.docCodigo ?? '—')}</div>
                    {r.conceptoNombre && <div className="muted" style={{ fontSize: '.72rem' }}>{r.conceptoNombre}</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{monto(r.baseImponible, r.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.porcentaje}%</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: r.tipo === 'igtf' ? 'var(--danger)' : r.direccion === 'recibida' ? 'var(--success)' : undefined }}>
                    {monto(r.montoRetenido, r.moneda)}
                  </td>
                  <td>
                    {r.anulada
                      ? <span className="badge" style={{ color: 'var(--danger)' }}>Anulada</span>
                      : <span className="badge" style={{ color: r.estado === 'declarada' ? 'var(--success)' : undefined }}>{labelEstadoRetencion(r.estado)}</span>}
                    <div className="muted" style={{ fontSize: '.7rem' }}>{r.createdAt ? dateTime(r.createdAt) : ''}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => void verComprobante(r)} title="Ver el comprobante">📄</button>
                    {r.comprobantePath && (
                      <button className="btn btn-sm btn-ghost" onClick={() => void verAdjunto(r)} title={r.comprobanteNombre ?? 'Adjunto'}>📎</button>
                    )}
                    {canWrite && !r.anulada && r.direccion === 'practicada' && (
                      <button className="btn btn-sm btn-ghost" title={r.estado === 'declarada' ? 'Volver a registrada' : 'Marcar como declarada'}
                        onClick={async () => {
                          try {
                            await marcarDeclarada(r.id, r.estado !== 'declarada', actor);
                            await reload();
                          } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
                        }}>{r.estado === 'declarada' ? '↩' : '✓'}</button>
                    )}
                    {canWrite && !r.anulada && (
                      <button className="btn btn-sm btn-ghost" onClick={() => { setAnular(r); setMotivo(''); }} title="Anular">⊘</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint muted" style={{ fontSize: '.74rem', marginTop: '.4rem' }}>
          Una retención <strong>no se borra</strong>: se anula con su motivo y conserva su número, porque el correlativo no se reusa.
        </div>
      </div>

      {anular && (
        <Modal title={`Anular la retención ${anular.numeroComprobante ?? ''}`} size="sm" onClose={() => setAnular(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setAnular(null)}>Cancelar</button>
              <button className="btn btn-danger" disabled={!motivo.trim()}
                onClick={async () => {
                  try {
                    await anularRetencion(anular.id, motivo);
                    toast('Retención anulada', 'success');
                    setAnular(null);
                    await reload();
                  } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular', 'error'); }
                }}>Anular</button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            Se anula <strong>{monto(anular.montoRetenido, anular.moneda)}</strong> de {labelImpuesto(anular.tipo)} de {anular.contraparteNombre ?? '—'}.
            El comprobante queda en el libro marcado como anulado, con su número.
          </p>
          <div className="form-row" style={{ margin: 0 }}>
            <label>¿Por qué se anula?</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la factura fue sustituida por el proveedor" />
          </div>
        </Modal>
      )}

      {registrar && (
        <RegistrarRetencionModal semilla={registrar} actor={actor} actorName={actorName}
          onClose={() => setRegistrar(null)}
          onHecho={async () => { setRegistrar(null); await reload(); }} />
      )}
      {parametros && <ConfiguracionFiscalModal actor={actor} onClose={() => { setParametros(false); void reload(); }} />}
    </div>
  );
}

function Kpi({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: string; color?: string }) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>{titulo}</div>
      <div className="mono" style={{ fontSize: '1.7rem', fontWeight: 800, color: color ?? 'inherit', lineHeight: 1.2 }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.74rem' }}>{pie}</div>
    </div>
  );
}

/* ═══════════════ Registrar / practicar una retención ═══════════════ */

/** Datos con los que se abre el modal. Vacío = carga manual desde el libro. */
export interface SemillaRetencion {
  direccion?: DireccionRetencion;
  docKind?: RetencionPracticada['docKind'];
  docId?: string | null;
  codigo?: string | null;
  contraparteId?: string | null;
  contraparteNombre?: string | null;
  contraparteRif?: string | null;
  moneda?: string;
  /** Total del documento: la base de partida para ISLR y municipal. */
  total?: number;
  /** IVA de la factura: la base de la retención de IVA. */
  iva?: number;
  /** Base imponible (total sin IVA). */
  baseImponible?: number;
}

export function RegistrarRetencionModal({ semilla, actor, actorName, onClose, onHecho }: {
  semilla: SemillaRetencion;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [config, setConfig] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);

  const [direccion, setDireccion] = useState<DireccionRetencion>(semilla.direccion ?? 'recibida');
  const [tipo, setTipo] = useState<TipoImpuesto>('islr');
  const [sujeto, setSujeto] = useState<SujetoRetenido>('pj_domiciliada');
  const [conceptoId, setConceptoId] = useState('');
  const [motivos, setMotivos] = useState<MotivosIvaCien>({});

  const [contraparte, setContraparte] = useState(semilla.contraparteNombre ?? '');
  const [rif, setRif] = useState(semilla.contraparteRif ?? '');
  const [moneda, setMoneda] = useState(semilla.moneda ?? 'Bs');
  const [numero, setNumero] = useState('');
  const [facturaNumero, setFacturaNumero] = useState(semilla.codigo ?? '');
  const [facturaControl, setFacturaControl] = useState('');
  const [facturaFecha, setFacturaFecha] = useState(hoyIso());
  const [baseStr, setBaseStr] = useState(String(semilla.baseImponible ?? semilla.total ?? 0));
  const [ivaStr, setIvaStr] = useState(String(semilla.iva ?? 0));
  const [pctStr, setPctStr] = useState('');
  const [montoStr, setMontoStr] = useState('');
  const [observacion, setObservacion] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getConfigRetencion(), listConceptos(true)])
      .then(([c, cs]) => { setConfig(c); setConceptos(cs); })
      .catch(() => { /* RLS/red */ });
  }, []);

  const conceptosDelTipo = useMemo(() => conceptos.filter((c) =>
    c.tipo === tipo && (c.sujeto === sujeto || c.sujeto === 'todos')), [conceptos, tipo, sujeto]);
  useEffect(() => { setConceptoId(conceptosDelTipo[0]?.id ?? ''); }, [conceptosDelTipo]);
  const concepto = conceptosDelTipo.find((c) => c.id === conceptoId) ?? null;

  // Cuando la practicamos nosotros, el sistema calcula. Cuando nos la
  // practicaron, el número ya está en el comprobante: se copia, no se inventa.
  const calculo: CalculoRetencion = useMemo(() => {
    const base = nDec(baseStr);
    if (tipo === 'iva') return calcularRetencionIva({ baseImponible: base, ivaFactura: nDec(ivaStr), motivos }, config);
    if (tipo === 'islr') return calcularRetencionIslr({ montoPago: base, concepto }, config);
    if (tipo === 'igtf') return calcularIgtf({ montoPago: base, enDivisas: true }, config);
    return calcularRetencionLocal({ montoPago: base, concepto }, tipo);
  }, [tipo, baseStr, ivaStr, motivos, concepto, config]);

  const esManual = direccion === 'recibida';
  const pctFinal = esManual ? nDec(pctStr) : calculo.porcentaje;
  const montoFinal = esManual
    ? (nDec(montoStr) || Math.round(nDec(baseStr) * nDec(pctStr)) / 100)
    : calculo.montoRetenido;

  async function emitir() {
    setError(null);
    if (montoFinal <= 0) { setError(esManual ? 'Cargá el monto que dice el comprobante.' : calculo.explicacion); return; }
    if (esManual && !contraparte.trim()) { setError('Poné quién practicó la retención.'); return; }
    setSaving(true);
    try {
      const periodo = periodoDe(facturaFecha);
      const r = await registrarRetencion({
        tipo, direccion,
        docKind: semilla.docKind ?? 'manual',
        docId: semilla.docId ?? null, docCodigo: semilla.codigo ?? null,
        contraparteId: semilla.contraparteId ?? null,
        contraparteRif: rif.trim() || null,
        contraparteNombre: contraparte.trim() || null,
        contraparteSujeto: tipo === 'iva' || tipo === 'igtf' ? null : sujeto,
        facturaNumero: facturaNumero.trim() || null,
        facturaControl: facturaControl.trim() || null,
        facturaFecha: facturaFecha || null,
        periodo, quincena: tipo === 'iva' ? quincenaDe(facturaFecha) : null,
        numeroComprobante: esManual ? (numero.trim() || null) : null,
        conceptoId: esManual ? null : (concepto?.id ?? null),
        conceptoNombre: esManual ? null : (concepto?.nombre ?? null),
        moneda,
        baseImponible: esManual ? nDec(baseStr) : calculo.baseImponible,
        alicuota: esManual ? 0 : calculo.alicuota,
        impuesto: esManual ? nDec(ivaStr) : calculo.impuesto,
        porcentaje: pctFinal,
        sustraendo: esManual ? 0 : calculo.sustraendo,
        montoRetenido: montoFinal,
        observacion: observacion.trim() || null,
        actor, actorName,
      });
      if (archivo) await adjuntarComprobante(r.id, archivo).catch(() => toast('La retención quedó, pero el adjunto no subió', 'error'));
      notify(
        `${labelDireccion(direccion)} · ${labelImpuesto(tipo)} · ${monto(r.montoRetenido, r.moneda)}${r.numeroComprobante ? ` · ${r.numeroComprobante}` : ''}`,
        'success', { link: '#/app/retenciones' },
      );
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la retención.');
      setSaving(false);
    }
  }

  return (
    <Modal title="🧾 Registrar retención" size="lg" onClose={() => !saving && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void emitir()} disabled={saving || montoFinal <= 0}>
            {saving ? 'Guardando…' : `Registrar · ${monto(montoFinal, moneda)}`}
          </button>
        </>
      }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* La dirección primero: cambia el significado de todo lo demás */}
      <div className="form-row">
        <label>¿Quién retuvo?</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {DIRECCIONES.map((d) => (
            <label key={d.key} className="card" style={{
              margin: 0, padding: '.45rem .8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
              borderColor: direccion === d.key ? 'var(--brand, #ff8a00)' : 'var(--border)',
            }}>
              <input type="radio" checked={direccion === d.key} onChange={() => setDireccion(d.key)} />
              <span style={{ fontWeight: 600 }}>{d.label}</span>
            </label>
          ))}
        </div>
        <small className="muted">{significadoRetencion(tipo, direccion)}</small>
      </div>

      {direccion === 'practicada' && !config.esContribuyenteEspecial && tipo === 'iva' && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem' }}>
          <small>
            La empresa <strong>no está marcada como contribuyente especial</strong> en ⚙ Parámetros, así que
            la retención de IVA da cero. Solo el especial designado por el SENIAT retiene IVA.
          </small>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '2 1 240px' }}>
          <label>{direccion === 'recibida' ? 'Quién nos retuvo' : 'A quién le retenemos'}</label>
          <input className="input" value={contraparte} onChange={(e) => setContraparte(e.target.value)} placeholder="Razón social" />
        </div>
        <div className="form-row" style={{ flex: '1 1 140px' }}>
          <label>RIF</label>
          <input className="input mono" value={rif} onChange={(e) => setRif(e.target.value)} placeholder="J-XXXXXXXX-X" />
        </div>
        <div className="form-row" style={{ flex: '0 1 110px' }}>
          <label>Moneda</label>
          <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="Bs">Bs</option>
            <option value="USD">$</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <label>Impuesto</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {TIPOS_IMPUESTO.map((t) => (
            <label key={t.key} className="card" style={{
              margin: 0, padding: '.4rem .7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
              borderColor: tipo === t.key ? 'var(--brand, #ff8a00)' : 'var(--border)',
            }}>
              <input type="radio" checked={tipo === t.key} onChange={() => setTipo(t.key)} />
              <span style={{ fontWeight: 600 }}>{t.corto}</span>
            </label>
          ))}
        </div>
      </div>

      {direccion === 'practicada' && tipo !== 'iva' && tipo !== 'igtf' && (
        <>
          <div className="form-row">
            <label>¿A quién se le retiene?</label>
            <select className="select" value={sujeto} onChange={(e) => setSujeto(e.target.value as SujetoRetenido)}>
              {SUJETOS.filter((s) => s.key !== 'todos').map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <small className="muted">El porcentaje del ISLR cambia según el sujeto: no es lo mismo una persona natural que una empresa.</small>
          </div>
          <div className="form-row">
            <label>Concepto</label>
            <select className="select" value={conceptoId} onChange={(e) => setConceptoId(e.target.value)}>
              {!conceptosDelTipo.length && <option value="">— sin conceptos activos para este caso —</option>}
              {conceptosDelTipo.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nombre} — {c.porcentaje}%</option>
              ))}
            </select>
            {concepto?.fundamento && <small className="muted">{concepto.fundamento}</small>}
          </div>
        </>
      )}

      {direccion === 'practicada' && tipo === 'iva' && (
        <div className="form-row">
          <label>¿Corresponde retener el 100%? (Providencia SNAT/2015/0049, art. 5)</label>
          {([
            ['ivaNoDiscriminado', 'El IVA no está discriminado en la factura'],
            ['facturaNoCumple', 'La factura no cumple los requisitos de facturación'],
            ['proveedorNoInscrito', 'El proveedor no está inscrito en el RIF o sus datos no coinciden'],
            ['proveedorNoDomiciliado', 'El proveedor no está domiciliado en el país'],
            ['metalesPreciosos', 'Compra de metales o piedras preciosas'],
          ] as Array<[keyof MotivosIvaCien, string]>).map(([k, label]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.84rem', marginTop: '.2rem' }}>
              <input type="checkbox" checked={!!motivos[k]} onChange={(e) => setMotivos({ ...motivos, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
          <small className="muted">Sin ninguna marcada se retiene el {config.pctIvaGeneral}%.</small>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        {esManual && (
          <div className="form-row" style={{ flex: '1 1 170px' }}>
            <label>N° del comprobante</label>
            <input className="input mono" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="El que trae el comprobante" />
            <small className="muted">Lo puso quien retuvo: se copia tal cual.</small>
          </div>
        )}
        <div className="form-row" style={{ flex: '1 1 150px' }}>
          <label>{tipo === 'iva' ? 'Base imponible' : 'Monto del pago'}</label>
          <input className="input mono" value={baseStr} onChange={(e) => setBaseStr(e.target.value)} inputMode="decimal" />
        </div>
        {tipo === 'iva' && (
          <div className="form-row" style={{ flex: '1 1 130px' }}>
            <label>IVA de la factura</label>
            <input className="input mono" value={ivaStr} onChange={(e) => setIvaStr(e.target.value)} inputMode="decimal" />
          </div>
        )}
        {esManual && (
          <>
            <div className="form-row" style={{ flex: '0 1 110px' }}>
              <label>% retenido</label>
              <input className="input mono" value={pctStr} onChange={(e) => setPctStr(e.target.value)} inputMode="decimal" />
            </div>
            <div className="form-row" style={{ flex: '1 1 150px' }}>
              <label>Monto retenido</label>
              <input className="input mono" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} inputMode="decimal"
                placeholder={String(Math.round(nDec(baseStr) * nDec(pctStr)) / 100)} />
              <small className="muted">Si lo dejás vacío se toma base × %.</small>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 140px' }}>
          <label>N° de factura</label>
          <input className="input mono" value={facturaNumero} onChange={(e) => setFacturaNumero(e.target.value)} />
        </div>
        <div className="form-row" style={{ flex: '1 1 130px' }}>
          <label>N° de control</label>
          <input className="input mono" value={facturaControl} onChange={(e) => setFacturaControl(e.target.value)} />
        </div>
        <div className="form-row" style={{ flex: '1 1 150px' }}>
          <label>Fecha de la factura</label>
          <input className="input" type="date" value={facturaFecha} onChange={(e) => setFacturaFecha(e.target.value)} />
          <small className="muted">Define el período{tipo === 'iva' ? ' y la quincena' : ''}.</small>
        </div>
      </div>

      <div className="form-row">
        <label>Comprobante (PDF o imagen)</label>
        <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        {archivo && <small className="muted">{archivo.name}</small>}
      </div>

      <div className="form-row">
        <label>Observación</label>
        <input className="input" value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Opcional" />
      </div>

      {/* El resultado, con la cuenta a la vista */}
      <div className="card" style={{ borderColor: montoFinal > 0 ? 'var(--brand, #ff8a00)' : 'var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div className="muted" style={{ fontSize: '.72rem' }}>{direccion === 'recibida' ? 'Nos retuvieron' : 'A retener'}</div>
            <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--brand, #ff8a00)' }}>
              {monto(montoFinal, moneda)}
            </div>
          </div>
          <div className="muted mono" style={{ fontSize: '.78rem', textAlign: 'right' }}>
            <div>Base {monto(esManual ? nDec(baseStr) : calculo.baseImponible, moneda)}</div>
            {!esManual && calculo.impuesto > 0 && <div>Impuesto {monto(calculo.impuesto, moneda)}</div>}
            <div>Retención {pctFinal}%</div>
            {!esManual && calculo.sustraendo > 0 && <div>Sustraendo −{monto(calculo.sustraendo, moneda)}</div>}
          </div>
        </div>
        <p className="muted" style={{ margin: '.4rem 0 0', fontSize: '.8rem' }}>
          {esManual ? significadoRetencion(tipo, direccion) : calculo.explicacion}
        </p>
      </div>
      <div className="hint muted" style={{ fontSize: '.74rem' }}>
        {direccion === 'practicada' && tipo === 'iva'
          ? 'Al registrar, la base le asigna el número de comprobante AAAAMM + 8 dígitos. El número no se reusa.'
          : 'Queda en el libro fiscal del período, con su comprobante imprimible.'}
      </div>
    </Modal>
  );
}

/* ═══════════════════ Parámetros fiscales ═══════════════════ */

export function ConfiguracionFiscalModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [cfg, setCfg] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [tab, setTab] = useState<'agente' | 'catalogo'>('agente');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const [c, cs] = await Promise.all([getConfigRetencion(), listConceptos(false)]);
    setCfg(c); setConceptos(cs);
  }, []);
  useEffect(() => { void recargar().catch(() => { /* RLS */ }); }, [recargar]);

  const set = <K extends keyof ConfigRetencion>(k: K, v: ConfigRetencion[K]) => setCfg((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setSaving(true); setError(null);
    try {
      await guardarConfigRetencion(cfg, actor);
      toast('Parámetros fiscales guardados', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
      setSaving(false);
    }
  }

  return (
    <Modal title="⚙ Parámetros fiscales" size="xl" onClose={() => !saving && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
          {tab === 'agente' && <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>}
        </>
      }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      <div className="view-toggle" role="tablist" style={{ marginBottom: '.75rem' }}>
        <button className={tab === 'agente' ? 'active' : ''} onClick={() => setTab('agente')}>Datos de la empresa</button>
        <button className={tab === 'catalogo' ? 'active' : ''} onClick={() => setTab('catalogo')}>Catálogo de conceptos ({conceptos.length})</button>
      </div>

      {tab === 'agente' ? (
        <>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '1 1 220px' }}>
              <label>Razón social</label>
              <input className="input" value={cfg.razonSocial ?? ''} onChange={(e) => set('razonSocial', e.target.value)} placeholder="Mineral Group Guayana C.A." />
            </div>
            <div className="form-row" style={{ flex: '1 1 150px' }}>
              <label>RIF</label>
              <input className="input mono" value={cfg.rif ?? ''} onChange={(e) => set('rif', e.target.value)} placeholder="J-XXXXXXXX-X" />
            </div>
          </div>
          <div className="form-row">
            <label>Dirección fiscal</label>
            <input className="input" value={cfg.direccionFiscal ?? ''} onChange={(e) => set('direccionFiscal', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '1 1 180px' }}>
              <label>Municipio</label>
              <input className="input" value={cfg.municipio ?? ''} onChange={(e) => set('municipio', e.target.value)} />
              <small className="muted">Define qué ordenanza de ISAE aplica.</small>
            </div>
            <div className="form-row" style={{ flex: '1 1 180px' }}>
              <label>Estado</label>
              <input className="input" value={cfg.estado ?? ''} onChange={(e) => set('estado', e.target.value)} />
              <small className="muted">Define la ley de timbre fiscal.</small>
            </div>
          </div>

          <div className="card" style={{ background: 'var(--bg-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600 }}>
              <input type="checkbox" checked={cfg.esContribuyenteEspecial} onChange={(e) => set('esContribuyenteEspecial', e.target.checked)} />
              La empresa es contribuyente especial designada agente de retención de IVA
            </label>
            <p className="muted" style={{ margin: '.3rem 0 .5rem', fontSize: '.82rem' }}>
              Solo el contribuyente especial designado por el SENIAT retiene IVA. <strong>Arranca apagado a propósito</strong>:
              préndanlo cuando confirmen la condición, porque de esto depende que se calcule o no la retención de IVA.
            </p>
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: '1 1 120px', margin: 0 }}>
                <label>% general</label>
                <input className="input mono" value={String(cfg.pctIvaGeneral)} onChange={(e) => set('pctIvaGeneral', nDec(e.target.value))} inputMode="decimal" />
              </div>
              <div className="form-row" style={{ flex: '1 1 120px', margin: 0 }}>
                <label>% en los supuestos del art. 5</label>
                <input className="input mono" value={String(cfg.pctIvaEspecial)} onChange={(e) => set('pctIvaEspecial', nDec(e.target.value))} inputMode="decimal" />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '1 1 180px' }}>
              <label>Valor de la Unidad Tributaria (Bs)</label>
              <input className="input mono" value={String(cfg.valorUt)} onChange={(e) => set('valorUt', nDec(e.target.value))} inputMode="decimal" />
              <small className="muted">Define el <strong>sustraendo</strong> y el mínimo del ISLR de personas naturales. Sin esto, el sustraendo queda en cero.</small>
            </div>
            <div className="form-row" style={{ flex: '1 1 140px' }}>
              <label>% de IGTF</label>
              <input className="input mono" value={String(cfg.pctIgtf)} onChange={(e) => set('pctIgtf', nDec(e.target.value))} inputMode="decimal" />
              <small className="muted">3% vigente; la ley admite entre 2% y 8%.</small>
            </div>
          </div>
        </>
      ) : (
        <CatalogoConceptos conceptos={conceptos} onCambio={() => void recargar()} />
      )}
    </Modal>
  );
}

function CatalogoConceptos({ conceptos, onCambio }: { conceptos: ConceptoRetencion[]; onCambio: () => void }) {
  const [edit, setEdit] = useState<ConceptoRetencion | null>(null);
  const [pct, setPct] = useState('');

  async function guardarPct(c: ConceptoRetencion) {
    try {
      await guardarConcepto({ ...c, porcentaje: nDec(pct) });
      toast(`«${c.nombre}» quedó en ${nDec(pct)}%`, 'success');
      setEdit(null);
      onCambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
  }

  return (
    <>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Los conceptos de <strong>ISLR</strong> vienen del <strong>Decreto 1.808</strong>. Los de <strong>municipal</strong> y
        <strong> timbre estadal</strong> nacen en <strong>0% y desactivados</strong> a propósito: esa alícuota la fija la
        ordenanza de cada municipio y la ley de cada estado, no hay un número nacional. Cargá el de ustedes y activalo.
      </p>
      <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr><th>Tipo</th><th>Concepto</th><th>Sujeto</th><th style={{ textAlign: 'right' }}>%</th><th>Fundamento</th><th></th></tr>
          </thead>
          <tbody>
            {conceptos.map((c) => (
              <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.5 }}>
                <td><span className="badge">{c.tipo}</span></td>
                <td>{c.codigo ? <span className="muted mono">{c.codigo} · </span> : null}{c.nombre}
                  {c.aplicaSustraendo && <div className="muted" style={{ fontSize: '.7rem' }}>con sustraendo · mínimo {c.baseMinimaUt} UT</div>}
                  {c.basePct !== 100 && <div className="muted" style={{ fontSize: '.7rem' }}>base: {c.basePct}% del pago</div>}
                </td>
                <td className="muted" style={{ fontSize: '.76rem' }}>{labelSujeto(c.sujeto)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                  {edit?.id === c.id ? (
                    <input className="input mono" style={{ width: 80 }} value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" autoFocus />
                  ) : `${c.porcentaje}%`}
                </td>
                <td className="muted" style={{ fontSize: '.72rem' }}>{c.fundamento ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {edit?.id === c.id ? (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => void guardarPct(c)}>✓</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEdit(c); setPct(String(c.porcentaje)); }} title="Cambiar el porcentaje">✎</button>
                      <button className="btn btn-sm btn-ghost" title={c.activo ? 'Desactivar' : 'Activar'}
                        onClick={async () => {
                          try { await activarConcepto(c.id, !c.activo); onCambio(); }
                          catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
                        }}>{c.activo ? '🚫' : '✓'}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
