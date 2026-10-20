/* ============================================================
   MGG · Retenciones v8 · El perfil fiscal del proveedor (diálogo)

   El dlg-perfil de la maqueta (v8, l. 1469), con sus dos pestañas (v8-14,
   punto 4): «Perfil fiscal» (tipo de contribuyente, tipo de persona y
   residencia con su categoría, actividad, licencia con su historial) y
   «Retenciones» (el análisis del proveedor con su gráfica y su tendencia).
   El perfil vive en la base de Retenciones (paquete 05): hasta que exista, el
   diálogo no aparece en producción; en local se ve con su estructura, sin
   datos guardados y con la marca 2.1 en lo que espera a la base. Las piezas
   que la maqueta pide y la base todavía no tiene (varias actividades con su
   «hasta»; tipo, emisión y vigencia de la licencia) van desactivadas.
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
import './rv8-perfil.css';

const FALTA_EN_BASE = 'Pendiente en la base de Retenciones: no está en el paquete 2.1';

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
}

export function PerfilProveedorDialogo(props: PropsPerfil) {
  if (!import.meta.env.DEV) return null;
  return <Dialogo {...props} />;
}

function Dialogo({ proveedor, perfil = null, historialLicencia = [], puedeEditar = false, libro = [], pestanaInicial = 'perfil', onCorregirProveedor, onAbrirReportes, onCerrar }: PropsPerfil) {
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
  const errores = validarPerfil({ ...b, persona });
  const cambiar = (c: Partial<BorradorPerfil>) => setB((x) => ({ ...x, ...c }));

  const ir = (p: 'perfil' | 'retenciones') => { setPestana(p); (p === 'perfil' ? tabPerfil : tabRet).current?.focus(); };
  const teclas = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    ir(pestana === 'perfil' ? 'retenciones' : 'perfil');
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>{pestana === 'perfil' ? 'Cancelar' : 'Cerrar'}</button>
      {pestana === 'perfil' && (
        <span className="rv8-con-marca">
          <button type="button" className="btn btn-primary" disabled>Guardar perfil</button><MarcaPaquete21 />
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
            <dt>Dirección fiscal (va en el comprobante)</dt><dd>{proveedor.direccion || '—'}</dd>
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

          <div className="rv8-pf-campo"><span>Actividad económica (ISAE)</span>
            <div className="rv8-pf-fila">
              <input className="texto" value={b.actividadCodigo === SIN_ACTIVIDAD_MUNICIPIO ? '' : b.actividadCodigo} placeholder="Código, como 3.2.14.04"
                aria-label="Código de la actividad" disabled={!editable || b.actividadCodigo === SIN_ACTIVIDAD_MUNICIPIO}
                onChange={(e) => cambiar({ actividadCodigo: e.target.value })} />
              <label><input type="checkbox" checked={b.actividadCodigo === SIN_ACTIVIDAD_MUNICIPIO} disabled={!editable}
                onChange={(e) => cambiar({ actividadCodigo: e.target.checked ? SIN_ACTIVIDAD_MUNICIPIO : '' })} /> Sin establecimiento en el municipio (No aplica)</label>
            </div>
            <span className="rv8-con-marca">
              <button type="button" className="btn btn-ghost" disabled>Añadir otra actividad…</button><MarcaPaquete21 texto={FALTA_EN_BASE} />
            </span>
            <span className="rv8-pf-huella">Sin actividad: el ISAE queda «Por definir».</span>
          </div>

          <div className="rv8-pf-caja"><b style={{ fontSize: '.85rem' }}>Licencia de actividad económica</b>
            <label className="rv8-pf-campo"><span>Número (de la ficha del proveedor)</span>
              <input className="texto" value={b.licenciaActividad} disabled={!editable} onChange={(e) => cambiar({ licenciaActividad: e.target.value })} />
            </label>
            <p className="rv8-pf-huella">Dato compartido con Compras. {historialLicencia.length ? 'Cambios del número:' : 'Sin cambios del número registrados.'}</p>
            {historialLicencia.length > 0 && <ul className="rv8-pf-historial">{historialLicencia.map((c, i) => <li key={i}>{textoLicenciaHistorial(c)}</li>)}</ul>}
            <div className="rv8-pf-fila">
              <label className="rv8-pf-campo"><span>Tipo</span><select className="select" disabled><option>No registrado</option></select></label>
              <label className="rv8-pf-campo"><span>Emisión</span><input className="fecha" type="date" disabled /></label>
              <label className="rv8-pf-campo"><span>Vigencia</span><input className="fecha" type="date" disabled /></label>
              <MarcaPaquete21 texto={FALTA_EN_BASE} />
            </div>
          </div>

          {errores.length > 0 && <p className="rv8-pf-nota alerta" role="alert">{errores.join(' ')}</p>}
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
