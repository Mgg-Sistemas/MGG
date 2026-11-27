import { skuVisible } from '@/modules/pedidos/nombresGenericos';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { notify } from '@/shared/lib/notify';
import { money, num, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';
import {
  listRetencionesPendientes, listRetencionesHechas, listOrdenesPorIds, finalizarRetencion,
  urlRetencion, comprobantesDeOrden, labelRetencionModo, labelRetencionMomento,
  TIPOS_RETENCION, type RetencionItem, type TipoRetencion,
} from './retenciones.repository';
import { cargarSoportesFisicos, guardarSoporteFisico, type SoportesFisicosMap } from './soporteFisico.repository';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import { badgeEstatusKanban, badgeImpuestoOrden } from './retencionesKanban';
import { urlSoporteCola, type SoporteCola } from './soporteCola';
import { estadoRetencionDeOrden, badgeEstadoRetencion, textoPago } from './estadoRetencion';
import { montosPagadosDeOrdenes, type MontoPagado } from './pagoOrden.repository';
import type { Orden } from '@/shared/lib/types';
import { LibroFiscalView, ConfiguracionFiscalModal, RegistrarRetencionModal, type FocoLibro, type SemillaRetencion } from '@/modules/libroFiscal/LibroFiscal';
import { getConfigRetencion, listRetenciones, tipoAGt, tipoDeGt } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { listImpuestos } from '@/modules/libroFiscal/impuestos.repository';
import { soloImpuestosActivos, filtrarActivos, type ImpuestosActivos, type FichaRetencionVista } from './impuestosVista';
import { impuestosQuePractica, noAplicaDisponible, noAplicaPorOrden } from '@/modules/libroFiscal/noAplica.repository';
import { NoAplicaModal, type ObjetivoNoAplica } from '@/modules/libroFiscal/NoAplicaModal';
import { PeriodosRetencion } from '@/modules/libroFiscal/PeriodosRetencion';
import { AuditoriaRetenciones } from '@/modules/libroFiscal/AuditoriaRetenciones';
import { RegistrarFacturaRetencion, type SemillaFactura } from '@/modules/libroFiscal/RegistrarFacturaRetencion';
import { semillaFacturaDesdeBuzon, semillaFacturaDesdeOrden, semillaFacturaDesdeOrdenArchivo } from '@/modules/libroFiscal/semillasRetencion';
import { cargarSemillaDeFacturaOrigen, facturasPorRegistrar, cargarDatosDirectosPorIds, type FacturaDeOrigen, type DatosDirectoExtra } from '@/modules/libroFiscal/documentosOrigen.repository';
import { ColaPorHacerView } from './ColaPorHacerView';
import { construirColaPorHacer, type ItemColaPorHacer } from './colaPorHacer';
import { v3Disponible } from '@/modules/libroFiscal/periodosRetencion.repository';
import { buzonDisponible } from '@/modules/libroFiscal/disponibilidad';
import { CONFIG_RETENCION_DEFECTO, puedePracticar, type ConfigRetencion, type TipoImpuesto } from '@/modules/libroFiscal/retencionesCalculo';
import { hoyVE } from '@/modules/tesoreria/tasas.repository';
import { aplicarFiltros, conteoOpcion, paginar, type FiltroLista } from '@/modules/libroFiscal/listas';
import { BarraLista, Paginador, type ControlFiltro } from '@/modules/libroFiscal/ListaControles';
import { ReportesView } from './ReportesView';
import { BuzonFacturasExternasView } from './BuzonFacturasExternasView';
import { listFacturasBuzon, ultimaCreacionBuzon, actualizarEstatusFacturaBuzon, type FacturaBuzon } from './facturasBuzon.repository';
import { lanzarAvisoFactura } from './notificacionesDispositivo';
// Multi-empresa (andamiaje F-ME2): empresa actual arriba del módulo. Oculto y
// sin efecto mientras la base no traiga la empresa en las retenciones.
import { useEmpresaActual, esEmpresaGt } from './empresaActual';
import { rifValido } from '@/shared/lib/rif';
import { list as listProveedores, insert as insertProveedor } from '@/modules/proveedores/proveedores.repository';
import { EmpresaActualSelector } from './EmpresaActualSelector';
import { EditorFichasFiscalesEmpresa } from './EditorFichasFiscalesEmpresa';
import { Link } from 'react-router-dom';
import '@/modules/libroFiscal/libroFiscal.css';
import '@/modules/libroFiscal/libroFiscalV8.css';
import { norm } from '@/shared/lib/texto';

type Vista = 'pendientes' | 'hechas' | 'libro' | 'agrupada' | 'periodos' | 'reportes' | 'auditoria' | 'buzon';

// C-g: marca por-navegador de hasta dónde se «vio» el buzón (el sello de creación de la
// factura más nueva ya vista). El badge cuenta las creadas después de esa marca; al abrir
// el buzón se actualiza y el badge se limpia. Es una comodidad por usuario, no dato fiscal.
const CLAVE_BUZON_VISTO = 'gt.retenciones.buzon.visto';
function leerBuzonVisto(): string | null {
  try { return localStorage.getItem(CLAVE_BUZON_VISTO); } catch { return null; }
}
function guardarBuzonVisto(v: string): void {
  try { localStorage.setItem(CLAVE_BUZON_VISTO, v); } catch { /* sin localStorage: el badge es best-effort */ }
}

export function RetencionesPage() {
  const { user } = useSession();
  const { can, appUser, puedeVista, isAdmin } = usePermissions();
  const canWrite = can('retenciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [vista, setVista] = useState<Vista>('agrupada');
  const [parametros, setParametros] = useState(false);
  const [configFiscal, setConfigFiscal] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [pendientes, setPendientes] = useState<RetencionItem[]>([]);
  const [hechas, setHechas] = useState<RetencionItem[]>([]);
  const [facturasCompras, setFacturasCompras] = useState<FacturaDeOrigen[]>([]);
  const [facturasBuzon, setFacturasBuzon] = useState<FacturaBuzon[]>([]);
  const [registradas, setRegistradas] = useState<Registradas>(new Map());
  const [pagosOc, setPagosOc] = useState<Map<string, MontoPagado>>(new Map());
  const [soportesFisicos, setSoportesFisicos] = useState<SoportesFisicosMap>({});
  const [usuariosDirectorio, setUsuariosDirectorio] = useState<{ id?: string; email: string; nombre?: string }[]>([]);
  const [todasOrdenes, setTodasOrdenes] = useState<RetencionItem[]>([]);
  const [directosExtra, setDirectosExtra] = useState<Map<string, DatosDirectoExtra>>(new Map());

  useEffect(() => {
    listUsuarios()
      .then((us) => setUsuariosDirectorio(us.map((u) => ({ id: u.id, email: u.email, nombre: u.nombre }))))
      .catch(() => {});
  }, []);
  const [conV3, setConV3] = useState(false);
  useEffect(() => { v3Disponible().then(setConV3).catch(() => setConV3(false)); }, []);
  // R11: el buzón de facturas del teléfono, solo con sus tablas en la base.
  const [conBuzon, setConBuzon] = useState(false);
  useEffect(() => { buzonDisponible().then(setConBuzon).catch(() => setConBuzon(false)); }, []);
  // C4a (D6): el buzón se muestra si está en la base Y activado en Parámetros (config.buzonActivo).
  // Multi-empresa (andamiaje): la empresa actual del módulo. En single-empresa
  // queda inerte (multiempresa=false) y el selector no se muestra.
  const { multiempresa, empresas, empresaId, empresaActual, setEmpresaId } = useEmpresaActual(configFiscal.multiempresaActivo !== false);
  // La ficha fiscal a usar para config/régimen: solo para una empresa NO-GT. GT (o
  // single-empresa) → null, y el libro/registro/reportes usan la config global (R1), como hoy.
  const empresaFicha = multiempresa && empresaActual && !esEmpresaGt(empresaActual) ? empresaActual : null;
  // «Por realizar» nace del flujo de compras de Golden Touch; una empresa NO-GT
  // (empresaFicha no-null) no tiene ese flujo. esGt=true para GT o single-empresa.
  const esGt = empresaFicha == null;

  const buzonVisible = conBuzon && configFiscal.buzonActivo !== false;
  // C-g: contador PERSISTENTE de facturas nuevas en el buzón, segregado por la empresa activa
  const [buzonNuevas, setBuzonNuevas] = useState(0);
  const buzonVistoRef = useRef<string | null>(leerBuzonVisto());
  const buzonUltimaRef = useRef<string>('');
  const prevUltimaBuzonAlertaRef = useRef<string | null>(null);
  const refrescarBuzonNuevas = useCallback(async (emitirAlerta = false) => {
    try {
      const facs = await listFacturasBuzon();
      // Filtrar estrictamente por la empresa seleccionada: no atribuir facturas de GT a MTO ni viceversa
      const facsEmpresa = multiempresa && empresaId
        ? facs.filter((f) => f.empresaId === empresaId || (empresaId === 'empresa-golden-touch' && !f.empresaId))
        : facs;
      const ultima = ultimaCreacionBuzon(facsEmpresa);
      buzonUltimaRef.current = ultima;
      // Primera vez (sin marca): se toma lo actual como ya visto, el badge no alarma de golpe.
      if (buzonVistoRef.current === null) { buzonVistoRef.current = ultima; guardarBuzonVisto(ultima); }
      const visto = buzonVistoRef.current ?? '';
      setBuzonNuevas(facsEmpresa.filter((f) => f.createdAt > visto).length);

      // Si entró una factura nueva por realtime: alertar con sonido, vibración y push
      if (emitirAlerta && prevUltimaBuzonAlertaRef.current !== null && ultima > prevUltimaBuzonAlertaRef.current && facsEmpresa.length > 0) {
        const facReciente = facsEmpresa[0];
        lanzarAvisoFactura(facReciente, { conSonido: true });
        notify(`🧾 Factura recibida de ${facReciente.proveedorNombre || 'Proveedor'}: ${facReciente.facturaNumero || 'S/N'}`, 'info', {
          push: true,
          modulo: 'retenciones',
          link: '/retenciones',
          detail: `Monto: ${facReciente.moneda === 'USD' ? '$' : 'Bs'} ${Number(facReciente.montoTotal || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
        });
      }
      prevUltimaBuzonAlertaRef.current = ultima;
    } catch { /* el badge es best-effort: sin lectura, queda como estaba */ }
  }, [multiempresa, empresaId]);
  useEffect(() => { if (conBuzon) void refrescarBuzonNuevas(false); }, [conBuzon, refrescarBuzonNuevas, empresaId]);
  // Al abrir el buzón (teléfono o vista PC) se marca lo visto y el badge se limpia.
  const marcarBuzonVisto = useCallback(() => {
    if (buzonUltimaRef.current) { buzonVistoRef.current = buzonUltimaRef.current; guardarBuzonVisto(buzonUltimaRef.current); }
    setBuzonNuevas(0);
  }, []);
  const [loading, setLoading] = useState(true);
  // El detalle puede venir de la cola «Por hacer»: ahí el soporte no es siempre
  // factura_recepcion_path (puede ser del Buzón o un archivo subido por Compras).
  const [sel, setSel] = useState<(RetencionItem & { soporteCola?: SoporteCola }) | null>(null);
  const [registrar, setRegistrar] = useState<SemillaRetencion | null>(null);
  // P03: registrar el documento fiscal desde un archivo de factura que subió Compras.
  const [registrarFactura, setRegistrarFactura] = useState<SemillaFactura | null>(null);
  // «Ver en libro» de la cola: foco contextual para que el libro abra filtrado
  // por esa factura (y, si está pendiente, por el listado de facturas por registrar).
  const [focoLibro, setFocoLibro] = useState<FocoLibro | null>(null);
  // D: la factura del Buzón que se está registrando (para marcarla 'retenida' al terminar y
  // registrar bajo SU empresa). Reusa el MISMO registro; no se duplica ningún formulario.
  const [buzonEnRegistro, setBuzonEnRegistro] = useState<FacturaBuzon | null>(null);
  // D48: «no aplica» por impuesto, sin número de comprobante (con R10 en la base).
  const [conNoAplica, setConNoAplica] = useState(false);
  useEffect(() => { noAplicaDisponible().then(setConNoAplica).catch(() => setConNoAplica(false)); }, []);
  const [noAplica, setNoAplica] = useState<ObjetivoNoAplica | null>(null);
  // D2: «Por realizar» pide solo los impuestos que la empresa practica, leídos de la
  // ÚNICA fuente (la RPC retencion_empresa_practica, por empresa cuando la base lo trae).
  // La base enforcea el régimen a la fecha de cada factura; el tablero resuelve a hoy.
  const [practica, setPractica] = useState<Set<ImpuestoPendiente> | null>(null);
  // La pestaña Períodos necesita también IGTF y ESTADAL (el tablero solo mira iva/islr/municipal).
  // Misma llamada a la RPC: se derivan los dos conjuntos sin duplicar consultas.
  const [practicaClaves, setPracticaClaves] = useState<Set<string> | null>(null);
  const cargarPractica = useCallback(() => {
    const claves: string[] = [
      ...IMPUESTOS_PENDIENTES.map((t) => tipoAGt(t.key)),
      'IGTF',
      'ESTADAL',
    ];
    impuestosQuePractica(claves, hoyVE(), empresaId ?? 'empresa-golden-touch')
      .then((s) => {
        const esEspecial = esGt ? (configFiscal.esContribuyenteEspecial === true) : Boolean(empresaActual?.esContribuyenteEspecial);
        if (s && !esEspecial) {
          s.delete('IVA');
        }
        setPracticaClaves(s);
        setPractica(s ? new Set(IMPUESTOS_PENDIENTES.map((t) => t.key).filter((k) => s.has(tipoAGt(k)))) : null);
      })
      .catch(() => { setPracticaClaves(null); setPractica(null); });
  }, [empresaId, esGt, configFiscal.esContribuyenteEspecial, empresaActual?.esContribuyenteEspecial]);
  useEffect(() => { cargarPractica(); }, [cargarPractica]);

  // Las vistas (tarjetas, filtros y columnas por impuesto) salen de los impuestos
  // ACTIVOS de la tabla, no de una lista fija: un impuesto deshabilitado desaparece.
  // Si no se puede leer o no hay datos, se cae a la lista fija (no se rompe la pantalla).
  const [impuestosActivos, setImpuestosActivos] = useState<ImpuestosActivos | null>(null);
  // La ficha de cada impuesto (direcciones que admite, formato de su serie) para los modales de registro.
  const [fichasImpuesto, setFichasImpuesto] = useState<Map<TipoImpuesto, FichaRetencionVista> | null>(null);
  const cargarImpuestosActivos = useCallback(() => {
    listImpuestos()
      .then((xs) => {
        setFichasImpuesto(new Map(xs.map((i) => [tipoDeGt(i.clave), {
          admitePracticada: i.admitePracticada, admiteSufrida: i.admiteSufrida, serieFormato: i.serieFormato, numera: i.numera,
        }] as const)));
        const activos = xs.filter((i) => i.activo !== false);
        if (!activos.length) { setImpuestosActivos(null); return; }
        setImpuestosActivos({
          claves: new Set(activos.map((i) => tipoDeGt(i.clave))),
          orden: new Map(activos.map((i) => [tipoDeGt(i.clave), i.orden] as const)),
        });
      })
      .catch(() => { setImpuestosActivos(null); setFichasImpuesto(null); });
  }, []);
  useEffect(() => { cargarImpuestosActivos(); }, [cargarImpuestosActivos]);


  // Búsqueda, filtros, orden y página de las dos listas de OC (Por realizar y Realizadas).
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [fTipo, setFTipo] = useState<'' | TipoRetencion>('');
  const [fTesoreria, setFTesoreria] = useState('');
  const [fTexto, setFTexto] = useState('');
  const [orden, setOrden] = useState<'reciente' | 'antiguo' | 'proveedor'>('reciente');
  const [pag, setPag] = useState(1);
  const [tam, setTam] = useState(25);
  const limpiarFiltros = () => { setFDesde(''); setFHasta(''); setFTipo(''); setFTesoreria(''); setFTexto(''); };
  useEffect(() => { setPag(1); }, [vista, fDesde, fHasta, fTipo, fTesoreria, fTexto, orden]);

  const reload = useCallback(async () => {
    const cfg = await getConfigRetencion().catch(() => CONFIG_RETENCION_DEFECTO);
    setConfigFiscal(cfg);
    const [p, h, libro, fc, fb, sf] = await Promise.all([
      listRetencionesPendientes(cfg.estadosKanbanRetencion).catch(() => [] as RetencionItem[]),
      listRetencionesHechas().catch(() => [] as RetencionItem[]),
      listRetenciones({ direccion: 'practicada' }).catch(() => []),
      facturasPorRegistrar().catch(() => [] as FacturaDeOrigen[]),
      listFacturasBuzon().catch(() => [] as FacturaBuzon[]),
      cargarSoportesFisicos().catch(() => ({} as SoportesFisicosMap)),
    ]);
    const reg: Registradas = new Map();
    for (const r of libro) {
      if (!r.docId) continue;
      const s = reg.get(r.docId) ?? new Set<TipoImpuesto>();
      s.add(r.tipo);
      reg.set(r.docId, s);
    }

    // Mapa unificado de órdenes para resolver adjuntos que no están en pendientes
    const ordenesMap = new Map<string, RetencionItem>();
    for (const item of [...p, ...h]) {
      if (item?.orden?.id) ordenesMap.set(item.orden.id, item);
    }

    const missingOcIds = Array.from(new Set(
      fc.filter((f) => f.origen.tipo === 'oc' && !ordenesMap.has(f.origen.id)).map((f) => f.origen.id),
    ));

    const [ordenesExtra, directos] = await Promise.all([
      missingOcIds.length > 0 ? listOrdenesPorIds(missingOcIds).catch(() => [] as RetencionItem[]) : Promise.resolve([] as RetencionItem[]),
      cargarDatosDirectosPorIds(fc).catch(() => new Map<string, DatosDirectoExtra>()),
    ]);

    for (const item of ordenesExtra) {
      if (item?.orden?.id) ordenesMap.set(item.orden.id, item);
    }

    const todas = Array.from(ordenesMap.values());

    // Lo marcado «no aplica» cuenta como resuelto para ese impuesto.
    const na = await noAplicaPorOrden(todas.map((i) => i.orden.id)).catch(() => new Map<string, Set<TipoImpuesto>>());
    for (const [id, tipos] of na) {
      const s = reg.get(id) ?? new Set<TipoImpuesto>();
      for (const t of tipos) s.add(t);
      reg.set(id, s);
    }
    setPendientes(p); setHechas(h); setRegistradas(reg);
    setFacturasCompras(fc); setFacturasBuzon(fb);
    setSoportesFisicos(sf);
    setTodasOrdenes(todas);
    setDirectosExtra(directos);
    // Monto neto con que Tesorería pagó las OC ya pagadas (lectura cruzada, solo lectura).
    const idsPagadas = [...p, ...h].filter((i) => i.orden.retencion_pagada).map((i) => i.orden.id);
    setPagosOc(await montosPagadosDeOrdenes(idsPagadas).catch(() => new Map<string, MontoPagado>()));
  }, []);

  const cambiarSoporteFisico = useCallback(async (
    item: ItemColaPorHacer,
    recibido: boolean,
    entregadoPor: string,
    tipo?: 'original' | 'copia' | null,
  ) => {
    const ordenId = item.rawOrdenItem?.orden.id || (item.rawFacturaOrigen?.origen.tipo === 'oc' ? item.rawFacturaOrigen.origen.id : null);
    const tipoFinal = tipo !== undefined ? tipo : (recibido ? 'original' : null);
    // Actualización optimista inmediata en la UI
    setSoportesFisicos((prev) => ({
      ...prev,
      [item.id]: {
        recibido,
        tipo: tipoFinal,
        entregadoPor: entregadoPor.trim(),
        recibidoEn: recibido ? (prev[item.id]?.recibidoEn || new Date().toISOString()) : undefined,
        recibidoPor: recibido ? (prev[item.id]?.recibidoPor || actor) : undefined,
        actualizadoEn: new Date().toISOString(),
      },
      ...(ordenId ? {
        [`orden-${ordenId}`]: {
          recibido,
          tipo: tipoFinal,
          entregadoPor: entregadoPor.trim(),
          recibidoEn: recibido ? (prev[`orden-${ordenId}`]?.recibidoEn || new Date().toISOString()) : undefined,
          recibidoPor: recibido ? (prev[`orden-${ordenId}`]?.recibidoPor || actor) : undefined,
          actualizadoEn: new Date().toISOString(),
        },
      } : {}),
    }));
    try {
      const nuevo = await guardarSoporteFisico(item.id, {
        recibido,
        tipo: tipoFinal,
        entregadoPor,
        usuarioEmail: actor,
      });
      setSoportesFisicos(nuevo);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar el soporte físico', 'error');
    }
  }, [actor]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // Realtime multiusuario: lo que registra otro (o paga Tesorería o cambia en Régimen/Parámetros) se refleja al instante.
  // C-g: se suma `retencion_facturas_externas` (solo con el buzón en la base) para que una
  // factura cargada desde el teléfono refresque el contador de nuevas aunque la vista esté cerrada.
  useRealtime(['ordenes', 'retenciones', 'retencion_decisiones', 'retencion_agente_condiciones', 'parametros', 'retencion_impuestos',
    'adjuntos_directos', 'retencion_documento_origenes',
    ...(conBuzon ? ['retencion_facturas_externas'] : [])], () => {
    cargarImpuestosActivos();
    void reload();
    cargarPractica();
    if (conBuzon) void refrescarBuzonNuevas(true);
  });

  // Cola unificada «Por hacer»: facturas con archivo adjunto listas para retener, por empresa.
  const colaPorHacer = useMemo(
    () => construirColaPorHacer({
      empresaId,
      esGt,
      facturasBuzon,
      facturasCompras,
      pendientesOrdenes: pendientes,
      todasOrdenes,
      directosExtra,
      soportesFisicos,
      registradas,
      practica,
      configFiscal,
      impuestosActivos: impuestosActivos?.claves ?? null,
    }),
    [empresaId, esGt, facturasBuzon, facturasCompras, pendientes, todasOrdenes, directosExtra, soportesFisicos, registradas, practica, configFiscal, impuestosActivos],
  );

  // La semilla del registro sale del archivo: su orden y, si es una OC que ya está en la lista, proveedor y montos.
  async function abrirDesdeFactura(f: FacturaDeOrigen) {
    const item = f.origen.tipo === 'oc' ? todasOrdenes.find((i) => i.orden.id === f.origen.id) : undefined;
    if (item) {
      setRegistrarFactura(semillaFacturaDesdeOrdenArchivo(f, item));
      return;
    }
    const semilla = await cargarSemillaDeFacturaOrigen(f);
    setRegistrarFactura(semilla);
  }

  // D (puente Buzón → Libro): el rol retención (vista PC) toma una factura cargada en el
  // buzón y abre el MISMO registro, sembrado con sus datos y BAJO la empresa de la factura
  // (cada empresa retiene en su libro). La ficha sale de las empresas ya cargadas; GT → null.
  function fichaDeBuzon(empId: string) {
    const e = empresas.find((x) => x.id === empId);
    return e && !esEmpresaGt(e) ? e : null;
  }
  async function abrirDesdeBuzon(fac: FacturaBuzon) {
    // El registro exige un proveedor registrado: lo buscamos por RIF. Si existe, se
    // selecciona; si no existe y el RIF es válido, se CREA (reusa proveedores.insert) para
    // poder retener. Con RIF inválido/vacío se abre sin proveedor y el registro lo pide.
    const rif = (fac.proveedorRif ?? '').trim();
    let contraparteId: string | undefined;
    if (rif) {
      const lista = await listProveedores().catch(() => [] as Awaited<ReturnType<typeof listProveedores>>);
      const existe = lista.find((p) => (p.rif ?? '').trim().toUpperCase() === rif.toUpperCase());
      if (existe) {
        contraparteId = existe.id;
      } else if (rifValido(rif)) {
        const nuevo = await insertProveedor({ rif, razon_social: (fac.proveedorNombre || rif).trim(), categorias: [], estado: 'activo', origen: 'nacional' }).catch(() => null);
        contraparteId = nuevo?.id;
      }
    }
    setBuzonEnRegistro(fac);
    setRegistrarFactura(semillaFacturaDesdeBuzon(fac, contraparteId));
  }

  // «Ver en libro» deja de ser un enlace genérico: lleva la factura de la fila.
  function abrirEnLibro(item: ItemColaPorHacer) {
    const desde = item.fecha && /^\d{4}-\d{2}/.test(item.fecha) ? `${item.fecha.slice(0, 7)}-01` : '';
    const origenId = item.rawFacturaOrigen?.origen?.id ?? item.rawOrdenItem?.orden?.id ?? null;
    const etiqueta = [item.codigo, item.proveedorRif].filter(Boolean).join(' · ') || item.proveedorNombre;
    setFocoLibro({
      texto: item.codigo || item.proveedorRif || item.proveedorNombre,
      desde,
      origenIds: origenId ? [origenId] : [],
      titulo: etiqueta,
    });
    setVista('agrupada');
  }

  const proveedorIdsPendientes = useMemo(
    () => new Set(colaPorHacer.map((i) => i.rawOrdenItem?.orden.proveedor_id).filter(Boolean) as string[]),
    [colaPorHacer],
  );

  // La lista de la vista: búsqueda y fechas (las de siempre), filtros con su conteo y orden.
  const baseLista = useMemo(() => {
    const txt = norm(fTexto);
    const xs = vista === 'pendientes' ? pendientes : hechas;
    return xs.filter(({ orden: o, proveedorNombre }) => {
      if (vista === 'hechas') {
        const fin = (o.retencion_finalizada_en ?? '').slice(0, 10);
        if (fDesde && fin && fin < fDesde) return false;
        if (fHasta && fin && fin > fHasta) return false;
        if (fDesde && !fin) return false;
      }
      if (txt) {
        const hay = norm(`${o.oc_codigo ?? ''} ${o.codigo} ${proveedorNombre} ${o.numero_administracion ?? ''}`);
        if (!hay.includes(txt)) return false;
      }
      return true;
    });
  }, [vista, pendientes, hechas, fDesde, fHasta, fTexto]);

  const filtrosLista = useMemo<FiltroLista<RetencionItem>[]>(() => [
    {
      campo: 'tesoreria', etiqueta: 'Tesorería', valor: fTesoreria,
      opciones: [['pagada', 'Pagada'], ['por_pagar', 'Por pagar']],
      pasa: ({ orden: o }, v) => (v === 'pagada' ? !!o.retencion_pagada : !o.retencion_pagada),
    },
    ...(vista === 'hechas' ? [{
      campo: 'tipo', etiqueta: 'Tipo de retención', valor: fTipo,
      opciones: soloImpuestosActivos(TIPOS_RETENCION, impuestosActivos).map((t): [string, string] => [t.key, t.label]),
      pasa: ({ orden: o }: RetencionItem, v: string) =>
        comprobantesDeOrden(o).some((c) => c.tipo === v) || Boolean(registradas.get(o.id)?.has(v as TipoImpuesto)),
    }] : []),
  ], [vista, fTesoreria, fTipo, registradas, impuestosActivos]);

  const filas = useMemo(() => {
    const fecha = ({ orden: o }: RetencionItem) => String((vista === 'hechas' ? o.retencion_finalizada_en : o.metodo_pago_en) ?? '');
    const xs = aplicarFiltros(baseLista, filtrosLista);
    const reciente = (a: RetencionItem, b: RetencionItem) => fecha(b).localeCompare(fecha(a));
    xs.sort(orden === 'antiguo' ? (a, b) => -reciente(a, b)
      : orden === 'proveedor' ? (a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre) || reciente(a, b)
        : reciente);
    return xs;
  }, [vista, baseLista, filtrosLista, orden]);
  const pagina = useMemo(() => paginar(filas, pag, tam), [filas, pag, tam]);

  const controles: ControlFiltro[] = filtrosLista.map((f) => ({
    campo: f.campo, etiqueta: f.etiqueta, valor: f.valor,
    total: aplicarFiltros(baseLista, filtrosLista.filter((o) => o.campo !== f.campo)).length,
    opciones: f.opciones.map(([v, t]) => ({ valor: v, texto: t, cuenta: conteoOpcion(baseLista, filtrosLista, f.campo, v) })),
  }));
  const ponerFiltro = (campo: string, v: string) => {
    if (campo === 'tesoreria') setFTesoreria(v);
    else if (campo === 'tipo') setFTipo(v as '' | TipoRetencion);
  };

  const conteosPorEmpresa = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of empresas) {
      if (esEmpresaGt(e)) {
        const buzonGt = facturasBuzon.filter((f) => (!f.empresaId || f.empresaId === e.id) && f.estatus !== 'retenida' && f.estatus !== 'descartada').length;
        map[e.id] = (facturasCompras.length || 0) + buzonGt;
      } else {
        map[e.id] = facturasBuzon.filter((f) => f.empresaId === e.id && f.estatus !== 'retenida' && f.estatus !== 'descartada').length;
      }
    }
    return map;
  }, [empresas, facturasBuzon, facturasCompras]);

  return (
    <div>
      {/* ── Cabecera v8 ── */}
      <header style={{ marginBottom: '.75rem' }}>
        {multiempresa && (
          <EmpresaActualSelector
            empresas={empresas}
            empresaId={empresaId}
            onChange={setEmpresaId}
            conteos={conteosPorEmpresa}
            esEspecial={esGt ? (configFiscal.esContribuyenteEspecial === true) : Boolean(empresaActual?.esContribuyenteEspecial)}
          />
        )}
        <div className="lfv8-cabeza-acciones">
          <button className="btn btn-ghost" onClick={() => setParametros(true)}>⚙ Parámetros</button>
          {buzonVisible && puedeVista('retenciones') && (
            <Link to="/app/retenciones/telefono" className="btn btn-ghost" style={{ textDecoration: 'none', position: 'relative' }} title={buzonNuevas > 0 ? `${buzonNuevas} factura(s) nueva(s) en el buzón` : 'Abrir vista móvil de facturas'} onClick={marcarBuzonVisto}>
              📱 Teléfono
              {buzonNuevas > 0 && (
                <span style={{ marginLeft: 6, background: 'var(--danger)', color: '#fff', borderRadius: 999, padding: '0 6px', fontSize: '.7rem', fontWeight: 700 }}>
                  {buzonNuevas}
                </span>
              )}
            </Link>
          )}
          <nav className="view-toggle" role="tablist" aria-label="Pantallas del módulo" style={{ margin: 0 }}>
            <button className={vista === 'pendientes' ? 'active' : ''} onClick={() => setVista('pendientes')}>
              Por hacer{colaPorHacer.length ? ` (${colaPorHacer.length})` : ''}
            </button>
            <button className={vista === 'hechas' ? 'active' : ''} onClick={() => setVista('hechas')}>Realizadas</button>
            <button className={vista === 'agrupada' || vista === 'libro' ? 'active' : ''} onClick={() => setVista('agrupada')}>📋 Control de Retenciones</button>
            {buzonVisible && (
              <button className={vista === 'buzon' ? 'active' : ''} onClick={() => { setVista('buzon'); marcarBuzonVisto(); }}>
                📥 Buzón Móvil{buzonNuevas > 0 ? ` (${buzonNuevas})` : ''}
              </button>
            )}
            {conV3 && <button className={vista === 'periodos' ? 'active' : ''} onClick={() => setVista('periodos')}>Períodos</button>}
            <button className={vista === 'reportes' ? 'active' : ''} onClick={() => setVista('reportes')}>Reportes</button>
            <button className={vista === 'auditoria' ? 'active' : ''} onClick={() => setVista('auditoria')}>🛡️ Auditoría</button>
          </nav>
        </div>
      </header>

      {/* El período en curso de cada impuesto se ve en «Períodos» (resumen por impuesto). */}

      {/* ── Libro fiscal consolidado (con switch interno entre vista por factura, lista o por impuesto) ── */}
      {(vista === 'agrupada' || vista === 'libro') && (
        <LibroFiscalView canWrite={canWrite} actor={actor} actorName={actorName} empresaId={empresaId} empresaFicha={empresaFicha} foco={focoLibro} />
      )}

      {/* ── Períodos fiscales (v8: filtros + atención + timeline) ── */}
      {/* Períodos solo con V3R en la base: generar el año, declarar y reabrir. */}
      {vista === 'periodos' && conV3 && (
        <PeriodosRetencion
          puedeEditar={canWrite}
          impuestosActivos={impuestosActivos}
          practicaClaves={practicaClaves}
          empresaId={empresaId}
          empresaNombre={empresaActual?.nombre}
        />
      )}

      {/* ── Reportes ── */}
      {vista === 'reportes' && (
        <ReportesView
          actor={actor}
          empresaId={empresaId}
          empresaFicha={empresaFicha}
          empresaNombre={empresaActual?.nombre}
          esGt={esGt}
          practicaClaves={practicaClaves}
          esEspecial={esGt ? (configFiscal.esContribuyenteEspecial === true) : Boolean(empresaActual?.esContribuyenteEspecial)}
          onCambiarEmpresa={setEmpresaId}
        />
      )}

      {/* ── Auditoría Fiscal (concisa y explícita) ── */}
      {vista === 'auditoria' && <AuditoriaRetenciones />}

      {/* ── Buzón Móvil y Multi-Empresa (facturas externas y soportes) ── */}
      {vista === 'buzon' && buzonVisible && (
        <BuzonFacturasExternasView
          empresaId={empresaId}
          onEmpresaChange={setEmpresaId}
          onRegistrar={abrirDesdeBuzon}
        />
      )}

      {/* ── Por hacer: cola unificada con archivo obligatorio por empresa ── */}
      {vista === 'pendientes' && (
        <ColaPorHacerView
          items={colaPorHacer}
          empresaNombre={empresaActual?.nombre}
          loading={loading}
          canWrite={canWrite}
          usuariosDirectorio={usuariosDirectorio}
          onCambiarSoporteFisico={cambiarSoporteFisico}
          onRegistrarBuzon={abrirDesdeBuzon}
          onRegistrarArchivo={(f) => { void abrirDesdeFactura(f); }}
          onRegistrarOrden={(item) => {
            setRegistrarFactura(semillaFacturaDesdeOrden(item));
          }}
          onVerDetalle={(item, soporte) => setSel({ ...item, soporteCola: soporte })}
          onNoAplica={conNoAplica && canWrite ? setNoAplica : undefined}
          onVerEnLibro={abrirEnLibro}
        />
      )}

      {/* ── Realizadas ── */}
      {vista === 'hechas' && (
      <>
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <BarraLista
          q={fTexto} onQ={setFTexto} placeholder="Buscar por N° de OC, OP o proveedor"
          resultados={filas.length} unidad="OC"
          filtros={controles} onFiltro={ponerFiltro}
          orden={{ valor: orden, opciones: [['reciente', 'Más reciente primero'], ['antiguo', 'Más antiguo primero'], ['proveedor', 'Proveedor (A–Z)']] }}
          onOrden={(v) => setOrden(v as typeof orden)}
          onQuitar={limpiarFiltros}
          extra={
            <>
              <label className="lf-campo"><span>Realizada desde</span><input className="input" type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} /></label>
              <label className="lf-campo"><span>Hasta</span><input className="input" type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} /></label>
            </>
          }
        />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead>
              <tr>
                <th>N°OC</th><th>OP</th><th>Proveedor</th><th>Condición</th><th>Retención</th>
                <th style={{ textAlign: 'right' }}>Total $</th><th>Tesorería</th>
                <th>Realizada</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !filas.length && (
                <tr><td colSpan={9}><EmptyState icon="🧾" message="Sin retenciones en el historial con esos filtros" /></td></tr>
              )}
              {!loading && pagina.filas.map(({ orden: o, proveedorNombre }) => {
                const kanban = badgeEstatusKanban(o.estado);
                const impOc = badgeImpuestoOrden(o);
                const estRet = estadoRetencionDeOrden(o, impuestosPendientesDeOrden(o, registradas, practica, configFiscal, impuestosActivos), registradas.get(o.id), pagosOc.get(o.id) ?? null);
                const badgeRet = badgeEstadoRetencion(estRet);
                return (
                  <tr key={o.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => setSel({ orden: o, proveedorNombre })}>
                    <td className="mono">
                      <div>{o.oc_codigo ?? '—'}</div>
                      <div style={{ display: 'flex', gap: '.25rem', marginTop: '2px', flexWrap: 'wrap' }}>
                        <span className={badgeRet.className} title={badgeRet.tooltip} style={{ fontSize: '.65rem', padding: '1px 4px' }}>
                          {badgeRet.label}
                        </span>
                        <span className={kanban.className} title={kanban.tooltip} style={{ fontSize: '.65rem', padding: '1px 4px' }}>
                          {kanban.label}
                        </span>
                        <span className={impOc.className} title={impOc.tooltip} style={{ fontSize: '.65rem', padding: '1px 4px' }}>
                          {impOc.label}
                        </span>
                      </div>
                    </td>
                    <td className="mono">{o.codigo}</td>
                  <td>{proveedorNombre}</td>
                  <td>{labelCondicionPago(o.condiciones_pago)}</td>
                  <td>{labelRetencionModo(o.retencion_modo)}{o.retencion_momento && <div className="muted" style={{ fontSize: '.74rem' }}>{labelRetencionMomento(o.retencion_momento)}</div>}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(o.total)}</td>
                  <td>{o.retencion_pagada ? <span className="badge" style={{ color: 'var(--success)' }}>{textoPago(estRet)}</span> : <span className="muted">Por pagar</span>}</td>
                  <td className="muted">{o.retencion_finalizada_en ? dateTime(o.retencion_finalizada_en) : '—'}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-primary" onClick={() => setSel({ orden: o, proveedorNombre })}>Ver</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && (
          <Paginador pagina={pagina} tam={tam} unidad="OC" onPagina={setPag} onTam={(t) => { setTam(t); setPag(1); }} />
        )}
      </div>
      </>
      )}

      {sel && (
        <RetencionModal
          item={sel} soporte={sel.soporteCola} canWrite={canWrite} actor={actor} impuestosActivos={impuestosActivos}
          tieneResueltosEnLibro={Boolean(registradas.get(sel.orden.id)?.size) || impuestosPendientesDeOrden(sel.orden, registradas, practica, configFiscal, impuestosActivos).length === 0}
          onClose={() => setSel(null)}
          onSaved={async () => { setSel(null); await reload(); }}
        />
      )}
      {parametros && (
        <ConfiguracionFiscalModal
          puedeEditar={canWrite}
          editorFiscalEmpresas={
            multiempresa ? (
              <EditorFichasFiscalesEmpresa
                puedeEditar={canWrite}
                onEmpresaCambiada={() => { void reload(); }}
              />
            ) : null
          }
          empresasRegimen={multiempresa ? empresas.map((e) => ({ id: e.id, nombre: e.nombreCorto || e.nombre })) : []}
          empresaRegimenId={empresaId}
          puedeBorrarRegimen={isAdmin}
          onClose={() => {
            setParametros(false);
            void reload();
          }}
        />
      )}
      {registrar && (
        <RegistrarRetencionModal
          semilla={registrar} actor={actor} actorName={actorName} empresaId={empresaId} empresaFicha={empresaFicha}
          proveedorIdsPendientes={proveedorIdsPendientes} impuestosActivos={impuestosActivos} fichasImpuesto={fichasImpuesto}
          onClose={() => setRegistrar(null)}
          onHecho={async () => { setRegistrar(null); await reload().catch(() => {}); }}
        />
      )}
      {noAplica && (
        <NoAplicaModal objetivo={noAplica} actor={actor} actorName={actorName}
          onClose={() => setNoAplica(null)}
          onHecho={async () => { setNoAplica(null); await reload().catch(() => {}); }} />
      )}
      {registrarFactura && (
        <RegistrarFacturaRetencion
          semilla={registrarFactura} actor={actor} actorName={actorName} impuestosActivos={impuestosActivos} fichasImpuesto={fichasImpuesto}
          empresaId={buzonEnRegistro ? buzonEnRegistro.empresaId : empresaId}
          empresaFicha={buzonEnRegistro ? fichaDeBuzon(buzonEnRegistro.empresaId) : empresaFicha}
          onClose={() => { setRegistrarFactura(null); setBuzonEnRegistro(null); }}
          onHecho={async () => {
            const buz = buzonEnRegistro;
            setRegistrarFactura(null); setBuzonEnRegistro(null);
            // Reusa actualizarEstatusFacturaBuzon; el realtime del buzón refresca solo.
            if (buz) await actualizarEstatusFacturaBuzon(buz.id, 'retenida').catch(() => {});
            await reload().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function RetencionModal({ item, soporte, canWrite, actor, tieneResueltosEnLibro, impuestosActivos, onClose, onSaved }: {
  item: RetencionItem; soporte?: SoporteCola; canWrite: boolean; actor: string; tieneResueltosEnLibro?: boolean; impuestosActivos?: ImpuestosActivos | null; onClose: () => void; onSaved: () => void;
}) {
  const o = item.orden;
  const yaFinalizada = !!o.retencion_finalizada;
  const comprobantes = useMemo(() => comprobantesDeOrden(o), [o]);
  // Solo se piden comprobantes de impuestos activos (uno deshabilitado no aparece).
  const tiposComprobante = useMemo(() => soloImpuestosActivos(TIPOS_RETENCION, impuestosActivos ?? null), [impuestosActivos]);
  const [archivos, setArchivos] = useState<Partial<Record<TipoRetencion, File>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const algunArchivo = (Object.values(archivos) as (File | undefined)[]).some(Boolean);
  const puedeSinArchivo = Boolean(tieneResueltosEnLibro || comprobantes.length > 0);

  function setArchivo(tipo: TipoRetencion, file: File | null) {
    setArchivos((m) => ({ ...m, [tipo]: file ?? undefined }));
  }

  async function descargar(path: string) {
    try { previewArchivo(await urlRetencion(path), path.split('/').pop() || 'comprobante'); }
    catch { toast('No se pudo abrir el comprobante', 'error'); }
  }

  async function abrirSoporte() {
    if (!soporte) return;
    try {
      previewArchivo(await urlSoporteCola(soporte), soporte.archivoNombre);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el soporte', 'error');
    }
  }

  async function handleFinalizar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!algunArchivo && !puedeSinArchivo) { setError('Carga al menos un comprobante (IVA, ISLR o Municipal) o registra los impuestos en el Libro Fiscal.'); return; }
    setSaving(true);
    try {
      await finalizarRetencion({ orden: o, archivos, actor, permitirSinArchivo: puedeSinArchivo });
      notify(`Retención registrada · OC ${o.oc_codigo ?? o.codigo}`, 'success', { link: '#/app/retenciones' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo finalizar la retención.'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      {!yaFinalizada && canWrite && (
        <button type="submit" form="ret-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Finalizar retención'}</button>
      )}
    </>
  );

  return (
    <Modal title={`Retención · OC ${o.oc_codigo ?? o.codigo}`} size="lg" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* Detalle de la OC */}
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la orden de compra</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
          <div><span className="muted">Proveedor:</span> <strong>{item.proveedorNombre}</strong></div>
          <div><span className="muted">Tlf. de administración del proveedor:</span> <strong className="mono">{o.numero_administracion || '—'}</strong></div>
          <div><span className="muted">Condición:</span> {labelCondicionPago(o.condiciones_pago)}</div>
          <div><span className="muted">Retención:</span> {labelRetencionModo(o.retencion_modo)}</div>
          {o.retencion_momento && <div><span className="muted">Cuándo se retiene:</span> {labelRetencionMomento(o.retencion_momento)}</div>}
          <div><span className="muted">Total:</span> <strong className="mono">{money(o.total)}</strong></div>
          <div><span className="muted">Tesorería:</span> {o.retencion_pagada ? <strong style={{ color: 'var(--success)' }}>✓ Pagada{o.retencion_pagada_en ? ` · ${dateTime(o.retencion_pagada_en)}` : ''}</strong> : 'Por pagar'}</div>
        </div>

        {/* Factura del proveedor cargada al finalizar la OC */}
        <div style={{ marginTop: '.55rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: '.86rem' }}>Factura del proveedor:</span>
          {soporte
            ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => void abrirSoporte()}>📎 Ver soporte · {soporte.archivoNombre}</button>
            : o.factura_recepcion_path
              ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => descargar(o.factura_recepcion_path!)}>🧾 Ver factura{o.factura_recepcion_nombre ? ` · ${o.factura_recepcion_nombre}` : ''}</button>
              : <span className="muted" style={{ fontSize: '.84rem' }}>— sin factura cargada —</span>}
        </div>

        <div className="table-wrap" style={{ marginTop: '.5rem' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
            <tbody>
              {(o.items ?? []).map((it, i) => (
                <tr key={i}><td>{it.nombre}{skuVisible(it.sku, '') ? <span className="muted"> · {it.sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(it.precio)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comprobantes ya cargados (descarga) */}
      {comprobantes.length > 0 && (
        <div className="card" style={{ margin: '0 0 .75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Comprobantes cargados</div>
          <div style={{ display: 'grid', gap: '.35rem' }}>
            {comprobantes.map((c) => (
              <div key={c.tipo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', fontSize: '.85rem' }}>
                <span><span className="badge">{c.label}</span> <span className="muted">{c.nombre}</span></span>
                <button className="btn btn-sm btn-ghost" onClick={() => descargar(c.path)}>📎 Descargar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Carga de los 3 comprobantes (al menos uno) */}
      {!yaFinalizada && canWrite && (
        <form id="ret-form" onSubmit={handleFinalizar}>
          <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.5rem' }}>
            Carga <strong>al menos uno</strong> de los comprobantes (PDF o imagen). Al finalizar, la retención queda registrada y se refleja en Tesorería.
          </div>
          {tiposComprobante.map((t) => (
            <div key={t.key} className="form-row">
              <label>{t.label}</label>
              <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(t.key, e.target.files?.[0] ?? null)} />
              {archivos[t.key] && <small className="muted">{archivos[t.key]?.name}</small>}
            </div>
          ))}
        </form>
      )}
      {yaFinalizada && (
        <div className="muted" style={{ fontSize: '.84rem' }}>✓ Retención finalizada{o.retencion_finalizada_en ? ` el ${dateTime(o.retencion_finalizada_en)}` : ''}.</div>
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Por realizar — v8: grid, pills de impuesto, acciones inline
   ═══════════════════════════════════════════════════════════════ */

type ImpuestoPendiente = 'iva' | 'islr' | 'municipal';
const IMPUESTOS_PENDIENTES: { key: ImpuestoPendiente; label: string }[] = [
  { key: 'iva', label: 'IVA' }, { key: 'islr', label: 'ISLR' }, { key: 'municipal', label: 'ISAE' },
];

/** Impuestos registrados en el libro, por id de la OC. */
type Registradas = Map<string, Set<TipoImpuesto>>;

/**
 * Lo que falta de una orden: ni el comprobante del flujo anterior ni una retención
 * vigente en el libro, SOLO para los impuestos que la empresa practica. D2: «practica»
 * es la ÚNICA fuente (la RPC retencion_empresa_practica, resuelta a hoy en `practica`);
 * si la RPC no está (degradación), se cae a las banderas de la config (GT). El Régimen
 * por fecha lo enforcea la base al registrar, así que el tablero a-hoy no deja pasar
 * nada fuera de régimen. Ya no se reconcilia con condiciones ni con el flag legado.
 */
function impuestosPendientesDeOrden(
  o: Orden,
  reg: Registradas,
  practica: Set<ImpuestoPendiente> | null = null,
  config?: ConfigRetencion | null,
  activos: ImpuestosActivos | null = null,
): ImpuestoPendiente[] {
  const ya = reg.get(o.id);
  const out: ImpuestoPendiente[] = [];
  const retiene = (k: ImpuestoPendiente) => {
    if (k === 'iva' && config && config.esContribuyenteEspecial !== true) return false;
    return (practica ? practica.has(k) : (config ? puedePracticar(k, config) : false));
  };

  if (retiene('iva') && !o.retencion_iva_path && !ya?.has('iva')) out.push('iva');
  if (retiene('islr') && !o.retencion_islr_path && !ya?.has('islr')) out.push('islr');
  if (retiene('municipal') && !o.retencion_municipal_path && !ya?.has('municipal')) out.push('municipal');

  // Un impuesto deshabilitado en Parámetros no pide retención.
  return filtrarActivos(out, activos);
}



