/* ============================================================
   MGG · Contabilidad · Menú «Integración» (E-06 pieza 2)

   Galac §8: lo que en Galac vive en cada sistema que alimenta a
   Contabilidad (Administrativo, Nómina…), en MGG vive aquí, porque los
   módulos son del mismo sistema:
   · Por contabilizar: la bandeja de documentos de los módulos sin
     comprobante (cont_integraciones «pendiente» o «error»). Contabilizar
     usa el motor de reglas; cada documento o lote da un comprobante, en
     orden de fecha y documento. «Ver comprobante» muestra lo que
     generaría la regla, sin grabar.
   · Reglas de Contabilización: por módulo de origen y pestaña, con sus
     cuentas Debe / Haber, «Cómo Contabilizar» (Inmediata / Pospuesta),
     «Tipo de Contabilización» (Cada Documento / Por Lote) y «Editar
     Inmediatamente el Comprobante Generado». Solo consulta en la maqueta.
   · Mapeos: de qué cuenta sale cada caja, categoría de gasto, almacén…
   Cada importe en una columna, con la equivalente debajo (ImporteDoble).
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { date, money } from '@/shared/lib/format';
import {
  contabilizarIntegraciones, listAuxiliares, listCentrosCosto, listCuentas, listIntegraciones, listMapeos,
  listReglasContabilizacion, listTiposComprobante, vistaPreviaIntegracion,
  type DocumentoIntegracion, type ReglaCompleta,
} from './contabilidad.repository';
import { ImporteDoble, SelectorMoneda, par, useMonedaVista } from './ImporteDoble';
import { nombreModulo } from './logica/integracion';
import type { ComprobanteGenerado } from './logica/motorReglas';
import type { MonedaInforme } from './logica/reportes';
import type { ContAuxiliar, ContCentroCosto, ContCuenta, ContIntegracion, ContMapeo, ContReglaLinea, ContTipoComprobante } from './tipos';

type Vista = 'bandeja' | 'reglas' | 'mapeos';

export function IntegracionTab() {
  const [vista, setVista] = useState<Vista>('bandeja');
  return (
    <>
      <div className="view-toggle" role="tablist" aria-label="Integración" style={{ marginBottom: '1rem' }}>
        <button role="tab" aria-selected={vista === 'bandeja'} className={vista === 'bandeja' ? 'active' : ''} onClick={() => setVista('bandeja')}>Por contabilizar</button>
        <button role="tab" aria-selected={vista === 'reglas'} className={vista === 'reglas' ? 'active' : ''} onClick={() => setVista('reglas')}>Reglas de Contabilización</button>
        <button role="tab" aria-selected={vista === 'mapeos'} className={vista === 'mapeos' ? 'active' : ''} onClick={() => setVista('mapeos')}>Mapeos</button>
      </div>
      {vista === 'bandeja' && <BandejaPorContabilizar />}
      {vista === 'reglas' && <ReglasContabilizacion />}
      {vista === 'mapeos' && <MapeosVista />}
    </>
  );
}

/* ───────────── Catálogos para mostrar códigos y nombres ───────────── */

interface Catalogo { cuentas: ContCuenta[]; centros: ContCentroCosto[]; auxiliares: ContAuxiliar[]; tipos: ContTipoComprobante[] }

function useCatalogo(): Catalogo | null {
  const [cat, setCat] = useState<Catalogo | null>(null);
  useEffect(() => {
    Promise.all([listCuentas(), listCentrosCosto(), listAuxiliares(), listTiposComprobante()])
      .then(([cuentas, centros, auxiliares, tipos]) => setCat({ cuentas, centros, auxiliares, tipos }))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer los catálogos.', 'error'));
  }, []);
  return cat;
}

const cuentaTexto = (cat: Catalogo, id: string | null) => {
  const c = cat.cuentas.find((x) => x.id === id);
  return c ? `${c.codigo} · ${c.nombre}` : '—';
};

/* ───────────── Por contabilizar ───────────── */

type FiltroEstado = 'por_contabilizar' | 'contabilizado' | 'todos';
const ESTADOS: Record<FiltroEstado, ContIntegracion['estado'][] | undefined> = {
  por_contabilizar: ['pendiente', 'error'], contabilizado: ['contabilizado'], todos: undefined,
};
const POR_PAGINA = 100;

export function EtiquetaIntegracion({ fila }: { fila: DocumentoIntegracion }) {
  const { estado, error } = fila.integracion;
  if (estado === 'contabilizado') return <span className="cont-etq mov">Contabilizado{fila.comprobante ? ` · ${fila.comprobante.codigo}` : ''}</span>;
  if (estado === 'error') return <span className="cont-etq descuadrado" title={error ?? ''}>Error</span>;
  if (estado === 'excluido') return <span className="cont-etq">Excluido</span>;
  return <span className="cont-etq acr">Pendiente</span>;
}

export function BandejaPorContabilizar() {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const [moneda, setMoneda] = useMonedaVista();
  const [filtro, setFiltro] = useState<FiltroEstado>('por_contabilizar');
  const [modulo, setModulo] = useState('');
  const [filas, setFilas] = useState<DocumentoIntegracion[] | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState<DocumentoIntegracion | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFilas(await listIntegraciones({ estados: ESTADOS[filtro] }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo leer la bandeja.', 'error');
    }
  }, [filtro]);
  useEffect(() => { void cargar(); setElegidos(new Set()); setPagina(0); }, [cargar]);

  const modulos = useMemo(() => [...new Set((filas ?? []).map((f) => f.integracion.origen_modulo))].sort(), [filas]);
  const visibles = useMemo(() => (filas ?? []).filter((f) => !modulo || f.integracion.origen_modulo === modulo), [filas, modulo]);
  const contabilizables = visibles.filter((f) => f.integracion.estado === 'pendiente' || f.integracion.estado === 'error');
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));

  async function contabilizar(ids: string[]) {
    if (!ids.length) return;
    setTrabajando(true);
    try {
      const r = await contabilizarIntegraciones(ids, actor);
      const desde = r.comprobantes[0]?.codigo;
      const hasta = r.comprobantes.at(-1)?.codigo;
      if (r.comprobantes.length) toast(`${r.comprobantes.length} comprobante(s) grabado(s)${desde ? `: ${desde}${hasta !== desde ? ` a ${hasta}` : ''}` : ''}.`, 'success');
      if (r.errores.length) toast(`${r.errores.length} documento(s) quedaron con error: ${r.errores[0].documento} · ${r.errores[0].error}`, 'error');
      setElegidos(new Set());
      await cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo contabilizar.', 'error');
    } finally {
      setTrabajando(false);
    }
  }

  const alternar = (id: string) => setElegidos((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  if (!filas) return <p className="muted">Leyendo la bandeja…</p>;
  const todosElegidos = contabilizables.length > 0 && contabilizables.every((f) => elegidos.has(f.integracion.id));

  return (
    <>
      <div className="cont-barra">
        <select className="select" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroEstado)} aria-label="Estado">
          <option value="por_contabilizar">Por contabilizar</option>
          <option value="contabilizado">Contabilizados</option>
          <option value="todos">Todos</option>
        </select>
        <select className="select" value={modulo} onChange={(e) => { setModulo(e.target.value); setPagina(0); }} aria-label="Módulo de origen">
          <option value="">Módulo: todos</option>
          {modulos.map((m) => <option key={m} value={m}>{nombreModulo(m)}</option>)}
        </select>
        <SelectorMoneda valor={moneda} onCambio={setMoneda} />
        <span className="cont-sep" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={trabajando || elegidos.size === 0} onClick={() => void contabilizar([...elegidos])}>
          Contabilizar seleccionados ({elegidos.size})
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={trabajando || contabilizables.length === 0} onClick={() => void contabilizar(contabilizables.map((f) => f.integracion.id))}>
          Contabilizar todo ({contabilizables.length})
        </button>
      </div>
      <p className="cont-nota" style={{ marginBottom: '.5rem' }}>
        Se contabiliza en orden de fecha y documento: cada documento da un comprobante, y los de una regla «Por Lote» del mismo día van juntos.
        Un documento que no se puede contabilizar (mes cerrado, falta un mapeo o una tasa) queda en «Error» con el motivo, y los demás siguen.
      </p>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" aria-label="Elegir todos" checked={todosElegidos} disabled={!contabilizables.length}
                    onChange={() => setElegidos(todosElegidos ? new Set() : new Set(contabilizables.map((f) => f.integracion.id)))} />
                </th>
                <th>Fecha</th><th>Generado Por</th><th>Documento</th><th>Descripción</th><th>Regla</th>
                <th style={{ textAlign: 'right' }}>Debe</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={9}><EmptyState icon="✅" message={filtro === 'por_contabilizar' ? 'No hay documentos por contabilizar.' : 'No hay documentos con ese filtro.'} /></td></tr>
              )}
              {visibles.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA).map((f) => {
                const i = f.integracion;
                const puede = i.estado === 'pendiente' || i.estado === 'error';
                return (
                  <tr key={i.id}>
                    <td><input type="checkbox" aria-label={`Elegir ${i.origen_id}`} disabled={!puede} checked={elegidos.has(i.id)} onChange={() => alternar(i.id)} /></td>
                    <td>{date(i.fecha)}</td>
                    <td className="muted">{nombreModulo(i.origen_modulo)}</td>
                    <td><span className="mono">{i.origen_id}</span>{f.documento?.origen_ref && <div className="dim">{f.documento.origen_ref}</div>}</td>
                    <td>
                      {f.documento?.descripcion ?? '—'}
                      {i.estado === 'error' && <div className="cont-nota cont-nota-alerta">{i.error}</div>}
                    </td>
                    <td>
                      {f.regla ? <><span className="mono">{f.regla.codigo}</span><div className="dim">{f.regla.pestana}{f.regla.tipo_contabilizacion === 'por_lote' ? ' · Por Lote' : ''}</div></> : <span className="cont-etq descuadrado">Sin regla</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{f.debe ? <ImporteDoble moneda={moneda} {...par(moneda, f.debe.ves, f.debe.usd)} conSimbolo /> : '—'}</td>
                    <td><EtiquetaIntegracion fila={f} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {puede && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVistaPrevia(f)}>Ver comprobante</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="cont-paginas">
            <button type="button" className="btn btn-ghost btn-sm" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹</button>
            <span>Página {pagina + 1} de {paginas} · {visibles.length} documentos</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>›</button>
          </div>
        )}
      </div>

      {vistaPrevia && (
        <VistaPreviaComprobante fila={vistaPrevia} moneda={moneda} trabajando={trabajando}
          onCerrar={() => setVistaPrevia(null)}
          onContabilizar={async () => { await contabilizar([vistaPrevia.integracion.id]); setVistaPrevia(null); }} />
      )}
    </>
  );
}

/** Lo que generaría la regla para un documento, sin grabar (Galac: «Editar Inmediatamente el Comprobante Generado»). */
function VistaPreviaComprobante({ fila, moneda, trabajando, onCerrar, onContabilizar }: {
  fila: DocumentoIntegracion; moneda: MonedaInforme; trabajando: boolean; onCerrar: () => void; onContabilizar: () => Promise<void>;
}) {
  const cat = useCatalogo();
  const [g, setG] = useState<ComprobanteGenerado | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    vistaPreviaIntegracion(fila.integracion.id).then(setG).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo generar el comprobante.'));
  }, [fila.integracion.id]);
  const s = (k: 'debe_ves' | 'haber_ves' | 'debe_usd' | 'haber_usd') => (g ? g.lineas.reduce((a, l) => a + Math.round(l[k] * 100), 0) / 100 : 0);
  return (
    <Modal title={`Comprobante que se generaría · ${fila.integracion.origen_id}`} size="lg" onClose={onCerrar} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Salir</button>
      <button type="button" className="btn btn-primary" disabled={!g || trabajando} onClick={() => void onContabilizar()}>Contabilizar</button>
    </>}>
      {error && <p className="cont-nota cont-nota-alerta">{error}</p>}
      {g && cat && (
        <>
          <div className="cont-cabecera">
            <div><span className="dim">Número</span><strong>Se asigna al contabilizar</strong></div>
            <div><span className="dim">Tipo</span><strong>{cat.tipos.find((t) => t.id === g.regla.tipo_comprobante_id)?.nombre ?? '—'}</strong></div>
            <div className="ancho"><span className="dim">Descripción</span><strong>{g.concepto}</strong></div>
            <div><span className="dim">Fecha</span><strong>{date(g.fecha)}</strong></div>
            <div><span className="dim">Generado Por</span><strong>{nombreModulo(fila.integracion.origen_modulo)}</strong></div>
            <div><span className="dim">Regla</span><strong className="mono">{g.regla.codigo}</strong></div>
            <div><span className="dim">Número de Lote</span><strong>{g.numero_lote ?? '—'}</strong></div>
          </div>
          <div className="table-wrap" style={{ marginTop: '.75rem' }}>
            <table className="table cont-asientos">
              <thead><tr><th>Código Cuenta</th><th>Auxiliar</th><th>C.C.</th><th>Descripción</th><th>Moneda</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
              <tbody>
                {g.lineas.map((l, i) => {
                  const cuenta = cat.cuentas.find((x) => x.id === l.cuenta_id);
                  return (
                    <tr key={i}>
                      <td><span className="mono">{cuenta?.codigo}</span><div className="dim">{cuenta?.nombre}</div></td>
                      <td>{cat.auxiliares.find((a) => a.id === l.auxiliar_id)?.codigo ?? ''}</td>
                      <td>{cat.centros.find((x) => x.id === l.centro_costo_id)?.codigo ?? ''}</td>
                      <td>{l.descripcion ?? g.concepto}</td>
                      <td>{l.moneda === 'VES' ? 'Bs' : l.moneda === 'USD' ? '$' : l.moneda}{l.moneda !== 'VES' && l.moneda !== 'USD' && <span className="cont-equiv">{money(l.monto_moneda, l.moneda)}</span>}</td>
                      <td className="num"><ImporteDoble moneda={moneda} {...par(moneda, l.debe_ves, l.debe_usd)} conSimbolo vacioSiCero /></td>
                      <td className="num"><ImporteDoble moneda={moneda} {...par(moneda, l.haber_ves, l.haber_usd)} conSimbolo vacioSiCero /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="cont-pie">
            <div><span className="dim">Total Debe</span><strong><ImporteDoble moneda={moneda} {...par(moneda, s('debe_ves'), s('debe_usd'))} conSimbolo /></strong></div>
            <div><span className="dim">Total Haber</span><strong><ImporteDoble moneda={moneda} {...par(moneda, s('haber_ves'), s('haber_usd'))} conSimbolo /></strong></div>
            <div><span className="dim">Tasa del dólar</span><strong className="mono">{g.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} Bs</strong></div>
            <div><span className="dim">Status</span><span className={`cont-etq ${g.estado === 'contabilizado' ? 'mov' : 'descuadrado'}`}>{g.estado === 'contabilizado' ? 'Contabilizado' : 'Descuadrado'}</span></div>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ───────────── Reglas de Contabilización ───────────── */

const TEXTO_CENTRO: Record<ContReglaLinea['centro_fuente'], string> = { ninguno: '—', del_evento: 'El del documento', fijo: 'Fijo' };

export function ReglasContabilizacion() {
  const cat = useCatalogo();
  const [reglas, setReglas] = useState<ReglaCompleta[] | null>(null);
  const [modulo, setModulo] = useState('');
  useEffect(() => {
    listReglasContabilizacion()
      .then((r) => { setReglas(r); setModulo((m) => m || r[0]?.regla.origen_modulo || ''); })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer las reglas.', 'error'));
  }, []);
  if (!reglas || !cat) return <p className="muted">Leyendo las reglas…</p>;

  const modulos = [...new Set(reglas.map((r) => r.regla.origen_modulo))];
  const delModulo = reglas.filter((r) => r.regla.origen_modulo === modulo);
  const pestanas = [...new Set(delModulo.map((r) => r.regla.pestana))];

  return (
    <>
      <div className="view-toggle" role="tablist" aria-label="Módulo de origen" style={{ marginBottom: '.75rem', flexWrap: 'wrap' }}>
        {modulos.map((m) => (
          <button key={m} role="tab" aria-selected={modulo === m} className={modulo === m ? 'active' : ''} onClick={() => setModulo(m)}>{nombreModulo(m)}</button>
        ))}
      </div>
      <p className="cont-nota" style={{ marginBottom: '.75rem' }}>Consulta: las reglas vienen del modelo de datos. Cada pestaña es un proceso del módulo, como en Galac.</p>
      {pestanas.map((p) => (
        <div key={p} className="card cont-regla-pestana">
          <div className="card-title">{p}</div>
          {delModulo.filter((r) => r.regla.pestana === p).map(({ regla, lineas }) => (
            <div key={regla.id} className="cont-regla">
              <div className="cont-regla-cabecera">
                <strong className="mono">{regla.codigo}</strong>
                <span>{regla.nombre}</span>
                <span className="cont-sep" />
                <span className="cont-etq tit">{regla.como_contabilizar === 'inmediata' ? 'Inmediata' : 'Pospuesta'}</span>
                <span className="cont-etq tit">{regla.tipo_contabilizacion === 'por_lote' ? 'Por Lote' : 'Cada Documento'}</span>
                {regla.editar_al_generar && <span className="cont-etq acr">Editar al generar</span>}
                {!regla.activa && <span className="cont-etq descuadrado">Inactiva</span>}
              </div>
              <div className="dim" style={{ fontSize: '.8rem', margin: '.2rem 0 .4rem' }}>
                Evento <span className="mono">{regla.evento}</span>
                {regla.condicion && <> · si {Object.entries(regla.condicion).map(([k, v]) => `${k} = ${v}`).join(' y ')}</>}
                {' · '}Comprobante {cat.tipos.find((t) => t.id === regla.tipo_comprobante_id)?.nombre ?? '—'}
                {' · '}Versión {regla.version}, vigente desde {date(regla.vigente_desde)}{regla.vigente_hasta ? ` hasta ${date(regla.vigente_hasta)}` : ''}
              </div>
              <div className="table-wrap">
                <table className="table cont-tabla-informe">
                  <thead><tr><th>#</th><th>Lado</th><th>Cuenta</th><th>Importe</th><th>C.C.</th><th>Auxiliar</th><th>Descripción</th></tr></thead>
                  <tbody>
                    {lineas.map((l) => (
                      <tr key={l.id}>
                        <td>{l.renglon}</td>
                        <td>{l.lado === 'debe' ? 'Debe' : 'Haber'}</td>
                        <td>{l.cuenta_fuente === 'fija' ? cuentaTexto(cat, l.cuenta_id) : <span>Por mapeo: <span className="mono">{l.mapeo_tipo}</span>{l.mapeo_campo && l.mapeo_campo !== l.mapeo_tipo ? <span className="dim"> (campo {l.mapeo_campo})</span> : null}</span>}</td>
                        <td className="mono">{l.importe}</td>
                        <td>{l.centro_fuente === 'fijo' ? cat.centros.find((c) => c.id === l.centro_costo_id)?.codigo ?? 'Fijo' : TEXTO_CENTRO[l.centro_fuente]}</td>
                        <td>{l.auxiliar_fuente === 'ninguno' ? '—' : l.auxiliar_fuente}</td>
                        <td>{l.descripcion ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* ───────────── Mapeos ───────────── */

export function MapeosVista() {
  const cat = useCatalogo();
  const [mapeos, setMapeos] = useState<ContMapeo[] | null>(null);
  useEffect(() => {
    listMapeos().then(setMapeos).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer los mapeos.', 'error'));
  }, []);
  if (!mapeos || !cat) return <p className="muted">Leyendo los mapeos…</p>;
  const tipos = [...new Set(mapeos.map((m) => m.tipo))];
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrap">
        <table className="table cont-tabla-informe">
          <thead><tr><th>Tipo</th><th>Clave del documento</th><th>Cuenta</th><th>C.C.</th></tr></thead>
          <tbody>
            {tipos.flatMap((t) => mapeos.filter((m) => m.tipo === t).sort((a, b) => a.clave.localeCompare(b.clave)).map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.tipo}</td>
                <td className="mono">{m.clave}</td>
                <td>{cuentaTexto(cat, m.cuenta_id)}</td>
                <td>{cat.centros.find((c) => c.id === m.centro_costo_id)?.codigo ?? '—'}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
