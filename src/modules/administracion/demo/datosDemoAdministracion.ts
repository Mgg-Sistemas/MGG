/* ============================================================
   Golden Touch · Administración · datos de prueba (SOLO LOCAL)
   Empresas, gastos fijos, categorías y proveedores FICTICIOS para ver la
   vista sin base (D27). Nombres inventados a propósito (repo público): la
   única clave real es «GT» (el propio sistema); el resto es «Demo». No usar
   para nada que no sea la maqueta.
   `crearRepoDemo()` implementa AdminRepo en memoria: las altas y ediciones
   quedan mientras dure la página (no tocan ninguna base).
   ============================================================ */
import { FAOV_TIERS, type TierFaov } from '../administracionParafiscal';
import type { AdminCategoria, AdminRepo, Carpeta, CarpetaInput, CentroAcopio, CentroAcopioInput, CrearEnvioInput, DocumentoEmpresa, DocumentoEmpresaInput, Empresa, EmpresaInput, EnvioTesoreria, GastoFijo, GastoFijoInput, Gestion, GestionInput, Movimiento, MovimientoInput, OpcionRef, Profesional, ProfesionalInput, Responsabilidad, ResponsabilidadInput, Aviso, AvisoInput, CentroRequerido, CentroRequeridoInput, TipoDocumento } from '../admin.repository';
import { calcularStatusVencimiento } from '../admin.repository';
import { generarPendientes as calcularPendientes } from '../administracionGenerar';
import { disponibleParaEnviar, motivoNoReversable } from '../administracionHonorarios';

/** Ganchos SOLO para pruebas de la impl demo (no existen en la impl Supabase). */
export interface RepoDemoHooks {
  /** Simula que Tesorería pagó el servicio directo de un envío. */
  __marcarEnvioPagado(envioId: string): void;
}

const uid = (): string => {
  try { return crypto.randomUUID(); } catch { return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
};

const EMPRESAS_DEMO: Empresa[] = [
  { id: uid(), clave: 'GT', nombre: 'Golden Touch 1127, C.A.', rif: 'J-00000000-0', moneda: 'USD', logoPath: null, activa: true, orden: 1 },
  { id: uid(), clave: 'DEMO1', nombre: 'Minera Demo Norte, C.A.', rif: 'J-11111111-1', moneda: 'Bs', logoPath: null, activa: true, orden: 2 },
  { id: uid(), clave: 'DEMO2', nombre: 'Servicios Demo del Sur, C.A.', rif: 'J-22222222-2', moneda: 'USD', logoPath: null, activa: true, orden: 3 },
];

// Plan de cuentas curado de gasto fijo (propio del módulo, no el catálogo compartido).
const CATEGORIAS_DEMO: AdminCategoria[] = [
  { id: 'cat-serv', nombre: 'Servicios públicos', orden: 1, activa: true },
  { id: 'cat-alq', nombre: 'Alquileres', orden: 2, activa: true },
  { id: 'cat-hon', nombre: 'Honorarios profesionales', orden: 3, activa: true },
  { id: 'cat-para', nombre: 'Parafiscales', orden: 4, activa: true },
  { id: 'cat-imp', nombre: 'Impuestos y tasas', orden: 5, activa: true },
  { id: 'cat-seg', nombre: 'Seguros', orden: 6, activa: true },
  { id: 'cat-mant', nombre: 'Mantenimiento', orden: 7, activa: true },
  { id: 'cat-fin', nombre: 'Financieros', orden: 8, activa: true },
  { id: 'cat-otros', nombre: 'Otros', orden: 9, activa: true },
];

const PROVEEDORES_DEMO: OpcionRef[] = [
  { id: 'prov-agua', nombre: 'Hidro Demo, C.A.' },
  { id: 'prov-luz', nombre: 'Energía Demo del Centro' },
  { id: 'prov-cont', nombre: 'Contadores Demo & Asociados' },
  { id: 'prov-abo', nombre: 'Bufete Demo Legal' },
];

function gastosSemilla(): GastoFijo[] {
  const base = (g: Omit<GastoFijo, 'id'>): GastoFijo => ({ id: uid(), ...g });
  return [
    base({ empresaClave: 'GT', concepto: 'Agua', proveedorId: 'prov-agua', proveedorNombre: 'Hidro Demo, C.A.', categoriaGastoId: 'cat-serv', monto: 1800, moneda: 'Bs', tasaRef: null, periodicidad: 'mensual', diaVencimiento: 5, vigenteDesde: '2026-01-01', estado: 'activo' }),
    base({ empresaClave: 'GT', concepto: 'Alquiler de oficina', proveedorId: null, proveedorNombre: 'Inmobiliaria Demo', categoriaGastoId: 'cat-alq', monto: 800, moneda: 'USD', tasaRef: 40, periodicidad: 'mensual', diaVencimiento: 1, vigenteDesde: '2026-01-01', estado: 'activo' }),
    base({ empresaClave: 'GT', concepto: 'Honorarios del contador', proveedorId: 'prov-cont', proveedorNombre: 'Contadores Demo & Asociados', categoriaGastoId: 'cat-hon', monto: 150, moneda: 'USD', tasaRef: 40, periodicidad: 'mensual', diaVencimiento: 10, vigenteDesde: '2026-01-01', estado: 'activo' }),
    base({ empresaClave: 'DEMO1', concepto: 'Internet y telefonía', proveedorId: 'prov-luz', proveedorNombre: 'Energía Demo del Centro', categoriaGastoId: 'cat-serv', monto: 95, moneda: 'USD', tasaRef: 40, periodicidad: 'mensual', diaVencimiento: 15, vigenteDesde: '2026-02-01', estado: 'activo' }),
    base({ empresaClave: 'DEMO1', concepto: 'Alquiler de galpón', proveedorId: null, proveedorNombre: 'Inmobiliaria Demo', categoriaGastoId: 'cat-alq', monto: 2400, moneda: 'USD', tasaRef: 40, periodicidad: 'trimestral', diaVencimiento: 1, vigenteDesde: '2026-01-01', estado: 'suspendido' }),
    base({ empresaClave: 'DEMO2', concepto: 'Honorarios del abogado', proveedorId: 'prov-abo', proveedorNombre: 'Bufete Demo Legal', categoriaGastoId: 'cat-hon', monto: 300, moneda: 'USD', tasaRef: 40, periodicidad: 'bimensual', diaVencimiento: 20, vigenteDesde: '2026-01-01', estado: 'activo' }),
    base({ empresaClave: 'GT', concepto: 'Parafiscales (INCES)', proveedorId: null, proveedorNombre: 'INCES', categoriaGastoId: 'cat-para', monto: 1200, moneda: 'Bs', tasaRef: null, periodicidad: 'trimestral', diaVencimiento: 5, vigenteDesde: '2026-01-01', estado: 'activo' }),
  ];
}

/** Algo de histórico ya cargado (importado), para que Movimientos y Reporte no estén vacíos. */
function movimientosSemilla(): Movimiento[] {
  const m = (p: Omit<Movimiento, 'id'>): Movimiento => ({ id: uid(), ...p });
  return [
    m({ empresaClave: 'GT', gastoFijoId: null, concepto: 'Agua', proveedorNombre: 'Hidro Demo, C.A.', categoriaGastoId: 'cat-serv', periodo: '2026-09', fecha: '2026-09-05', monto: 1750, moneda: 'Bs', tasaRef: null, estadoPago: 'pagado', origen: 'importado', servicioDirectoId: null }),
    m({ empresaClave: 'GT', gastoFijoId: null, concepto: 'Agua', proveedorNombre: 'Hidro Demo, C.A.', categoriaGastoId: 'cat-serv', periodo: '2026-10', fecha: '2026-10-05', monto: 1800, moneda: 'Bs', tasaRef: null, estadoPago: 'pagado', origen: 'importado', servicioDirectoId: null }),
    m({ empresaClave: 'GT', gastoFijoId: null, concepto: 'Alquiler de oficina', proveedorNombre: 'Inmobiliaria Demo', categoriaGastoId: 'cat-alq', periodo: '2026-10', fecha: '2026-10-01', monto: 800, moneda: 'USD', tasaRef: 40, estadoPago: 'pagado', origen: 'importado', servicioDirectoId: null }),
    m({ empresaClave: 'DEMO1', gastoFijoId: null, concepto: 'Internet y telefonía', proveedorNombre: 'Energía Demo del Centro', categoriaGastoId: 'cat-serv', periodo: '2026-10', fecha: '2026-10-15', monto: 95, moneda: 'USD', tasaRef: 40, estadoPago: 'pagado', origen: 'importado', servicioDirectoId: null }),
  ];
}

/** Repo en memoria para la página de prueba: implementa AdminRepo sin tocar base. */
export function crearRepoDemo(): AdminRepo & RepoDemoHooks {
  const empresas: Empresa[] = EMPRESAS_DEMO.map((e) => ({ ...e }));
  const gastos: GastoFijo[] = gastosSemilla();
  let factoresFaov: TierFaov[] = FAOV_TIERS;
  const movimientos: Movimiento[] = movimientosSemilla();
  const documentos: DocumentoEmpresa[] = [];
  const categorias: AdminCategoria[] = CATEGORIAS_DEMO.map((c) => ({ ...c }));
  const centros: CentroAcopio[] = [];
  const profesionales: Profesional[] = [];
  const carpetas: Carpeta[] = [];
  const gestiones: Gestion[] = [];
  const envios: EnvioTesoreria[] = [];
  const responsabilidades: Responsabilidad[] = [];
  const avisos: Aviso[] = [];
  const centroRequeridos: CentroRequerido[] = [];
  const urlsDemo = new Map<string, string>(); // path → object URL (solo en memoria)
  const claveDe = (id: string) => empresas.find((e) => e.id === id)?.clave;

  return {
    listEmpresas: () => Promise.resolve(empresas.map((e) => ({ ...e })).sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave, 'es'))),
    crearEmpresa: (e: EmpresaInput) => {
      const nueva: Empresa = { id: uid(), ...e };
      empresas.push(nueva);
      return Promise.resolve({ ...nueva });
    },
    editarEmpresa: (id, cambios) => {
      const i = empresas.findIndex((e) => e.id === id);
      if (i >= 0) empresas[i] = { ...empresas[i], ...cambios };
      return Promise.resolve();
    },
    contarGastosDeEmpresa: (clave) => Promise.resolve(gastos.filter((g) => g.empresaClave === clave).length),
    desactivarEmpresa: (id) => {
      const i = empresas.findIndex((e) => e.id === id);
      if (i >= 0) empresas[i] = { ...empresas[i], activa: false };
      return Promise.resolve();
    },
    borrarEmpresa: (id) => {
      const clave = claveDe(id);
      const i = empresas.findIndex((e) => e.id === id);
      if (i >= 0 && !(clave && gastos.some((g) => g.empresaClave === clave))) empresas.splice(i, 1);
      return Promise.resolve();
    },
    listCentros: (empresaClave) => Promise.resolve(
      centros.filter((c) => !empresaClave || c.empresaClave === empresaClave)
        .map((c) => ({ ...c }))
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es')),
    ),
    crearCentro: (c: CentroAcopioInput) => {
      const nuevo: CentroAcopio = { id: uid(), ...c };
      centros.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    editarCentro: (id, cambios) => {
      const i = centros.findIndex((c) => c.id === id);
      if (i >= 0) centros[i] = { ...centros[i], ...cambios };
      return Promise.resolve();
    },
    setActivoCentro: (id, activo) => {
      const i = centros.findIndex((c) => c.id === id);
      if (i >= 0) centros[i] = { ...centros[i], activo };
      return Promise.resolve();
    },
    eliminarCentro: (id) => {
      const i = centros.findIndex((c) => c.id === id);
      if (i >= 0) centros.splice(i, 1);
      return Promise.resolve();
    },
    listProfesionales: () => Promise.resolve(
      profesionales.map((p) => ({ ...p })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    ),
    crearProfesional: (p: ProfesionalInput) => {
      const nuevo: Profesional = { id: uid(), ...p };
      profesionales.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    editarProfesional: (id, cambios) => {
      const i = profesionales.findIndex((p) => p.id === id);
      if (i >= 0) profesionales[i] = { ...profesionales[i], ...cambios };
      return Promise.resolve();
    },
    setActivoProfesional: (id, activo) => {
      const i = profesionales.findIndex((p) => p.id === id);
      if (i >= 0) profesionales[i] = { ...profesionales[i], activo };
      return Promise.resolve();
    },
    listCarpetas: (empresaClave) => Promise.resolve(
      carpetas.filter((c) => !empresaClave || c.empresaClave === empresaClave)
        .map((c) => ({ ...c }))
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es')),
    ),
    crearCarpeta: (c: CarpetaInput) => {
      const nueva: Carpeta = { id: uid(), ...c };
      carpetas.push(nueva);
      return Promise.resolve({ ...nueva });
    },
    editarCarpeta: (id, cambios) => {
      const i = carpetas.findIndex((c) => c.id === id);
      if (i >= 0) carpetas[i] = { ...carpetas[i], ...cambios };
      return Promise.resolve();
    },
    borrarCarpeta: (id) => {
      const i = carpetas.findIndex((c) => c.id === id);
      if (i >= 0) carpetas.splice(i, 1);
      return Promise.resolve();
    },
    listGestiones: (empresaClave, profesionalId) => Promise.resolve(
      gestiones
        .filter((g) => !empresaClave || g.empresaClave === empresaClave)
        .filter((g) => !profesionalId || g.profesionalId === profesionalId)
        .map((g) => ({ ...g }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    ),
    crearGestion: (g: GestionInput) => {
      const nueva: Gestion = { id: uid(), ...g };
      gestiones.push(nueva);
      return Promise.resolve({ ...nueva });
    },
    editarGestion: (id, cambios) => {
      const i = gestiones.findIndex((g) => g.id === id);
      if (i >= 0) gestiones[i] = { ...gestiones[i], ...cambios };
      return Promise.resolve();
    },
    anularGestion: (id) => {
      const i = gestiones.findIndex((g) => g.id === id);
      if (i >= 0) gestiones[i] = { ...gestiones[i], estado: 'anulada' };
      return Promise.resolve();
    },
    borrarGestion: (id) => {
      const i = gestiones.findIndex((g) => g.id === id);
      if (i >= 0) gestiones.splice(i, 1);
      return Promise.resolve();
    },
    listEnvios: (gestionId) => Promise.resolve(
      envios.filter((e) => !gestionId || e.gestionId === gestionId).map((e) => ({ ...e }))
        .sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio)),
    ),
    crearEnvio: (input: CrearEnvioInput) => {
      const { gestion } = input;
      const monto = Math.round((Number(input.monto) || 0) * 100) / 100;
      if (monto <= 0) return Promise.reject(new Error('Indica el monto a enviar a Tesorería.'));
      const disponible = disponibleParaEnviar(gestion, envios.filter((e) => e.gestionId === gestion.id));
      if (monto > disponible + 0.01) return Promise.reject(new Error(`El envío (${monto}) supera lo disponible para enviar de la gestión (${disponible}); ya hay envíos comprometidos.`));
      const nuevo: EnvioTesoreria = {
        id: uid(), gestionId: gestion.id, empresaClave: gestion.empresaClave, monto, moneda: gestion.moneda,
        fechaEnvio: new Date().toISOString(), estado: 'enviado', servicioDirectoId: `demo-sd-${uid()}`,
        enviadoPor: input.actor ?? 'demo', pagadoEn: null,
      };
      envios.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    reversarEnvio: (id) => {
      const i = envios.findIndex((e) => e.id === id);
      if (i < 0) return Promise.reject(new Error('Envío no encontrado.'));
      // En demo no hay servicio directo real; el estado del propio envío es la fuente.
      const motivo = motivoNoReversable(envios[i], false);
      if (motivo) return Promise.reject(new Error(motivo));
      envios[i] = { ...envios[i], estado: 'reversado' };
      return Promise.resolve();
    },
    refrescarEnvios: () => Promise.resolve(), // demo no tiene Tesorería real
    urlAdjuntoEnvio: () => Promise.resolve(null),
    listResponsabilidades: (empresaClave) => Promise.resolve(
      responsabilidades.filter((x) => !empresaClave || x.empresaClave === empresaClave).map((x) => ({ ...x })),
    ),
    asignarResponsabilidad: (input: ResponsabilidadInput) => {
      const existente = responsabilidades.find(
        (x) => x.usuarioEmail === input.usuarioEmail && x.objetivoTipo === input.objetivoTipo && x.objetivoId === input.objetivoId,
      );
      if (existente) return Promise.resolve({ ...existente });
      const nueva: Responsabilidad = { id: uid(), ...input };
      responsabilidades.push(nueva);
      return Promise.resolve({ ...nueva });
    },
    quitarResponsabilidad: (id) => {
      const i = responsabilidades.findIndex((x) => x.id === id);
      if (i >= 0) responsabilidades.splice(i, 1);
      return Promise.resolve();
    },
    listAvisos: (empresaClave) => Promise.resolve(
      avisos.filter((x) => !empresaClave || x.empresaClave === empresaClave).map((x) => ({ ...x })),
    ),
    crearAviso: (a: AvisoInput) => {
      const nuevo: Aviso = { id: uid(), leido: false, ...a };
      avisos.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    marcarAvisoLeido: (id, leido) => {
      const i = avisos.findIndex((x) => x.id === id);
      if (i >= 0) avisos[i] = { ...avisos[i], leido };
      return Promise.resolve();
    },
    borrarAviso: (id) => {
      const i = avisos.findIndex((x) => x.id === id);
      if (i >= 0) avisos.splice(i, 1);
      return Promise.resolve();
    },
    listCentroRequeridos: (empresaClave) => Promise.resolve(
      centroRequeridos.filter((x) => !empresaClave || x.empresaClave === empresaClave).map((x) => ({ ...x })),
    ),
    agregarCentroRequerido: (input: CentroRequeridoInput) => {
      const existente = centroRequeridos.find((x) => x.centroId === input.centroId && x.tipoDocumento === input.tipoDocumento);
      if (existente) return Promise.resolve({ ...existente });
      const nuevo: CentroRequerido = { id: uid(), ...input };
      centroRequeridos.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    quitarCentroRequerido: (id) => {
      const i = centroRequeridos.findIndex((x) => x.id === id);
      if (i >= 0) centroRequeridos.splice(i, 1);
      return Promise.resolve();
    },
    __marcarEnvioPagado: (envioId: string) => {
      const i = envios.findIndex((e) => e.id === envioId);
      if (i >= 0) envios[i] = { ...envios[i], estado: 'pagado', pagadoEn: new Date().toISOString() };
    },
    leerFactoresFaov: () => Promise.resolve(factoresFaov),
    guardarFactoresFaov: (tiers: TierFaov[]) => { factoresFaov = tiers; return Promise.resolve(); },
    listGastosFijos: (empresaClave) => Promise.resolve(
      gastos.filter((g) => !empresaClave || g.empresaClave === empresaClave).map((g) => ({ ...g }))
        .sort((a, b) => a.concepto.localeCompare(b.concepto, 'es')),
    ),
    crearGastoFijo: (g: GastoFijoInput) => {
      const nuevo: GastoFijo = { id: uid(), ...g };
      gastos.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    editarGastoFijo: (id, cambios) => {
      const i = gastos.findIndex((g) => g.id === id);
      if (i >= 0) gastos[i] = { ...gastos[i], ...cambios };
      return Promise.resolve();
    },
    setEstadoGastoFijo: (id, estado) => {
      const i = gastos.findIndex((g) => g.id === id);
      if (i >= 0) gastos[i] = { ...gastos[i], estado };
      return Promise.resolve();
    },
    listCategorias: () => Promise.resolve(
      categorias.filter((c) => c.activa).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es')).map((c) => ({ id: c.id, nombre: c.nombre })),
    ),
    listAdminCategorias: () => Promise.resolve(
      categorias.map((c) => ({ ...c })).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es')),
    ),
    crearAdminCategoria: (nombre) => {
      const nueva: AdminCategoria = { id: uid(), nombre: nombre.trim(), orden: (categorias.reduce((m, c) => Math.max(m, c.orden), 0) + 1), activa: true };
      categorias.push(nueva);
      return Promise.resolve({ ...nueva });
    },
    renombrarAdminCategoria: (id, nombre) => {
      const i = categorias.findIndex((c) => c.id === id);
      if (i >= 0) categorias[i] = { ...categorias[i], nombre: nombre.trim() };
      return Promise.resolve();
    },
    setActivaAdminCategoria: (id, activa) => {
      const i = categorias.findIndex((c) => c.id === id);
      if (i >= 0) categorias[i] = { ...categorias[i], activa };
      return Promise.resolve();
    },
    listProveedores: () => Promise.resolve(PROVEEDORES_DEMO.map((p) => ({ ...p }))),
    listMovimientos: (empresaClave) => Promise.resolve(
      movimientos.filter((m) => !empresaClave || m.empresaClave === empresaClave).map((m) => ({ ...m }))
        .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)),
    ),
    crearMovimiento: (m: MovimientoInput) => {
      const nuevo: Movimiento = { id: uid(), ...m };
      movimientos.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    editarMovimiento: (id, cambios) => {
      const i = movimientos.findIndex((m) => m.id === id);
      if (i >= 0) movimientos[i] = { ...movimientos[i], ...cambios };
      return Promise.resolve();
    },
    anularMovimiento: (id) => {
      const i = movimientos.findIndex((m) => m.id === id);
      if (i >= 0) movimientos[i] = { ...movimientos[i], estadoPago: 'anulado' };
      return Promise.resolve();
    },
    borrarMovimiento: (id) => {
      const i = movimientos.findIndex((m) => m.id === id);
      if (i >= 0) movimientos.splice(i, 1);
      return Promise.resolve();
    },
    generarPendientes: (empresaClave, hasta = new Date()) => {
      const gs = gastos.filter((g) => !empresaClave || g.empresaClave === empresaClave);
      const existentes = movimientos.filter((m) => m.gastoFijoId).map((m) => ({ gastoFijoId: m.gastoFijoId as string, periodo: m.periodo }));
      const nuevos = calcularPendientes(gs, existentes, hasta);
      for (const n of nuevos) {
        movimientos.push({
          id: uid(), empresaClave: n.empresaClave, gastoFijoId: n.gastoFijoId, concepto: n.concepto, proveedorNombre: null,
          categoriaGastoId: n.categoriaGastoId, periodo: n.periodo, fecha: n.fecha, monto: n.monto, moneda: n.moneda, tasaRef: null,
          estadoPago: 'pendiente', origen: 'generado', servicioDirectoId: `demo-sd-${n.periodo}-${(n.gastoFijoId ?? '').slice(0, 6)}`,
        });
      }
      return Promise.resolve({ creados: nuevos.length, enTesoreria: nuevos.length });
    },
    enviarMovimientoATesoreria: (mov: Movimiento) => {
      const i = movimientos.findIndex((m) => m.id === mov.id);
      if (i < 0) return Promise.reject(new Error('No existe el pendiente.'));
      if (movimientos[i].servicioDirectoId) return Promise.reject(new Error('Este pendiente ya esta en Tesoreria.'));
      movimientos[i] = { ...movimientos[i], servicioDirectoId: `demo-sd-${uid()}` };
      return Promise.resolve();
    },
    // En el doble, Tesoreria nunca paga sola: el estado no cambia solo.
    refrescarMovimientos: () => Promise.resolve(),
    urlComprobanteMovimiento: (mov: Movimiento) =>
      Promise.resolve(mov.servicioDirectoId ? `https://demo/comprobante/${mov.servicioDirectoId}` : null),
    contarMovimientosDeGasto: (gastoFijoId: string) =>
      Promise.resolve(movimientos.filter((m) => m.gastoFijoId === gastoFijoId).length),
    borrarGastoFijo: (id: string) => {
      const usados = movimientos.filter((m) => m.gastoFijoId === id).length;
      if (usados > 0) {
        return Promise.reject(new Error(`No se puede borrar: esta plantilla ya genero ${usados} movimiento(s). Suspendela para que deje de generar.`));
      }
      const i = gastos.findIndex((g: GastoFijo) => g.id === id);
      if (i >= 0) gastos.splice(i, 1);
      return Promise.resolve();
    },
    listDocumentos: (empresaClave) => Promise.resolve(
      documentos
        .filter((d) => !empresaClave || d.empresaClave === empresaClave)
        .map((d) => ({ ...d }))
        .sort((a, b) => (a.createdAt && b.createdAt && a.createdAt < b.createdAt ? 1 : -1)),
    ),
    subirDocumento: (empresaClave, tipo: TipoDocumento, file: File, meta?: Partial<DocumentoEmpresaInput>, actor?: string) => {
      const path = `demo/${empresaClave}/${uid()}-${file.name}`;
      try { urlsDemo.set(path, URL.createObjectURL(file)); } catch { /* sin createObjectURL: la previsualización queda vacía */ }
      const nowIso = new Date().toISOString();
      const status = calcularStatusVencimiento(meta?.fechaVencimiento, meta?.statusVencimiento);
      const nuevo: DocumentoEmpresa = {
        id: uid(),
        empresaClave,
        carpeta: meta?.carpeta || 'otros',
        centroAcopioId: meta?.centroAcopioId || null,
        responsable: meta?.responsable || null,
        tipo,
        nombre: meta?.nombre || file.name,
        path,
        contentType: file.type || null,
        tamano: file.size,
        fechaEmision: meta?.fechaEmision || null,
        fechaVencimiento: meta?.fechaVencimiento || null,
        statusVencimiento: status,
        socioNombre: meta?.socioNombre || null,
        entidadEmisora: meta?.entidadEmisora || null,
        numeroRegistro: meta?.numeroRegistro || null,
        notaTramite: meta?.notaTramite || null,
        costoGestion: meta?.costoGestion ?? null,
        monedaCosto: meta?.monedaCosto ?? null,
        gestionId: meta?.gestionId ?? null,
        avisoDias: meta?.avisoDias ?? null,
        subcarpetaId: meta?.subcarpetaId ?? null,
        badgeTexto: meta?.badgeTexto ?? null,
        prioridad: meta?.prioridad ?? null,
        historial: [
          {
            id: uid(),
            fecha: nowIso,
            actor: actor || 'demo@goldentouch.com',
            accion: 'creacion',
            detalle: 'Documento subido en modo demo',
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      documentos.push(nuevo);
      return Promise.resolve({ ...nuevo });
    },
    editarDocumento: (id: string, cambios: Partial<DocumentoEmpresaInput>, actor?: string, detalle?: string) => {
      const idx = documentos.findIndex((d) => d.id === id);
      if (idx < 0) return Promise.reject(new Error('Documento demo no encontrado.'));
      const d = documentos[idx];
      const nowIso = new Date().toISOString();
      const nuevoStatus = calcularStatusVencimiento(
        cambios.fechaVencimiento !== undefined ? cambios.fechaVencimiento : d.fechaVencimiento,
        cambios.statusVencimiento !== undefined ? cambios.statusVencimiento : d.statusVencimiento,
      );
      const histItem = {
        id: uid(),
        fecha: nowIso,
        actor: actor || 'demo@goldentouch.com',
        accion: cambios.statusVencimiento ? ('cambio_status' as const) : ('modificacion' as const),
        detalle: detalle || 'Metadatos actualizados en demo',
      };
      const actualizado: DocumentoEmpresa = {
        ...d,
        ...cambios,
        statusVencimiento: nuevoStatus,
        historial: [...d.historial, histItem],
        updatedAt: nowIso,
      };
      documentos[idx] = actualizado;
      return Promise.resolve({ ...actualizado });
    },
    renovarDocumento: (id: string, file: File | null, meta: Partial<DocumentoEmpresaInput>, actor?: string, nota?: string) => {
      const idx = documentos.findIndex((d) => d.id === id);
      if (idx < 0) return Promise.reject(new Error('Documento demo no encontrado.'));
      const d = documentos[idx];
      const nowIso = new Date().toISOString();
      let path = d.path;
      let tamano = d.tamano;
      let detalle = nota ? `Renovación registrada. ${nota}` : 'Documento renovado con nueva vigencia';
      if (file) {
        path = `demo/${d.empresaClave}/${uid()}-${file.name}`;
        tamano = file.size;
        try { urlsDemo.set(path, URL.createObjectURL(file)); } catch { /* noop */ }
        detalle = `Renovado con nuevo archivo "${file.name}". ${nota || ''}`.trim();
      }
      const nuevoStatus = calcularStatusVencimiento(
        meta.fechaVencimiento !== undefined ? meta.fechaVencimiento : d.fechaVencimiento,
        meta.statusVencimiento !== undefined ? meta.statusVencimiento : d.statusVencimiento,
      );
      const histItem = {
        id: uid(),
        fecha: nowIso,
        actor: actor || 'demo@goldentouch.com',
        accion: 'renovacion' as const,
        detalle,
      };
      const actualizado: DocumentoEmpresa = {
        ...d,
        ...meta,
        path,
        tamano,
        statusVencimiento: nuevoStatus,
        historial: [...d.historial, histItem],
        updatedAt: nowIso,
      };
      documentos[idx] = actualizado;
      return Promise.resolve({ ...actualizado });
    },
    urlDocumento: (path) => Promise.resolve(urlsDemo.get(path) ?? ''),
    borrarDocumento: (doc) => {
      const i = documentos.findIndex((d) => d.id === doc.id);
      if (i >= 0) documentos.splice(i, 1);
      const u = urlsDemo.get(doc.path);
      if (u) { try { URL.revokeObjectURL(u); } catch { /* ya revocada */ } urlsDemo.delete(doc.path); }
      return Promise.resolve();
    },
  };
}
