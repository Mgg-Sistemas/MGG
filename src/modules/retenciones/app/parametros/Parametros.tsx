/* ============================================================
   MGG · Retenciones v8 · ⚙ Parámetros

   Traslado del panel «Parámetros de retenciones» de la maqueta v8: dos
   capas, Ajustes (lo de todos los días) y Ajustes avanzados (lo que cambia
   cálculos, números o fechas). Cada tarjeta abre su sección y «Volver»
   regresa a la portada.

   Hoy se muestran las secciones que tienen datos en la base, y se editan
   con lo que la base ya guarda (las mismas funciones que la pantalla de
   hoy, por la puerta), solo con permiso de escritura en Retenciones:
   · Ajustes › Datos de la empresa (retencion_config);
   · Ajustes avanzados › Régimen y valores compartidos (retencion_config) y
     el catálogo de conceptos de cada impuesto (retencion_conceptos): alta,
     edición, activar y desactivar.
   Las tarjetas siguen la maqueta (v8-2-ajustes.js, pintarInicioPa): en
   Ajustes, las ocho de ORDEN_AJUSTES; en Ajustes avanzados, el aviso, la
   cadena y los dos grupos «Cada impuesto» y «De toda la empresa». Las que
   esperan a sus tablas (paquete 2.1) se ven solo en local, desactivadas y
   marcadas; en producción no aparecen (secciones.ts).
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { labelSujeto, type ConceptoRetencion, type ConfigRetencion } from '../../retencionesCalculo';
import { usePuerta } from '../datos/puerta';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { EditorConcepto, EditorEmpresa, EditorRegimen } from './editores';
import { AVISO_AVANZADOS, CADENA, seccionesDe, type Seccion } from './secciones';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import './parametros.css';
import './rv8-parametros.css';

type Vista = 'portada' | 'empresa' | 'avanzados' | 'impuestos' | 'regimen' | `conceptos:${string}`;

const pct = (n: number) => `${n.toLocaleString('es-VE', { maximumFractionDigits: 4 })} %`;
const ut = (n: number) => (n > 0 ? `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Sin cargar');

interface Props {
  onCerrar: () => void;
  /** Con escritura en Retenciones, cada sección se edita. Sin ella, solo se consulta. */
  puedeEditar?: boolean;
  /** Abre directamente una sección (el aviso de régimen abre «regimen»). */
  vistaInicial?: Vista;
}

export function Parametros({ onCerrar, puedeEditar = false, vistaInicial = 'portada' }: Props) {
  const puerta = usePuerta();
  const { user } = useSession();
  const [vista, setVista] = useState<Vista>(vistaInicial);
  const [config, setConfig] = useState<ConfigRetencion | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<null | 'empresa' | 'regimen' | 'nuevo' | string>(null);

  const cargar = useCallback(() => {
    Promise.all([puerta.config(), puerta.conceptos(false)])
      .then(([c, cs]) => { setConfig(c); setConceptos(cs); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo leer la configuración fiscal.'));
  }, [puerta]);
  useEffect(() => { cargar(); }, [cargar]);

  const ir = (v: Vista) => { setVista(v); setEditando(null); };
  const guardarConfig = async (c: ConfigRetencion) => {
    await puerta.guardarConfig(c, user?.email ?? 'sistema');
    toast('Parámetros guardados.', 'success'); setEditando(null); cargar();
  };
  const guardarConcepto = async (c: Partial<ConceptoRetencion> & { nombre: string; tipo: ConceptoRetencion['tipo'] }) => {
    await puerta.guardarConcepto(c);
    toast(c.id ? 'Concepto guardado.' : 'Concepto creado.', 'success'); setEditando(null); cargar();
  };
  const activar = (c: ConceptoRetencion) => {
    puerta.activarConcepto(c.id, !c.activo)
      .then(() => { toast(c.activo ? 'Concepto desactivado.' : 'Concepto activado.', 'success'); cargar(); })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo cambiar el concepto.', 'error'));
  };

  const tiposConCatalogo = [...new Set(conceptos.map((c) => c.tipo as string))];
  const local = import.meta.env.DEV;
  const resumen = (s: Seccion, c: ConfigRetencion): string => {
    if (s.clave === 'empresa') return `${c.rif ? `RIF ${c.rif}` : 'RIF sin cargar'}${c.razonSocial ? ` · ${c.razonSocial}` : ''}`;
    if (s.clave === 'impuestos') return `${tiposConCatalogo.length} impuesto(s) con conceptos · ${conceptos.filter((x) => x.activo).length} concepto(s) activo(s)`;
    if (s.clave === 'regimen') return c.esContribuyenteEspecial ? 'Contribuyente especial' : 'No es contribuyente especial';
    if (s.clave === 'valores') return `UT ${ut(c.valorUt)} · IVA ${pct(c.pctIvaGeneral)} · IGTF ${pct(c.pctIgtf)}`;
    return '';
  };
  const tarjeta = (s: Seccion, c: ConfigRetencion) => (s.vista
    ? (
      <button key={s.clave} type="button" className="v7-pa-btn" onClick={() => ir(s.vista as Vista)}>
        <span className="t">{s.titulo}</span><span className="d">{s.linea}</span><span className="r">{resumen(s, c)}</span>
      </button>
    )
    : (
      <div key={s.clave} className="v7-pa-btn rv8-requiere-base" aria-disabled="true">
        <span className="t">{s.titulo} <MarcaPaquete21 /></span><span className="d">{s.linea}</span>
      </div>
    ));
  const volver = (a: Vista) => <button type="button" className="v7-volver" onClick={() => ir(a)}>‹ Volver</button>;
  const botonEditar = (que: string) => (puedeEditar && editando == null
    ? <button type="button" className="mini v8-pa-editar" onClick={() => setEditando(que)}>Editar</button> : null);

  const footer = (
    <>
      <span className="huella v8-pa-pie">{puedeEditar ? 'Edición: administración, o escritura en Retenciones.' : 'Consulta: sin permiso de escritura en Retenciones.'}</span>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
    </>
  );

  return (
    <Modal title="⚙ Parámetros de retenciones" size="lg" onClose={onCerrar} footer={footer}>
      <div className="ret-v8 v8-parametros">
        {error && <div className="aviso-error" role="alert">No se pudo leer la configuración fiscal: {error}</div>}
        {!config && !error && <p className="muted" role="status">Cargando…</p>}

        {config && vista === 'portada' && (
          <>
            <h3 className="v7-capa-t">Ajustes</h3>
            <p className="huella v7-capa-d">Mantenimiento de todos los días. No cambian cuánto se retiene, cómo se numera ni cuándo se declara.</p>
            <div className="v7-pa-grid">{seccionesDe('ajustes', local).map((x) => tarjeta(x, config))}</div>
            <button type="button" className="v7-pa-avanzados" onClick={() => ir('avanzados')}>
              <span className="t">Ajustes avanzados</span>
              <span className="d">Cada impuesto con su regla, período, numeración y formato; y lo de toda la empresa: régimen, valores compartidos e interruptores generales.</span>
              <span className="r">Cambian cálculos, números o fechas de declaración · {seccionesDe('impuesto', local).length + seccionesDe('empresa', local).length} secciones</span>
            </button>
          </>
        )}

        {config && vista === 'empresa' && (
          <>
            {volver('portada')}
            <h3 className="v7-sec-t">Datos de la empresa {botonEditar('empresa')}</h3>
            {editando === 'empresa'
              ? <EditorEmpresa config={config} onGuardar={guardarConfig} onCancelar={() => setEditando(null)} />
              : (
                <dl className="v7-que">
                  <dt>Razón social</dt><dd>{config.razonSocial || 'Sin cargar'}</dd>
                  <dt>RIF</dt><dd className="mono">{config.rif || 'Sin cargar'}</dd>
                  <dt>Dirección fiscal</dt><dd>{config.direccionFiscal || 'Sin cargar'}</dd>
                  <dt>Municipio</dt><dd>{config.municipio || 'Sin cargar'}</dd>
                  <dt>Estado</dt><dd>{config.estado || 'Sin cargar'}</dd>
                </dl>
              )}
          </>
        )}

        {config && vista === 'avanzados' && (
          <>
            <button type="button" className="v7-volver" onClick={() => ir('portada')}>← Parámetros</button>
            <div className="rv8-v7-aviso-avanzado" role="note"><b>Ajustes avanzados.</b> {AVISO_AVANZADOS}</div>
            <figure className="rv8-v8-cadena">
              <ol>{CADENA.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
              <figcaption>Cada eslabón depende del anterior. Lo de la empresa se configura una vez y lo usan varios impuestos; lo demás está en la ficha de cada impuesto.</figcaption>
            </figure>
            <h4 className="v7-capa-t">Cada impuesto</h4>
            <div className="v7-pa-grid">{seccionesDe('impuesto', local).map((x) => tarjeta(x, config))}</div>
            <h4 className="v7-capa-t">De toda la empresa</h4>
            <div className="v7-pa-grid">{seccionesDe('empresa', local).map((x) => tarjeta(x, config))}</div>
          </>
        )}

        {config && vista === 'impuestos' && (
          <>
            {volver('avanzados')}
            <h3 className="v7-sec-t">Impuestos y reglas</h3>
            <p className="huella">Hoy, el catálogo de conceptos de cada impuesto, con el que se elige el % de cada línea.</p>
            <div className="v7-pa-grid">
              {tiposConCatalogo.map((t) => {
                const xs = conceptos.filter((c) => c.tipo === t);
                return (
                  <button key={t} type="button" className="v7-pa-btn" onClick={() => ir(`conceptos:${t}`)}>
                    <span className="t">Conceptos de {nombreImpuesto(t)}</span>
                    <span className="d">El catálogo con el que se elige el % de cada línea.</span>
                    <span className="r">{xs.filter((c) => c.activo).length} activo(s) de {xs.length}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {config && vista === 'regimen' && (
          <>
            {volver('avanzados')}
            <h3 className="v7-sec-t">Régimen fiscal y valores compartidos {botonEditar('regimen')}</h3>
            {editando === 'regimen'
              ? <EditorRegimen config={config} onGuardar={guardarConfig} onCancelar={() => setEditando(null)} />
              : (
                <dl className="v7-que">
                  <dt>Condición</dt><dd>{config.esContribuyenteEspecial ? 'Contribuyente especial: practica retención de IVA' : 'No es contribuyente especial: no practica retención de IVA'}</dd>
                  <dt>IVA: % general</dt><dd>{pct(config.pctIvaGeneral)}</dd>
                  <dt>IVA: % del art. 5</dt><dd>{pct(config.pctIvaEspecial)}</dd>
                  <dt>Unidad tributaria</dt><dd>{ut(config.valorUt)}{config.valorUt > 0 ? '' : ' · sin ella no se calculan el mínimo ni el sustraendo del ISLR'}</dd>
                  <dt>IGTF</dt><dd>{pct(config.pctIgtf)}</dd>
                </dl>
              )}
          </>
        )}

        {config && vista.startsWith('conceptos:') && (() => {
          const t = vista.slice('conceptos:'.length) as ConceptoRetencion['tipo'];
          const xs = conceptos.filter((c) => c.tipo === t).sort((a, b) => a.orden - b.orden);
          const enEdicion = editando && editando !== 'nuevo' ? xs.find((c) => c.id === editando) ?? null : null;
          return (
            <>
              {volver('impuestos')}
              <h3 className="v7-sec-t">
                Conceptos de {nombreImpuesto(t)}{' '}
                {puedeEditar && editando == null && <button type="button" className="mini v8-pa-editar" onClick={() => setEditando('nuevo')}>+ Nuevo concepto</button>}
              </h3>
              {(editando === 'nuevo' || enEdicion) && (
                <EditorConcepto key={editando ?? ''} concepto={enEdicion} tipo={t} onGuardar={guardarConcepto} onCancelar={() => setEditando(null)} />
              )}
              <div className={`lista-sis v8-pa-conceptos${puedeEditar ? ' con-acciones' : ''}`}>
                <div className="fila-sis cab">
                  <span>Código</span><span>Concepto</span><span>Sujeto</span><span className="n">%</span><span className="n">Base</span><span>Mínimo y sustraendo</span><span>Estado</span>{puedeEditar && <span />}
                </div>
                {xs.map((c) => (
                  <div key={c.id} className="fila-sis">
                    <span data-l="Código" className="mono">{c.codigo || '—'}</span>
                    <span data-l="Concepto">{c.nombre}{c.fundamento && <small>{c.fundamento}</small>}</span>
                    <span data-l="Sujeto">{labelSujeto(c.sujeto)}</span>
                    <span data-l="%" className="n">{pct(c.porcentaje)}</span>
                    <span data-l="Base" className="n">{pct(c.basePct)}</span>
                    <span data-l="Mínimo y sustraendo">{c.baseMinimaUt > 0 ? `${c.baseMinimaUt.toLocaleString('es-VE')} UT` : 'Sin mínimo'}{c.aplicaSustraendo ? ' · con sustraendo' : ''}</span>
                    <span data-l="Estado"><span className={`pill ${c.activo ? 'ok' : 'inactivo'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></span>
                    {puedeEditar && (
                      <span className="acc">
                        <button type="button" className="mini" disabled={editando != null} onClick={() => setEditando(c.id)}>Editar</button>
                        <button type="button" className="mini" disabled={editando != null} onClick={() => activar(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>
    </Modal>
  );
}
