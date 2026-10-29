/* ============================================================
   MGG · Contabilidad · Menú «Auxiliares y Otros» (E-14, Fase 1)

   La ventana de tablas de Galac (galac-capturas-A.md, photo_19; diferencias
   1 y 17): a la izquierda el panel con las 7 tablas; arriba la cinta con
   «Administrar» (Insertar · Modificar · Inactivar) y «Consultas»
   (Consultar · Buscar · Imprimir Lista); a la derecha la rejilla de la
   tabla elegida, con su cuadro «Buscar» y paginada. NO hay Eliminar: en
   Contabilidad nada se borra, se inactiva (usuario, 20/10). El código no
   se modifica; los tipos del sistema (90-98) tampoco.

   Las columnas y las filas salen de logica/listasCatalogos.ts; las reglas,
   de logica/catalogos.ts (las aplica el repositorio y los errores llegan
   en español). Un formulario por tabla, en la misma ventana modal: en
   «Consultar» los campos quedan de solo lectura.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { parseDecimal } from '@/shared/ui/DecimalInput';
import { useSession } from '@/modules/auth/authStore';
import {
  cambiarActivaMoneda, cambiarActivaMonedaLocal, cambiarActivoAuxiliar, cambiarActivoCambio, cambiarActivoCentroCosto,
  cambiarActivoPais, cambiarActivoTipoComprobante, crearAuxiliar, crearCambio, crearCentroCosto, crearMoneda, crearMonedaLocal,
  crearPais, crearTipoComprobante, listAuxiliares, listCambios, listCentrosCosto, listMonedas, listMonedasLocales, listPaises,
  listTiposComprobante, modificarAuxiliar, modificarCambio, modificarCentroCosto, modificarMoneda, modificarMonedaLocal,
  modificarPais, modificarTipoComprobante,
} from './contabilidad.repository';
import { ORIGENES_TIPO, TIPOS_AUXILIAR, TIPOS_CENTRO, claveMonedaLocal } from './logica/catalogos';
import {
  TABLAS_CATALOGO, columnasDe, columnasNumericas, filasDe, filtrarFilas, paginar, tituloTabla,
  type DatosCatalogos, type FilaCatalogo, type TablaCatalogo,
} from './logica/listasCatalogos';
import { verListaPdf } from './librosExport';
import type { ContCentroCosto, ContParametros, ContTipoComprobante, TipoAuxiliar } from './tipos';

type Modo = 'insertar' | 'modificar' | 'consultar';

const CLAVE_TABLA = 'mgg.contabilidad.auxiliares.tabla';

function tablaGuardada(): TablaCatalogo {
  try {
    const v = localStorage.getItem(CLAVE_TABLA);
    return TABLAS_CATALOGO.some((t) => t.clave === v) ? (v as TablaCatalogo) : 'tipo';
  } catch {
    return 'tipo';
  }
}

export function AuxiliaresTab({ parametros }: { parametros: ContParametros }) {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const [tabla, setTabla] = useState<TablaCatalogo>(tablaGuardada);
  const [datos, setDatos] = useState<DatosCatalogos | null>(null);
  const [texto, setTexto] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [elegida, setElegida] = useState<string | null>(null);
  const [ventana, setVentana] = useState<{ modo: Modo; id: string | null } | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const buscar = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      const [auxiliares, cambios, centros, monedas, monedasLocales, paises, tipos] = await Promise.all([
        listAuxiliares(), listCambios(), listCentrosCosto(), listMonedas(), listMonedasLocales(), listPaises(), listTiposComprobante(),
      ]);
      setDatos({ auxiliares, cambios, centros, monedas, monedasLocales, paises, tipos });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron leer las tablas.', 'error');
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  function elegirTabla(t: TablaCatalogo) {
    setTabla(t);
    setTexto('');
    setPagina(0);
    setElegida(null);
    try { localStorage.setItem(CLAVE_TABLA, t); } catch { /* sin almacenamiento: no se recuerda la tabla */ }
  }

  const filas = useMemo(() => (datos ? filtrarFilas(filasDe(tabla, datos), texto, verInactivos) : []), [datos, tabla, texto, verInactivos]);
  const vista = paginar(filas, pagina);
  const fila = filas.find((f) => f.id === elegida) ?? null;
  const columnas = columnasDe(tabla);
  const numericas = columnasNumericas(tabla);
  const titulo = tituloTabla(tabla);

  async function alternarActivo(f: FilaCatalogo) {
    try {
      const activo = !f.activo;
      if (tabla === 'auxiliar') await cambiarActivoAuxiliar(f.id, activo);
      else if (tabla === 'cambio') await cambiarActivoCambio(f.id, activo, actor);
      else if (tabla === 'centro') await cambiarActivoCentroCosto(f.id, activo);
      else if (tabla === 'moneda') await cambiarActivaMoneda(f.id, activo);
      else if (tabla === 'moneda_local') await cambiarActivaMonedaLocal(f.id, activo);
      else if (tabla === 'pais') await cambiarActivoPais(f.id, activo);
      else await cambiarActivoTipoComprobante(f.id, activo);
      await cargar();
      toast(`${titulo}: ${activo ? 'activado' : 'inactivado'}.`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cambiar el estado.', 'error');
    }
  }

  async function imprimir() {
    setImprimiendo(true);
    try {
      await verListaPdf(
        { empresa: parametros.empresa_nombre, titulo: `Lista de ${titulo}`, rango: `${filas.length} registro(s)${texto.trim() ? ` · Buscar: «${texto.trim()}»` : ''}`, moneda: parametros.moneda_funcional === 'USD' ? 'USD' : 'VES', archivo: `lista-${tabla}` },
        columnas, filas.map((f) => f.celdas), numericas,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar la lista.', 'error');
    } finally {
      setImprimiendo(false);
    }
  }

  const sinElegir = !fila;
  return (
    <div className="cont-tablas">
      <nav className="card cont-tablas-panel" aria-label="Tablas de Contabilidad">
        {TABLAS_CATALOGO.map((t) => (
          <button key={t.clave} type="button" className={tabla === t.clave ? 'sel' : ''} aria-current={tabla === t.clave} onClick={() => elegirTabla(t.clave)}>
            {t.titulo}
          </button>
        ))}
        <div className="cont-tablas-pie dim">
          <div>Tablas de Contabilidad</div>
          <div>Compañía {parametros.empresa_nombre ?? '—'}</div>
        </div>
      </nav>

      <div className="card cont-tablas-cuerpo">
        <div className="cont-cinta" role="toolbar" aria-label={`Acciones de ${titulo}`}>
          <div className="cont-cinta-grupo">
            <div className="cont-cinta-botones">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVentana({ modo: 'insertar', id: null })}>➕ Insertar</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={sinElegir || fila.sistema || !fila.activo}
                title={fila?.sistema ? 'Es del sistema: no se modifica.' : fila && !fila.activo ? 'Está inactivo: se activa primero.' : undefined}
                onClick={() => fila && setVentana({ modo: 'modificar', id: fila.id })}>✏️ Modificar</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={sinElegir || fila.sistema}
                title={fila?.sistema ? 'Es del sistema: siempre está activo.' : 'En Contabilidad nada se elimina: se inactiva.'}
                onClick={() => fila && void alternarActivo(fila)}>{fila && !fila.activo ? '✅ Activar' : '⛔ Inactivar'}</button>
            </div>
            <span className="cont-cinta-titulo">Administrar</span>
          </div>
          <div className="cont-cinta-grupo">
            <div className="cont-cinta-botones">
              <button type="button" className="btn btn-ghost btn-sm" disabled={sinElegir} onClick={() => fila && setVentana({ modo: 'consultar', id: fila.id })}>🔎 Consultar</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => buscar.current?.focus()}>🔍 Buscar</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={imprimiendo || filas.length === 0} onClick={() => void imprimir()}>🖨️ Imprimir Lista</button>
            </div>
            <span className="cont-cinta-titulo">Consultas</span>
          </div>
        </div>

        <div className="card-title">{titulo}</div>
        <div className="cont-barra">
          <input ref={buscar} className="input" type="search" placeholder="Buscar…" aria-label={`Buscar en ${titulo}`} value={texto}
            onChange={(e) => { setTexto(e.target.value); setPagina(0); }} />
          <label className="cont-check"><input type="checkbox" checked={verInactivos} onChange={(e) => { setVerInactivos(e.target.checked); setPagina(0); }} /> Ver inactivos</label>
          <span className="cont-sep" />
          <span className="dim" style={{ fontSize: '.8rem' }}>{filas.length} registro(s)</span>
        </div>

        {!datos ? <p className="muted">Cargando…</p> : filas.length === 0 ? <EmptyState icon="🗂️" message={texto.trim() ? 'Nada coincide con la búsqueda.' : `La tabla ${titulo} está vacía.`} /> : (
          <>
            <div className="table-wrap">
              <table className="table cont-tabla-catalogo">
                <thead><tr>{columnas.map((c, i) => <th key={c} className={numericas.includes(i) ? 'num' : ''}>{c}</th>)}</tr></thead>
                <tbody>
                  {vista.filas.map((f) => (
                    <tr key={f.id} className={`${f.id === elegida ? 'sel' : ''} ${f.activo ? '' : 'inactiva'}`} aria-selected={f.id === elegida}
                      onClick={() => setElegida(f.id)} onDoubleClick={() => setVentana({ modo: 'consultar', id: f.id })}>
                      {f.celdas.map((c, i) => (
                        <td key={i} className={numericas.includes(i) ? 'num' : i === 0 || columnas[i] === 'Código' ? 'mono' : ''}>
                          {c}{i === 0 && f.sistema && <span className="cont-etq" style={{ marginLeft: '.4rem' }}>Sistema</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cont-paginas">
              <button type="button" className="btn btn-ghost btn-sm" disabled={vista.pagina === 0} onClick={() => setPagina(vista.pagina - 1)}>‹</button>
              <span>Página {vista.pagina + 1} de {vista.paginas}</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={vista.pagina >= vista.paginas - 1} onClick={() => setPagina(vista.pagina + 1)}>›</button>
            </div>
          </>
        )}
      </div>

      {ventana && datos && (
        <FichaModal tabla={tabla} modo={ventana.modo} id={ventana.id} datos={datos} parametros={parametros} actor={actor}
          onCerrar={() => setVentana(null)}
          onGuardado={async (id) => { setVentana(null); await cargar(); setElegida(id); }} />
      )}
    </div>
  );
}

/* ───────────── La ficha de cada tabla ───────────── */

interface Campo {
  k: string;
  etiqueta: string;
  tipo: 'texto' | 'select' | 'fecha' | 'decimal';
  opciones?: Array<[string, string]>;
  /** Solo se escribe al insertar (el código no se modifica). */
  soloAlta?: boolean;
  /** Mayúsculas y minúsculas como las escribe el usuario (Galac: «Bolívar Soberano»). */
  libre?: boolean;
  mono?: boolean;
}

type Valores = Record<string, string>;

const opcionesMoneda = (d: DatosCatalogos, propia?: string) =>
  d.monedas.filter((m) => m.activa || m.codigo === propia).map((m): [string, string] => [m.codigo, `${m.codigo} · ${m.nombre}`]);

function camposDe(t: TablaCatalogo, d: DatosCatalogos, v: Valores, p: ContParametros): Campo[] {
  switch (t) {
    case 'auxiliar': return [
      { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: TIPOS_AUXILIAR, soloAlta: true },
      { k: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlta: true, mono: true },
      { k: 'nombre', etiqueta: 'Nombre', tipo: 'texto' },
      { k: 'rif', etiqueta: 'RIF', tipo: 'texto', mono: true },
    ];
    case 'cambio': return [
      { k: 'moneda', etiqueta: 'Moneda', tipo: 'select', opciones: opcionesMoneda(d, v.moneda).filter(([c]) => c !== p.moneda_funcional) },
      { k: 'fecha', etiqueta: 'Fecha', tipo: 'fecha' },
      { k: 'tasa_ves', etiqueta: 'Cambio (Bs por unidad)', tipo: 'decimal' },
    ];
    case 'centro': return [
      { k: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlta: true, mono: true },
      { k: 'nombre', etiqueta: 'Nombre', tipo: 'texto' },
      { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: TIPOS_CENTRO },
      {
        k: 'padre_id', etiqueta: 'Depende de', tipo: 'select',
        opciones: [['', 'Ninguno'], ...d.centros.filter((c) => (c.activo || c.id === v.padre_id) && c.id !== v.id).map((c): [string, string] => [c.id, `${c.codigo} · ${c.nombre}`])],
      },
    ];
    case 'moneda': return [
      { k: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlta: true, mono: true },
      { k: 'nombre', etiqueta: 'Nombre', tipo: 'texto', libre: true },
      { k: 'simbolo', etiqueta: 'Símbolo', tipo: 'texto', libre: true },
    ];
    case 'moneda_local': return [
      // País, moneda y vigencia desde son la clave (la PK del DDL v0.8): solo al insertar.
      { k: 'codigo_pais', etiqueta: 'País', tipo: 'select', soloAlta: true, opciones: d.paises.filter((x) => x.activo || x.codigo === v.codigo_pais).map((x): [string, string] => [x.codigo, `${x.codigo} · ${x.nombre}`]) },
      { k: 'codigo_moneda', etiqueta: 'Moneda', tipo: 'select', soloAlta: true, opciones: opcionesMoneda(d, v.codigo_moneda) },
      { k: 'factor_conversion', etiqueta: 'Factor de Conversión', tipo: 'decimal' },
      { k: 'codigo_moneda_anterior', etiqueta: 'Moneda Anterior', tipo: 'select', opciones: [['', 'Ninguna'], ...opcionesMoneda(d, v.codigo_moneda_anterior)] },
      { k: 'vigencia_desde', etiqueta: 'Vigencia Desde', tipo: 'fecha', soloAlta: true },
      { k: 'vigencia_hasta', etiqueta: 'Vigencia Hasta (vacío = 06/06/2079)', tipo: 'fecha' },
    ];
    case 'pais': return [
      { k: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlta: true, mono: true },
      { k: 'nombre', etiqueta: 'Nombre', tipo: 'texto', libre: true },
    ];
    case 'tipo': return [
      { k: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlta: true, mono: true },
      { k: 'nombre', etiqueta: 'Nombre', tipo: 'texto', libre: true },
      { k: 'origen', etiqueta: 'Origen', tipo: 'select', opciones: ORIGENES_TIPO },
    ];
  }
}

const tasaTexto = (n: number) => String(n).replace('.', ',');

/** Los valores de la ficha: los del registro, o los de una ficha nueva. */
function valoresDe(t: TablaCatalogo, id: string | null, d: DatosCatalogos): Valores {
  const hoy = new Date().toISOString().slice(0, 10);
  switch (t) {
    case 'auxiliar': {
      const a = d.auxiliares.find((x) => x.id === id);
      return a ? { tipo: a.tipo, codigo: a.codigo, nombre: a.nombre, rif: a.rif ?? '' } : { tipo: 'proveedor', codigo: '', nombre: '', rif: '' };
    }
    case 'cambio': {
      const c = d.cambios.find((x) => x.id === id);
      return c ? { moneda: c.moneda, fecha: c.fecha, tasa_ves: tasaTexto(c.tasa_ves) } : { moneda: 'USD', fecha: hoy, tasa_ves: '' };
    }
    case 'centro': {
      const c = d.centros.find((x) => x.id === id);
      return c ? { id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, padre_id: c.padre_id ?? '' } : { codigo: '', nombre: '', tipo: 'area', padre_id: '' };
    }
    case 'moneda': {
      const m = d.monedas.find((x) => x.codigo === id);
      return m ? { codigo: m.codigo, nombre: m.nombre, simbolo: m.simbolo } : { codigo: '', nombre: '', simbolo: '' };
    }
    case 'moneda_local': {
      const l = d.monedasLocales.find((x) => claveMonedaLocal(x) === id);
      return l
        ? { codigo_pais: l.codigo_pais, codigo_moneda: l.codigo_moneda, factor_conversion: tasaTexto(l.factor_conversion), codigo_moneda_anterior: l.codigo_moneda_anterior ?? '', vigencia_desde: l.vigencia_desde, vigencia_hasta: l.vigencia_hasta }
        : { codigo_pais: '', codigo_moneda: '', factor_conversion: '1', codigo_moneda_anterior: '', vigencia_desde: hoy, vigencia_hasta: '' };
    }
    case 'pais': {
      const p = d.paises.find((x) => x.codigo === id);
      return p ? { codigo: p.codigo, nombre: p.nombre } : { codigo: '', nombre: '' };
    }
    case 'tipo': {
      const x = d.tipos.find((y) => y.id === id);
      return x ? { codigo: x.codigo, nombre: x.nombre, origen: x.origen } : { codigo: '', nombre: '', origen: 'manual' };
    }
  }
}

/** Graba la ficha y devuelve el id del registro (para dejarlo elegido en la rejilla). */
async function grabar(t: TablaCatalogo, modo: 'insertar' | 'modificar', id: string | null, v: Valores, actor: string): Promise<string> {
  const numero = (s: string) => parseDecimal(s) ?? NaN;
  switch (t) {
    case 'auxiliar':
      return modo === 'insertar'
        ? (await crearAuxiliar({ tipo: v.tipo as TipoAuxiliar, codigo: v.codigo, nombre: v.nombre, rif: v.rif })).id
        : (await modificarAuxiliar(id!, { nombre: v.nombre, rif: v.rif })).id;
    case 'cambio': {
      const x = { moneda: v.moneda, fecha: v.fecha, tasa_ves: numero(v.tasa_ves) };
      return modo === 'insertar' ? (await crearCambio(x, actor)).id : (await modificarCambio(id!, x, actor)).id;
    }
    case 'centro': {
      const x = { nombre: v.nombre, tipo: v.tipo as ContCentroCosto['tipo'], padre_id: v.padre_id || null };
      return modo === 'insertar' ? (await crearCentroCosto({ codigo: v.codigo, ...x })).id : (await modificarCentroCosto(id!, x)).id;
    }
    case 'moneda':
      return modo === 'insertar'
        ? (await crearMoneda({ codigo: v.codigo, nombre: v.nombre, simbolo: v.simbolo })).codigo
        : (await modificarMoneda(id!, { nombre: v.nombre, simbolo: v.simbolo })).codigo;
    case 'moneda_local': {
      const x = { factor_conversion: numero(v.factor_conversion), codigo_moneda_anterior: v.codigo_moneda_anterior || null, vigencia_hasta: v.vigencia_hasta };
      return claveMonedaLocal(modo === 'insertar'
        ? await crearMonedaLocal({ codigo_pais: v.codigo_pais, codigo_moneda: v.codigo_moneda, vigencia_desde: v.vigencia_desde, ...x })
        : await modificarMonedaLocal(id!, x));
    }
    case 'pais':
      return modo === 'insertar' ? (await crearPais({ codigo: v.codigo, nombre: v.nombre })).codigo : (await modificarPais(id!, { nombre: v.nombre })).codigo;
    case 'tipo': {
      const origen = v.origen as ContTipoComprobante['origen'];
      return modo === 'insertar'
        ? (await crearTipoComprobante({ codigo: v.codigo, nombre: v.nombre, origen }, actor)).id
        : (await modificarTipoComprobante(id!, { nombre: v.nombre, origen })).id;
    }
  }
}

const TITULO_MODO: Record<Modo, string> = { insertar: 'Insertar', modificar: 'Modificar', consultar: 'Consultar' };

function FichaModal({ tabla, modo, id, datos, parametros, actor, onCerrar, onGuardado }: {
  tabla: TablaCatalogo; modo: Modo; id: string | null; datos: DatosCatalogos; parametros: ContParametros; actor: string;
  onCerrar: () => void; onGuardado: (id: string) => Promise<void>;
}) {
  const [valores, setValores] = useState<Valores>(() => valoresDe(tabla, id, datos));
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const campos = camposDe(tabla, datos, valores, parametros);
  const soloLectura = modo === 'consultar';

  async function guardar() {
    if (modo === 'consultar') return;
    setGuardando(true);
    setErrores([]);
    try {
      await onGuardado(await grabar(tabla, modo, id, valores, actor));
      toast(`${tituloTabla(tabla)}: ${modo === 'insertar' ? 'insertado' : 'modificado'}.`, 'success');
    } catch (e) {
      // El repositorio junta los errores en una frase por regla: se muestran uno por renglón.
      setErrores((e instanceof Error ? e.message : 'No se pudo grabar.').split(/(?<=\.)\s+/));
      setGuardando(false);
    }
  }

  return (
    <Modal title={`${tituloTabla(tabla)} · ${TITULO_MODO[modo]}`} size="sm" onClose={() => !guardando && onCerrar()}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>{soloLectura ? 'Salir' : 'Cancelar'}</button>
        {!soloLectura && <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Grabando…' : 'Grabar'}</button>}
      </>}>
      <div className="cont-form">
        {campos.map((c, i) => {
          const bloqueado = soloLectura || (modo === 'modificar' && c.soloAlta);
          const clase = `${c.mono ? 'mono ' : ''}${c.libre ? 'no-upper' : ''}`.trim();
          const cambiar = (x: string) => setValores({ ...valores, [c.k]: x });
          return (
            <label key={c.k} className={c.k === 'nombre' ? 'full' : ''}>{c.etiqueta}
              {c.tipo === 'select' ? (
                <select className="select" value={valores[c.k] ?? ''} disabled={bloqueado} onChange={(e) => cambiar(e.target.value)}>
                  {!c.opciones!.some(([k]) => k === '') && <option value="">Elija…</option>}
                  {c.opciones!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              ) : (
                <input className={`input ${clase}`} value={valores[c.k] ?? ''} readOnly={bloqueado} autoFocus={i === 0 && !bloqueado}
                  type={c.tipo === 'fecha' ? 'date' : 'text'} inputMode={c.tipo === 'decimal' ? 'decimal' : undefined}
                  onChange={(e) => cambiar(e.target.value)} />
              )}
            </label>
          );
        })}
      </div>
      {tabla === 'cambio' && <p className="cont-nota">La tasa manual manda en su fecha sobre la del sistema y vale hasta la siguiente, con el tope de 7 días.</p>}
      {errores.length > 0 && <ul className="cont-errores">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
    </Modal>
  );
}
