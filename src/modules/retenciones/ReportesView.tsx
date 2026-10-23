/* ============================================================
   Golden Touch · Retenciones · Reportes
   Estructura visual de la maqueta v8 §sec-reportes, con datos reales del
   libro (listRetenciones): plantillas del sistema y propias, filtros, vista
   previa con totales en Bs, CSV, Excel, PDF y TXT del SENIAT (IVA).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EMPRESA_RIF } from '@/shared/lib/empresa';
import { diaVE } from '@/modules/tesoreria/tasas.repository';
import { getConfigRetencion, listRetenciones, type RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { razonSocialAgente } from '@/modules/libroFiscal/comprobanteRetencionPdf';
import { CONFIG_RETENCION_DEFECTO, type ConfigRetencion } from '@/modules/libroFiscal/retencionesCalculo';
import {
  COLUMNAS_POR_DEFECTO, COLUMNAS_REPORTE, IMPUESTOS_REPORTE, borrarPlantilla, filtrarReporte, formatoMonto,
  guardarPlantilla, leerPlantillas, ordenarReporte, rangoDePeriodo, tablaCruzada, tablaDeCruzada, tablaDetalle,
  totalesReporte, type Agrupar, type EleccionPeriodo, type EstadoFiltro, type FechaBase, type FiltroReporte,
  type OrdenReporte, type PeriodoReporte, type PlantillaPropia, type TablaReporte,
} from './reportesRetenciones';
import { descargarCsv, lineaTotales, reporteExcel, reportePdf, type CabeceraReporte } from './reportesRetencionesArchivos';
import { armarTxtIva, filasTxtIva, type PeriodoCampo2 } from './txtSeniatIva';
import { armarXmlIslr, filasXmlIslr } from './xmlSeniatIslr';

interface PlantillaReporte { id: string; nombre: string; titulo: string }

const PLANTILLAS_SISTEMA: PlantillaReporte[] = [
  { id: 'relacion_iva', nombre: 'Relación quincenal de IVA', titulo: 'Relación quincenal de IVA' },
  { id: 'relacion_islr', nombre: 'Relación mensual de ISLR', titulo: 'Relación mensual de ISLR' },
  { id: 'relacion_isae', nombre: 'Relación mensual de ISAE', titulo: 'Relación mensual de ISAE' },
  { id: 'libro', nombre: 'Libro de retenciones', titulo: 'Libro de retenciones' },
  { id: 'por_proveedor', nombre: 'Retenciones por proveedor', titulo: 'Retenciones por proveedor' },
  { id: 'retenido_periodo', nombre: 'Retenido por proveedor y período', titulo: 'Retenido por proveedor y período' },
  { id: 'anual', nombre: 'Resumen anual', titulo: 'Resumen anual de retenciones' },
];

const SOLO = (k: string) => Object.fromEntries(IMPUESTOS_REPORTE.map((i) => [i.key, i.key === k]));
const TODOS = Object.fromEntries(IMPUESTOS_REPORTE.map((i) => [i.key, true]));
const MAX_VISTA = 500;

const PERIODOS: { value: PeriodoReporte; label: string; grupo: 'Atajos' | 'Elegir' }[] = [
  { value: 'semana_actual', label: 'Esta semana', grupo: 'Atajos' },
  { value: 'semana_anterior', label: 'Semana anterior', grupo: 'Atajos' },
  { value: 'quincena_actual', label: 'Quincena actual', grupo: 'Atajos' },
  { value: 'quincena_anterior', label: 'Quincena anterior', grupo: 'Atajos' },
  { value: 'mes_actual', label: 'Mes actual', grupo: 'Atajos' },
  { value: 'mes_anterior', label: 'Mes anterior', grupo: 'Atajos' },
  { value: 'anio_actual', label: 'Año actual', grupo: 'Atajos' },
  { value: 'anio_anterior', label: 'Año anterior', grupo: 'Atajos' },
  { value: 'semana', label: 'Semana…', grupo: 'Elegir' },
  { value: 'quincena', label: 'Quincena…', grupo: 'Elegir' },
  { value: 'mes', label: 'Mes…', grupo: 'Elegir' },
  { value: 'anio', label: 'Año…', grupo: 'Elegir' },
  { value: 'rango', label: 'Rango de fechas…', grupo: 'Elegir' },
];

const fechaVe = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

export function ReportesView({ actor }: { actor: string }) {
  const hoy = diaVE(new Date().toISOString()) || new Date().toISOString().slice(0, 10);

  const [datos, setDatos] = useState<RetencionPracticada[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigRetencion | null>(null);

  const [plantillaId, setPlantillaId] = useState('relacion_iva');
  const [propiaId, setPropiaId] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoReporte>('quincena_anterior');
  const [eleccion, setEleccion] = useState<EleccionPeriodo>({});
  const [impuestos, setImpuestos] = useState<Record<string, boolean>>(SOLO('iva'));
  const [direccion, setDireccion] = useState<FiltroReporte['direccion']>('practicada');
  const [estado, setEstado] = useState<EstadoFiltro>('');
  const [moneda, setMoneda] = useState<FiltroReporte['moneda']>('');
  const [provQ, setProvQ] = useState('');
  const [agrupar, setAgrupar] = useState<Agrupar>('ninguno');
  const [fBase, setFBase] = useState<FechaBase>('factura');
  const [ordenRep, setOrdenRep] = useState<OrdenReporte>('fecha');
  const [orientacion, setOrientacion] = useState<'horizontal' | 'vertical'>('horizontal');
  const [colsActivas, setColsActivas] = useState<Set<string>>(new Set(COLUMNAS_POR_DEFECTO));

  const [misPlantillas, setMisPlantillas] = useState<PlantillaPropia[]>(() => leerPlantillas(actor));
  const [nombrePlantilla, setNombrePlantilla] = useState('');
  const [generando, setGenerando] = useState<string | null>(null);

  const [verTxt, setVerTxt] = useState(false);
  const [txtMes, setTxtMes] = useState('');
  const [txtCampo2, setTxtCampo2] = useState<PeriodoCampo2>('operaciones');

  const [verXml, setVerXml] = useState(false);
  const [xmlMes, setXmlMes] = useState('');

  const [verArc, setVerArc] = useState(false);
  const [arcAnio, setArcAnio] = useState(() => new Date().getFullYear());
  const [arcProveedorRif, setArcProveedorRif] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [filas, cfg] = await Promise.all([listRetenciones({ incluirAnuladas: true }), getConfigRetencion().catch(() => null)]);
      setDatos(filas); setConfig(cfg); setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e instanceof Error ? e.message : 'No se pudieron leer las retenciones.');
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retenciones'], () => { void cargar(); });
  useEffect(() => { setMisPlantillas(leerPlantillas(actor)); }, [actor]);

  const proveedoresIslr = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const r of datos ?? []) {
      if (r.tipo === 'islr' && r.direccion === 'practicada' && !r.anulada && r.contraparteRif) {
        mapa.set(r.contraparteRif, r.contraparteNombre || r.contraparteRif);
      }
    }
    return [...mapa.entries()].map(([rif, nombre]) => ({ rif, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [datos]);

  async function descargarArcPdf() {
    if (!arcProveedorRif) { toast('Selecciona el proveedor para el comprobante ARC', 'error'); return; }
    try {
      const { verComprobanteArcPdf } = await import('@/modules/libroFiscal/comprobanteArcPdf');
      await verComprobanteArcPdf(arcAnio, arcProveedorRif, datos ?? [], config ?? CONFIG_RETENCION_DEFECTO);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante ARC', 'error');
    }
  }

  const plantilla = PLANTILLAS_SISTEMA.find((p) => p.id === plantillaId) ?? PLANTILLAS_SISTEMA[0];
  const propia = misPlantillas.find((p) => p.id === propiaId) ?? null;
  const titulo = propia?.nombre ?? plantilla.titulo;
  const esCruzada = plantillaId === 'retenido_periodo';

  function seleccionarPlantilla(id: string) {
    setPlantillaId(id); setPropiaId(null);
    if (id === 'relacion_iva') { setPeriodo('quincena_anterior'); setImpuestos(SOLO('iva')); setDireccion('practicada'); setAgrupar('ninguno'); }
    else if (id === 'relacion_islr') { setPeriodo('mes_anterior'); setImpuestos(SOLO('islr')); setDireccion('practicada'); setAgrupar('ninguno'); }
    else if (id === 'relacion_isae') { setPeriodo('mes_anterior'); setImpuestos(SOLO('isae')); setDireccion('practicada'); setAgrupar('ninguno'); }
    else if (id === 'libro') { setPeriodo('mes_actual'); setImpuestos(TODOS); setDireccion(''); setAgrupar('ninguno'); }
    else if (id === 'por_proveedor') { setPeriodo('anio_actual'); setImpuestos(TODOS); setDireccion('practicada'); setAgrupar('proveedor'); setOrdenRep('retenido'); }
    else if (id === 'retenido_periodo') { setPeriodo('anio_actual'); setImpuestos(TODOS); setDireccion('practicada'); setAgrupar('mes'); }
    else if (id === 'anual') { setPeriodo('anio_actual'); setImpuestos(TODOS); setDireccion('practicada'); setAgrupar('mes'); setOrdenRep('fecha'); }
  }

  function aplicarPropia(p: PlantillaPropia) {
    setPlantillaId(p.base); setPropiaId(p.id);
    setPeriodo(p.periodo); setEleccion(p.eleccion ?? {});
    setImpuestos(p.filtro.impuestos); setDireccion(p.filtro.direccion); setEstado(p.filtro.estado);
    setMoneda(p.filtro.moneda); setProvQ(p.filtro.proveedor); setFBase(p.filtro.fechaBase);
    setAgrupar(p.agrupar); setOrdenRep(p.orden); setColsActivas(new Set(p.columnas)); setOrientacion(p.orientacion);
  }

  const filtro: FiltroReporte = useMemo(() => ({
    impuestos, direccion, estado, moneda, proveedor: provQ, fechaBase: fBase,
  }), [impuestos, direccion, estado, moneda, provQ, fBase]);

  const rango = useMemo(() => rangoDePeriodo(periodo, hoy, eleccion), [periodo, hoy, eleccion]);
  const filas = useMemo(
    () => (datos && rango ? ordenarReporte(filtrarReporte(datos, filtro, rango), ordenRep, fBase) : []),
    [datos, rango, filtro, ordenRep, fBase],
  );
  const totales = useMemo(() => totalesReporte(filas), [filas]);
  const columnas = useMemo(() => COLUMNAS_REPORTE.filter((c) => colsActivas.has(c.id)).map((c) => c.id), [colsActivas]);
  const tabla: TablaReporte | null = useMemo(() => {
    if (!filas.length) return null;
    if (esCruzada) return tablaDeCruzada(tablaCruzada(filas));
    return columnas.length ? tablaDetalle(filas, columnas, agrupar, fBase) : null;
  }, [filas, esCruzada, columnas, agrupar, fBase]);

  const textoFiltros = useMemo(() => {
    const imp = IMPUESTOS_REPORTE.filter((i) => impuestos[i.key]).map((i) => i.label).join(', ') || 'ningún impuesto';
    const dir = direccion === 'practicada' ? 'a proveedores' : direccion === 'recibida' ? 'de clientes' : 'todas las direcciones';
    const est = { '': 'sin anuladas', ok: 'registradas', declarada: 'declaradas', anulada: 'anuladas', todas: 'con anuladas' }[estado];
    const partes = [imp, dir, est, moneda ? `en ${moneda === 'Bs' ? 'Bs' : '$'}` : '', provQ.trim() ? `proveedor «${provQ.trim()}»` : '',
      fBase === 'registro' ? 'por fecha de registro' : 'por fecha de la factura'];
    return partes.filter(Boolean).join(' · ');
  }, [impuestos, direccion, estado, moneda, provQ, fBase]);

  const cabecera = (): CabeceraReporte | null => (rango ? {
    titulo, rango, filtros: textoFiltros, totales, registros: filas.length, orientacion,
  } : null);

  async function exportar(tipo: 'csv' | 'excel' | 'pdf') {
    const c = cabecera();
    if (!c || !tabla) { toast(rango ? 'No hay filas que exportar con estos filtros.' : 'Completa el período del reporte.', 'error'); return; }
    setGenerando(tipo);
    try {
      if (tipo === 'csv') descargarCsv(tabla, c);
      else if (tipo === 'excel') await reporteExcel(tabla, c);
      else await reportePdf(tabla, c);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo.', 'error');
    } finally {
      setGenerando(null);
    }
  }

  function guardarComoPlantilla() {
    try {
      const lista = guardarPlantilla(actor, {
        nombre: nombrePlantilla, base: plantillaId, periodo, eleccion,
        filtro, agrupar, orden: ordenRep, columnas, orientacion,
      });
      setMisPlantillas(lista);
      const guardada = lista.find((p) => p.nombre.trim().toLowerCase() === nombrePlantilla.trim().toLowerCase());
      if (guardada) setPropiaId(guardada.id);
      setNombrePlantilla('');
      toast('Plantilla guardada en este navegador.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar la plantilla.', 'error');
    }
  }

  function quitarPlantilla(p: PlantillaPropia) {
    if (!window.confirm(`¿Quitar la plantilla «${p.nombre}»?`)) return;
    setMisPlantillas(borrarPlantilla(actor, p.id));
    if (propiaId === p.id) setPropiaId(null);
  }

  /* ── TXT del SENIAT (IVA) ── */
  const mesTxt = txtMes || (rango ? rango.desde.slice(0, 7) : hoy.slice(0, 7));
  const txt = useMemo(() => {
    if (!datos) return null;
    return armarTxtIva({
      rifAgente: config?.rif || EMPRESA_RIF,
      razonSocial: config ? razonSocialAgente(config) : '',
      periodo: mesTxt.replace('-', ''),
      campo2: txtCampo2,
      filas: datos,
    });
  }, [datos, config, mesTxt, txtCampo2]);
  const txtFilas = useMemo(() => (datos ? filasTxtIva(datos, mesTxt.replace('-', '')).length : 0), [datos, mesTxt]);

  function descargarTxt() {
    if (!txt || txt.faltan.length) return;
    const blob = new Blob([txt.contenido], { type: 'text/plain;charset=us-ascii' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = txt.nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── XML del SENIAT (ISLR) ── */
  const mesXml = xmlMes || (rango ? rango.desde.slice(0, 7) : hoy.slice(0, 7));
  const xml = useMemo(() => {
    if (!datos) return null;
    return armarXmlIslr({
      rifAgente: config?.rif || EMPRESA_RIF,
      razonSocial: config ? razonSocialAgente(config) : '',
      periodo: mesXml.replace('-', ''),
      filas: datos,
    });
  }, [datos, config, mesXml]);
  const xmlFilas = useMemo(() => (datos ? filasXmlIslr(datos, mesXml.replace('-', '')).length : 0), [datos, mesXml]);

  function descargarXml() {
    if (!xml || xml.faltan.length) return;
    const blob = new Blob([xml.contenido], { type: 'application/xml;charset=iso-8859-1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = xml.nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const toggleCol = (id: string) => setColsActivas((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleImp = (key: string) => setImpuestos((prev) => ({ ...prev, [key]: !prev[key] }));
  const setElec = (patch: Partial<EleccionPeriodo>) => setEleccion((e) => ({ ...e, ...patch }));

  const cargando = datos == null && !errorCarga;
  const visibles = tabla ? tabla.filas.slice(0, MAX_VISTA) : [];

  return (
    <div className="lfv8-rep-layout">
      {/* ── Sidebar: plantillas ── */}
      <aside className="lfv8-rep-plantillas" aria-label="Plantillas de reporte">
        <h4>Plantillas del sistema</h4>
        {PLANTILLAS_SISTEMA.map((p) => (
          <button key={p.id} className="lfv8-rep-pl" aria-current={!propiaId && plantillaId === p.id ? 'true' : undefined} onClick={() => seleccionarPlantilla(p.id)}>
            {p.nombre}
          </button>
        ))}

        <h4>Mis plantillas</h4>
        {misPlantillas.length === 0 ? (
          <p className="muted" style={{ fontSize: '.78rem', padding: '.3rem .6rem' }}>
            Sin plantillas propias. Usar «Guardar como plantilla».
          </p>
        ) : misPlantillas.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.2rem' }}>
            <button className="lfv8-rep-pl" aria-current={propiaId === p.id ? 'true' : undefined} onClick={() => aplicarPropia(p)}>
              {p.nombre}
              <small>{PLANTILLAS_SISTEMA.find((s) => s.id === p.base)?.nombre ?? ''}</small>
            </button>
            <button type="button" className="btn btn-sm btn-ghost" title={`Quitar «${p.nombre}»`} aria-label={`Quitar la plantilla ${p.nombre}`} onClick={() => quitarPlantilla(p)}>✕</button>
          </div>
        ))}
        <p className="muted" style={{ fontSize: '.72rem', padding: '.2rem .6rem' }}>Se guardan solo en este navegador: no se ven desde otra computadora ni las ven otros usuarios.</p>
      </aside>

      {/* ── Constructor del reporte ── */}
      <section className="lfv8-rep-constructor">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{titulo}</h2>
          <span className="muted" style={{ fontSize: '.78rem' }}>{propia ? 'Plantilla propia' : 'Plantilla del sistema'}</span>
        </div>

        {/* Filtros */}
        <div className="lfv8-rep-filtros">
          <div className="lfv8-campo">
            <span>Período del reporte</span>
            <select className="lfv8-select" value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoReporte)}>
              {(['Atajos', 'Elegir'] as const).map((g) => (
                <optgroup key={g} label={g}>
                  {PERIODOS.filter((p) => p.grupo === g).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </optgroup>
              ))}
            </select>
            {(periodo === 'semana' || periodo === 'quincena') && (
              <input className="input" type="date" aria-label="Un día del período" value={eleccion.dia ?? ''} onChange={(e) => setElec({ dia: e.target.value })} />
            )}
            {periodo === 'mes' && <input className="input" type="month" aria-label="Mes" value={eleccion.mes ?? ''} onChange={(e) => setElec({ mes: e.target.value })} />}
            {periodo === 'anio' && <input className="input mono" inputMode="numeric" placeholder="AAAA" aria-label="Año" value={eleccion.anio ?? ''} onChange={(e) => setElec({ anio: e.target.value.replace(/\D/g, '').slice(0, 4) })} />}
            {periodo === 'rango' && (
              <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                <input className="input" type="date" aria-label="Desde" value={eleccion.desde ?? ''} onChange={(e) => setElec({ desde: e.target.value })} />
                <input className="input" type="date" aria-label="Hasta" value={eleccion.hasta ?? ''} onChange={(e) => setElec({ hasta: e.target.value })} />
              </div>
            )}
            <small className="muted" style={{ fontSize: '.76rem' }}>
              {rango ? `Del ${fechaVe(rango.desde)} al ${fechaVe(rango.hasta)}` : 'Completa el período.'}
            </small>
          </div>

          <div className="lfv8-campo">
            <span>Impuestos</span>
            <div className="lfv8-chips">
              {IMPUESTOS_REPORTE.map((i) => (
                <button key={i.key} type="button" className="lfv8-chip" aria-pressed={!!impuestos[i.key]} onClick={() => toggleImp(i.key)}>{i.label}</button>
              ))}
            </div>
          </div>

          <div className="lfv8-campo">
            <span>Dirección</span>
            <select className="lfv8-select" value={direccion} onChange={(e) => setDireccion(e.target.value as FiltroReporte['direccion'])}>
              <option value="">Todas</option>
              <option value="practicada">A proveedores</option>
              <option value="recibida">De clientes</option>
            </select>
          </div>

          <div className="lfv8-campo">
            <span>Estado</span>
            <select className="lfv8-select" value={estado} onChange={(e) => setEstado(e.target.value as EstadoFiltro)}>
              <option value="">Todos (sin anuladas)</option>
              <option value="ok">Registradas</option>
              <option value="declarada">Declaradas</option>
              <option value="anulada">Anuladas</option>
              <option value="todas">Todas (con anuladas)</option>
            </select>
          </div>

          <div className="lfv8-campo">
            <span>Moneda</span>
            <select className="lfv8-select" value={moneda} onChange={(e) => setMoneda(e.target.value as FiltroReporte['moneda'])}>
              <option value="">Todas</option>
              <option value="Bs">Bs</option>
              <option value="USD">$</option>
            </select>
          </div>

          <div className="lfv8-campo">
            <span>Proveedores</span>
            <input className="lfv8-select" style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }} placeholder="Proveedor o RIF" value={provQ} onChange={(e) => setProvQ(e.target.value)} />
            {!provQ && <small className="muted" style={{ fontSize: '.76rem' }}>Todos los proveedores</small>}
          </div>

          {!esCruzada && (
            <div className="lfv8-campo">
              <span>Agrupar por</span>
              <select className="lfv8-select" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
                <option value="ninguno">Sin agrupar (detalle)</option>
                <option value="proveedor">Proveedor</option>
                <option value="periodo">Período fiscal</option>
                <option value="tipo">Impuesto</option>
                <option value="semana">Semana</option>
                <option value="quincena">Quincena</option>
                <option value="mes">Mes</option>
                <option value="anio">Año</option>
              </select>
            </div>
          )}

          <div className="lfv8-campo">
            <span>Fecha de referencia</span>
            <select className="lfv8-select" value={fBase} onChange={(e) => setFBase(e.target.value as FechaBase)}>
              <option value="factura">Fecha de la factura</option>
              <option value="registro">Fecha de registro</option>
            </select>
          </div>

          {!esCruzada && (
            <div className="lfv8-campo">
              <span>Ordenar por</span>
              <select className="lfv8-select" value={ordenRep} onChange={(e) => setOrdenRep(e.target.value as OrdenReporte)}>
                <option value="fecha">Fecha</option>
                <option value="proveedor">Proveedor</option>
                <option value="retenido">Monto retenido (mayor primero)</option>
              </select>
            </div>
          )}
        </div>

        {/* Columnas del detalle */}
        {!esCruzada && (
          <details>
            <summary className="muted" style={{ cursor: 'pointer', fontSize: '.82rem' }}>Columnas del detalle</summary>
            <div className="lfv8-rep-columnas">
              {COLUMNAS_REPORTE.map((c) => (
                <label key={c.id}><input type="checkbox" checked={colsActivas.has(c.id)} onChange={() => toggleCol(c.id)} /> {c.label}</label>
              ))}
            </div>
          </details>
        )}

        {/* Acciones */}
        <div className="lfv8-rep-acciones">
          <input className="input" style={{ maxWidth: 220 }} placeholder="Nombre de la plantilla" aria-label="Nombre de la plantilla"
            value={nombrePlantilla} onChange={(e) => setNombrePlantilla(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && nombrePlantilla.trim()) guardarComoPlantilla(); }} />
          <button className="btn" onClick={guardarComoPlantilla} disabled={!nombrePlantilla.trim()}>Guardar como plantilla</button>
          <button className="btn" onClick={() => void exportar('csv')} disabled={!tabla || !!generando}>Descargar CSV</button>
          <button className="btn" onClick={() => void exportar('excel')} disabled={!tabla || !!generando}>{generando === 'excel' ? 'Generando…' : 'Descargar Excel'}</button>
          <button className="btn" onClick={() => void exportar('pdf')} disabled={!tabla || !!generando}>{generando === 'pdf' ? 'Generando…' : 'Imprimir / PDF'}</button>
          <button className="btn" aria-expanded={verTxt} onClick={() => { setVerTxt((v) => !v); setVerXml(false); setVerArc(false); }}>TXT para el SENIAT (IVA)</button>
          <button className="btn" aria-expanded={verXml} onClick={() => { setVerXml((v) => !v); setVerTxt(false); setVerArc(false); }}>XML para el SENIAT (ISLR)</button>
          <button className="btn" aria-expanded={verArc} onClick={() => { setVerArc((v) => !v); setVerTxt(false); setVerXml(false); }}
            title="Comprobante de Retención de ISLR Anual por Proveedor (Forma ARC - Art. 24 Decreto 1.808)">Comprobante ARC (ISLR)</button>
        </div>

        {verTxt && (
          <div className="card" style={{ margin: '.4rem 0', borderColor: 'var(--warning)' }}>
            <strong style={{ fontSize: '.9rem' }}>TXT de retenciones de IVA para el SENIAT</strong>
            <p className="muted" style={{ fontSize: '.8rem', margin: '.3rem 0' }}>
              Formato del instructivo de 2020: coteje la primera declaración con el contador antes de presentarla.
            </p>
            <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="lfv8-campo">
                <span>Período de las operaciones</span>
                <input className="input" type="month" value={mesTxt} onChange={(e) => setTxtMes(e.target.value)} />
              </div>
              <div className="lfv8-campo">
                <span>Período que va en el archivo</span>
                <select className="lfv8-select" value={txtCampo2} onChange={(e) => setTxtCampo2(e.target.value as PeriodoCampo2)}>
                  <option value="operaciones">El de las operaciones</option>
                  <option value="siguiente">El mes siguiente, como el otro sistema</option>
                </select>
              </div>
              <button className="btn btn-primary" onClick={descargarTxt} disabled={!txt || txt.faltan.length > 0}>Descargar TXT</button>
            </div>
            {txt && (
              <small className="hint muted" style={{ display: 'block', marginTop: '.4rem' }}>
                {txtFilas
                  ? `${txtFilas} retención(es) de IVA practicadas del período, sin anuladas · ${txt.nombre}`
                  : `Sin retenciones de IVA practicadas en el período: va la línea de «sin operaciones» · ${txt.nombre}`}
              </small>
            )}
            {txt && txt.faltan.length > 0 && (
              <div style={{ marginTop: '.4rem', color: 'var(--danger)', fontSize: '.8rem' }}>
                <strong>Antes de descargar, falta:</strong>
                <ul style={{ margin: '.2rem 0 0 1rem', padding: 0 }}>
                  {txt.faltan.slice(0, 20).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                {txt.faltan.length > 20 && <span>…y {txt.faltan.length - 20} más.</span>}
              </div>
            )}
          </div>
        )}

        {verXml && (
          <div className="card" style={{ margin: '.4rem 0', borderColor: 'var(--primary)' }}>
            <strong style={{ fontSize: '.9rem' }}>XML de retenciones de ISLR para el SENIAT</strong>
            <p className="muted" style={{ fontSize: '.8rem', margin: '.3rem 0' }}>
              Formato oficial según Decreto 1.808 para la declaración mensual de retenciones en el portal del SENIAT.
            </p>
            <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="lfv8-campo">
                <span>Período de las operaciones</span>
                <input className="input" type="month" value={mesXml} onChange={(e) => setXmlMes(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={descargarXml} disabled={!xml || xml.faltan.length > 0}>Descargar XML</button>
            </div>
            {xml && (
              <small className="hint muted" style={{ display: 'block', marginTop: '.4rem' }}>
                {xmlFilas
                  ? `${xmlFilas} retención(es) de ISLR practicadas del período, sin anuladas · ${xml.nombre}`
                  : `Sin retenciones de ISLR practicadas en el período: archivo vacío de declaración · ${xml.nombre}`}
              </small>
            )}
            {xml && xml.faltan.length > 0 && (
              <div style={{ marginTop: '.4rem', color: 'var(--danger)', fontSize: '.8rem' }}>
                <strong>Antes de descargar, falta:</strong>
                <ul style={{ margin: '.2rem 0 0 1rem', padding: 0 }}>
                  {xml.faltan.slice(0, 20).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                {xml.faltan.length > 20 && <span>…y {xml.faltan.length - 20} más.</span>}
              </div>
            )}
          </div>
        )}

        {verArc && (
          <div className="card" style={{ margin: '.4rem 0', borderColor: 'var(--accent, #6366f1)' }}>
            <strong style={{ fontSize: '.9rem' }}>Comprobante de Retención Anual ARC (ISLR)</strong>
            <p className="muted" style={{ fontSize: '.8rem', margin: '.3rem 0' }}>
              Relación anual acumulada de enero a diciembre por proveedor según el Artículo 24 del Decreto N° 1.808 con verificación digital.
            </p>
            <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="lfv8-campo">
                <span>Ejercicio Fiscal (Año)</span>
                <input className="input" type="number" min={2020} max={2035} value={arcAnio}
                  onChange={(e) => setArcAnio(Number(e.target.value) || new Date().getFullYear())} />
              </div>
              <div className="lfv8-campo" style={{ minWidth: 260 }}>
                <span>Proveedor (Sujeto Retenido)</span>
                <select className="lfv8-select" value={arcProveedorRif} onChange={(e) => setArcProveedorRif(e.target.value)}>
                  <option value="">-- Seleccionar proveedor con ISLR --</option>
                  {proveedoresIslr.map((p) => (
                    <option key={p.rif} value={p.rif}>{p.nombre ? `${p.nombre} (${p.rif})` : p.rif}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={descargarArcPdf} disabled={!arcProveedorRif}>
                Ver / Descargar ARC (PDF)
              </button>
            </div>
          </div>
        )}

        {/* Orientación */}
        <fieldset className="lfv8-rep-orient">
          <legend>Orientación</legend>
          <label><input type="radio" name="rep-orient" checked={orientacion === 'horizontal'} onChange={() => setOrientacion('horizontal')} /> Horizontal</label>
          <label><input type="radio" name="rep-orient" checked={orientacion === 'vertical'} onChange={() => setOrientacion('vertical')} /> Vertical</label>
        </fieldset>

        {/* Totales y vista previa */}
        <p className="lfv8-rep-progreso">
          {errorCarga ? `No se pudieron leer las retenciones: ${errorCarga}`
            : cargando ? 'Leyendo las retenciones…'
              : !rango ? 'Completa el período del reporte.'
                : filas.length ? `${filas.length} registro(s) · ${textoFiltros}`
                  : 'Sin retenciones con estos filtros en el período.'}
          {errorCarga && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>}
        </p>

        {filas.length > 0 && (
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline', margin: '.2rem 0 .5rem' }}>
            <div>
              <div className="muted" style={{ fontSize: '.72rem' }}>Retenido (Bs)</div>
              <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700 }}>Bs {formatoMonto(totales.retenidoBs)}</div>
            </div>
            {totales.porMoneda.map((m) => (
              <div key={m.moneda}>
                <div className="muted" style={{ fontSize: '.72rem' }}>En {m.moneda === 'Bs' ? 'Bs' : '$'} · {m.registros} reg.</div>
                <div className="mono" style={{ fontSize: '.9rem' }}>{m.moneda === 'Bs' ? 'Bs' : '$'} {formatoMonto(m.retenido)}</div>
              </div>
            ))}
            {totales.sinTasa > 0 && (
              <small style={{ color: 'var(--warning)' }}>{totales.sinTasa} en $ sin tasa: no suman en Bs.</small>
            )}
          </div>
        )}

        <div className="lfv8-rep-vista">
          {tabla ? (
            <>
              <table className="table" style={{ fontSize: '.78rem', width: '100%' }}>
                <thead>
                  <tr>{tabla.encabezados.map((h, i) => <th key={i} style={{ textAlign: tabla.numeros.includes(i) ? 'right' : 'left' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {visibles.map((f, ri) => {
                    const esTotal = tabla.totales.includes(ri);
                    return (
                      <tr key={ri} className={esTotal ? 'lfv8-rep-fila-total' : undefined}>
                        {f.map((v, ci) => (
                          <td key={ci} className={tabla.numeros.includes(ci) ? 'mono' : undefined} style={{ textAlign: tabla.numeros.includes(ci) ? 'right' : 'left' }}>
                            {v == null ? '' : typeof v === 'number' && tabla.numeros.includes(ci) ? formatoMonto(v) : String(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {tabla.filas.length > MAX_VISTA && (
                <p className="muted" style={{ fontSize: '.76rem', marginTop: '.4rem' }}>
                  Vista previa: las primeras {MAX_VISTA} de {tabla.filas.length} filas. Los archivos llevan todas.
                </p>
              )}
              <p className="muted" style={{ fontSize: '.74rem', marginTop: '.4rem' }}>{lineaTotales(totales)}</p>
            </>
          ) : (
            <p style={{ textAlign: 'center', padding: '2rem 0', color: '#777' }}>
              {!esCruzada && !columnas.length ? 'Elige al menos una columna del detalle.' : 'Sin filas para mostrar con estos filtros.'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
