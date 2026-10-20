/* ============================================================
   MGG · Retenciones v8 · El perfil fiscal del proveedor (diálogo)

   El dlg-perfil de la maqueta (v8, l. 1469), con sus dos pestañas (v8-14,
   punto 4): «Perfil fiscal» (tipo de contribuyente, tipo de persona y
   residencia con su categoría, sus actividades con la principal y su «hasta»,
   la licencia con tipo, emisión, vigencia, aviso e historial) y «Retenciones»
   (el análisis del proveedor con su gráfica y su tendencia).
   El perfil vive en la base de Retenciones: paquete 05 de la v2.2 y, en espera,
   v8p-03 (licencias y sus tipos), v8p-04 (actividades) y v8p-05 (vista y
   avisos). Hasta que existan, el diálogo no aparece en producción; en local se
   edita sin guardar y «Guardar perfil» va desactivado con la marca 2.1.
   ============================================================ */

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import type { RetencionPracticada } from '../datos/puerta';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { GraficaProveedor } from '../pantalla/reportes/GraficaProveedor';
import { serieProveedor } from '../pantalla/reportes/analisis';
import type { Grano } from '../pantalla/reportes/cruzada';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import {
  ATAJOS_PERFIL, NOTA_INACTIVO, NOTA_LECTURA, NOTA_PERFIL, NOTA_PROPUESTA, SIN_ACTIVIDAD_MUNICIPIO, SIN_CATEGORIA, TIPOS_CONTRIBUYENTE,
  borradorDe, huellaPerfil, partesDePersona, personaDe, rangoPerfil, sugerenciaRif, textoCategoria, textoLicenciaHistorial, validarPerfil,
  type AtajoPerfil, type BorradorPerfil, type CambioLicencia, type PerfilProveedor, type Residencia, type TipoContribuyente, type TipoPersona,
} from './perfilProveedor';
import '../pantalla/reportes/rv8-analisis.css';
import {
  UMBRAL_LICENCIAS, anadirActividad, cerrarActividad, elegirPrincipal, estadoLicencia, principalDe, validarLicencia, venceDesdeEmision,
  type ActividadProveedor, type TipoLicencia,
} from './actividadesLicencia';
import type { CambiosPerfil } from '../datos/perfilProveedor';
import { fechaVe } from '../impresion/numeros';
import './rv8-perfil.css';

export type { TipoLicencia };

export interface ProveedorPerfil {
  id: string;
  razonSocial: string;
  rif: string;
  direccion: string | null;
  /** Inactivo: el perfil se conserva y no propone. */
  activo?: boolean;
}

export interface PropsPerfil {
  proveedor: ProveedorPerfil;
  /** La fila de retencion_perfil_proveedor_v; null mientras no exista la base (o el proveedor no tenga perfil). */
  perfil?: PerfilProveedor | null;
  /** Los cambios del número de licencia (retencion_licencia_historial), el más reciente primero. */
  historialLicencia?: CambioLicencia[];
  /** Sus actividades (retencion_proveedor_actividades, v8p-04). */
  actividades?: ActividadProveedor[];
  /** Las actividades que se pueden añadir (el catálogo del ISAE). Sin él, se escribe el código. */
  catalogoActividades?: { codigo: string; texto: string }[];
  /** El catálogo «Tipos de licencia» (retencion_licencia_tipos, v8p-03). */
  tiposLicencia?: TipoLicencia[];
  /** Tipo, emisión y vigencia de su licencia (retencion_proveedor_licencias, v8p-03). */
  licencia?: { tipoId: string | null; emision: string | null; vence: string | null } | null;
  /** Días de aviso antes del vencimiento (retenciones.avisos.umbrales.licencias). */
  umbralLicencias?: number;
  /** «Ver en Vencimientos». */
  onVerVencimientos?: () => void;
  /** Admin o escritura en Retenciones (la política «retencion_perfil update permiso»). */
  puedeEditar?: boolean;
  /** Para la pestaña «Retenciones»: las retenciones del libro. */
  libro?: readonly RetencionPracticada[];
  pestanaInicial?: 'perfil' | 'retenciones';
  /** «Corregir en Proveedores»: abre la ficha del proveedor en su módulo. */
  onCorregirProveedor?: () => void;
  /** «Abrir en Reportes (Retenido por proveedor y período)». */
  onAbrirReportes?: (rango: [string, string]) => void;
  onCerrar: () => void;
  /** La base ya tiene el perfil (capacidades.perfilProveedor): el diálogo se muestra también en producción. */
  disponible?: boolean;
  /** Guarda por la puerta. Sin él, «Guardar perfil» va desactivado con la marca 2.1. */
  onGuardar?: (c: CambiosPerfil) => Promise<void>;
}

export function PerfilProveedorDialogo(props: PropsPerfil) {
  if (!import.meta.env.DEV && !props.disponible) return null;
  return <Dialogo {...props} />;
}

function Dialogo({
  proveedor, perfil = null, historialLicencia = [], actividades = [], catalogoActividades = [], tiposLicencia = [], licencia = null,
  umbralLicencias = UMBRAL_LICENCIAS, onVerVencimientos, puedeEditar = false, libro = [], pestanaInicial = 'perfil', onCorregirProveedor, onAbrirReportes, onCerrar,
  onGuardar,
}: PropsPerfil) {
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const hoyIso = new Date().toLocaleDateString('en-CA');
  const [acts, setActsBase] = useState<ActividadProveedor[]>(actividades);
  const [nuevaAct, setNuevaAct] = useState('');
  const [errorAct, setErrorAct] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState<number | null>(null);
  const [hastaNueva, setHastaNueva] = useState('');
  const setActs = (xs: ActividadProveedor[]) => { setActsBase(xs); setErrorAct(null); };
  const anadir = () => {
    const r = anadirActividad(acts, nuevaAct, hoyIso);
    if (!r.ok) { setErrorAct(r.error); return; }
    setActs(r.actividades); setNuevaAct('');
  };
  const catalogo = new Map(catalogoActividades.map((c) => [c.codigo, c.texto]));
  const textoActividad = (c: string) => (c === SIN_ACTIVIDAD_MUNICIPIO ? 'Sin establecimiento en el municipio · No aplica' : catalogo.get(c) ?? c);
  const [lic, setLic] = useState({ tipoId: licencia?.tipoId ?? '', emision: licencia?.emision ?? '', vence: licencia?.vence ?? '' });
  const cambiarLic = (c: Partial<typeof lic>) => setLic((x) => {
    const y = { ...x, ...c };
    // La vigencia se propone desde la emisión con los meses del tipo, solo si está vacía
    if (!y.vence && (c.emision || c.tipoId)) y.vence = venceDesdeEmision(y.emision, tiposLicencia.find((t) => t.id === y.tipoId)?.vigenciaMeses ?? null) ?? '';
    return y;
  });
  const estLic = estadoLicencia(lic.vence || null, hoyIso, umbralLicencias);
  const errorLic = validarLicencia(lic.emision, lic.vence);
  const [pestana, setPestana] = useState(pestanaInicial);
  const tabPerfil = useRef<HTMLButtonElement>(null);
  const tabRet = useRef<HTMLButtonElement>(null);
  const activo = proveedor.activo !== false && (perfil?.vigente ?? true);
  const editable = puedeEditar && activo;
  const [b, setB] = useState<BorradorPerfil>(() => borradorDe(perfil));
  const inicial = partesDePersona(b.persona);
  const [tipo, setTipo] = useState<TipoPersona | ''>(inicial.tipo);
  const [residencia, setResidencia] = useState<Residencia | ''>(inicial.residencia);
  const persona = personaDe(tipo, residencia);
  const cat = textoCategoria(persona);
  const sug = sugerenciaRif(proveedor.rif);
  const errores = validarPerfil({ ...b, persona, actividadCodigo: principalDe(acts)?.codigo ?? '' });
  const cambiar = (c: Partial<BorradorPerfil>) => setB((x) => ({ ...x, ...c }));

  const ir = (p: 'perfil' | 'retenciones') => { setPestana(p); (p === 'perfil' ? tabPerfil : tabRet).current?.focus(); };
  const teclas = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    ir(pestana === 'perfil' ? 'retenciones' : 'perfil');
  };

  const guardar = () => {
    if (!onGuardar) return;
    setGuardando(true); setErrorGuardar(null);
    const v = (s: string) => s || null;
    onGuardar({
      borrador: { ...b, persona }, actividadesAntes: actividades, actividades: acts,
      licenciaAntes: licencia ? { tipoId: licencia.tipoId, emision: licencia.emision, vence: licencia.vence } : null,
      licencia: { tipoId: v(lic.tipoId), emision: v(lic.emision), vence: v(lic.vence) },
      numeroLeido: perfil?.licenciaActividad ?? null,
    })
      .then(onCerrar)
      .catch((e: unknown) => setErrorGuardar(e instanceof Error ? e.message : 'No se pudo guardar el perfil.'))
      .finally(() => setGuardando(false));
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>{pestana === 'perfil' ? 'Cancelar' : 'Cerrar'}</button>
      {pestana === 'perfil' && (
        <span className="rv8-con-marca">
          {onGuardar ? (
            <button type="button" className="btn btn-primary" disabled={!editable || guardando || errores.length > 0 || !!errorLic} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar perfil'}
            </button>
          ) : <><button type="button" className="btn btn-primary" disabled>Guardar perfil</button><MarcaPaquete21 /></>}
        </span>
      )}
    </>
  );

  return (
    <Modal title={`Perfil fiscal del proveedor · ${proveedor.razonSocial} · ${proveedor.rif}`} size="lg" onClose={onCerrar} footer={footer}>
      <div className="rv8-pf-tabs" role="tablist" aria-label="Perfil fiscal del proveedor" onKeyDown={teclas}>
        <button ref={tabPerfil} type="button" role="tab" id="pf-tab-perfil" aria-controls="pf-panel-perfil" aria-selected={pestana === 'perfil'}
          tabIndex={pestana === 'perfil' ? 0 : -1} onClick={() => setPestana('perfil')}>Perfil fiscal</button>
        <button ref={tabRet} type="button" role="tab" id="pf-tab-ret" aria-controls="pf-panel-ret" aria-selected={pestana === 'retenciones'}
          tabIndex={pestana === 'retenciones' ? 0 : -1} onClick={() => setPestana('retenciones')}>Retenciones</button>
      </div>

      {pestana === 'perfil' ? (
        <div className="rv8-pf" id="pf-panel-perfil" role="tabpanel" aria-labelledby="pf-tab-perfil">
          <p className="rv8-pf-nota">{NOTA_PERFIL}</p>
          {!activo && <p className="rv8-pf-nota alerta">{NOTA_INACTIVO}</p>}
          {!puedeEditar && <p className="rv8-pf-nota alerta">{NOTA_LECTURA}</p>}
          <dl className="rv8-pf-ficha" aria-label="Datos de la ficha del proveedor (solo lectura)">
            <dt>Razón social</dt><dd>{proveedor.razonSocial}</dd>
            <dt>RIF</dt><dd className="mono">{proveedor.rif}</dd>
            <dt>Dirección fiscal (va en el comprobante)</dt><dd>{perfil?.direccion ?? proveedor.direccion ?? '—'}</dd>
            {onCorregirProveedor && (
              <dd className="enlace"><button type="button" className="mini" onClick={onCorregirProveedor}>Corregir en Proveedores</button> <span className="muted">· datos de solo lectura en este módulo</span></dd>
            )}
          </dl>

          <label className="rv8-pf-campo"><span>Tipo de contribuyente (IVA)</span>
            <select className="select" value={b.tipoContribuyente} disabled={!editable} onChange={(e) => cambiar({ tipoContribuyente: e.target.value as TipoContribuyente | '' })}>
              <option value="">No registrado</option>
              {TIPOS_CONTRIBUYENTE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>

          <fieldset className="rv8-pf-fs"><legend>Tipo de persona (ISLR)</legend>
            <label><input type="radio" name="pf-tipo" checked={tipo === 'natural'} disabled={!editable} onChange={() => setTipo('natural')} /> Natural</label>
            <label><input type="radio" name="pf-tipo" checked={tipo === 'juridica'} disabled={!editable} onChange={() => setTipo('juridica')} /> Jurídica</label>
            {sug && !tipo && (
              <span className="rv8-pf-huella">Sugerencia por la letra del RIF: {sug === 'juridica' ? 'jurídica' : 'natural'}.{' '}
                {editable && <button type="button" className="mini" onClick={() => setTipo(sug)}>Usar la sugerencia</button>}
              </span>
            )}
          </fieldset>
          <fieldset className="rv8-pf-fs"><legend>Residencia fiscal (ISLR)</legend>
            <label><input type="radio" name="pf-res" checked={residencia === 've'} disabled={!editable} onChange={() => setResidencia('ve')} /> En Venezuela (domiciliado o residente)</label>
            <label><input type="radio" name="pf-res" checked={residencia === 'fuera'} disabled={!editable} onChange={() => setResidencia('fuera')} /> Fuera de Venezuela (no domiciliado o no residente)</label>
            <span className="rv8-pf-huella">Decide la columna de la tabla del ISLR que se aplica.</span>
          </fieldset>
          <p className="rv8-pf-categoria" aria-live="polite">
            {cat.categoria ? <>Categoría (resulta de lo anterior): <b>{cat.categoria}</b>{cat.falta && <>. <span className="rv8-pf-falta">{cat.falta}</span></>}</> : SIN_CATEGORIA}
          </p>

          <div className="rv8-pf-campo"><span>Actividades económicas (ISAE)</span>
            {acts.length ? (
              <div className="rv8-pf-acts">
                {acts.map((x, i) => (
                  <div key={`${x.codigo}-${i}`} className={`rv8-pf-act${x.hasta && x.hasta < hoyIso ? ' vencida' : ''}`}>
                    <label><input type="radio" name="pf-principal" checked={x.principal} disabled={!editable || !!x.hasta} onChange={() => setActs(elegirPrincipal(acts, i))} /> Principal</label>
                    <span>{textoActividad(x.codigo)}{x.hasta ? ` · hasta ${fechaVe(x.hasta)}` : ''}</span>
                    {editable && !x.hasta ? (
                      cerrando === i ? (
                        <span className="rv8-pf-fila">
                          <input className="fecha" type="date" aria-label="Fecha «hasta» de la actividad" value={hastaNueva} onChange={(e) => setHastaNueva(e.target.value)} />
                          <button type="button" className="mini" disabled={!hastaNueva} onClick={() => { setActs(cerrarActividad(acts, i, hastaNueva)); setCerrando(null); }}>Cerrar</button>
                          <button type="button" className="mini" onClick={() => setCerrando(null)}>Cancelar</button>
                        </span>
                      ) : <button type="button" className="mini" onClick={() => { setCerrando(i); setHastaNueva(hoyIso); }}>Cerrar (fecha «hasta»)</button>
                    ) : <span />}
                  </div>
                ))}
              </div>
            ) : <p className="rv8-pf-huella">Sin actividades: el ISAE queda «Por definir».</p>}
            {editable && (
              <span className="rv8-pf-fila">
                {catalogoActividades.length ? (
                  <select className="select" aria-label="Añadir actividad" value={nuevaAct} onChange={(e) => setNuevaAct(e.target.value)}>
                    <option value="">Añadir actividad…</option>
                    {catalogoActividades.map((c) => <option key={c.codigo} value={c.codigo}>{c.texto}</option>)}
                    <option value={SIN_ACTIVIDAD_MUNICIPIO}>Sin establecimiento en el municipio</option>
                  </select>
                ) : (
                  <input className="texto" aria-label="Añadir actividad (código)" placeholder="Código, como 3.2.14.04" value={nuevaAct} onChange={(e) => setNuevaAct(e.target.value)} />
                )}
                <button type="button" className="btn btn-ghost" disabled={!nuevaAct} onClick={anadir}>Añadir</button>
              </span>
            )}
            {errorAct && <span className="rv8-pf-falta" role="alert">{errorAct}</span>}
            <span className="rv8-pf-huella">En el registro se propone la última usada; si no hay, la principal. «Sin establecimiento en el municipio»: No aplica.</span>
          </div>

          <div className="rv8-pf-caja"><b style={{ fontSize: '.85rem' }}>Licencia de actividad económica</b>
            <label className="rv8-pf-campo"><span>Número (de la ficha del proveedor)</span>
              <input className="texto" value={b.licenciaActividad} disabled={!editable} onChange={(e) => cambiar({ licenciaActividad: e.target.value })} />
            </label>
            <p className="rv8-pf-huella">Dato compartido con Compras. {historialLicencia.length ? 'Cambios:' : 'Sin cambios registrados.'}</p>
            {historialLicencia.length > 0 && <ul className="rv8-pf-historial">{historialLicencia.map((c, i) => <li key={i}>{textoLicenciaHistorial(c)}</li>)}</ul>}
            <div className="rv8-pf-fila">
              <label className="rv8-pf-campo"><span>Tipo</span>
                <select className="select" value={lic.tipoId} disabled={!editable} onChange={(e) => cambiarLic({ tipoId: e.target.value })}>
                  <option value="">No registrado</option>
                  {tiposLicencia.filter((t) => t.activo || t.id === lic.tipoId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </label>
              <label className="rv8-pf-campo"><span>Emisión</span><input className="fecha" type="date" value={lic.emision} disabled={!editable} onChange={(e) => cambiarLic({ emision: e.target.value })} /></label>
              <label className="rv8-pf-campo"><span>Vigencia</span><input className="fecha" type="date" value={lic.vence} disabled={!editable} onChange={(e) => cambiarLic({ vence: e.target.value })} /></label>
            </div>
            <div className="rv8-pf-campo"><span>Aviso de vencimiento</span>
              <span className="rv8-pf-fila">
                <span className={`rv8-pf-estado e-${estLic.estado}`}>{estLic.texto}</span>
                {lic.vence && <span className="rv8-pf-huella">Aviso con {umbralLicencias} días.</span>}
                {onVerVencimientos && <button type="button" className="mini" onClick={onVerVencimientos}>Ver en Vencimientos</button>}
              </span>
            </div>
            {estLic.estado === 'vencida' && <p className="rv8-pf-nota alerta">Licencia vencida el {fechaVe(lic.vence)}. Solo es un aviso: no bloquea el registro.</p>}
            {errorLic && <p className="rv8-pf-falta" role="alert">{errorLic}</p>}
          </div>

          {errores.length > 0 && <p className="rv8-pf-nota alerta" role="alert">{errores.join(' ')}</p>}
          {errorGuardar && <p className="rv8-pf-nota alerta" role="alert">{errorGuardar}</p>}
          <p className="rv8-pf-nota">{NOTA_PROPUESTA}</p>
          <p className="rv8-pf-huella">{huellaPerfil(perfil?.actualizadoPor ?? null, perfil?.actualizadoEn ?? null)}</p>
          <p className="rv8-pf-huella">Edición: administración, o roles con permiso de escritura en Retenciones.</p>
        </div>
      ) : (
        <PestanaRetenciones proveedor={proveedor} libro={libro} onAbrirReportes={onAbrirReportes} />
      )}
    </Modal>
  );
}

function PestanaRetenciones({ proveedor, libro, onAbrirReportes }: { proveedor: ProveedorPerfil; libro: readonly RetencionPracticada[]; onAbrirReportes?: (r: [string, string]) => void }) {
  const [atajo, setAtajo] = useState<AtajoPerfil>('ultimos_12');
  const [grano, setGrano] = useState<Grano>('mes');
  const [moneda, setMoneda] = useState('Bs');
  const [desde, hasta] = rangoPerfil(atajo, new Date());
  const tipos = useMemo(() => [...new Set(libro.map((r) => r.tipo as string))], [libro]);
  const serie = useMemo(() => serieProveedor(libro, proveedor.id, { desde, hasta, grano, moneda, tipos }), [libro, proveedor.id, desde, hasta, grano, moneda, tipos]);
  return (
    <div className="rv8-pf" id="pf-panel-ret" role="tabpanel" aria-labelledby="pf-tab-ret">
      <div className="rv8-pf-ctrl">
        <label className="rv8-pf-campo"><span>Rango</span>
          <select className="select" value={atajo} onChange={(e) => setAtajo(e.target.value as AtajoPerfil)}>
            {ATAJOS_PERFIL.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="rv8-pf-campo"><span>Columnas por</span>
          <select className="select" value={grano} onChange={(e) => setGrano(e.target.value as Grano)}>
            <option value="mes">Mes</option><option value="trimestre">Trimestre</option><option value="anio">Año</option>
          </select>
        </label>
        <label className="rv8-pf-campo"><span>Montos en</span>
          <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="Bs">Bs</option><option value="USD">$</option>
          </select>
        </label>
      </div>
      <p className="rv8-pf-huella">Retenciones practicadas a este proveedor, sin anuladas, por la fecha de la factura, en {moneda === 'USD' ? '$' : 'Bs'}{tipos.length ? ` (${tipos.map(nombreImpuesto).join(', ')})` : ''}.</p>
      <GraficaProveedor id={`perfil-${proveedor.id}`} moneda={moneda} serie={serie} />
      {onAbrirReportes && <p><button type="button" className="btn btn-ghost" onClick={() => onAbrirReportes([desde, hasta])}>Abrir en Reportes (Retenido por proveedor y período)</button></p>}
    </div>
  );
}
