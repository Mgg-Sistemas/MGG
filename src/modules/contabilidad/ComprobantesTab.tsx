/* ============================================================
   MGG · Contabilidad · Pestaña «Comprobantes» (al estilo Galac)

   Galac §3: buscador → lista → acción. Acciones: Consultar, Insertar,
   Insertar Copia (para los recurrentes), Modificar y Reversar. No hay
   Eliminar (usuario, 20/10 12:15: «solo reversar»).

   El status no lo elige el usuario: lo decide el cuadre en vivo
   (Contabilizado / Descuadrado). Un descuadrado se graba si Parámetros
   lo permite y no entra en los saldos.

   Rejilla «ASIENTOS» con las columnas de Galac: Código Cuenta · Fecha
   Ref. · Referencia · Auxiliar · C.C. · Descripción · Debe · Haber, más
   la moneda del renglón. Cada importe en UNA columna: la cifra en la
   moneda elegida (selector Bs / $) y debajo, tenue, la equivalente
   (usuario, 20/10 14:00; ver ImporteDoble).
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { date, dateTime, dosDecimales, hoyISO, money } from '@/shared/lib/format';
import { parseDecimal } from '@/shared/ui/DecimalInput';
import { ImporteDoble, RecuadroMoneda, SelectorMoneda, par, useMonedaVista } from './ImporteDoble';
import {
  getComprobante, getTasa, grabarComprobante, listAuxiliares, listCentrosCosto, listComprobantes, listCuentas,
  listPeriodos, listTiposComprobante, renglonDeLinea, reversarComprobante, type ComprobanteCompleto,
} from './contabilidad.repository';
import {
  GENERADO_POR, descripcionReverso, mensajeMesCerrado, montosDeRenglon, statusDe, totalesDe, type CabeceraBorrador, type Lado, type RenglonBorrador,
} from './logica/comprobantes';
import { normalizarTexto } from './logica/planCuentas';
import type { MonedaInforme } from './logica/reportes';
import type {
  ContAuxiliar, ContCentroCosto, ContComprobante, ContCuenta, ContParametros, ContPeriodo, ContTipoComprobante,
  EstadoComprobante, EventoComprobante, Moneda,
} from './tipos';

/** Galac pagina las rejillas («Página 1 de N»). */
const POR_PAGINA = 100;

const fmtBs = (n: number) => money(n, 'Bs');
const fmtUsd = (n: number) => money(n, 'USD');

export interface Catalogos {
  cuentas: ContCuenta[];
  centros: ContCentroCosto[];
  auxiliares: ContAuxiliar[];
  tipos: ContTipoComprobante[];
  periodos: ContPeriodo[];
}

type Ventana =
  | { kind: 'ninguna' }
  | { kind: 'consultar'; id: string }
  | { kind: 'editar'; modo: 'insertar' | 'modificar' | 'copia'; base: ComprobanteCompleto | null }
  | { kind: 'reversar'; comp: ContComprobante };

/** La página la monta con `key` = versión de los datos: al reiniciar la simulación arranca de cero. */
export function ComprobantesTab({ parametros }: { parametros: ContParametros }) {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const [lista, setLista] = useState<ContComprobante[] | null>(null);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [ventana, setVentana] = useState<Ventana>({ kind: 'ninguna' });
  const [texto, setTexto] = useState('');
  const [status, setStatus] = useState<'' | EstadoComprobante>('');
  const [tipo, setTipo] = useState('');
  const [mes, setMes] = useState('');
  const [pagina, setPagina] = useState(0);
  const [moneda, setMoneda] = useMonedaVista();
  // Al cambiar un filtro se vuelve a la primera página.
  useEffect(() => { setPagina(0); }, [texto, status, tipo, mes]);

  const cargar = useCallback(async () => {
    try {
      const [comprobantes, cuentas, centros, auxiliares, tipos, periodos] = await Promise.all([
        listComprobantes(), listCuentas(), listCentrosCosto(), listAuxiliares(), listTiposComprobante(), listPeriodos(),
      ]);
      setLista(comprobantes);
      setCat({ cuentas, centros, auxiliares, tipos, periodos });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron leer los comprobantes.', 'error');
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const reversados = useMemo(() => new Map((lista ?? []).filter((c) => c.reverso_de_id).map((c) => [c.reverso_de_id as string, c])), [lista]);

  const filtrados = useMemo(() => {
    const q = normalizarTexto(texto.trim());
    return (lista ?? []).filter((c) =>
      (!status || c.estado === status) && (!tipo || c.tipo_id === tipo) && (!mes || c.periodo_id === mes) &&
      (!q || [c.codigo, c.concepto, c.origen_ref ?? ''].some((v) => normalizarTexto(v).includes(q))));
  }, [lista, texto, status, tipo, mes]);

  async function abrirEditar(modo: 'modificar' | 'copia', id: string) {
    try {
      setVentana({ kind: 'editar', modo, base: await getComprobante(id) });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante.', 'error');
    }
  }

  if (!lista || !cat) return <p className="muted">Cargando comprobantes…</p>;
  const nombreTipo = (id: string) => cat.tipos.find((t) => t.id === id)?.nombre ?? '—';
  const descuadrados = lista.filter((c) => c.estado === 'descuadrado').length;
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));

  return (
    <>
      <div className="cont-barra">
        <input className="input" type="search" placeholder="Buscar por número, descripción o N° doc. origen…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as '' | EstadoComprobante)} aria-label="Status">
          <option value="">Status: todos</option>
          <option value="contabilizado">Contabilizado</option>
          <option value="descuadrado">Descuadrado</option>
        </select>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de comprobante">
          <option value="">Tipo: todos</option>
          {cat.tipos.map((t) => <option key={t.id} value={t.id}>{t.codigo} · {t.nombre}</option>)}
        </select>
        <select className="select" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes">
          <option value="">Mes: todos</option>
          {cat.periodos.filter((p) => p.numero !== 13).map((p) => <option key={p.id} value={p.id}>{p.codigo.slice(4)}/{p.codigo.slice(0, 4)}</option>)}
        </select>
        <SelectorMoneda valor={moneda} onCambio={setMoneda} />
        <span className="cont-sep" />
        {descuadrados > 0 && <span className="cont-etq acr" title="No afectan saldos ni informes">{descuadrados} descuadrado(s)</span>}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setVentana({ kind: 'editar', modo: 'insertar', base: null })}>+ Insertar</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Número</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Status</th><th>Generado Por</th>
                <th style={{ textAlign: 'right' }}>Debe</th><th />
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && <tr><td colSpan={8}><EmptyState icon="🔎" message="No se encontraron datos con esas características." /></td></tr>}
              {filtrados.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA).map((c) => {
                const rev = reversados.get(c.id);
                return (
                  <tr key={c.id} className="cont-fila-cbte" onClick={() => setVentana({ kind: 'consultar', id: c.id })}>
                    <td className="mono">{c.codigo}</td>
                    <td>{date(c.fecha)}</td>
                    <td className="muted">{nombreTipo(c.tipo_id)}</td>
                    <td>
                      {c.concepto}
                      {c.origen_ref && <span className="dim"> · {c.origen_ref}</span>}
                      {rev && <div className="cont-nota">Reversado por {rev.codigo}</div>}
                    </td>
                    <td><StatusEtiqueta estado={c.estado} /></td>
                    <td className="muted">{GENERADO_POR[c.origen]}</td>
                    <td style={{ textAlign: 'right' }}><ImporteDoble moneda={moneda} {...par(moneda, c.total_debe_ves, c.total_debe_usd)} conSimbolo /></td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-ghost btn-sm" title="Insertar copia" onClick={() => void abrirEditar('copia', c.id)}>⧉</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="cont-paginas">
            <button type="button" className="btn btn-ghost btn-sm" disabled={pagina === 0} onClick={() => setPagina(0)}>«</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹</button>
            <span>Página {pagina + 1} de {paginas} · {filtrados.length} comprobantes</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>›</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pagina >= paginas - 1} onClick={() => setPagina(paginas - 1)}>»</button>
          </div>
        )}
      </div>

      {ventana.kind === 'consultar' && (
        <ConsultarComprobante id={ventana.id} cat={cat}
          onCerrar={() => setVentana({ kind: 'ninguna' })}
          onModificar={(id) => void abrirEditar('modificar', id)}
          onCopia={(id) => void abrirEditar('copia', id)}
          onReversar={(comp) => setVentana({ kind: 'reversar', comp })} />
      )}
      {ventana.kind === 'editar' && (
        <EditarComprobante modo={ventana.modo} base={ventana.base} cat={cat} parametros={parametros}
          onCerrar={() => setVentana({ kind: 'ninguna' })}
          onGrabar={async (input) => {
            const c = await grabarComprobante(input, actor);
            toast(c.estado === 'contabilizado'
              ? `Comprobante ${c.codigo} grabado: Contabilizado.`
              : `Comprobante ${c.codigo} grabado DESCUADRADO: no afecta saldos hasta que cuadre.`, c.estado === 'contabilizado' ? 'success' : 'warning');
            setVentana({ kind: 'consultar', id: c.id });
            await cargar();
          }} />
      )}
      {ventana.kind === 'reversar' && (
        <ReversarDialogo comp={ventana.comp}
          onCerrar={() => setVentana({ kind: 'consultar', id: ventana.comp.id })}
          onReversar={async (motivo) => {
            const rev = await reversarComprobante(ventana.comp.id, motivo, actor);
            toast(`Comprobante ${ventana.comp.codigo} reversado por el ${rev.codigo}.`, 'success');
            setVentana({ kind: 'consultar', id: rev.id });
            await cargar();
          }} />
      )}
    </>
  );
}

export function StatusEtiqueta({ estado }: { estado: EstadoComprobante }) {
  return <span className={`cont-etq ${estado === 'contabilizado' ? 'mov' : 'descuadrado'}`}>{estado === 'contabilizado' ? 'Contabilizado' : 'Descuadrado'}</span>;
}

/* ───────────── Consultar ───────────── */

function ConsultarComprobante({ id, cat, onCerrar, onModificar, onCopia, onReversar }: {
  id: string;
  cat: Catalogos;
  onCerrar: () => void;
  onModificar: (id: string) => void;
  onCopia: (id: string) => void;
  onReversar: (c: ContComprobante) => void;
}) {
  const [datos, setDatos] = useState<ComprobanteCompleto | null>(null);
  const [original, setOriginal] = useState<ContComprobante | null>(null);
  const [moneda] = useMonedaVista();
  // onCerrar llega nueva en cada render del padre: por referencia, para no volver a leer sin motivo.
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;

  useEffect(() => {
    getComprobante(id)
      .then(async (d) => {
        setDatos(d);
        setOriginal(d.comprobante.reverso_de_id ? (await getComprobante(d.comprobante.reverso_de_id)).comprobante : null);
      })
      .catch((e: unknown) => { toast(e instanceof Error ? e.message : 'No se pudo leer el comprobante.', 'error'); cerrar.current(); });
  }, [id]);

  if (!datos) return null;
  const c = datos.comprobante;
  const t = totalesDe(datos.lineas);
  const esReverso = c.origen === 'reverso';
  const mes = cat.periodos.find((p) => p.id === c.periodo_id);
  // Con el mes cerrado no se modifica ni se reversa: el botón queda deshabilitado y se explica por qué.
  const mesCerrado = mes && mes.estado !== 'abierto' ? mensajeMesCerrado(mes.codigo) : null;
  const puedeModificar = !esReverso && !datos.reversadoPor;
  const puedeReversar = c.estado === 'contabilizado' && !esReverso && !datos.reversadoPor;
  return (
    <Modal title={`Comprobante ${c.codigo}`} size="xl" onClose={onCerrar}
      footer={<>
        {puedeReversar && <button type="button" className="btn btn-danger" disabled={!!mesCerrado} title={mesCerrado ?? undefined} onClick={() => onReversar(c)}>↶ Reversar</button>}
        <button type="button" className="btn btn-ghost" onClick={() => onCopia(c.id)}>⧉ Insertar copia</button>
        {puedeModificar && <button type="button" className="btn btn-ghost" disabled={!!mesCerrado} title={mesCerrado ?? undefined} onClick={() => onModificar(c.id)}>✎ Modificar</button>}
        <button type="button" className="btn btn-primary" onClick={onCerrar}>Salir</button>
      </>}>
      <CabeceraVista comp={c} cat={cat} />
      {mesCerrado && <p className="cont-nota">{mesCerrado}</p>}
      {c.modificado && <p className="cont-nota">Modificado después de grabado: ver el historial.</p>}
      {datos.reversadoPor && <p className="cont-nota">Reversado por el comprobante {datos.reversadoPor.codigo}: no se modifica ni se vuelve a reversar.</p>}
      {original && <p className="cont-nota">Reversa al comprobante {original.codigo} ({original.concepto}).</p>}
      {c.estado === 'descuadrado' && <p className="cont-nota cont-nota-alerta">Descuadrado: sus montos no aparecen en ningún saldo ni informe hasta que cuadre.</p>}
      <div className="table-wrap" style={{ marginTop: '.75rem' }}>
        <table className="table cont-asientos">
          <thead>
            <tr><th>Código Cuenta</th><th>Fecha Ref.</th><th>Referencia</th><th>Auxiliar</th><th>C.C.</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th></tr>
          </thead>
          <tbody>
            {datos.lineas.map((l) => {
              const cuenta = cat.cuentas.find((x) => x.id === l.cuenta_id);
              // Un renglón en otra divisa (USDT) dice además su monto original.
              const enMoneda = l.moneda !== 'VES' && l.moneda !== 'USD' ? <span className="cont-equiv">{money(l.monto_moneda, l.moneda)}</span> : null;
              return (
                <tr key={l.id}>
                  <td><span className="mono">{cuenta?.codigo}</span><div className="dim">{cuenta?.nombre}</div></td>
                  <td>{l.fecha_referencia ? date(l.fecha_referencia) : ''}</td>
                  <td>{l.referencia ?? ''}</td>
                  <td>{cat.auxiliares.find((a) => a.id === l.auxiliar_id)?.codigo ?? ''}</td>
                  <td>{cat.centros.find((x) => x.id === l.centro_costo_id)?.codigo ?? ''}</td>
                  <td>{l.descripcion ?? c.concepto}</td>
                  <td className="num"><ImporteDoble moneda={moneda} {...par(moneda, l.debe_ves, l.debe_usd)} conSimbolo vacioSiCero />{l.debe_ves || l.debe_usd ? enMoneda : null}</td>
                  <td className="num"><ImporteDoble moneda={moneda} {...par(moneda, l.haber_ves, l.haber_usd)} conSimbolo vacioSiCero />{l.haber_ves || l.haber_usd ? enMoneda : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PieTotales t={t} estado={c.estado} moneda={moneda} />
      <p className="dim" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
        Operador: {c.created_by ?? '—'} · {dateTime(c.created_at)}
        {c.updated_at && <> · Última Modificación: {c.updated_by ?? '—'} · {dateTime(c.updated_at)}</>}
        {c.numero_lote && <> · Lote {c.numero_lote}</>}
      </p>
      <HistorialComprobante historial={c.historial} />
    </Modal>
  );
}

const TEXTO_EVENTO: Record<EventoComprobante['evento'], string> = { grabado: 'Grabado', modificado: 'Modificado', reversado: 'Reversado' };

/** El historial del comprobante: solo se agrega, nunca se reescribe (usuario, 20/10 13:04). */
export function HistorialComprobante({ historial }: { historial: EventoComprobante[] }) {
  if (!historial.length) return null;
  const detalle = (ev: EventoComprobante): string => {
    if (ev.evento === 'reversado') return `por el ${String(ev.reverso ?? '—')}`;
    if (ev.evento === 'grabado') return ev.origen ? `generado por ${GENERADO_POR[ev.origen as ContComprobante['origen']] ?? String(ev.origen)}` : '';
    const a = ev.antes as Record<string, unknown> | undefined;
    const d = ev.despues as Record<string, unknown> | undefined;
    if (!a || !d) return '';
    const cambios: string[] = [];
    if (a.fecha !== d.fecha) cambios.push(`fecha ${date(String(a.fecha))} → ${date(String(d.fecha))}`);
    if (a.concepto !== d.concepto) cambios.push(`descripción «${String(a.concepto)}» → «${String(d.concepto)}»`);
    if (a.estado !== d.estado) cambios.push(`status ${String(a.estado)} → ${String(d.estado)}`);
    if (a.total_debe_ves !== d.total_debe_ves) cambios.push(`debe ${fmtBs(Number(a.total_debe_ves))} → ${fmtBs(Number(d.total_debe_ves))}`);
    if (a.asientos !== d.asientos) cambios.push(`asientos ${String(a.asientos)} → ${String(d.asientos)}`);
    return cambios.join(' · ') || 'sin cambios de cabecera ni de totales';
  };
  return (
    <div className="cont-historial">
      <div className="dim">Historial</div>
      <ul>
        {historial.map((ev, i) => (
          <li key={i}><span className="mono">{dateTime(ev.at)}</span> · <strong>{TEXTO_EVENTO[ev.evento] ?? ev.evento}</strong> · {ev.actor}{detalle(ev) && <> · {detalle(ev)}</>}</li>
        ))}
      </ul>
    </div>
  );
}

export function CabeceraVista({ comp, cat }: { comp: ContComprobante; cat: Catalogos }) {
  const tipo = cat.tipos.find((t) => t.id === comp.tipo_id);
  return (
    <div className="cont-cabecera">
      <div><span className="dim">Fecha</span><strong>{date(comp.fecha)}</strong></div>
      <div><span className="dim">Número</span><strong className="mono">{comp.codigo}</strong></div>
      <div><span className="dim">Tipo</span><strong>{tipo ? `${tipo.codigo} · ${tipo.nombre}` : '—'}</strong></div>
      <div className="ancho"><span className="dim">Descripción</span><strong>{comp.concepto}</strong></div>
      <div><span className="dim">Status</span><StatusEtiqueta estado={comp.estado} /></div>
      <div><span className="dim">Generado Por</span><strong>{GENERADO_POR[comp.origen]}</strong></div>
      <div><span className="dim">N° Doc. Origen</span><strong>{comp.origen_ref ?? '—'}</strong></div>
      <div><span className="dim">Tasa del dólar</span><strong className="mono">{comp.tasa?.toLocaleString('es-VE', { minimumFractionDigits: 2 }) ?? '—'} Bs</strong></div>
      <RecuadroMoneda />
    </div>
  );
}

/** Sub Totales y Diferencia: una cifra por casilla en la moneda elegida, la equivalente debajo. */
export function PieTotales({ t, estado, moneda }: { t: ReturnType<typeof totalesDe>; estado: EstadoComprobante; moneda: MonedaInforme }) {
  return (
    <div className="cont-pie">
      <div><span className="dim">Sub Total Debe</span><strong><ImporteDoble moneda={moneda} {...par(moneda, t.debe_ves, t.debe_usd)} conSimbolo /></strong></div>
      <div><span className="dim">Sub Total Haber</span><strong><ImporteDoble moneda={moneda} {...par(moneda, t.haber_ves, t.haber_usd)} conSimbolo /></strong></div>
      <div className={t.dif_ves || t.dif_usd ? 'cont-dif' : ''}><span className="dim">Diferencia</span><strong><ImporteDoble moneda={moneda} {...par(moneda, t.dif_ves, t.dif_usd)} conSimbolo /></strong></div>
      <div><span className="dim">Status</span><StatusEtiqueta estado={estado} /></div>
    </div>
  );
}

/* ───────────── Insertar / Modificar / Insertar Copia ───────────── */

/**
 * Bajo lo que se escribe (en la moneda del renglón), la equivalente: la moneda
 * elegida si el renglón va en otra; si va en la elegida, la otra.
 */
function Equivalente({ monedaRenglon, principal, ves, usd }: { monedaRenglon: Moneda; principal: MonedaInforme; ves: number; usd: number }) {
  const muestra = monedaRenglon === principal ? (principal === 'VES' ? 'USD' : 'VES') : principal;
  return <span className="cont-equiv mono">{muestra === 'VES' ? fmtBs(ves) : fmtUsd(usd)}</span>;
}

interface Fila extends RenglonBorrador {
  clave: number;
  /** Lo que el usuario escribió en Debe y Haber (texto, como los demás montos del sistema). */
  debeTxt: string;
  haberTxt: string;
}

let siguienteClave = 1;
const filaVacia = (moneda: Moneda = 'USD'): Fila => ({
  clave: siguienteClave++, cuenta_id: '', fecha_referencia: null, referencia: '', auxiliar_id: null, centro_costo_id: null,
  descripcion: '', moneda, monto_moneda: 0, lado: 'debe', tasa: 0, debeTxt: '', haberTxt: '',
});

function filaDe(r: RenglonBorrador): Fila {
  const txt = String(r.monto_moneda).replace('.', ',');
  return { ...r, clave: siguienteClave++, debeTxt: r.lado === 'debe' ? txt : '', haberTxt: r.lado === 'haber' ? txt : '' };
}

export function EditarComprobante({ modo, base, cat, parametros, onCerrar, onGrabar }: {
  modo: 'insertar' | 'modificar' | 'copia';
  base: ComprobanteCompleto | null;
  cat: Catalogos;
  parametros: ContParametros;
  onCerrar: () => void;
  onGrabar: (input: { id?: string; cabecera: CabeceraBorrador; renglones: RenglonBorrador[] }) => Promise<void>;
}) {
  const b = base?.comprobante;
  const [moneda] = useMonedaVista();
  const [tipoId, setTipoId] = useState(b?.tipo_id ?? parametros.tipo_comprobante_defecto_id ?? cat.tipos.find((t) => t.activo)?.id ?? '');
  const [fecha, setFecha] = useState(modo === 'modificar' && b ? b.fecha : hoyISO());
  const [concepto, setConcepto] = useState(b?.concepto ?? '');
  const [origenRef, setOrigenRef] = useState(modo === 'modificar' ? b?.origen_ref ?? '' : '');
  // Modificar arranca con la tasa guardada; si no, el primer render (antes de leer la tabla de
  // cambio) mostraría los Bs en 0 y el status como Descuadrado.
  const [tasaTxt, setTasaTxt] = useState(modo === 'modificar' && b?.tasa ? String(b.tasa).replace('.', ',') : '');
  const [tasaUsdt, setTasaUsdt] = useState(0);
  const [filas, setFilas] = useState<Fila[]>(() => (base?.lineas.length ? base.lineas.map((l) => filaDe(renglonDeLinea(l))) : [filaVacia(), filaVacia()]));
  const [activa, setActiva] = useState(0);
  const [grabando, setGrabando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);

  // La tasa sale de la tabla de cambio para la fecha; el usuario la puede corregir.
  useEffect(() => {
    let vigente = true;
    void Promise.all([getTasa('USD', fecha), getTasa('USDT', fecha)]).then(([usd, usdt]) => {
      if (!vigente) return;
      if (!(modo === 'modificar' && b && b.fecha === fecha && b.tasa)) setTasaTxt(usd ? String(usd).replace('.', ',') : '');
      else setTasaTxt(String(b.tasa).replace('.', ','));
      setTasaUsdt(usdt ?? 0);
    });
    return () => { vigente = false; };
  }, [fecha, modo, b]);

  const tasaUsd = parseDecimal(tasaTxt) ?? 0;
  const tasaDe = useCallback((m: Moneda) => (m === 'VES' ? 1 : m === 'USD' ? tasaUsd : m === 'USDT' ? tasaUsdt : 0), [tasaUsd, tasaUsdt]);

  const renglones: RenglonBorrador[] = filas.map((f) => {
    const debe = parseDecimal(f.debeTxt) ?? 0;
    const haber = parseDecimal(f.haberTxt) ?? 0;
    const lado: Lado = debe > 0 ? 'debe' : 'haber';
    return {
      cuenta_id: f.cuenta_id, fecha_referencia: f.fecha_referencia, referencia: f.referencia, auxiliar_id: f.auxiliar_id,
      centro_costo_id: f.centro_costo_id, descripcion: f.descripcion, moneda: f.moneda,
      monto_moneda: debe > 0 ? debe : haber, lado, tasa: tasaDe(f.moneda),
    };
  });
  // Las filas totalmente vacías no cuentan (Galac ignora la última línea en blanco).
  const usados = renglones.filter((r, i) => r.cuenta_id || filas[i].debeTxt || filas[i].haberTxt);
  const montos = usados.map((r) => montosDeRenglon(r, tasaUsd));
  const t = totalesDe(montos);
  const estado = statusDe(t, parametros.tolerancia_cuadre);

  const opcionesCuenta: SearchOption[] = useMemo(() => cat.cuentas.filter((c) => c.es_movimiento && c.activa)
    .map((c) => ({ value: c.id, label: `${c.codigo} · ${c.nombre}`, hint: c.moneda ?? undefined })), [cat.cuentas]);

  const cambiar = (i: number, x: Partial<Fila>) => setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...x } : f)));

  function elegirCuenta(i: number, id: string) {
    const cuenta = cat.cuentas.find((c) => c.id === id);
    const f = filas[i];
    cambiar(i, {
      cuenta_id: id,
      // La cuenta en divisa fija la moneda del renglón; el auxiliar se limpia si ya no corresponde.
      moneda: cuenta?.moneda ?? f.moneda,
      auxiliar_id: cuenta?.exige_auxiliar && cat.auxiliares.find((a) => a.id === f.auxiliar_id)?.tipo === cuenta.tipo_auxiliar ? f.auxiliar_id : null,
    });
  }

  function agregarFila() {
    const ultima = filas[filas.length - 1];
    setFilas((prev) => [...prev, { ...filaVacia(ultima?.moneda), referencia: ultima?.referencia ?? '', fecha_referencia: ultima?.fecha_referencia ?? null }]);
    setActiva(filas.length);
  }

  async function grabar() {
    setGrabando(true);
    setErrores([]);
    try {
      await onGrabar({
        id: modo === 'modificar' ? b?.id : undefined,
        cabecera: { tipo_id: tipoId, fecha, concepto, moneda_documento: 'USD', tasa: tasaUsd, origen_ref: origenRef },
        renglones: usados,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo grabar el comprobante.';
      setErrores(msg.split(/(?<=\.) (?=[A-ZÁÉÍÓÚ])/));
      setGrabando(false);
    }
  }

  const titulo = modo === 'insertar' ? 'Comprobante - Insertar' : modo === 'copia' ? `Comprobante - Insertar Copia de ${b?.codigo}` : `Comprobante - Modificar ${b?.codigo}`;
  const filaActiva = filas[activa];
  const cuentaActiva = cat.cuentas.find((c) => c.id === filaActiva?.cuenta_id);
  return (
    <Modal title={titulo} size="xl" onClose={() => !grabando && onCerrar()}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={grabando}>Salir</button>
        <button type="button" className="btn btn-primary" onClick={() => void grabar()} disabled={grabando}>{grabando ? 'Grabando…' : 'Grabar'}</button>
      </>}>
      <div className="cont-cabecera editable">
        <label><span className="dim">Fecha</span><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label><span className="dim">Número</span><input className="input mono" value={modo === 'modificar' ? b?.codigo ?? '' : 'Se asigna al grabar'} disabled /></label>
        <label><span className="dim">Tipo</span>
          <select className="select" value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
            {cat.tipos.filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select>
        </label>
        <label className="ancho"><span className="dim">Descripción</span><input className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} autoFocus /></label>
        <label><span className="dim">N° Doc. Origen</span><input className="input" value={origenRef} onChange={(e) => setOrigenRef(e.target.value)} /></label>
        <label><span className="dim">Tasa del dólar (Bs)</span><input className="input mono" type="text" inputMode="decimal" value={tasaTxt} onChange={(e) => setTasaTxt(dosDecimales(e.target.value))} /></label>
        <div><span className="dim">Status</span><StatusEtiqueta estado={estado} /></div>
        <RecuadroMoneda />
      </div>

      <div className="table-wrap" style={{ marginTop: '.75rem' }}>
        <table className="table cont-asientos editable">
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>Código Cuenta</th><th>Fecha Ref.</th><th>Referencia</th><th style={{ minWidth: 170 }}>Auxiliar</th>
              <th>C.C.</th><th style={{ minWidth: 160 }}>Descripción</th><th>Moneda</th><th className="num">Debe</th><th className="num">Haber</th><th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const cuenta = cat.cuentas.find((c) => c.id === f.cuenta_id);
              const auxiliares = cuenta?.exige_auxiliar ? cat.auxiliares.filter((a) => a.activo && a.tipo === cuenta.tipo_auxiliar) : [];
              const m = montos[usados.indexOf(renglones[i])];
              return (
                <tr key={f.clave} className={i === activa ? 'activa' : ''} onFocus={() => setActiva(i)} onClick={() => setActiva(i)}>
                  <td><SearchSelect options={opcionesCuenta} value={f.cuenta_id} onChange={(v) => elegirCuenta(i, v)} placeholder="Cuenta…" /></td>
                  <td><input className="input" type="date" value={f.fecha_referencia ?? ''} onChange={(e) => cambiar(i, { fecha_referencia: e.target.value || null })} /></td>
                  <td><input className="input" value={f.referencia} onChange={(e) => cambiar(i, { referencia: e.target.value })} style={{ width: 110 }} /></td>
                  <td>
                    {cuenta?.exige_auxiliar ? (
                      <SearchSelect options={auxiliares.map((a) => ({ value: a.id, label: `${a.codigo} · ${a.nombre}` }))}
                        value={f.auxiliar_id ?? ''} onChange={(v) => cambiar(i, { auxiliar_id: v || null })} placeholder="Auxiliar…" />
                    ) : <span className="dim">—</span>}
                  </td>
                  <td>
                    <select className="select" value={f.centro_costo_id ?? ''} onChange={(e) => cambiar(i, { centro_costo_id: e.target.value || null })}
                      aria-label="Centro de costo" style={cuenta?.exige_centro_costo && !f.centro_costo_id ? { borderColor: 'var(--danger, #ef4f5e)' } : undefined}>
                      <option value="">{cuenta?.exige_centro_costo ? 'Exige C.C.' : '—'}</option>
                      {cat.centros.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
                    </select>
                  </td>
                  <td><input className="input" value={f.descripcion} placeholder={concepto} onChange={(e) => cambiar(i, { descripcion: e.target.value })} /></td>
                  <td>
                    <select className="select" value={f.moneda} disabled={!!cuenta?.moneda} onChange={(e) => cambiar(i, { moneda: e.target.value as Moneda })} aria-label="Moneda">
                      <option value="VES">Bs</option><option value="USD">$</option><option value="USDT">USDT</option>
                    </select>
                  </td>
                  <td className="num">
                    <input className="input mono num" type="text" inputMode="decimal" value={f.debeTxt}
                      onChange={(e) => cambiar(i, { debeTxt: dosDecimales(e.target.value), haberTxt: e.target.value ? '' : f.haberTxt })} />
                    {m && m.debe_ves > 0 && <Equivalente monedaRenglon={f.moneda} principal={moneda} ves={m.debe_ves} usd={m.debe_usd} />}
                  </td>
                  <td className="num">
                    <input className="input mono num" type="text" inputMode="decimal" value={f.haberTxt}
                      onChange={(e) => cambiar(i, { haberTxt: dosDecimales(e.target.value), debeTxt: e.target.value ? '' : f.debeTxt })} />
                    {m && m.haber_ves > 0 && <Equivalente monedaRenglon={f.moneda} principal={moneda} ves={m.haber_ves} usd={m.haber_usd} />}
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" title="Quitar el asiento" disabled={filas.length <= 1}
                      onClick={(e) => { e.stopPropagation(); setFilas((prev) => prev.filter((_, j) => j !== i)); setActiva(0); }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '.5rem' }} onClick={agregarFila}>+ Asiento</button>

      <div className="cont-linea-activa">
        <div><span className="dim">Nombre de la Cuenta</span>{cuentaActiva ? `${cuentaActiva.codigo} · ${cuentaActiva.nombre}` : '—'}</div>
        <div><span className="dim">Centro de Costos</span>{cat.centros.find((c) => c.id === filaActiva?.centro_costo_id)?.nombre ?? '—'}</div>
        <div><span className="dim">Nombre del Auxiliar</span>{cat.auxiliares.find((a) => a.id === filaActiva?.auxiliar_id)?.nombre ?? '—'}</div>
      </div>

      <PieTotales t={t} estado={estado} moneda={moneda} />
      {estado === 'descuadrado' && (
        <p className="cont-nota cont-nota-alerta">
          {parametros.permite_descuadrados
            ? 'Si se graba así, queda Descuadrado: no afecta saldos ni informes hasta que cuadre.'
            : 'Parámetros no permite grabar comprobantes descuadrados.'}
        </p>
      )}
      {errores.length > 0 && <ul className="cont-errores">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
    </Modal>
  );
}

/* ───────────── Reversar ───────────── */

export function ReversarDialogo({ comp, onCerrar, onReversar }: {
  comp: ContComprobante;
  onCerrar: () => void;
  onReversar: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    if (!motivo.trim()) { toast('Motivo del reverso requerido.', 'warning'); return; }
    setEnviando(true);
    try {
      await onReversar(motivo);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo reversar el comprobante.', 'error');
      setEnviando(false);
    }
  }
  return (
    <Modal title={`Reversar el comprobante ${comp.codigo}`} size="sm" onClose={() => !enviando && onCerrar()}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>Salir</button>
        <button type="button" className="btn btn-danger" onClick={() => void confirmar()} disabled={enviando || !motivo.trim()}>{enviando ? 'Reversando…' : 'Reversar'}</button>
      </>}>
      <p style={{ marginTop: 0 }}>
        Se crea otro comprobante con las mismas cuentas y los montos invertidos (Debe ↔ Haber), en la misma fecha. El
        original no se borra ni se modifica: queda marcado como reversado.
      </p>
      <label className="cont-form" style={{ display: 'block' }}>
        <span className="dim">Motivo (obligatorio)</span>
        <textarea className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      </label>
      {motivo.trim() && <p className="dim" style={{ fontSize: '.8rem' }}>Descripción del reverso: {descripcionReverso(comp.codigo, motivo)}</p>}
    </Modal>
  );
}
