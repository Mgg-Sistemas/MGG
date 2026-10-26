import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { notify } from '@/shared/lib/notify';
import { money, montoMoneda, num, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';
import {
  listRetencionesPendientes, listRetencionesHechas, finalizarRetencion,
  urlRetencion, comprobantesDeOrden, labelRetencionModo,
  TIPOS_RETENCION, type RetencionItem, type TipoRetencion,
} from './retenciones.repository';
import type { Orden } from '@/shared/lib/types';
import { LibroFiscalView, ConfiguracionFiscalModal, RegistrarRetencionModal, type SemillaRetencion } from '@/modules/libroFiscal/LibroFiscal';
import { listRetenciones, tipoAGt } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { impuestosQuePractica, noAplicaDisponible, noAplicaPorOrden } from '@/modules/libroFiscal/noAplica.repository';
import { listCondiciones, empresaEsAgenteEnFecha, type CondicionRegistrada } from '@/modules/libroFiscal/agenteCondiciones.repository';
import { NoAplicaModal, type ObjetivoNoAplica } from '@/modules/libroFiscal/NoAplicaModal';
import { PeriodosRetencion } from '@/modules/libroFiscal/PeriodosRetencion';
import { AuditoriaRetenciones } from '@/modules/libroFiscal/AuditoriaRetenciones';
import { RegistrarFacturaRetencion, type SemillaFactura } from '@/modules/libroFiscal/RegistrarFacturaRetencion';
import { FacturasPorRegistrar } from '@/modules/libroFiscal/FacturasPorRegistrar';
import { AvisoSinFactura } from '@/modules/libroFiscal/AvisoSinFactura';
import type { FacturaDeOrigen } from '@/modules/libroFiscal/documentosOrigen.repository';
import { v3Disponible } from '@/modules/libroFiscal/periodosRetencion.repository';
import { fechaTasaBcv, type TipoImpuesto } from '@/modules/libroFiscal/retencionesCalculo';
import { diaVE, getTasasUsdDeFechas, hoyVE } from '@/modules/tesoreria/tasas.repository';
import { aplicarFiltros, conteoOpcion, paginar, type FiltroLista } from '@/modules/libroFiscal/listas';
import { BarraLista, Paginador, type ControlFiltro } from '@/modules/libroFiscal/ListaControles';
import { ReportesView } from './ReportesView';
import '@/modules/libroFiscal/libroFiscal.css';
import '@/modules/libroFiscal/libroFiscalV8.css';
import { norm } from '@/shared/lib/texto';

type Vista = 'pendientes' | 'hechas' | 'libro' | 'agrupada' | 'periodos' | 'reportes' | 'auditoria';

/** Qué documento es un código, en palabras: el personal no tiene por qué saber las siglas. */
function nombreDocumento(codigo: string | null | undefined): string {
  const c = String(codigo ?? '').toUpperCase();
  if (c.startsWith('OC-')) return 'Orden de compra';
  if (c.startsWith('CS-')) return 'Control de servicio';
  if (c.startsWith('OP-') || c.startsWith('SP-')) return 'Solicitud de pedido';
  if (c.startsWith('SS-')) return 'Solicitud de servicio';
  return 'Compra';
}

export function RetencionesPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('retenciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [vista, setVista] = useState<Vista>('agrupada');
  const [parametros, setParametros] = useState(false);
  const [pendientes, setPendientes] = useState<RetencionItem[]>([]);
  const [hechas, setHechas] = useState<RetencionItem[]>([]);
  const [registradas, setRegistradas] = useState<Registradas>(new Map());
  const [tasasDoc, setTasasDoc] = useState<TasasDoc>(new Map());
  const [conV3, setConV3] = useState(false);
  useEffect(() => { v3Disponible().then(setConV3).catch(() => setConV3(false)); }, []);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<RetencionItem | null>(null);
  const [registrar, setRegistrar] = useState<SemillaRetencion | null>(null);
  // P03: registrar el documento fiscal desde un archivo de factura que subió Compras.
  const [registrarFactura, setRegistrarFactura] = useState<SemillaFactura | null>(null);
  // D48: «no aplica» por impuesto, sin número de comprobante (con R10 en la base).
  const [conNoAplica, setConNoAplica] = useState(false);
  useEffect(() => { noAplicaDisponible().then(setConNoAplica).catch(() => setConNoAplica(false)); }, []);
  const [noAplica, setNoAplica] = useState<ObjetivoNoAplica | null>(null);
  // Con R10: «Por realizar» pide solo los impuestos que la empresa practica hoy según Parámetros › Régimen.
  const [practica, setPractica] = useState<Set<ImpuestoPendiente> | null>(null);
  useEffect(() => {
    impuestosQuePractica(IMPUESTOS_PENDIENTES.map((t) => tipoAGt(t.key)), hoyVE())
      .then((s) => setPractica(s ? new Set(IMPUESTOS_PENDIENTES.map((t) => t.key).filter((k) => s.has(tipoAGt(k)))) : null))
      .catch(() => setPractica(null));
  }, []);

  // Régimen fiscal con historial de condiciones para validar vigencias fecha por fecha
  const [condiciones, setCondiciones] = useState<CondicionRegistrada[] | null>(null);
  const cargarCondiciones = useCallback(() => {
    listCondiciones().then(setCondiciones).catch(() => setCondiciones([]));
  }, []);
  useEffect(() => { cargarCondiciones(); }, [cargarCondiciones]);

  // Búsqueda, filtros, orden y página de las dos listas de OC (Por realizar y Realizadas).
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [fTipo, setFTipo] = useState<'' | TipoRetencion>('');
  const [fTesoreria, setFTesoreria] = useState('');
  const [fTexto, setFTexto] = useState('');
  const [orden, setOrden] = useState<'reciente' | 'antiguo' | 'proveedor'>('reciente');
  const [pag, setPag] = useState(1);
  const [tam, setTam] = useState(25);
  const limpiarFiltros = () => { setFDesde(''); setFHasta(''); setFTipo(''); setFTesoreria(''); setFTexto(''); };
  useEffect(() => { setPag(1); }, [vista, fDesde, fHasta, fTipo, fTesoreria, fTexto, orden]);

  const reload = useCallback(async () => {
    const [p, h, libro] = await Promise.all([
      listRetencionesPendientes().catch(() => [] as RetencionItem[]),
      listRetencionesHechas().catch(() => [] as RetencionItem[]),
      listRetenciones({ direccion: 'practicada' }).catch(() => []),
    ]);
    const reg: Registradas = new Map();
    for (const r of libro) {
      if (!r.docId) continue;
      const s = reg.get(r.docId) ?? new Set<TipoImpuesto>();
      s.add(r.tipo);
      reg.set(r.docId, s);
    }
    // Lo marcado «no aplica» cuenta como resuelto para ese impuesto.
    const na = await noAplicaPorOrden(p.map((i) => i.orden.id)).catch(() => new Map<string, Set<TipoImpuesto>>());
    for (const [id, tipos] of na) {
      const s = reg.get(id) ?? new Set<TipoImpuesto>();
      for (const t of tipos) s.add(t);
      reg.set(id, s);
    }
    setPendientes(p); setHechas(h); setRegistradas(reg);
    const docs = p.map((i) => {
      const d = fechaDocumento(i.orden);
      return { id: i.orden.id, fecha: fechaTasaBcv(d.fecha), origen: d.origen };
    });
    const porFecha = await getTasasUsdDeFechas(docs.map((d) => d.fecha)).catch(() => new Map<string, number>());
    const td: TasasDoc = new Map();
    for (const d of docs) {
      const tasa = porFecha.get(d.fecha);
      if (tasa) td.set(d.id, { tasa, fecha: d.fecha, origen: d.origen });
    }
    setTasasDoc(td);
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // Realtime multiusuario: lo que registra otro (o paga Tesorería o cambia en Régimen) se refleja al instante.
  useRealtime(['ordenes', 'retenciones', 'retencion_decisiones', 'retencion_agente_condiciones'], () => {
    void reload();
    cargarCondiciones();
  });

  // Una OC sigue «por realizar» mientras le quede un impuesto sin registrar en el libro.
  const porRealizar = useMemo(
    () => pendientes.filter((i) => impuestosPendientesDeOrden(i.orden, registradas, practica, condiciones).length > 0),
    [pendientes, registradas, practica, condiciones],
  );

  // La semilla del registro sale del archivo: su orden y, si es una OC que ya está en la lista, proveedor y montos.
  function semillaDeFactura(f: FacturaDeOrigen): SemillaFactura {
    const s: SemillaFactura = {
      direccion: 'practicada', docKind: f.origen.tipo, docId: f.origen.id,
      adjuntoId: f.adjuntoId, adjunto: { nombre: f.nombre, bucket: f.bucket, path: f.path },
    };
    const item = f.origen.tipo === 'oc' ? [...pendientes, ...hechas].find((i) => i.orden.id === f.origen.id) : undefined;
    if (!item) return s;
    const o = item.orden;
    return {
      ...s, contraparteId: o.proveedor_id, contraparteNombre: item.proveedorNombre,
      moneda: o.total_moneda === 'Bs' ? 'Bs' : 'USD',
      facturaTotal: o.total, baseImponible: o.total - (o.iva_monto ?? 0), iva: o.iva_monto ?? 0,
    };
  }

  const proveedorIdsPendientes = useMemo(
    () => new Set(porRealizar.map((i) => i.orden.proveedor_id).filter(Boolean) as string[]),
    [porRealizar],
  );

  // La lista de la vista: búsqueda y fechas (las de siempre), filtros con su conteo y orden.
  const baseLista = useMemo(() => {
    const txt = norm(fTexto);
    const xs = vista === 'pendientes' ? pendientes : hechas;
    return xs.filter(({ orden: o, proveedorNombre }) => {
      if (vista === 'hechas') {
        const fin = (o.retencion_finalizada_en ?? '').slice(0, 10);
        if (fDesde && fin && fin < fDesde) return false;
        if (fHasta && fin && fin > fHasta) return false;
        if (fDesde && !fin) return false;
      }
      if (txt) {
        const hay = norm(`${o.oc_codigo ?? ''} ${o.codigo} ${proveedorNombre} ${o.numero_administracion ?? ''}`);
        if (!hay.includes(txt)) return false;
      }
      return true;
    });
  }, [vista, pendientes, hechas, fDesde, fHasta, fTexto]);

  const filtrosLista = useMemo<FiltroLista<RetencionItem>[]>(() => [
    {
      campo: 'tesoreria', etiqueta: 'Tesorería', valor: fTesoreria,
      opciones: [['pagada', 'Pagada'], ['por_pagar', 'Por pagar']],
      pasa: ({ orden: o }, v) => (v === 'pagada' ? !!o.retencion_pagada : !o.retencion_pagada),
    },
    ...(vista === 'hechas' ? [{
      campo: 'tipo', etiqueta: 'Tipo de retención', valor: fTipo,
      opciones: TIPOS_RETENCION.map((t): [string, string] => [t.key, t.label]),
      pasa: ({ orden: o }: RetencionItem, v: string) => comprobantesDeOrden(o).some((c) => c.tipo === v),
    }] : []),
  ], [vista, fTesoreria, fTipo]);

  const filas = useMemo(() => {
    const fecha = ({ orden: o }: RetencionItem) => String((vista === 'hechas' ? o.retencion_finalizada_en : o.metodo_pago_en) ?? '');
    const xs = aplicarFiltros(baseLista, filtrosLista);
    const reciente = (a: RetencionItem, b: RetencionItem) => fecha(b).localeCompare(fecha(a));
    xs.sort(orden === 'antiguo' ? (a, b) => -reciente(a, b)
      : orden === 'proveedor' ? (a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre) || reciente(a, b)
        : reciente);
    return xs;
  }, [vista, baseLista, filtrosLista, orden]);
  const pagina = useMemo(() => paginar(filas, pag, tam), [filas, pag, tam]);

  const controles: ControlFiltro[] = filtrosLista.map((f) => ({
    campo: f.campo, etiqueta: f.etiqueta, valor: f.valor,
    total: aplicarFiltros(baseLista, filtrosLista.filter((o) => o.campo !== f.campo)).length,
    opciones: f.opciones.map(([v, t]) => ({ valor: v, texto: t, cuenta: conteoOpcion(baseLista, filtrosLista, f.campo, v) })),
  }));
  const ponerFiltro = (campo: string, v: string) => {
    if (campo === 'tesoreria') setFTesoreria(v);
    else if (campo === 'tipo') setFTipo(v as '' | TipoRetencion);
  };

  return (
    <div>
      {/* ── Cabecera v8 ── */}
      <header style={{ marginBottom: '.75rem' }}>
        <p className="muted" style={{ margin: '0 0 .5rem' }}>
          Retenciones por factura: aplicables, registradas y no aplicables.
        </p>
        <div className="lfv8-cabeza-acciones">
          <button className="btn btn-ghost" onClick={() => setParametros(true)}>⚙ Parámetros</button>
          <nav className="view-toggle" role="tablist" aria-label="Pantallas del módulo" style={{ margin: 0 }}>
            <button className={vista === 'pendientes' ? 'active' : ''} onClick={() => setVista('pendientes')}>
              Por realizar{porRealizar.length ? ` (${porRealizar.length})` : ''}
            </button>
            <button className={vista === 'hechas' ? 'active' : ''} onClick={() => setVista('hechas')}>Realizadas</button>
            <button className={vista === 'agrupada' || vista === 'libro' ? 'active' : ''} onClick={() => setVista('agrupada')}>📒 Libro fiscal</button>
            {conV3 && <button className={vista === 'periodos' ? 'active' : ''} onClick={() => setVista('periodos')}>Períodos</button>}
            <button className={vista === 'reportes' ? 'active' : ''} onClick={() => setVista('reportes')}>Reportes</button>
            <button className={vista === 'auditoria' ? 'active' : ''} onClick={() => setVista('auditoria')}>🛡️ Auditoría</button>
          </nav>
        </div>
      </header>

      {/* El período en curso de cada impuesto se ve en «Períodos» (resumen por impuesto). */}

      {/* ── Libro fiscal consolidado (con switch interno entre vista por factura, lista o por impuesto) ── */}
      {(vista === 'agrupada' || vista === 'libro') && (
        <LibroFiscalView canWrite={canWrite} actor={actor} actorName={actorName} />
      )}

      {/* ── Períodos fiscales (v8: filtros + atención + timeline) ── */}
      {/* Períodos solo con V3R en la base: generar el año, declarar y reabrir. */}
      {vista === 'periodos' && conV3 && <PeriodosRetencion puedeEditar={canWrite} />}

      {/* ── Reportes ── */}
      {vista === 'reportes' && <ReportesView actor={actor} />}

      {/* ── Auditoría Fiscal (concisa y explícita) ── */}
      {vista === 'auditoria' && <AuditoriaRetenciones />}

      {/* ── Por realizar (v8): grid, pills, acciones inline ── */}
      {/* P03: lo que falta de Compras (recepciones sin factura) y sus archivos de factura por registrar. */}
      {vista === 'pendientes' && (
        <>
          <AvisoSinFactura rutaDe={(o) => `/app/pedidos?detalle=${encodeURIComponent(o.origen.id)}`} />
          <FacturasPorRegistrar puedeRegistrar={canWrite} onRegistrar={(f) => setRegistrarFactura(semillaDeFactura(f))} />
        </>
      )}
      {vista === 'pendientes' && (
        <PorRealizarView
          items={porRealizar} registradas={registradas} practica={practica} condiciones={condiciones} tasasDoc={tasasDoc} loading={loading} canWrite={canWrite}
          onVer={setSel} onVista={() => setVista('agrupada')}
          onRegistrar={setRegistrar}
          onNoAplica={conNoAplica && canWrite ? setNoAplica : undefined}
        />
      )}

      {/* ── Realizadas ── */}
      {vista === 'hechas' && (
      <>
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <BarraLista
          q={fTexto} onQ={setFTexto} placeholder="Buscar por N° de OC, OP o proveedor"
          resultados={filas.length} unidad="OC"
          filtros={controles} onFiltro={ponerFiltro}
          orden={{ valor: orden, opciones: [['reciente', 'Más reciente primero'], ['antiguo', 'Más antiguo primero'], ['proveedor', 'Proveedor (A–Z)']] }}
          onOrden={(v) => setOrden(v as typeof orden)}
          onQuitar={limpiarFiltros}
          extra={
            <>
              <label className="lf-campo"><span>Realizada desde</span><input className="input" type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} /></label>
              <label className="lf-campo"><span>Hasta</span><input className="input" type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} /></label>
            </>
          }
        />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead>
              <tr>
                <th>N°OC</th><th>OP</th><th>Proveedor</th><th>Condición</th><th>Retención</th>
                <th style={{ textAlign: 'right' }}>Total $</th><th>Tesorería</th>
                <th>Realizada</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !filas.length && (
                <tr><td colSpan={9}><EmptyState icon="🧾" message="Sin retenciones en el historial con esos filtros" /></td></tr>
              )}
              {!loading && pagina.filas.map(({ orden: o, proveedorNombre }) => (
                <tr key={o.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => setSel({ orden: o, proveedorNombre })}>
                  <td className="mono">{o.oc_codigo ?? '—'}</td>
                  <td className="mono">{o.codigo}</td>
                  <td>{proveedorNombre}</td>
                  <td>{labelCondicionPago(o.condiciones_pago)}</td>
                  <td>{labelRetencionModo(o.retencion_modo)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(o.total)}</td>
                  <td>{o.retencion_pagada ? <span className="badge" style={{ color: 'var(--success)' }}>✓ Pagada</span> : <span className="muted">Por pagar</span>}</td>
                  <td className="muted">{o.retencion_finalizada_en ? dateTime(o.retencion_finalizada_en) : '—'}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-primary" onClick={() => setSel({ orden: o, proveedorNombre })}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && (
          <Paginador pagina={pagina} tam={tam} unidad="OC" onPagina={setPag} onTam={(t) => { setTam(t); setPag(1); }} />
        )}
      </div>
      </>
      )}

      {sel && (
        <RetencionModal
          item={sel} canWrite={canWrite} actor={actor} actorName={actorName}
          onClose={() => setSel(null)}
          onSaved={async () => { setSel(null); await reload(); }}
        />
      )}
      {parametros && (
        <ConfiguracionFiscalModal puedeEditar={canWrite} onClose={() => setParametros(false)} />
      )}
      {registrar && (
        <RegistrarRetencionModal
          semilla={registrar} actor={actor} actorName={actorName}
          proveedorIdsPendientes={proveedorIdsPendientes}
          onClose={() => setRegistrar(null)}
          onHecho={async () => { setRegistrar(null); await reload().catch(() => {}); }}
        />
      )}
      {noAplica && (
        <NoAplicaModal objetivo={noAplica} actor={actor} actorName={actorName}
          onClose={() => setNoAplica(null)}
          onHecho={async () => { setNoAplica(null); await reload().catch(() => {}); }} />
      )}
      {registrarFactura && (
        <RegistrarFacturaRetencion
          semilla={registrarFactura} actor={actor} actorName={actorName}
          onClose={() => setRegistrarFactura(null)}
          onHecho={async () => { setRegistrarFactura(null); await reload().catch(() => {}); }}
        />
      )}
    </div>
  );
}

function RetencionModal({ item, canWrite, actor, actorName, onClose, onSaved }: {
  item: RetencionItem; canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const o = item.orden;
  const yaFinalizada = !!o.retencion_finalizada;
  const comprobantes = useMemo(() => comprobantesDeOrden(o), [o]);
  const [archivos, setArchivos] = useState<Partial<Record<TipoRetencion, File>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const algunArchivo = (Object.values(archivos) as (File | undefined)[]).some(Boolean);

  function setArchivo(tipo: TipoRetencion, file: File | null) {
    setArchivos((m) => ({ ...m, [tipo]: file ?? undefined }));
  }

  async function descargar(path: string) {
    try { previewArchivo(await urlRetencion(path), path.split('/').pop() || 'comprobante'); }
    catch { toast('No se pudo abrir el comprobante', 'error'); }
  }

  async function handleFinalizar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!algunArchivo) { setError('Carga al menos un comprobante (IVA, ISLR o Municipal).'); return; }
    setSaving(true);
    try {
      void actorName;
      await finalizarRetencion({ orden: o, archivos, actor });
      notify(`Retención registrada · OC ${o.oc_codigo ?? o.codigo}`, 'success', { link: '#/app/retenciones' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo finalizar la retención.'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      {!yaFinalizada && canWrite && (
        <button type="submit" form="ret-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Finalizar retención'}</button>
      )}
    </>
  );

  return (
    <Modal title={`Retención · OC ${o.oc_codigo ?? o.codigo}`} size="lg" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* Detalle de la OC */}
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la orden de compra</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
          <div><span className="muted">Proveedor:</span> <strong>{item.proveedorNombre}</strong></div>
          <div><span className="muted">Tlf. de administración del proveedor:</span> <strong className="mono">{o.numero_administracion || '—'}</strong></div>
          <div><span className="muted">Condición:</span> {labelCondicionPago(o.condiciones_pago)}</div>
          <div><span className="muted">Retención:</span> {labelRetencionModo(o.retencion_modo)}</div>
          <div><span className="muted">Total:</span> <strong className="mono">{money(o.total)}</strong></div>
          <div><span className="muted">Tesorería:</span> {o.retencion_pagada ? <strong style={{ color: 'var(--success)' }}>✓ Pagada{o.retencion_pagada_en ? ` · ${dateTime(o.retencion_pagada_en)}` : ''}</strong> : 'Por pagar'}</div>
        </div>

        {/* Factura del proveedor cargada al finalizar la OC */}
        <div style={{ marginTop: '.55rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: '.86rem' }}>Factura del proveedor:</span>
          {o.factura_recepcion_path
            ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => descargar(o.factura_recepcion_path!)}>🧾 Ver factura{o.factura_recepcion_nombre ? ` · ${o.factura_recepcion_nombre}` : ''}</button>
            : <span className="muted" style={{ fontSize: '.84rem' }}>— sin factura cargada —</span>}
        </div>

        <div className="table-wrap" style={{ marginTop: '.5rem' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
            <tbody>
              {(o.items ?? []).map((it, i) => (
                <tr key={i}><td>{it.nombre}{it.sku ? <span className="muted"> · {it.sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(it.precio)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comprobantes ya cargados (descarga) */}
      {comprobantes.length > 0 && (
        <div className="card" style={{ margin: '0 0 .75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Comprobantes cargados</div>
          <div style={{ display: 'grid', gap: '.35rem' }}>
            {comprobantes.map((c) => (
              <div key={c.tipo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', fontSize: '.85rem' }}>
                <span><span className="badge">{c.label}</span> <span className="muted">{c.nombre}</span></span>
                <button className="btn btn-sm btn-ghost" onClick={() => descargar(c.path)}>📎 Descargar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Carga de los 3 comprobantes (al menos uno) */}
      {!yaFinalizada && canWrite && (
        <form id="ret-form" onSubmit={handleFinalizar}>
          <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.5rem' }}>
            Carga <strong>al menos uno</strong> de los comprobantes (PDF o imagen). Al finalizar, la retención queda registrada y se refleja en Tesorería.
          </div>
          {TIPOS_RETENCION.map((t) => (
            <div key={t.key} className="form-row">
              <label>{t.label}</label>
              <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(t.key, e.target.files?.[0] ?? null)} />
              {archivos[t.key] && <small className="muted">{archivos[t.key]?.name}</small>}
            </div>
          ))}
        </form>
      )}
      {yaFinalizada && (
        <div className="muted" style={{ fontSize: '.84rem' }}>✓ Retención finalizada{o.retencion_finalizada_en ? ` el ${dateTime(o.retencion_finalizada_en)}` : ''}.</div>
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Por realizar — v8: grid, pills de impuesto, acciones inline
   ═══════════════════════════════════════════════════════════════ */

type ImpuestoPendiente = 'iva' | 'islr' | 'municipal';
const IMPUESTOS_PENDIENTES: { key: ImpuestoPendiente; label: string }[] = [
  { key: 'iva', label: 'IVA' }, { key: 'islr', label: 'ISLR' }, { key: 'municipal', label: 'ISAE' },
];

/** Impuestos registrados en el libro, por id de la OC. */
type Registradas = Map<string, Set<TipoImpuesto>>;

/** Tasa BCV del día del documento (OC o CS), por id, con el rótulo de qué fecha se usó. */
type TasaDoc = { tasa: number; fecha: string; origen: string };
type TasasDoc = Map<string, TasaDoc>;

/** Día del documento: emisión de la OC/CS; si no la tiene, su creación. Nunca el pago. */
function fechaDocumento(o: Orden): { fecha: string; origen: string } {
  const origen = o.tipo === 'servicio' ? 'CS' : 'OC';
  if (o.oc_emitida_en) return { fecha: diaVE(o.oc_emitida_en), origen: `emisión ${origen}` };
  return { fecha: diaVE(o.oc_creada_en ?? o.created_at), origen: `creación ${origen}` };
}

/** El equivalente en la otra moneda, a la tasa del día del documento. */
function equivalente(o: Orden, t: TasaDoc | undefined): { monto: string; tasa: string } | null {
  if (!t) return null;
  const enBs = o.total_moneda === 'Bs';
  return {
    monto: `≈ ${enBs ? montoMoneda(o.total / t.tasa, 'USD') : montoMoneda(o.total * t.tasa, 'Bs')}`,
    tasa: `BCV ${num(t.tasa)} del ${t.fecha.slice(8, 10)}/${t.fecha.slice(5, 7)} (${t.origen})`,
  };
}

/**
 * Lo que falta: ni el comprobante del flujo anterior ni una retención vigente en el libro.
 * Con `practica` (R10), solo los impuestos que la empresa practica según su Régimen.
 * Valida la vigencia de agente de retención a la fecha del documento (OC o CS).
 */
function impuestosPendientesDeOrden(
  o: Orden,
  reg: Registradas,
  practica: Set<ImpuestoPendiente> | null = null,
  condiciones: CondicionRegistrada[] | null = null,
): ImpuestoPendiente[] {
  const ya = reg.get(o.id);
  const out: ImpuestoPendiente[] = [];

  const fechaDoc = fechaDocumento(o).fecha;
  let retieneIva = true;
  if (condiciones && condiciones.length > 0) {
    retieneIva = empresaEsAgenteEnFecha(condiciones, fechaDoc, 'IVA');
  } else if (practica) {
    retieneIva = practica.has('iva');
  }

  if (retieneIva && !o.retencion_iva_path && !ya?.has('iva')) out.push('iva');
  if ((!practica || practica.has('islr')) && !o.retencion_islr_path && !ya?.has('islr')) out.push('islr');
  if ((!practica || practica.has('municipal')) && !o.retencion_municipal_path && !ya?.has('municipal')) out.push('municipal');

  return out;
}

function PorRealizarView({ items, registradas, practica, condiciones, tasasDoc, loading, canWrite, onVer, onVista, onRegistrar, onNoAplica }: {
  items: RetencionItem[]; registradas: Registradas; practica: Set<ImpuestoPendiente> | null; condiciones: CondicionRegistrada[] | null; tasasDoc: TasasDoc; loading: boolean; canWrite: boolean;
  onVer: (item: RetencionItem) => void; onVista: () => void;
  onRegistrar: (semilla: SemillaRetencion) => void;
  /** Solo con R10 y permiso: marcar que un impuesto no aplica. */
  onNoAplica?: (o: ObjetivoNoAplica) => void;
}) {
  const [q, setQ] = useState('');
  const [fImp, setFImp] = useState('');
  const [ord, setOrd] = useState<'antiguo' | 'reciente' | 'proveedor'>('antiguo');
  const [pag, setPag] = useState(1);
  const tam = 25;

  useEffect(() => { setPag(1); }, [q, fImp, ord]);

  const retenidosSinRegistrar = useMemo(
    () => items.filter((i) => i.orden.retencion_aplicada && !i.orden.retencion_finalizada && !registradas.has(i.orden.id)),
    [items, registradas],
  );

  const alertas = useMemo(
    () => items.filter((i) => {
      const o = i.orden;
      if (!o.retencion_monto || o.retencion_monto <= 0) return false;
      return o.retencion_monto > o.total;
    }),
    [items],
  );

  const filtradas = useMemo(() => {
    const txt = norm(q);
    return items.filter(({ orden: o, proveedorNombre }) => {
      if (txt) {
        const hay = norm(`${o.oc_codigo ?? ''} ${o.codigo} ${proveedorNombre} ${o.numero_administracion ?? ''}`);
        if (!hay.includes(txt)) return false;
      }
      if (fImp) {
        const pends = impuestosPendientesDeOrden(o, registradas, practica, condiciones);
        if (!pends.includes(fImp as ImpuestoPendiente)) return false;
      }
      return true;
    });
  }, [items, registradas, practica, condiciones, q, fImp]);

  const ordenadas = useMemo(() => {
    const xs = [...filtradas];
    const fecha = (i: RetencionItem) => String(i.orden.metodo_pago_en ?? i.orden.created_at ?? '');
    xs.sort(ord === 'reciente' ? (a, b) => fecha(b).localeCompare(fecha(a))
      : ord === 'proveedor' ? (a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre)
        : (a, b) => fecha(a).localeCompare(fecha(b)));
    return xs;
  }, [filtradas, ord]);

  const totalPags = Math.max(1, Math.ceil(ordenadas.length / tam));
  const pagActual = Math.min(pag, totalPags);
  const visible = ordenadas.slice((pagActual - 1) * tam, pagActual * tam);

  const conteoImp = useMemo(() => {
    const c: Record<string, number> = { iva: 0, islr: 0, municipal: 0 };
    for (const i of items) {
      for (const k of impuestosPendientesDeOrden(i.orden, registradas, practica, condiciones)) c[k]++;
    }
    return c;
  }, [items, registradas, practica, condiciones]);

  return (
    <>
      {/* Retenido al pagar, sin registrar */}
      {retenidosSinRegistrar.length > 0 && (
        <div className="lfv8-pagar">
          <h3>Retenido al pagar, falta cargarlo en el libro ({retenidosSinRegistrar.length})</h3>
          <p className="lfv8-huella">Lo retenido en el pago que todavía no está en el libro, incluidos los servicios directos. Al registrar, se usa la tasa de la factura y la del pago queda como referencia.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
            {retenidosSinRegistrar.slice(0, 10).map(({ orden: o, proveedorNombre }) => (
              <div key={o.id} className="lfv8-pagar-fila">
                <span>
                  <b className="mono">{o.oc_codigo ?? o.codigo}</b> · {nombreDocumento(o.oc_codigo ?? o.codigo)} · {proveedorNombre}
                  {o.retencion_monto != null && <> · retenido {montoMoneda(o.retencion_monto, o.total_moneda)}</>}
                  {o.retencion_tasa != null && <> · tasa del pago {num(o.retencion_tasa)}</>}
                </span>
                {canWrite && (
                  <span className="lfv8-pagar-acc">
                    <button className="btn btn-sm lfv8-btn-reg" onClick={() => onVer({ orden: o, proveedorNombre })}>Registrar</button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {retenidosSinRegistrar.length > 10 && (
            <p className="lfv8-huella">Se muestran 10 de {retenidosSinRegistrar.length}.</p>
          )}
        </div>
      )}

      {/* Alertas */}
      {alertas.map(({ orden: o, proveedorNombre }) => (
        <div key={`alerta-${o.id}`} className="lfv8-alerta-media">
          <span>{o.oc_codigo ?? o.codigo} · {proveedorNombre}: El monto pagado al proveedor supera el debido: verificar la retención de IVA de la compra.</span>
        </div>
      ))}

      {/* Barra de búsqueda y filtros */}
      <div className="lfv8-barra">
        <div className="lfv8-buscar">
          <input
            type="search" className="input lfv8-buscar-q" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por proveedor, RIF, factura u OC" aria-label="Buscar por proveedor, RIF, factura u OC"
          />
          <span className="lfv8-barra-res" role="status">{filtradas.length} resultado(s)</span>
        </div>
        <div className="lfv8-barra-filtros">
          <label className="lfv8-campo">
            <span>Impuesto</span>
            <select className="lfv8-select" value={fImp} onChange={(e) => setFImp(e.target.value)}>
              <option value="">Todos</option>
              {IMPUESTOS_PENDIENTES.map((t) => (
                <option key={t.key} value={t.key}>{t.label} ({conteoImp[t.key]})</option>
              ))}
            </select>
          </label>
          <label className="lfv8-campo">
            <span>Ordenar por</span>
            <select className="lfv8-select" value={ord} onChange={(e) => setOrd(e.target.value as typeof ord)}>
              <option value="antiguo">Más antiguo primero</option>
              <option value="reciente">Más reciente primero</option>
              <option value="proveedor">Proveedor (A–Z)</option>
            </select>
          </label>
        </div>
      </div>

      <p className="lfv8-huella">Cada fila es una compra ya pagada o por pagar (orden de compra «OC» o control de servicio «CS»). Sigue aquí mientras le falte cargar la retención de algún impuesto (IVA, ISLR o ISAE), o marcar que no aplica.</p>

      {/* Grid table */}
      <div className="lfv8-sis" style={{ '--cols': '1fr 1.5fr 1fr .9fr 1fr 2.4fr' } as React.CSSProperties}>
        <div className="lfv8-sis-cab">
          <span>Compra</span>
          <span>Proveedor</span>
          <span>Retenciones cargadas</span>
          <span style={{ textAlign: 'right' }}>Total</span>
          <span>Pendiente</span>
          <span></span>
        </div>

        {loading && <div className="lfv8-sis-vacio">Cargando…</div>}
        {!loading && !ordenadas.length && <div className="lfv8-sis-vacio">Sin registros para los filtros aplicados.</div>}

        {!loading && visible.map(({ orden: o, proveedorNombre }) => {
          const fechaDoc = fechaDocumento(o).fecha;
          const pends = impuestosPendientesDeOrden(o, registradas, practica, condiciones);
          const aplicablesDeOrden = (condiciones && condiciones.length > 0)
            ? IMPUESTOS_PENDIENTES.filter((t) => t.key === 'iva' ? empresaEsAgenteEnFecha(condiciones, fechaDoc, 'IVA') : (!practica || practica.has(t.key)))
            : (practica ? IMPUESTOS_PENDIENTES.filter((t) => practica.has(t.key)) : IMPUESTOS_PENDIENTES);
          const total = aplicablesDeOrden.length;
          const regs = Math.max(0, total - pends.length);
          return (
            <div key={o.id} className="lfv8-sis-fila">
              <span data-l="Compra">
                <span className="mono">{o.oc_codigo ?? o.codigo}</span>
                <small>{nombreDocumento(o.oc_codigo ?? o.codigo)}</small>
              </span>
              <span data-l="Proveedor">
                {proveedorNombre}
                {o.numero_administracion && <small>{o.numero_administracion}</small>}
              </span>
              <span data-l="Retenciones cargadas">
                {regs > 0 ? `${regs} de ${total} impuestos` : 'Ninguna todavía'}
              </span>
              <span className="n" data-l="Total">
                {montoMoneda(o.total, o.total_moneda)}
                {(() => {
                  const eq = equivalente(o, tasasDoc.get(o.id));
                  if (!eq) return <small className="muted" style={{ display: 'block' }}>sin tasa BCV del día</small>;
                  return (<>
                    <small style={{ display: 'block', whiteSpace: 'nowrap' }}>{eq.monto}</small>
                    <small className="muted" style={{ display: 'block', whiteSpace: 'nowrap' }}>{eq.tasa}</small>
                  </>);
                })()}
              </span>
              <span data-l="Pendiente">
                {pends.map((k) => {
                  const lbl = IMPUESTOS_PENDIENTES.find((t) => t.key === k)?.label ?? k;
                  return <span key={k} className="lfv8-pill falta">{lbl}</span>;
                })}
                {pends.length === 0 && <span className="lfv8-pill ok">Completa</span>}
              </span>
              <span className="lfv8-sis-acc">
                {pends.map((k) => {
                  const lbl = IMPUESTOS_PENDIENTES.find((t) => t.key === k)?.label ?? k;
                  return (
                    <button key={k} className="btn btn-sm lfv8-btn-reg" onClick={() => onRegistrar({
                      direccion: 'practicada',
                      tipoInicial: k,
                      // Las OC de servicio también viven en `ordenes`: van por orden_id, no por servicio_directo_id.
                      docKind: 'oc',
                      docId: o.id, codigo: o.oc_codigo ?? o.codigo,
                      contraparteId: o.proveedor_id, contraparteNombre: proveedorNombre,
                      moneda: o.total_moneda === 'Bs' ? 'Bs' : 'USD',
                      total: o.total, baseImponible: o.total - (o.iva_monto ?? 0), iva: o.iva_monto ?? 0,
                    })}>
                      Registrar {lbl}
                    </button>
                  );
                })}
                {onNoAplica && pends.map((k) => {
                  const lbl = IMPUESTOS_PENDIENTES.find((t) => t.key === k)?.label ?? k;
                  return (
                    <button key={`na-${k}`} className="btn btn-sm btn-ghost" title={`Al ${lbl} de esta compra no le corresponde retención`}
                      onClick={() => onNoAplica({
                        ordenId: o.id, codigo: o.oc_codigo ?? o.codigo, proveedorId: o.proveedor_id ?? null, proveedorNombre,
                        moneda: o.total_moneda === 'Bs' ? 'Bs' : 'USD', total: o.total ?? null,
                        impuestoClave: tipoAGt(k), impuestoNombre: lbl,
                      })}>
                      {lbl}: no aplica
                    </button>
                  );
                })}
                {o.factura_recepcion_path
                  ? <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); void descargarFactura(o); }}>📎 Factura</button>
                  : <button className="btn btn-sm btn-ghost" disabled title="Sin archivo de factura en Compras">📎 Sin archivo</button>}
                {o.oc_codigo && (
                  <a className="btn btn-sm btn-ghost" href={`#/app/pedidos?detalle=${encodeURIComponent(o.id)}`}>Ver OC</a>
                )}
                <button className="btn btn-sm btn-ghost" onClick={onVista}>Ver en vista agrupada</button>
              </span>
            </div>
          );
        })}

        {!loading && ordenadas.length > tam && (
          <div className="lfv8-sis-pag">
            <span><b>{ordenadas.length}</b> documento(s) · página {pagActual} de {totalPags}</span>
            <span className="lfv8-sis-pag-btns">
              <button className="btn btn-ghost" disabled={pagActual <= 1} onClick={() => setPag(pagActual - 1)}>‹ Anterior</button>
              <button className="btn btn-ghost" disabled={pagActual >= totalPags} onClick={() => setPag(pagActual + 1)}>Siguiente ›</button>
            </span>
          </div>
        )}
      </div>
    </>
  );
}

async function descargarFactura(o: Orden) {
  try {
    const url = await urlRetencion(o.factura_recepcion_path!);
    previewArchivo(url, o.factura_recepcion_nombre ?? 'factura');
  } catch { toast('No se pudo abrir la factura', 'error'); }
}

