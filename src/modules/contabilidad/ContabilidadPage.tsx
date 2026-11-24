/* ============================================================
   MGG · Contabilidad · Página principal (maqueta)

   Módulo inspirado en Galac Contabilidad, sobre DATOS SIMULADOS: no lee
   ni escribe en Supabase (ver contabilidad.repository.ts). Se ve por
   permisos (usuario, 29/10 08:26): ModuleKey 'contabilidad', la ruta dentro
   de <RequireModule module="contabilidad"> y el menú con can('contabilidad').
   Un rol nuevo nace sin este módulo: se habilita en Usuarios → Roles y Permiso.

   Las pestañas siguen la barra de menús de Galac (GALAC-CONTABILIDAD-
   REFERENCIA.md §1.1): Compañía · Comprobante · Cuenta · Balances ·
   Informes · Período · Cerrar Período, más «Auxiliares y Otros» (la
   barra de catálogos de Galac, photo_20, en un menú) e «Integración» (Galac la
   tiene en cada sistema que alimenta a Contabilidad, §8; en MGG los
   módulos son del mismo sistema). NIIF y Conciliación Contable
   quedan para después. Abajo, la barra de estado de Galac: Compañía,
   Período y Usuario.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { date } from '@/shared/lib/format';
import {
  getParametros, listCuentas, listEjercicios, listTiposComprobante, modificarTiposDeParametros,
} from './contabilidad.repository';
import {
  listEmpresasContables, leerEmpresaContableActiva, guardarEmpresaContableActiva,
  EMPRESAS_CONTABLES_DEFECTO, type EmpresaContable
} from './empresasContabilidad';
import { GestionEmpresasContablesModal } from './GestionEmpresasContablesModal';
import { AuxiliaresTab } from './AuxiliaresTab';
import { ComprobantesTab } from './ComprobantesTab';
import { BalancesTab, InformesTab } from './LibrosTab';
import { IntegracionTab } from './IntegracionTab';
import { CerrarPeriodoTab, PeriodoTab } from './PeriodoTab';
import { NOMBRE_NUMERACION } from './logica/comprobantes';
import { PlanCuentasTab } from './PlanCuentasTab';
import { ReporteDinamicoTab } from './ReporteDinamicoTab';
import type { ContCuenta, ContEjercicio, ContParametros, ContTipoComprobante } from './tipos';
import './contabilidad.css';

type Menu = 'comprobante' | 'reporte' | 'integracion' | 'cuenta' | 'balances' | 'informes' | 'periodo' | 'cerrar' | 'auxiliares' | 'compania';

const MENUS: { key: Menu; label: string }[] = [
  { key: 'comprobante', label: 'Comprobantes' },
  { key: 'reporte', label: '📊 Reporte Dinámico' },
  { key: 'integracion', label: 'Por Contabilizar' },
  { key: 'cuenta', label: 'Plan de Cuentas' },
  { key: 'balances', label: 'Estados Financieros' },
  { key: 'informes', label: 'Libros Contables' },
  { key: 'periodo', label: 'Períodos Mensuales' },
  { key: 'cerrar', label: 'Cierre de Ejercicio' },
  { key: 'auxiliares', label: 'Terceros y Centros' },
  { key: 'compania', label: 'Parámetros Empresa' },
];

const CLAVE_MENU = 'gt.contabilidad.menu';

function menuGuardado(): Menu {
  try {
    const v = localStorage.getItem(CLAVE_MENU) || localStorage.getItem('mgg.contabilidad.menu');
    return MENUS.some((m) => m.key === v) ? (v as Menu) : 'comprobante';
  } catch {
    return 'comprobante';
  }
}

export function ContabilidadPage() {
  const { user } = useSession();
  const [empresas, setEmpresas] = useState<EmpresaContable[]>(EMPRESAS_CONTABLES_DEFECTO);
  const [empresaActiva, setEmpresaActiva] = useState<string>(leerEmpresaContableActiva);
  const [menu, setMenu] = useState<Menu>(menuGuardado);
  const [parametros, setParametros] = useState<ContParametros | null>(null);
  const [ejercicio, setEjercicio] = useState<ContEjercicio | null>(null);
  const [abrirGestionEmpresas, setAbrirGestionEmpresas] = useState(false);
  // Sube al cambiar de empresa: las pestañas se vuelven a montar desde cero.
  const [version, setVersion] = useState(0);

  const recargarEmpresas = useCallback(() => {
    void listEmpresasContables().then((lista) => {
      if (lista.length > 0) {
        setEmpresas(lista);
        if (!lista.some((e) => e.clave === empresaActiva)) {
          const def = lista[0].clave;
          setEmpresaActiva(def);
          guardarEmpresaContableActiva(def);
        }
      }
    });
  }, [empresaActiva]);

  useEffect(() => {
    recargarEmpresas();
  }, [recargarEmpresas]);

  const cargar = useCallback(async () => {
    try {
      const [p, ejercicios] = await Promise.all([getParametros(empresaActiva), listEjercicios(empresaActiva)]);
      setParametros(p);
      setEjercicio(ejercicios.find((e) => e.estado === 'abierto') ?? ejercicios[0] ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron leer los parámetros contables.', 'error');
    }
  }, [empresaActiva]);

  useEffect(() => { void cargar(); }, [cargar, version]);

  function elegir(m: Menu) {
    setMenu(m);
    try { localStorage.setItem(CLAVE_MENU, m); } catch { /* sin almacenamiento: no se recuerda el menú */ }
  }

  function cambiarEmpresa(clave: string) {
    setEmpresaActiva(clave);
    guardarEmpresaContableActiva(clave);
    setVersion((v) => v + 1);
  }

  const empresaSelObj = empresas.find((e) => e.clave === empresaActiva) ?? empresas[0];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📒 Contabilidad</h1>
          <p className="muted">Moneda funcional {parametros?.moneda_funcional ?? '…'} · referencia {parametros?.moneda_referencia ?? '…'} · cada asiento en las dos monedas</p>
        </div>
        <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
            <span className="muted hint" style={{ fontWeight: 600 }}>🏢 Empresa:</span>
            <select
              className="input"
              value={empresaActiva}
              onChange={(e) => cambiarEmpresa(e.target.value)}
              aria-label="Empresa Contable"
              style={{ minWidth: 220, fontWeight: 500 }}
            >
              {empresas.map((e) => (
                <option key={e.clave} value={e.clave}>
                  {e.nombre} ({e.clave})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAbrirGestionEmpresas(true)}
            title="Administrar el catálogo de empresas jurídicas del grupo (crear, editar RIF y estado)"
          >
            ⚙ Gestionar Empresas
          </button>
        </div>
      </div>

      <nav className="view-toggle cont-menus" role="tablist" aria-label="Menús de Contabilidad">
        {MENUS.map((m) => (
          <button key={m.key} role="tab" aria-selected={menu === m.key} className={menu === m.key ? 'active' : ''} onClick={() => elegir(m.key)}>
            {m.label}
          </button>
        ))}
      </nav>

      <div className="cont-estado" aria-label="Barra de estado">
        <span>Compañía: <strong>{parametros ? (empresaSelObj?.nombre ?? parametros.empresa_nombre) : '…'}</strong>{parametros && empresaSelObj?.rif ? ` (${empresaSelObj.rif})` : ''}</span>
        <span>Período: <strong>{ejercicio ? `${date(ejercicio.fecha_inicio)} - ${date(ejercicio.fecha_fin)}` : '…'}</strong></span>
        <span>Usuario: <strong>{user?.email ?? '—'}</strong></span>
      </div>

      {!parametros && <p className="muted">Cargando…</p>}
      {parametros && <>
        {menu === 'comprobante' && <ComprobantesTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} />}
        {menu === 'reporte' && <ReporteDinamicoTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} />}
        {menu === 'integracion' && <IntegracionTab key={`${version}-${empresaActiva}`} empresaClave={empresaActiva} />}
        {menu === 'cuenta' && <PlanCuentasTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} />}
        {menu === 'balances' && <BalancesTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} />}
        {menu === 'informes' && <InformesTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} />}
        {menu === 'periodo' && <PeriodoTab key={`${version}-${empresaActiva}`} empresaClave={empresaActiva} />}
        {menu === 'cerrar' && <CerrarPeriodoTab key={`${version}-${empresaActiva}`} empresaClave={empresaActiva} />}
        {menu === 'auxiliares' && <AuxiliaresTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} />}
        {menu === 'compania' && <CompaniaTab key={`${version}-${empresaActiva}`} parametros={parametros} empresaClave={empresaActiva} empresaNombre={empresaSelObj?.nombre} empresaRif={empresaSelObj?.rif} onCambio={cargar} />}
      </>}

      {abrirGestionEmpresas && (
        <GestionEmpresasContablesModal
          onClose={() => setAbrirGestionEmpresas(false)}
          onActualizado={() => {
            recargarEmpresas();
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function CompaniaTab({
  parametros,
  empresaClave,
  empresaNombre,
  empresaRif,
  onCambio,
}: {
  parametros: ContParametros;
  empresaClave?: string;
  empresaNombre?: string;
  empresaRif?: string | null;
  onCambio: () => Promise<void>;
}) {
  const [datos, setDatos] = useState<{ cuentas: ContCuenta[]; tipos: ContTipoComprobante[] } | null>(null);

  useEffect(() => {
    Promise.all([listCuentas(empresaClave), listTiposComprobante()])
      .then(([cuentas, tipos]) => setDatos({ cuentas, tipos }))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudieron leer los parámetros.', 'error'));
  }, [parametros, empresaClave]);

  if (!datos) return <p className="muted">Cargando…</p>;
  const cuenta = (id: string | null) => {
    const c = datos.cuentas.find((x) => x.id === id);
    return c ? <><span className="mono">{c.codigo}</span> · {c.nombre}</> : <span className="dim">Sin asignar</span>;
  };
  const p = parametros;
  return (
    <div className="cont-grid-2">
      <div className="card">
        <div className="card-title">Compañía · Parámetros Contabilidad</div>
        <div className="table-wrap">
          <table className="table cont-tabla-param">
            <tbody>
              <tr><td>Empresa activa</td><td><strong>{empresaNombre ?? p.empresa_nombre}</strong> ({empresaClave ?? 'MGG'})</td></tr>
              <tr><td>RIF Fiscal</td><td><span className="mono">{empresaRif ?? 'J-50221930-7'}</span></td></tr>
              <tr><td>Máscara del código</td><td className="mono">{p.mascara_codigo} ({p.niveles} niveles)</td></tr>
              <tr><td>Moneda funcional</td><td>{p.moneda_funcional} (VEN-NIF)</td></tr>
              <tr><td>Moneda de referencia</td><td>{p.moneda_referencia}</td></tr>
              <tr><td>Fuente de la tasa</td><td>{p.fuente_tasa.toUpperCase()}</td></tr>
              <tr><td>Tolerancia de cuadre</td><td>{p.tolerancia_cuadre.toFixed(2)}</td></tr>
              <tr><td>Tipo de numeración</td><td>{NOMBRE_NUMERACION[p.tipo_numeracion]}</td></tr>
              <tr><td>Comprobantes descuadrados</td><td>{p.permite_descuadrados ? 'Se permite grabarlos (no afectan saldos)' : 'No se permite grabarlos'}</td></tr>
              <tr><td>Fecha futura</td><td>{p.permite_fecha_futura ? 'Se permite' : 'No se permite'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Cuentas del cierre y del diferencial cambiario</div>
        <div className="table-wrap">
          <table className="table cont-tabla-param">
            <tbody>
              <tr><td>Resultado del ejercicio</td><td>{cuenta(p.cuenta_resultado_ejercicio_id)}</td></tr>
              <tr><td>Utilidades acumuladas</td><td>{cuenta(p.cuenta_utilidades_retenidas_id)}</td></tr>
              <tr><td>Ganancia en cambio</td><td>{cuenta(p.cuenta_dif_cambio_ganancia_id)}</td></tr>
              <tr><td>Pérdida en cambio</td><td>{cuenta(p.cuenta_dif_cambio_perdida_id)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <TiposDeProcesoCard parametros={p} tipos={datos.tipos} empresaClave={empresaClave} onCambio={onCambio} />
    </div>
  );
}

type CampoTipo = 'tipo_comprobante_defecto_id' | 'tipo_diferencial_id' | 'tipo_cierre_id' | 'tipo_apertura_id';

/** Los procesos que numeran con un tipo elegido en Parámetros (DDL v0.8, Master 29/10 05:26). */
const PROCESOS: Array<[CampoTipo, string]> = [
  ['tipo_comprobante_defecto_id', 'Carga manual (por omisión)'],
  ['tipo_diferencial_id', 'Diferencial cambiario del cierre de mes'],
  ['tipo_cierre_id', 'Cierre del ejercicio'],
  ['tipo_apertura_id', 'Apertura del ejercicio siguiente'],
];

/**
 * Parámetros · tipos de comprobante de los procesos. Se eligen entre los activos; el que ya está
 * elegido se sigue ofreciendo aunque se haya inactivado, para que se vea y se cambie.
 */
function TiposDeProcesoCard({ parametros, tipos, empresaClave, onCambio }: {
  parametros: ContParametros; tipos: ContTipoComprobante[]; empresaClave?: string; onCambio: () => Promise<void>;
}) {
  const inicial = () => Object.fromEntries(PROCESOS.map(([k]) => [k, parametros[k] ?? ''])) as Record<CampoTipo, string>;
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState<Record<CampoTipo, string>>(inicial);
  const [guardando, setGuardando] = useState(false);

  const nombre = (id: string | null) => {
    const t = tipos.find((x) => x.id === id);
    if (!t) return <span className="cont-nota-alerta">Sin asignar</span>;
    return <><span className="mono">{t.codigo}</span> · {t.nombre}{!t.activo && <span className="cont-nota-alerta"> (inactivo)</span>}</>;
  };

  async function guardar() {
    setGuardando(true);
    try {
      await modificarTiposDeParametros({
        tipo_comprobante_defecto_id: valores.tipo_comprobante_defecto_id || null,
        tipo_diferencial_id: valores.tipo_diferencial_id || null,
        tipo_cierre_id: valores.tipo_cierre_id || null,
        tipo_apertura_id: valores.tipo_apertura_id || null,
      }, undefined, empresaClave);
      await onCambio();
      setEditando(false);
      toast('Parámetros grabados.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron grabar los parámetros.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title cont-card-titulo">
        <span>Tipos de comprobante de los procesos</span>
        {!editando && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setValores(inicial()); setEditando(true); }}>Modificar</button>}
      </div>
      <div className="table-wrap">
        <table className="table cont-tabla-param">
          <tbody>
            {PROCESOS.map(([campo, etiqueta]) => (
              <tr key={campo}>
                <td>{etiqueta}</td>
                <td>
                  {editando ? (
                    <select className="select" value={valores[campo]} aria-label={etiqueta}
                      onChange={(e) => setValores({ ...valores, [campo]: e.target.value })}>
                      <option value="">Elija…</option>
                      {tipos.filter((t) => t.activo || t.id === parametros[campo]).map((t) => (
                        <option key={t.id} value={t.id}>{t.codigo} · {t.nombre}{t.activo ? '' : ' (inactivo)'}</option>
                      ))}
                    </select>
                  ) : nombre(parametros[campo])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && (
        <div className="cont-ficha-acciones" style={{ marginTop: '.75rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={guardando} onClick={() => setEditando(false)}>Cancelar</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Grabando…' : 'Grabar'}</button>
        </div>
      )}
    </div>
  );
}
