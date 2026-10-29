/* ============================================================
   MGG · Contabilidad · Balance General y Estado de Resultados (E-06)

   En el menú Balances, como en Galac (F1 p.95). La estructura (secciones,
   grupos, renglones y subtotales) es DATO de BD (`estructura_ef`, como los
   «Balances NIIF» de Galac §7.8): la pantalla solo la recorre.
   Parámetros: fecha de corte o mes, moneda, Nivel de Detalle (solo los
   renglones, o los renglones con sus cuentas) e «Incluir Código de
   Cuenta». El Estado de Resultados trae las variantes de Galac: Mensual,
   Acumulado, Comparativo, Comparativo Acumulado y Mes a Mes.
   Cada importe en una columna, con la equivalente debajo (ImporteDoble).
   PDF y Excel por botón, solo en la moneda elegida.
   ============================================================ */

import { Fragment, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { date, dateTime } from '@/shared/lib/format';
import { getBalanceGeneral, getEstadoResultados, listComprobantes } from './contabilidad.repository';
import { ImporteDoble, SelectorMoneda, useMonedaVista } from './ImporteDoble';
import { cuadraBalance, NOMBRE_VARIANTE, type EstadoFinanciero, type VarianteResultados } from './logica/estados';
import type { MonedaInforme } from './logica/reportes';
import { verEstadoExcel, verEstadoPdf } from './librosExport';
import type { ContParametros } from './tipos';

/** El último mes con comprobantes contabilizados (AAAA-MM): con qué abren los estados. */
function useUltimoMes(): string {
  const [mes, setMes] = useState('');
  useEffect(() => {
    listComprobantes()
      .then((l) => setMes((l.filter((c) => c.estado === 'contabilizado').reduce((m, c) => (c.fecha > m ? c.fecha : m), '') || new Date().toISOString()).slice(0, 7)))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer los comprobantes.', 'error'));
  }, []);
  return mes;
}

const finDeMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Las cifras de una fila, una celda por columna, con su equivalente. */
function Cifras({ valores, eq, moneda }: { valores: number[]; eq?: number[]; moneda: MonedaInforme }) {
  return <>{valores.map((v, i) => <td key={i} className="num"><ImporteDoble moneda={moneda} valor={v} eq={eq?.[i]} saldo /></td>)}</>;
}

/** La tabla de un estado: secciones, grupos y renglones (con sus cuentas si se detallan), totales y subtotales. */
export function TablaEstado({ estado, conCodigo, moneda }: { estado: EstadoFinanciero; conCodigo: boolean; moneda: MonedaInforme }) {
  const ancho = estado.columnas.length + 1;
  return (
    <div className="table-wrap">
      <table className="table cont-tabla-informe">
        <thead><tr><th>Concepto</th>{estado.columnas.map((col) => <th key={col.etiqueta} className="num">{col.etiqueta}</th>)}</tr></thead>
        <tbody>
          {estado.bloques.map((b, i) => (b.tipo === 'subtotal' ? (
            <tr key={i} className="titulo cont-subtotal-estado"><td>{b.etiqueta}</td><Cifras valores={b.valores} eq={b.eq} moneda={moneda} /></tr>
          ) : (
            <Fragment key={i}>
              <tr className="titulo"><td colSpan={ancho} className="cont-seccion-estado">{b.nombre}</td></tr>
              {b.grupos.map((g, j) => (
                <Fragment key={j}>
                  {g.nombre && g.nombre !== b.nombre && <tr className="titulo"><td colSpan={ancho} className="cont-grupo-estado">{g.nombre}</td></tr>}
                  {g.renglones.map((r) => (
                    <Fragment key={r.codigo}>
                      <tr><td style={{ paddingLeft: '1.2rem' }}>{r.nombre}</td><Cifras valores={r.valores} eq={r.eq} moneda={moneda} /></tr>
                      {r.detalle.map((x) => (
                        <tr key={x.cuenta.id} className="cont-detalle-estado">
                          <td style={{ paddingLeft: '2.4rem' }}>{conCodigo && <span className="mono dim">{x.cuenta.codigo} · </span>}{x.cuenta.nombre}</td>
                          <Cifras valores={x.valores} eq={x.eq} moneda={moneda} />
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
              <tr className="titulo cont-total-seccion"><td>{b.total.etiqueta}</td><Cifras valores={b.total.valores} eq={b.total.eq} moneda={moneda} /></tr>
            </Fragment>
          )))}
        </tbody>
        {estado.totales.length > 0 && (
          <tfoot>
            {estado.totales.map((t) => <tr key={t.etiqueta}><td>{t.etiqueta}</td><Cifras valores={t.valores} eq={t.eq} moneda={moneda} /></tr>)}
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Acciones({ estado, conCodigo, ctx }: { estado: EstadoFinanciero; conCodigo: boolean; ctx: Parameters<typeof verEstadoPdf>[2] }) {
  const [trabajando, setTrabajando] = useState(false);
  const correr = (f: () => Promise<void>) => {
    setTrabajando(true);
    f().catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo generar el archivo.', 'error')).finally(() => setTrabajando(false));
  };
  return (
    <div className="cont-informe-acciones">
      <button type="button" className="btn btn-ghost btn-sm" disabled={trabajando} onClick={() => correr(() => verEstadoPdf(estado, conCodigo, ctx))}>📄 PDF</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={trabajando} onClick={() => correr(() => verEstadoExcel(estado, conCodigo, ctx))}>📊 Excel</button>
    </div>
  );
}

function Encabezado({ empresa, titulo, rango, moneda }: { empresa: string | null; titulo: string; rango: string; moneda: MonedaInforme }) {
  return (
    <div className="cont-encabezado">
      <div><strong>{empresa ?? '—'}</strong></div>
      <div className="cont-encabezado-titulo">{titulo}</div>
      <div>{rango}</div>
      <div className="dim">Expresado en {moneda === 'VES' ? 'Bolívares' : 'Dólares'} · Emitido el {dateTime(new Date().toISOString())}</div>
    </div>
  );
}

/** «Nivel de Detalle» de Galac en un estado por renglones: solo los renglones, o también sus cuentas. */
function Detalle({ detallar, setDetallar, conCodigo, setConCodigo }: { detallar: boolean; setDetallar: (v: boolean) => void; conCodigo: boolean; setConCodigo: (v: boolean) => void }) {
  return (
    <>
      <label className="cont-param"><span className="dim">Nivel de Detalle</span>
        <select className="select" value={detallar ? 'cuentas' : 'renglones'} onChange={(e) => setDetallar(e.target.value === 'cuentas')}>
          <option value="renglones">Renglones</option>
          <option value="cuentas">Renglones y cuentas</option>
        </select>
      </label>
      <label className="cont-check"><input type="checkbox" checked={conCodigo} disabled={!detallar} onChange={(e) => setConCodigo(e.target.checked)} /> Incluir Código de Cuenta</label>
    </>
  );
}

/* ───────────── Balance General ───────────── */

export function BalanceGeneralVista({ parametros }: { parametros: ContParametros }) {
  const ultimo = useUltimoMes();
  const [hasta, setHasta] = useState('');
  const [moneda, setMoneda] = useMonedaVista();
  const [detallar, setDetallar] = useState(false);
  const [conCodigo, setConCodigo] = useState(true);
  const [datos, setDatos] = useState<EstadoFinanciero | null>(null);

  useEffect(() => { if (ultimo && !hasta) setHasta(finDeMes(ultimo)); }, [ultimo, hasta]);
  useEffect(() => {
    if (!hasta) return;
    getBalanceGeneral({ hasta, moneda, detallar })
      .then(setDatos)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo armar el balance general.', 'error'));
  }, [hasta, moneda, detallar]);

  const titulo = datos?.titulo ?? 'Balance General';
  const cuadra = datos ? cuadraBalance(datos).every(Boolean) : true;
  return (
    <>
      <div className="card cont-parametros">
        <div className="card-title">Datos del Informe</div>
        <div className="cont-parametros-fila">
          <label className="cont-param"><span className="dim">Fecha de Corte</span><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <SelectorMoneda valor={moneda} onCambio={setMoneda} />
          <Detalle detallar={detallar} setDetallar={setDetallar} conCodigo={conCodigo} setConCodigo={setConCodigo} />
          <span className="dim" style={{ alignSelf: 'end', fontSize: '.8rem' }}>Acumulado desde la apertura del período.</span>
        </div>
      </div>
      {!datos ? <p className="muted">Armando el balance general…</p> : (
        <div className="card cont-informe">
          <Acciones estado={datos} conCodigo={conCodigo} ctx={{ empresa: parametros.empresa_nombre, titulo, rango: datos.columnas[0].etiqueta, moneda, archivo: `balance-general-${hasta}-${moneda}` }} />
          <Encabezado empresa={parametros.empresa_nombre} titulo={titulo} rango={datos.columnas[0].etiqueta} moneda={moneda} />
          {!cuadra && <p className="cont-nota cont-nota-alerta">El balance no cuadra: el Activo es distinto del Pasivo más el Patrimonio. Revisar si alguna cuenta quedó fuera de la estructura.</p>}
          <TablaEstado estado={datos} conCodigo={conCodigo} moneda={moneda} />
        </div>
      )}
    </>
  );
}

/* ───────────── Estado de Resultados ───────────── */

export function EstadoResultadosVista({ parametros }: { parametros: ContParametros }) {
  const ultimo = useUltimoMes();
  const [mes, setMes] = useState('');
  const [variante, setVariante] = useState<VarianteResultados>('acumulado');
  const [moneda, setMoneda] = useMonedaVista();
  const [detallar, setDetallar] = useState(false);
  const [conCodigo, setConCodigo] = useState(true);
  const [incluirCierre, setIncluirCierre] = useState(false);
  const [datos, setDatos] = useState<EstadoFinanciero | null>(null);

  useEffect(() => { if (ultimo && !mes) setMes(ultimo); }, [ultimo, mes]);
  useEffect(() => {
    if (!mes) return;
    getEstadoResultados({ variante, corte: mes, moneda, detallar, incluirCierre })
      .then(setDatos)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo armar el estado de resultados.', 'error'));
  }, [mes, variante, moneda, detallar, incluirCierre]);

  const titulo = `${datos?.titulo ?? 'Estado de Resultados'} · ${NOMBRE_VARIANTE[variante]}`;
  const rango = datos ? (datos.columnas.length === 1 ? `Del ${date(datos.columnas[0].desde)} al ${date(datos.columnas[0].hasta)}` : datos.columnas.map((c) => c.etiqueta).join(' · ')) : '';
  return (
    <>
      <div className="card cont-parametros">
        <div className="card-title">Datos del Informe</div>
        <div className="cont-parametros-fila">
          <label className="cont-param"><span className="dim">Mes de corte</span><input className="input" type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
          <label className="cont-param ancho"><span className="dim">Tipo</span>
            <select className="select" value={variante} onChange={(e) => setVariante(e.target.value as VarianteResultados)}>
              {(Object.keys(NOMBRE_VARIANTE) as VarianteResultados[]).map((k) => <option key={k} value={k}>{NOMBRE_VARIANTE[k]}</option>)}
            </select>
          </label>
          <SelectorMoneda valor={moneda} onCambio={setMoneda} />
          <Detalle detallar={detallar} setDetallar={setDetallar} conCodigo={conCodigo} setConCodigo={setConCodigo} />
          <label className="cont-check"><input type="checkbox" checked={incluirCierre} onChange={(e) => setIncluirCierre(e.target.checked)} /> Incluir Comprobante Cierre de Resultados</label>
        </div>
      </div>
      {!datos ? <p className="muted">Armando el estado de resultados…</p> : (
        <div className="card cont-informe">
          <Acciones estado={datos} conCodigo={conCodigo} ctx={{ empresa: parametros.empresa_nombre, titulo, rango, moneda, archivo: `estado-resultados-${variante}-${mes}-${moneda}` }} />
          <Encabezado empresa={parametros.empresa_nombre} titulo={titulo} rango={rango} moneda={moneda} />
          <TablaEstado estado={datos} conCodigo={conCodigo} moneda={moneda} />
        </div>
      )}
    </>
  );
}
