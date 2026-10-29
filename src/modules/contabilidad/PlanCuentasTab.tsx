/* ============================================================
   MGG · Contabilidad · Pestaña «Plan de cuentas»

   Árbol navegable (expandir por nivel, buscar por código o nombre sin
   acentos) y la ficha de la cuenta elegida. Desde un título se crea una
   subcuenta con el código siguiente ya propuesto; las cuentas no se
   borran, se inactivan.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { cambiarActivaCuenta, crearCuenta, listCuentas } from './contabilidad.repository';
import {
  NOMBRE_CLASE, NOMBRE_NATURALEZA, claseSugerida, codigoPadre, codigosConHijos, codigosHastaNivel, construirArbol, filtrarArbol,
  formatoDeMascara, naturalezaSugerida, resumenPlan, siguienteCodigoHijo, validarNuevaCuenta, type NodoCuenta,
} from './logica/planCuentas';
import { TIPOS_AUXILIAR, nombreTipoAuxiliar } from './logica/catalogos';
import type { ClaseCuenta, ContCuenta, ContParametros, CuentaInput, Moneda, Naturaleza, TipoAuxiliar } from './tipos';

const nombreAuxiliar = nombreTipoAuxiliar;

/** La página la monta con `key` = versión de los datos: al reiniciar la simulación arranca de cero. */
export function PlanCuentasTab({ parametros }: { parametros: ContParametros }) {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const [cuentas, setCuentas] = useState<ContCuenta[] | null>(null);
  const [texto, setTexto] = useState('');
  const [verInactivas, setVerInactivas] = useState(false);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [elegida, setElegida] = useState<string | null>(null);
  const [nueva, setNueva] = useState<{ padre: ContCuenta | null } | null>(null);

  // En la primera carga el plan se abre hasta el nivel 2 (Activo › Activo corriente…), como un
  // plan impreso; después manda lo que el usuario abra o cierre.
  const inicializado = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const lista = await listCuentas();
      setCuentas(lista);
      if (!inicializado.current) {
        inicializado.current = true;
        setAbiertas(new Set(codigosHastaNivel(construirArbol(lista), 2)));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo leer el plan de cuentas.', 'error');
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => (cuentas ?? []).filter((c) => verInactivas || c.activa), [cuentas, verInactivas]);
  const arbol = useMemo(() => construirArbol(visibles), [visibles]);
  const filtrado = useMemo(() => filtrarArbol(arbol, texto), [arbol, texto]);
  const buscando = texto.trim() !== '';
  const resumen = useMemo(() => resumenPlan(cuentas ?? []), [cuentas]);
  const cuenta = cuentas?.find((c) => c.id === elegida) ?? null;

  const alternar = (codigo: string) => setAbiertas((prev) => {
    const s = new Set(prev);
    if (s.has(codigo)) s.delete(codigo); else s.add(codigo);
    return s;
  });

  async function alternarActiva(c: ContCuenta) {
    try {
      await cambiarActivaCuenta(c.id, !c.activa);
      toast(c.activa ? `Cuenta ${c.codigo} inactivada.` : `Cuenta ${c.codigo} activada.`, 'success');
      await cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cambiar la cuenta.', 'error');
    }
  }

  if (!cuentas) return <p className="muted">Cargando el plan de cuentas…</p>;

  const filas: Array<{ nodo: NodoCuenta; nivel: number }> = [];
  const recorrer = (lista: NodoCuenta[]) => {
    for (const n of lista) {
      filas.push({ nodo: n, nivel: n.cuenta.nivel });
      if (n.hijos.length && (buscando || abiertas.has(n.cuenta.codigo))) recorrer(n.hijos);
    }
  };
  recorrer(filtrado);

  return (
    <>
      <div className="kpi-grid m-tiles" style={{ marginBottom: '1rem' }}>
        <div className="kpi"><div className="label">Cuentas</div><div className="value">{resumen.total}</div></div>
        <div className="kpi"><div className="label">De título</div><div className="value">{resumen.titulos}</div></div>
        <div className="kpi"><div className="label">De movimiento</div><div className="value">{resumen.movimiento}</div></div>
        <div className="kpi"><div className="label">Niveles · máscara</div><div className="value">{resumen.niveles} <span className="mono" style={{ fontSize: '.9rem' }}>{parametros.mascara_codigo}</span></div></div>
      </div>

      <div className="cont-barra">
        <input className="input" type="search" placeholder="Buscar por código o nombre…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <span className="cont-niveles" aria-label="Expandir hasta el nivel">
          Nivel:
          {formatoDeMascara(parametros.mascara_codigo).map((_, i) => (
            <button key={i} type="button" className="chip" title={`Expandir hasta el nivel ${i + 1}`}
              onClick={() => setAbiertas(new Set(codigosHastaNivel(arbol, i + 1)))}>{i + 1}</button>
          ))}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbiertas(new Set(codigosConHijos(arbol)))}>Expandir todo</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbiertas(new Set())}>Contraer todo</button>
        <label className="cont-niveles" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} /> Mostrar inactivas
        </label>
        <span className="cont-sep" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNueva({ padre: null })}>+ Nueva cuenta</button>
      </div>

      <div className="cont-plan">
        <div className="card cont-arbol">
          <div className="cont-arbol-cab">
            <span>Cuenta</span><span>Tipo</span><span>Naturaleza</span><span>Clase</span>
          </div>
          <div className="cont-arbol-cuerpo" role="tree" aria-label="Plan de cuentas">
            {filas.length === 0 && <EmptyState icon="🔎" message={buscando ? 'Ninguna cuenta coincide con la búsqueda.' : 'El plan de cuentas está vacío.'} />}
            {filas.map(({ nodo, nivel }) => {
              const c = nodo.cuenta;
              const tieneHijos = nodo.hijos.length > 0;
              const abierta = buscando || abiertas.has(c.codigo);
              return (
                <div key={c.id} role="treeitem" aria-level={nivel} aria-expanded={tieneHijos ? abierta : undefined} aria-selected={c.id === elegida}
                  className={`cont-fila nivel-${nivel}${c.es_movimiento ? '' : ' titulo'}${c.activa ? '' : ' inactiva'}${c.id === elegida ? ' sel' : ''}`}
                  onClick={() => setElegida(c.id)}
                  onDoubleClick={() => tieneHijos && alternar(c.codigo)}>
                  <span className="cont-celda-cuenta" style={{ paddingLeft: `${(nivel - 1) * 1.15}rem` }}>
                    <button type="button" className={`cont-toggle${tieneHijos ? '' : ' vacio'}`} aria-label={abierta ? 'Contraer' : 'Expandir'}
                      onClick={(e) => { e.stopPropagation(); if (tieneHijos && !buscando) alternar(c.codigo); }}>
                      {abierta ? '▾' : '▸'}
                    </button>
                    <span className="cont-codigo">{c.codigo}</span>
                    <span className="cont-nombre" title={c.nombre}>{c.nombre}</span>
                  </span>
                  <span><span className={`cont-etq ${c.es_movimiento ? 'mov' : 'tit'}`}>{c.es_movimiento ? 'Movimiento' : 'Título'}</span></span>
                  <span><span className={`cont-etq ${c.naturaleza === 'deudora' ? 'deu' : 'acr'}`}>{NOMBRE_NATURALEZA[c.naturaleza]}</span></span>
                  <span className="muted" style={{ fontSize: '.8rem' }}>{NOMBRE_CLASE[c.clase]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <FichaCuenta cuenta={cuenta} cuentas={cuentas} parametros={parametros}
          onSubcuenta={(padre) => setNueva({ padre })}
          onAlternarActiva={(c) => void alternarActiva(c)} />
      </div>

      {nueva && (
        <NuevaCuentaModal padre={nueva.padre} cuentas={cuentas} parametros={parametros}
          onCerrar={() => setNueva(null)}
          onGuardar={async (input) => {
            const creada = await crearCuenta(input, actor);
            toast(`Cuenta ${creada.codigo} creada.`, 'success');
            setNueva(null);
            await cargar();
            // Se abre toda la ruta hasta la cuenta nueva, para que se vea en el árbol.
            setAbiertas((prev) => {
              const s = new Set(prev);
              for (let p = codigoPadre(creada.codigo); p; p = codigoPadre(p)) s.add(p);
              return s;
            });
            setElegida(creada.id);
          }} />
      )}
    </>
  );
}

function FichaCuenta({ cuenta, cuentas, parametros, onSubcuenta, onAlternarActiva }: {
  cuenta: ContCuenta | null;
  cuentas: ContCuenta[];
  parametros: ContParametros;
  onSubcuenta: (padre: ContCuenta) => void;
  onAlternarActiva: (c: ContCuenta) => void;
}) {
  if (!cuenta) {
    return (
      <div className="card cont-ficha">
        <EmptyState icon="📒" message="Elige una cuenta del árbol para ver su ficha." />
      </div>
    );
  }
  const ruta: ContCuenta[] = [];
  for (let p = cuenta.padre_id; p; ) {
    const padre = cuentas.find((c) => c.id === p);
    if (!padre) break;
    ruta.unshift(padre);
    p = padre.padre_id;
  }
  const hijas = cuentas.filter((c) => c.padre_id === cuenta.id).length;
  const puedeSubcuenta = !cuenta.es_movimiento && cuenta.activa && siguienteCodigoHijo(cuenta.codigo, cuentas, parametros.mascara_codigo) != null;
  return (
    <div className="card cont-ficha">
      {ruta.length > 0 && <div className="cont-ruta">{ruta.map((r) => <span key={r.id}>{r.nombre}</span>)}</div>}
      <div className="cont-codigo">{cuenta.codigo}</div>
      <h3>{cuenta.nombre}</h3>
      <dl>
        <dt>Tiene sub-cuenta</dt><dd>{cuenta.es_movimiento ? 'No · de movimiento (recibe asientos)' : <span className="cont-titulo-leyenda">Sí · Cuenta Título</span>}</dd>
        <dt>Nivel</dt><dd>{cuenta.nivel} de {parametros.niveles}</dd>
        <dt>Clase</dt><dd>{NOMBRE_CLASE[cuenta.clase]}</dd>
        <dt>Naturaleza</dt><dd>{NOMBRE_NATURALEZA[cuenta.naturaleza]}</dd>
        {!cuenta.es_movimiento && <><dt>Subcuentas</dt><dd>{hijas}</dd></>}
        {cuenta.es_movimiento && <>
          <dt>Centro de costo</dt><dd>{cuenta.exige_centro_costo ? 'Obligatorio' : 'No se pide'}</dd>
          <dt>Auxiliar</dt><dd>{cuenta.exige_auxiliar ? `Obligatorio · ${nombreAuxiliar(cuenta.tipo_auxiliar)}` : 'No se pide'}</dd>
        </>}
        <dt>Moneda</dt><dd>{cuenta.moneda ?? 'Cualquiera'}</dd>
        <dt>Monetaria</dt><dd>{cuenta.es_monetaria ? 'Sí (diferencial cambiario)' : 'No'}</dd>
        {cuenta.rubro && <><dt>Rubro</dt><dd className="mono">{cuenta.rubro}</dd></>}
        <dt>Estado</dt><dd>{cuenta.activa ? 'Activa' : 'Inactiva'}</dd>
      </dl>
      <div className="cont-ficha-acciones">
        {puedeSubcuenta && <button type="button" className="btn btn-primary btn-sm" onClick={() => onSubcuenta(cuenta)}>+ Subcuenta</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAlternarActiva(cuenta)}>{cuenta.activa ? 'Inactivar' : 'Activar'}</button>
      </div>
    </div>
  );
}

function NuevaCuentaModal({ padre, cuentas, parametros, onCerrar, onGuardar }: {
  padre: ContCuenta | null;
  cuentas: ContCuenta[];
  parametros: ContParametros;
  onCerrar: () => void;
  onGuardar: (input: CuentaInput) => Promise<void>;
}) {
  const mascara = parametros.mascara_codigo;
  const codigoInicial = padre ? siguienteCodigoHijo(padre.codigo, cuentas, mascara) ?? '' : '';
  const nivelInicial = codigoInicial ? codigoInicial.split('.').length : 0;
  const [codigo, setCodigo] = useState(codigoInicial);
  const [nombre, setNombre] = useState('');
  const [esMovimiento, setEsMovimiento] = useState(nivelInicial === parametros.niveles);
  const [clase, setClase] = useState<ClaseCuenta>(padre?.clase ?? 'activo');
  const [naturaleza, setNaturaleza] = useState<Naturaleza>(padre?.naturaleza ?? 'deudora');
  const [exigeCentro, setExigeCentro] = useState(false);
  const [exigeAuxiliar, setExigeAuxiliar] = useState(false);
  const [tipoAuxiliar, setTipoAuxiliar] = useState<TipoAuxiliar | ''>('');
  const [moneda, setMoneda] = useState<Moneda | ''>('');
  const [monetaria, setMonetaria] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [intentado, setIntentado] = useState(false);

  // Sin padre, la clase y la naturaleza se proponen por el primer dígito; se pueden cambiar.
  // En el último nivel solo hay cuentas de movimiento: el tipo se ajusta solo.
  function cambiarCodigo(v: string) {
    setCodigo(v);
    if (v.trim().split('.').filter(Boolean).length === parametros.niveles) setEsMovimiento(true);
    if (!padre && v.trim()) {
      const c = claseSugerida(v.trim());
      setClase(c);
      setNaturaleza(naturalezaSugerida(c));
    }
  }

  const input: CuentaInput = {
    codigo, nombre, es_movimiento: esMovimiento, naturaleza, clase,
    exige_centro_costo: esMovimiento && exigeCentro,
    exige_auxiliar: esMovimiento && exigeAuxiliar,
    tipo_auxiliar: esMovimiento && exigeAuxiliar && tipoAuxiliar ? tipoAuxiliar : null,
    moneda: moneda || null,
    es_monetaria: monetaria,
  };
  const errores = validarNuevaCuenta(input, cuentas, mascara);

  async function guardar() {
    setIntentado(true);
    if (errores.length) return;
    setGuardando(true);
    try {
      await onGuardar(input);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear la cuenta.', 'error');
      setGuardando(false);
    }
  }

  return (
    <Modal title={padre ? `Nueva subcuenta de ${padre.codigo} · ${padre.nombre}` : 'Nueva cuenta'} size="sm" onClose={() => !guardando && onCerrar()}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Crear cuenta'}</button>
      </>}>
      <div className="cont-form">
        <label>Código <span className="dim">(máscara {mascara})</span>
          <input className="input mono" value={codigo} onChange={(e) => cambiarCodigo(e.target.value)} inputMode="decimal" autoFocus={!padre} />
        </label>
        <label className="cont-check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={!esMovimiento} onChange={(e) => setEsMovimiento(!e.target.checked)} />
          Tiene sub-cuenta {!esMovimiento && <span className="cont-titulo-leyenda">Cuenta Título</span>}
        </label>
        <label className="full">Descripción
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus={!!padre} />
        </label>
        <label>Clase
          <select className="select" value={clase} onChange={(e) => setClase(e.target.value as ClaseCuenta)}>
            {(Object.keys(NOMBRE_CLASE) as ClaseCuenta[]).map((k) => <option key={k} value={k}>{NOMBRE_CLASE[k]}</option>)}
          </select>
        </label>
        <label>Naturaleza
          <select className="select" value={naturaleza} onChange={(e) => setNaturaleza(e.target.value as Naturaleza)}>
            <option value="deudora">Debe</option>
            <option value="acreedora">Haber</option>
          </select>
        </label>
        <label>Moneda
          <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda | '')}>
            <option value="">Cualquiera</option>
            <option value="VES">VES · Bolívar</option>
            <option value="USD">USD · Dólar</option>
            <option value="USDT">USDT</option>
          </select>
        </label>
        <label className="cont-check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={monetaria} onChange={(e) => setMonetaria(e.target.checked)} /> Monetaria
        </label>
        {esMovimiento && <>
          <label className="cont-check">
            <input type="checkbox" checked={exigeCentro} onChange={(e) => setExigeCentro(e.target.checked)} /> Exige centro de costo
          </label>
          <label className="cont-check">
            <input type="checkbox" checked={exigeAuxiliar} onChange={(e) => setExigeAuxiliar(e.target.checked)} /> Exige auxiliar
          </label>
          {exigeAuxiliar && (
            <label className="full">Tipo de auxiliar
              <select className="select" value={tipoAuxiliar} onChange={(e) => setTipoAuxiliar(e.target.value as TipoAuxiliar | '')}>
                <option value="">Elige…</option>
                {TIPOS_AUXILIAR.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
        </>}
      </div>
      {intentado && errores.length > 0 && (
        <ul className="cont-errores">{errores.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
    </Modal>
  );
}
