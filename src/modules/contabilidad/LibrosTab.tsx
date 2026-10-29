/* ============================================================
   MGG · Contabilidad · Menús «Balances» e «Informes» (tramo 3)

   Como Galac (§7): un selector del informe, el formulario de parámetros
   («Datos del Informe») y el informe en pantalla con su encabezado
   impreso: compañía, título, rango, «Expresado en Bolívares / Dólares»
   y la fecha de emisión. Cada informe sale en Bs o en $ (usuario, 20/10:
   balances en las dos monedas). Solo entran los comprobantes
   contabilizados; los saldos acreedores van entre paréntesis. Cada
   importe con su equivalente debajo, tenue (ImporteDoble); el PDF y el
   Excel, solo en la moneda elegida.
   · Balances: Balance de Comprobación · Mayor Analítico.
   · Informes: Diario de Comprobantes (Libro Diario) e Informes de
     Movimientos de Cuentas (photo_55): Movimiento de una Cuenta (el Mayor
     Analítico) y Movimientos de Auxiliares, en la misma lista; los dos por
     centro de costos son de la Fase 2 y no se muestran todavía.
   PDF y Excel quedan para después (reportPreview / xlsx, por import()).
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { date, dateTime } from '@/shared/lib/format';
import {
  getBalanceComprobacion, getLibroDiario, getMayorAnalitico, getMovimientosAuxiliares, listAuxiliares, listComprobantes, listCuentas,
  listEjercicios,
} from './contabilidad.repository';
import { TIPOS_AUXILIAR, nombreTipoAuxiliar } from './logica/catalogos';
import type { AuxiliarMayor, BalanceComprobacion, CuentaMayor, LibroDiario, MonedaInforme } from './logica/reportes';
import { ImporteDoble, SelectorMoneda, useMonedaVista } from './ImporteDoble';
import type { ContAuxiliar, ContCuenta, ContEjercicio, ContParametros, TipoAuxiliar } from './tipos';
import { BalanceGeneralVista, EstadoResultadosVista } from './EstadosTab';
import {
  verAuxiliaresExcel, verAuxiliaresPdf, verBalanceExcel, verBalancePdf, verDiarioExcel, verDiarioPdf, verMayorExcel, verMayorPdf,
  type ContextoLibro,
} from './librosExport';


/** Desde el inicio del ejercicio hasta hoy (o su cierre, si ya pasó). */
function rangoEjercicio(ej: ContEjercicio | null): { desde: string; hasta: string } {
  const hoy = new Date().toISOString().slice(0, 10);
  if (!ej) return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
  return { desde: ej.fecha_inicio, hasta: hoy < ej.fecha_fin ? hoy : ej.fecha_fin };
}

function useEjercicio(): ContEjercicio | null | undefined {
  const [ej, setEj] = useState<ContEjercicio | null | undefined>(undefined);
  useEffect(() => {
    listEjercicios()
      .then((l) => setEj(l.find((x) => x.estado === 'abierto') ?? l[0] ?? null))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo leer el ejercicio.', 'error'));
  }, []);
  return ej;
}

/** El encabezado impreso de Galac (F4 pp.30-33). */
export function EncabezadoInforme({ empresa, titulo, rango, moneda }: { empresa: string | null; titulo: string; rango: string; moneda: MonedaInforme }) {
  return (
    <div className="cont-encabezado">
      <div><strong>{empresa ?? '—'}</strong></div>
      <div className="cont-encabezado-titulo">{titulo}</div>
      <div>{rango}</div>
      <div className="dim">Expresado en {moneda === 'VES' ? 'Bolívares' : 'Dólares'} · Emitido el {dateTime(new Date().toISOString())}</div>
    </div>
  );
}

const fechaTexto = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

/** El contexto impreso de un informe: encabezado y nombre del archivo. */
function contexto(parametros: ContParametros, titulo: string, desde: string, hasta: string, moneda: MonedaInforme, archivo: string): ContextoLibro {
  return {
    empresa: parametros.empresa_nombre, titulo, moneda,
    rango: desde && hasta ? `Del ${fechaTexto(desde)} al ${fechaTexto(hasta)}` : '',
    archivo: `${archivo}-${desde}-a-${hasta}-${moneda}`,
  };
}

/** PDF y Excel del informe en pantalla (C37): solo por botón, con vista previa; nada se descarga solo. */
function AccionesInforme({ onPdf, onExcel }: { onPdf: () => Promise<void>; onExcel: () => Promise<void> }) {
  const [trabajando, setTrabajando] = useState(false);
  const correr = (f: () => Promise<void>) => {
    setTrabajando(true);
    f().catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo generar el archivo.', 'error')).finally(() => setTrabajando(false));
  };
  return (
    <div className="cont-informe-acciones">
      <button type="button" className="btn btn-ghost btn-sm" disabled={trabajando} onClick={() => correr(onPdf)}>📄 PDF</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={trabajando} onClick={() => correr(onExcel)}>📊 Excel</button>
    </div>
  );
}

/* ───────────── Balances ───────────── */

type VistaBalances = 'general' | 'resultados' | 'comprobacion' | 'mayor';

export function BalancesTab({ parametros }: { parametros: ContParametros }) {
  const [vista, setVista] = useState<VistaBalances>('comprobacion');
  return (
    <>
      <div className="view-toggle" role="tablist" aria-label="Balances" style={{ marginBottom: '1rem' }}>
        <button role="tab" aria-selected={vista === 'general'} className={vista === 'general' ? 'active' : ''} onClick={() => setVista('general')}>Balance General</button>
        <button role="tab" aria-selected={vista === 'resultados'} className={vista === 'resultados' ? 'active' : ''} onClick={() => setVista('resultados')}>Estado de Resultados</button>
        <button role="tab" aria-selected={vista === 'comprobacion'} className={vista === 'comprobacion' ? 'active' : ''} onClick={() => setVista('comprobacion')}>Balance de Comprobación</button>
        <button role="tab" aria-selected={vista === 'mayor'} className={vista === 'mayor' ? 'active' : ''} onClick={() => setVista('mayor')}>Mayor Analítico</button>
      </div>
      {vista === 'general' && <BalanceGeneralVista parametros={parametros} />}
      {vista === 'resultados' && <EstadoResultadosVista parametros={parametros} />}
      {vista === 'comprobacion' && <BalanceComprobacionVista parametros={parametros} />}
      {vista === 'mayor' && <MayorAnaliticoVista parametros={parametros} />}
    </>
  );
}

function BalanceComprobacionVista({ parametros }: { parametros: ContParametros }) {
  const ej = useEjercicio();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [nivel, setNivel] = useState(Math.min(3, parametros.niveles));
  const [moneda, setMoneda] = useMonedaVista();
  const [sinMovimiento, setSinMovimiento] = useState(false);
  const [conCodigo, setConCodigo] = useState(true);
  const [datos, setDatos] = useState<BalanceComprobacion | null>(null);

  useEffect(() => {
    if (ej === undefined) return;
    const r = rangoEjercicio(ej);
    setDesde(r.desde);
    setHasta(r.hasta);
  }, [ej]);

  useEffect(() => {
    if (!desde || !hasta) return;
    getBalanceComprobacion({ desde, hasta, moneda, nivel, incluirSinMovimiento: sinMovimiento })
      .then(setDatos)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo armar el balance.', 'error'));
  }, [desde, hasta, moneda, nivel, sinMovimiento]);

  return (
    <>
      <div className="card cont-parametros">
        <div className="card-title">Datos del Informe</div>
        <div className="cont-parametros-fila">
          <label className="cont-param"><span className="dim">Fecha de Inicio</span><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="cont-param"><span className="dim">Fecha de Corte</span><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <label className="cont-param"><span className="dim">Nivel de Detalle</span>
            <select className="select" value={nivel} onChange={(e) => setNivel(Number(e.target.value))}>
              {Array.from({ length: parametros.niveles }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <SelectorMoneda valor={moneda} onCambio={setMoneda} />
          <label className="cont-check"><input type="checkbox" checked={conCodigo} onChange={(e) => setConCodigo(e.target.checked)} /> Incluir Código de Cuenta</label>
          <label className="cont-check"><input type="checkbox" checked={sinMovimiento} onChange={(e) => setSinMovimiento(e.target.checked)} /> Cuentas sin Movimiento</label>
        </div>
      </div>

      {!datos ? <p className="muted">Armando el balance…</p> : (
        <div className="card cont-informe">
          <AccionesInforme
            onPdf={() => verBalancePdf(datos, conCodigo, contexto(parametros, 'Balance de Comprobación', desde, hasta, moneda, 'balance-comprobacion'))}
            onExcel={() => verBalanceExcel(datos, conCodigo, contexto(parametros, 'Balance de Comprobación', desde, hasta, moneda, 'balance-comprobacion'))} />
          <EncabezadoInforme empresa={parametros.empresa_nombre} titulo="Balance de Comprobación" rango={`Del ${date(desde)} al ${date(hasta)}`} moneda={moneda} />
          {datos.filas.length === 0 ? <EmptyState icon="📊" message="Sin saldos ni movimientos en el rango." /> : (
            <div className="table-wrap">
              <table className="table cont-tabla-informe">
                <thead>
                  <tr><th>Nombre de la Cuenta</th><th className="num">Saldo Inicial</th><th className="num">Monto Debe</th><th className="num">Monto Haber</th><th className="num">Saldo Actual</th></tr>
                </thead>
                <tbody>
                  {datos.filas.map((f) => (
                    <tr key={f.cuenta.id} className={f.cuenta.es_movimiento ? '' : 'titulo'}>
                      <td style={{ paddingLeft: `${0.6 + (f.nivel - 1) * 1.1}rem` }}>
                        {conCodigo && <span className="mono dim">{f.cuenta.codigo} · </span>}{f.cuenta.nombre}
                      </td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={f.saldoInicial} eq={f.eq?.saldoInicial} saldo /></td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={f.debe} eq={f.eq?.debe} /></td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={f.haber} eq={f.eq?.haber} /></td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={f.saldoActual} eq={f.eq?.saldoActual} saldo /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>TOTALES</td>
                    <td className="num"><ImporteDoble moneda={moneda} valor={datos.totales.saldoInicial} eq={datos.totales.eq?.saldoInicial} saldo /></td>
                    <td className="num"><ImporteDoble moneda={moneda} valor={datos.totales.debe} eq={datos.totales.eq?.debe} /></td>
                    <td className="num"><ImporteDoble moneda={moneda} valor={datos.totales.haber} eq={datos.totales.eq?.haber} /></td>
                    <td className="num"><ImporteDoble moneda={moneda} valor={datos.totales.saldoActual} eq={datos.totales.eq?.saldoActual} saldo /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** `titulo`: en Balances es «Mayor Analítico»; en Informes, «Movimiento de una Cuenta» (el nombre de Galac). */
function MayorAnaliticoVista({ parametros, titulo = 'Mayor Analítico' }: { parametros: ContParametros; titulo?: string }) {
  const ej = useEjercicio();
  const [cuentas, setCuentas] = useState<ContCuenta[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [cuentaDesde, setCuentaDesde] = useState('');
  const [cuentaHasta, setCuentaHasta] = useState('');
  const [modo, setModo] = useState<'detallado' | 'resumido'>('detallado');
  const [moneda, setMoneda] = useMonedaVista();
  const [sinMovimiento, setSinMovimiento] = useState(false);
  const [datos, setDatos] = useState<CuentaMayor[] | null>(null);

  useEffect(() => {
    listCuentas()
      .then((l) => {
        setCuentas(l);
        // Por omisión, la primera cuenta de movimiento: el mayor de todo el plan es muy largo para una pantalla.
        const primera = l.find((c) => c.es_movimiento)?.codigo ?? '';
        setCuentaDesde(primera);
        setCuentaHasta(primera);
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo leer el plan de cuentas.', 'error'));
  }, []);

  useEffect(() => {
    if (ej === undefined) return;
    const r = rangoEjercicio(ej);
    setDesde(r.desde);
    setHasta(r.hasta);
  }, [ej]);

  useEffect(() => {
    if (!desde || !hasta || !cuentaDesde) return;
    getMayorAnalitico({ desde, hasta, moneda, modo, cuentaDesde, cuentaHasta: cuentaHasta || cuentaDesde, incluirSinMovimiento: sinMovimiento })
      .then(setDatos)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo armar el mayor.', 'error'));
  }, [desde, hasta, moneda, modo, cuentaDesde, cuentaHasta, sinMovimiento]);

  const opciones = useMemo(() => cuentas.filter((c) => c.es_movimiento).map((c) => ({ value: c.codigo, label: `${c.codigo} · ${c.nombre}` })), [cuentas]);

  return (
    <>
      <div className="card cont-parametros">
        <div className="card-title">Datos del Informe</div>
        <div className="cont-parametros-fila">
          <label className="cont-param"><span className="dim">Fecha Inicial</span><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="cont-param"><span className="dim">Fecha Final</span><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <label className="cont-param ancho"><span className="dim">Cuenta Desde</span><SearchSelect options={opciones} value={cuentaDesde} onChange={setCuentaDesde} placeholder="Cuenta…" /></label>
          <label className="cont-param ancho"><span className="dim">Cuenta Hasta</span><SearchSelect options={opciones} value={cuentaHasta} onChange={setCuentaHasta} placeholder="Cuenta…" /></label>
          <label className="cont-param"><span className="dim">Modalidad</span>
            <select className="select" value={modo} onChange={(e) => setModo(e.target.value as 'detallado' | 'resumido')}>
              <option value="detallado">Detallado</option>
              <option value="resumido">Resumido</option>
            </select>
          </label>
          <SelectorMoneda valor={moneda} onCambio={setMoneda} />
          <label className="cont-check"><input type="checkbox" checked={sinMovimiento} onChange={(e) => setSinMovimiento(e.target.checked)} /> Cuentas sin Mov. con Saldo Inicial</label>
        </div>
      </div>

      {!datos ? <p className="muted">Armando el mayor…</p> : (
        <div className="card cont-informe">
          <AccionesInforme
            onPdf={() => verMayorPdf(datos, modo, contexto(parametros, `${titulo} ${modo === 'detallado' ? 'Detallado' : 'Resumido'}`, desde, hasta, moneda, 'mayor-analitico'))}
            onExcel={() => verMayorExcel(datos, modo, contexto(parametros, `${titulo} ${modo === 'detallado' ? 'Detallado' : 'Resumido'}`, desde, hasta, moneda, 'mayor-analitico'))} />
          <EncabezadoInforme empresa={parametros.empresa_nombre} titulo={`${titulo} ${modo === 'detallado' ? 'Detallado' : 'Resumido'}`} rango={`Desde ${date(desde)} al ${date(hasta)}`} moneda={moneda} />
          {datos.length === 0 && <EmptyState icon="📒" message="Sin movimientos para esas cuentas en el rango." />}
          {datos.map((m) => (
            <div key={m.cuenta.id} className="cont-mayor-cuenta">
              <div className="cont-mayor-titulo">Cuenta Contable: <span className="mono">{m.cuenta.codigo}</span> - {m.cuenta.nombre}</div>
              <div className="table-wrap">
                <table className="table cont-tabla-informe">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      {modo === 'detallado' ? <><th>N° Comprobante</th><th>Referencia</th><th>Descripción</th><th>Auxiliar</th><th>C.C.</th></> : <th>Concepto</th>}
                      <th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="titulo">
                      <td colSpan={modo === 'detallado' ? 6 : 2}>Saldo Inicial</td><td /><td /><td className="num"><ImporteDoble moneda={moneda} valor={m.saldoInicial} eq={m.eq?.saldoInicial} saldo /></td>
                    </tr>
                    {m.movimientos.map((x, i) => (
                      <tr key={i}>
                        <td>{date(x.fecha)}</td>
                        {modo === 'detallado'
                          ? <><td className="mono">{x.comprobante}</td><td>{x.referencia ?? ''}</td><td>{x.descripcion}</td><td>{x.auxiliar ?? ''}</td><td>{x.centro ?? ''}</td></>
                          : <td>{x.comprobante} · {x.descripcion}</td>}
                        <td className="num"><ImporteDoble moneda={moneda} valor={x.debe} eq={x.eq?.debe} vacioSiCero /></td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={x.haber} eq={x.eq?.haber} vacioSiCero /></td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={x.saldo} eq={x.eq?.saldo} saldo /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={modo === 'detallado' ? 6 : 2}>TOTALES</td><td className="num"><ImporteDoble moneda={moneda} valor={m.debe} eq={m.eq?.debe} /></td><td className="num"><ImporteDoble moneda={moneda} valor={m.haber} eq={m.eq?.haber} /></td><td className="num"><ImporteDoble moneda={moneda} valor={m.saldoFinal} eq={m.eq?.saldoFinal} saldo /></td></tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ───────────── Informes ───────────── */

/** Comprobantes por página del Diario: el trimestre trae cientos por mes. */
const DIARIO_POR_PAGINA = 50;

type VistaInformes = 'diario' | 'movimientos';

export function InformesTab({ parametros }: { parametros: ContParametros }) {
  const [vista, setVista] = useState<VistaInformes>('diario');
  return (
    <>
      <div className="view-toggle" role="tablist" aria-label="Informes" style={{ marginBottom: '1rem' }}>
        <button role="tab" aria-selected={vista === 'diario'} className={vista === 'diario' ? 'active' : ''} onClick={() => setVista('diario')}>Diario de Comprobantes</button>
        <button role="tab" aria-selected={vista === 'movimientos'} className={vista === 'movimientos' ? 'active' : ''} onClick={() => setVista('movimientos')}>Informes de Movimientos de Cuentas</button>
      </div>
      {vista === 'diario' && <DiarioVista parametros={parametros} />}
      {vista === 'movimientos' && <MovimientosCuentasVista parametros={parametros} />}
    </>
  );
}

function DiarioVista({ parametros }: { parametros: ContParametros }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [moneda, setMoneda] = useMonedaVista();
  const [datos, setDatos] = useState<LibroDiario | null>(null);
  const [pagina, setPagina] = useState(0);

  // Por omisión, el último mes con comprobantes: el diario de todo el ejercicio son miles de asientos.
  useEffect(() => {
    listComprobantes()
      .then((l) => {
        const ultima = l.filter((c) => c.estado === 'contabilizado').reduce((m, c) => (c.fecha > m ? c.fecha : m), '');
        const base = ultima || new Date().toISOString().slice(0, 10);
        const fin = new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(5, 7)), 0)).toISOString().slice(0, 10);
        setDesde(`${base.slice(0, 7)}-01`);
        setHasta(fin);
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer los comprobantes.', 'error'));
  }, []);

  useEffect(() => {
    if (!desde || !hasta) return;
    setPagina(0);
    getLibroDiario(desde, hasta, moneda)
      .then(setDatos)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo armar el diario.', 'error'));
  }, [desde, hasta, moneda]);

  const paginas = datos ? Math.max(1, Math.ceil(datos.comprobantes.length / DIARIO_POR_PAGINA)) : 1;
  return (
    <>
      <div className="card cont-parametros">
        <div className="card-title">Datos del Informe</div>
        <div className="cont-parametros-fila">
          <label className="cont-param"><span className="dim">Fecha Inicial</span><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="cont-param"><span className="dim">Fecha Final</span><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <SelectorMoneda valor={moneda} onCambio={setMoneda} />
          <span className="dim" style={{ alignSelf: 'end', fontSize: '.8rem' }}>Estatus: Contabilizados (los descuadrados no entran en el libro)</span>
        </div>
      </div>

      {!datos ? <p className="muted">Armando el diario…</p> : (
        <div className="card cont-informe">
          <AccionesInforme
            onPdf={() => verDiarioPdf(datos, contexto(parametros, 'Diario de Comprobantes', desde, hasta, moneda, 'diario-comprobantes'))}
            onExcel={() => verDiarioExcel(datos, contexto(parametros, 'Diario de Comprobantes', desde, hasta, moneda, 'diario-comprobantes'))} />
          <EncabezadoInforme empresa={parametros.empresa_nombre} titulo="Diario de Comprobantes" rango={`Del ${date(desde)} al ${date(hasta)}`} moneda={moneda} />
          {datos.comprobantes.length === 0 && <EmptyState icon="🧾" message="Sin comprobantes contabilizados en el rango." />}
          {datos.comprobantes.slice(pagina * DIARIO_POR_PAGINA, (pagina + 1) * DIARIO_POR_PAGINA).map((c) => (
            <div key={c.comprobante.id} className="cont-diario-comprobante">
              <div className="cont-mayor-titulo">
                <span className="mono">{c.comprobante.codigo}</span> · {date(c.comprobante.fecha)} · {c.comprobante.concepto}
              </div>
              <div className="table-wrap">
                <table className="table cont-tabla-informe">
                  <thead><tr><th>Código</th><th>Nombre de la Cuenta</th><th>Referencia</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
                  <tbody>
                    {c.asientos.map((a, i) => (
                      <tr key={i}>
                        <td className="mono">{a.codigo}</td><td>{a.nombre}</td><td>{a.referencia ?? ''}</td><td>{a.descripcion}</td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={a.debe} eq={a.eq?.debe} vacioSiCero /></td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={a.haber} eq={a.eq?.haber} vacioSiCero /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>Total del comprobante</td><td className="num"><ImporteDoble moneda={moneda} valor={c.debe} eq={c.eq?.debe} /></td><td className="num"><ImporteDoble moneda={moneda} valor={c.haber} eq={c.eq?.haber} /></td></tr></tfoot>
                </table>
              </div>
            </div>
          ))}
          {datos.comprobantes.length > 0 && (
            <div className="cont-diario-total">
              <span>TOTAL GENERAL · {datos.comprobantes.length} comprobantes</span>
              <span><ImporteDoble moneda={moneda} valor={datos.debe} eq={datos.eq?.debe} /></span><span><ImporteDoble moneda={moneda} valor={datos.haber} eq={datos.eq?.haber} /></span>
            </div>
          )}
          {paginas > 1 && (
            <div className="cont-paginas">
              <button type="button" className="btn btn-ghost btn-sm" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹</button>
              <span>Página {pagina + 1} de {paginas}</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>›</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ───────────── Informes de Movimientos de Cuentas (photo_55) ───────────── */

type InformeMovimientos = 'cuenta' | 'auxiliares';

/**
 * La lista de la ventana de Galac, en su orden. Los dos por centro de costos («Movimientos de una
 * Cuenta por Centro de Costos» y «de Centro de Costo y Cuenta Por Auxiliares») son de la Fase 2: no
 * se muestran hasta que funcionen (lo que no funciona, no se muestra).
 */
const INFORMES_MOVIMIENTOS: Array<{ clave: InformeMovimientos; nombre: string }> = [
  { clave: 'cuenta', nombre: 'Movimiento de una Cuenta' },
  { clave: 'auxiliares', nombre: 'Movimientos de Auxiliares' },
];

function MovimientosCuentasVista({ parametros }: { parametros: ContParametros }) {
  const [informe, setInforme] = useState<InformeMovimientos>('cuenta');
  return (
    <div className="cont-movimientos">
      <div className="card cont-radios" role="radiogroup" aria-label="Informes de Movimientos de Cuentas">
        {INFORMES_MOVIMIENTOS.map((x) => (
          <label key={x.clave} className="cont-check">
            <input type="radio" name="informe-movimientos" checked={x.clave === informe} onChange={() => setInforme(x.clave)} />
            {x.nombre}
          </label>
        ))}
      </div>
      <div>
        {informe === 'cuenta' && <MayorAnaliticoVista parametros={parametros} titulo="Movimiento de una Cuenta" />}
        {informe === 'auxiliares' && <MovimientosAuxiliaresVista parametros={parametros} />}
      </div>
    </div>
  );
}

function MovimientosAuxiliaresVista({ parametros }: { parametros: ContParametros }) {
  const ej = useEjercicio();
  const [auxiliares, setAuxiliares] = useState<ContAuxiliar[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState<TipoAuxiliar | ''>('');
  const [auxDesde, setAuxDesde] = useState('');
  const [auxHasta, setAuxHasta] = useState('');
  const [moneda, setMoneda] = useMonedaVista();
  const [sinMovimiento, setSinMovimiento] = useState(false);
  const [datos, setDatos] = useState<AuxiliarMayor[] | null>(null);

  useEffect(() => {
    listAuxiliares()
      .then(setAuxiliares)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer los auxiliares.', 'error'));
  }, []);

  useEffect(() => {
    if (ej === undefined) return;
    const r = rangoEjercicio(ej);
    setDesde(r.desde);
    setHasta(r.hasta);
  }, [ej]);

  useEffect(() => {
    if (!desde || !hasta) return;
    getMovimientosAuxiliares({ desde, hasta, moneda, tipo, auxiliarDesde: auxDesde, auxiliarHasta: auxHasta || auxDesde, incluirSinMovimiento: sinMovimiento })
      .then(setDatos)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo armar el informe.', 'error'));
  }, [desde, hasta, moneda, tipo, auxDesde, auxHasta, sinMovimiento]);

  // Desde y Hasta son códigos dentro del tipo elegido (sin tipo, de todos).
  const opciones = useMemo(() => auxiliares
    .filter((a) => !tipo || a.tipo === tipo)
    .map((a) => ({ value: a.codigo, label: `${a.codigo} · ${a.nombre}${tipo ? '' : ` (${nombreTipoAuxiliar(a.tipo)})`}` })), [auxiliares, tipo]);

  const ctx = () => contexto(parametros, 'Movimientos de Auxiliares', desde, hasta, moneda, 'movimientos-auxiliares');
  return (
    <>
      <div className="card cont-parametros">
        <div className="card-title">Movimientos de Auxiliares</div>
        <div className="cont-parametros-fila">
          <label className="cont-param"><span className="dim">Fecha Inicial</span><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="cont-param"><span className="dim">Fecha Final</span><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <label className="cont-param"><span className="dim">Tipo de Auxiliar</span>
            <select className="select" value={tipo} onChange={(e) => { setTipo(e.target.value as TipoAuxiliar | ''); setAuxDesde(''); setAuxHasta(''); }}>
              <option value="">Todos</option>
              {TIPOS_AUXILIAR.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="cont-param ancho"><span className="dim">Auxiliar Desde</span><SearchSelect options={opciones} value={auxDesde} onChange={setAuxDesde} placeholder="Todos…" /></label>
          <label className="cont-param ancho"><span className="dim">Auxiliar Hasta</span><SearchSelect options={opciones} value={auxHasta} onChange={setAuxHasta} placeholder="Todos…" /></label>
          <SelectorMoneda valor={moneda} onCambio={setMoneda} />
          <label className="cont-check"><input type="checkbox" checked={sinMovimiento} onChange={(e) => setSinMovimiento(e.target.checked)} /> Auxiliares sin Mov. con Saldo Inicial</label>
        </div>
      </div>

      {!datos ? <p className="muted">Armando el informe…</p> : (
        <div className="card cont-informe">
          <AccionesInforme onPdf={() => verAuxiliaresPdf(datos, ctx())} onExcel={() => verAuxiliaresExcel(datos, ctx())} />
          <EncabezadoInforme empresa={parametros.empresa_nombre} titulo="Movimientos de Auxiliares" rango={`Desde ${date(desde)} al ${date(hasta)}`} moneda={moneda} />
          {datos.length === 0 && <EmptyState icon="👥" message="Sin movimientos de auxiliares en el rango." />}
          {datos.map((a) => (
            <div key={a.auxiliar.id} className="cont-mayor-cuenta">
              <div className="cont-mayor-titulo">
                Auxiliar: {nombreTipoAuxiliar(a.auxiliar.tipo)} <span className="mono">{a.auxiliar.codigo}</span> - {a.auxiliar.nombre}
                {a.auxiliar.rif && <span className="dim"> · {a.auxiliar.rif}</span>}
              </div>
              <div className="table-wrap">
                <table className="table cont-tabla-informe">
                  <thead>
                    <tr><th>Fecha</th><th>N° Comprobante</th><th>Cuenta</th><th>Referencia</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr>
                  </thead>
                  <tbody>
                    <tr className="titulo">
                      <td colSpan={5}>Saldo Inicial</td><td /><td /><td className="num"><ImporteDoble moneda={moneda} valor={a.saldoInicial} eq={a.eq?.saldoInicial} saldo /></td>
                    </tr>
                    {a.movimientos.map((x, i) => (
                      <tr key={i}>
                        <td>{date(x.fecha)}</td>
                        <td className="mono">{x.comprobante}</td>
                        <td><span className="mono">{x.cuenta}</span> <span className="dim">{x.nombreCuenta}</span></td>
                        <td>{x.referencia ?? ''}</td>
                        <td>{x.descripcion}</td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={x.debe} eq={x.eq?.debe} vacioSiCero /></td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={x.haber} eq={x.eq?.haber} vacioSiCero /></td>
                        <td className="num"><ImporteDoble moneda={moneda} valor={x.saldo} eq={x.eq?.saldo} saldo /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>TOTALES</td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={a.debe} eq={a.eq?.debe} /></td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={a.haber} eq={a.eq?.haber} /></td>
                      <td className="num"><ImporteDoble moneda={moneda} valor={a.saldoFinal} eq={a.eq?.saldoFinal} saldo /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
