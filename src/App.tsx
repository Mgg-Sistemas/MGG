import { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './modules/landing/LandingPage';
import { LoginPage } from './modules/auth/LoginPage';
import { AppShell } from './shared/ui/AppShell';
import { ProtectedRoute } from './modules/auth/ProtectedRoute';
import { PermissionsProvider, RequireModule, RequireVistaTelefono, HomeRedirect } from './modules/auth/PermissionsContext';
import { ToastHost } from './shared/ui/Toast';
import { PasswordChangeGate } from './modules/usuarios/PasswordChangeGate';
import { lazyReload, ChunkErrorBoundary } from './shared/lib/lazyReload';

// Lazy: las páginas internas se descargan en chunks separados al navegarlas.
// lazyReload(): si un chunk fue borrado por un despliegue nuevo, recarga sola.
const CarnetPublicoPage = lazyReload(() => import('./modules/rrhh/CarnetPublicoPage').then((m) => ({ default: m.CarnetPublicoPage })));
const DashboardPage = lazyReload(() => import('./modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PedidosPage = lazyReload(() => import('./modules/pedidos/PedidosPage').then((m) => ({ default: m.PedidosPage })));
const HistoricoPage = lazyReload(() => import('./modules/pedidos/HistoricoPage').then((m) => ({ default: m.HistoricoPage })));
const ProveedoresPage = lazyReload(() => import('./modules/proveedores/ProveedoresPage').then((m) => ({ default: m.ProveedoresPage })));
const InventarioPage = lazyReload(() => import('./modules/inventario/InventarioPage').then((m) => ({ default: m.InventarioPage })));
const DepositoPage = lazyReload(() => import('./modules/inventario/InventarioPage').then((m) => ({ default: m.DepositoPage })));
const AlmacenCentroPage = lazyReload(() => import('./modules/inventario/InventarioPage').then((m) => ({ default: m.AlmacenCentroPage })));
const ProduccionPage = lazyReload(() => import('./modules/produccion/ProduccionPage').then((m) => ({ default: m.ProduccionPage })));
const RefinacionPage = lazyReload(() => import('./modules/produccion/ProduccionPage').then((m) => ({ default: m.RefinacionPage })));
const SalidasPage = lazyReload(() => import('./modules/salidas/SalidasPage').then((m) => ({ default: m.SalidasPage })));
const CocinaPage = lazyReload(() => import('./modules/cocina/CocinaPage').then((m) => ({ default: m.CocinaPage })));
const CocinaMovilView = lazyReload(() => import('./modules/cocina/CocinaMovilView').then((m) => ({ default: m.CocinaMovilView })));
const TelefonoInicioPage = lazyReload(() => import('./modules/auth/TelefonoInicioPage').then((m) => ({ default: m.TelefonoInicioPage })));
const CombustiblePage = lazyReload(() => import('./modules/combustible/CombustiblePage').then((m) => ({ default: m.CombustiblePage })));
const AcopioPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.AcopioPage })));
const ReportePreliminarPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.ReportePreliminarPage })));
const GlobalMineralTinPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.GlobalMineralTinPage })));
const PeramanalEnderPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.PeramanalEnderPage })));
const EsmeraldaAliPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.EsmeraldaAliPage })));
const PijiguaosPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.PijiguaosPage })));
const MaquinariaPage = lazyReload(() => import('./modules/maquinaria/MaquinariaPage').then((m) => ({ default: m.MaquinariaPage })));
const ServicioMantenimientoPage = lazyReload(() => import('./modules/maquinaria/ServicioMantenimientoPage').then((m) => ({ default: m.ServicioMantenimientoPage })));
const EquipoExpedientePage = lazyReload(() => import('./modules/maquinaria/EquipoExpedientePage').then((m) => ({ default: m.EquipoExpedientePage })));
const OrdenesServicioPage = lazyReload(() => import('./modules/maquinaria/OrdenesServicioPage').then((m) => ({ default: m.OrdenesServicioPage })));
const AveriasEstadosPage = lazyReload(() => import('./modules/maquinaria/AveriasEstadosPage').then((m) => ({ default: m.AveriasEstadosPage })));
const LavadosPage = lazyReload(() => import('./modules/maquinaria/LavadosPage').then((m) => ({ default: m.LavadosPage })));
const RepuestosComprasPage = lazyReload(() => import('./modules/maquinaria/RepuestosComprasPage').then((m) => ({ default: m.RepuestosComprasPage })));
const RepuestosPorEquipoPage = lazyReload(() => import('./modules/maquinaria/RepuestosPorEquipoPage').then((m) => ({ default: m.RepuestosPorEquipoPage })));
const MaquinariaMovilView = lazyReload(() => import('./modules/maquinaria/MaquinariaMovilView').then((m) => ({ default: m.MaquinariaMovilView })));
const ChoferesPage = lazyReload(() => import('./modules/choferes/ChoferesPage').then((m) => ({ default: m.ChoferesPage })));
const VentasPage = lazyReload(() => import('./modules/ventas/VentasPage').then((m) => ({ default: m.VentasPage })));
const TesoreriaPage = lazyReload(() => import('./modules/tesoreria/TesoreriaPage').then((m) => ({ default: m.TesoreriaPage })));
const RetencionesPage = lazyReload(() => import('./modules/retenciones/RetencionesPage').then((m) => ({ default: m.RetencionesPage })));
const RetencionesMovilView = lazyReload(() => import('./modules/retenciones/RetencionesMovilView').then((m) => ({ default: m.RetencionesMovilView })));
const RecepcionesPage = lazyReload(() => import('./modules/recepciones/RecepcionesPage').then((m) => ({ default: m.RecepcionesPage })));
const RrhhPage = lazyReload(() => import('./modules/rrhh/RrhhPage').then((m) => ({ default: m.RrhhPage })));
const AsignacionesPage = lazyReload(() => import('./modules/asignaciones/AsignacionesPage').then((m) => ({ default: m.AsignacionesPage })));
const DocumentacionPage = lazyReload(() => import('./modules/documentacion/DocumentacionPage').then((m) => ({ default: m.DocumentacionPage })));
const SurtidorMovilView = lazyReload(() => import('./modules/combustible/SurtidorMovilView').then((m) => ({ default: m.SurtidorMovilView })));
const UsuariosPage = lazyReload(() => import('./modules/usuarios/UsuariosPage').then((m) => ({ default: m.UsuariosPage })));
const AuditoriaPage = lazyReload(() => import('./modules/auditoria/AuditoriaPage').then((m) => ({ default: m.AuditoriaPage })));
const AjustesPage = lazyReload(() => import('./modules/ajustes/AjustesPage').then((m) => ({ default: m.AjustesPage })));
const CambiarClavePage = lazyReload(() => import('./modules/usuarios/CambiarClavePage').then((m) => ({ default: m.CambiarClavePage })));

function PageLoader() {
  return <div className="p-8 muted">Cargando…</div>;
}

/**
 * Precarga en SEGUNDO PLANO (cuando el navegador está ocioso) los chunks de las
 * páginas más usadas, después del primer render. Así, al hacer clic en un módulo,
 * su código ya está descargado y abre al instante. No bloquea la carga inicial
 * ni compite con el primer pintado.
 */
function usePrefetchPaginasFrecuentes() {
  useEffect(() => {
    const rutas: (() => Promise<unknown>)[] = [
      () => import('./modules/dashboard/DashboardPage'),
      () => import('./modules/inventario/InventarioPage'),
      () => import('./modules/pedidos/PedidosPage'),
      () => import('./modules/tesoreria/TesoreriaPage'),
      () => import('./modules/salidas/SalidasPage'),
      () => import('./modules/acopio/AcopioPage'),
      () => import('./modules/recepciones/RecepcionesPage'),
      () => import('./modules/retenciones/RetencionesPage'),
      () => import('./modules/retenciones/RetencionesMovilView'),
    ];
    let cancelado = false;
    const prefetch = () => {
      void rutas.reduce(
        (cadena, cargar) => cadena.then(() => (cancelado ? undefined : cargar().then(() => undefined).catch(() => undefined))),
        Promise.resolve<void>(undefined),
      );
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(prefetch, { timeout: 6000 });
      return () => { cancelado = true; w.cancelIdleCallback?.(id); };
    }
    const id = window.setTimeout(prefetch, 4000);
    return () => { cancelado = true; window.clearTimeout(id); };
  }, []);
}

function SinAccesoPage() {
  return (
    <div className="sin-acceso-wrap p-8 text-center">
      <h2>Acceso no autorizado</h2>
      <p className="muted">No tienes permiso para ver esta pantalla. Consulta al administrador.</p>
    </div>
  );
}

export function App() {
  usePrefetchPaginasFrecuentes();

  return (
    <ChunkErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Carnet público por QR (sin login): cualquiera puede verificarlo */}
        <Route path="/carnet/:id" element={<Suspense fallback={<PageLoader />}><CarnetPublicoPage /></Suspense>} />
        {/* Rutas protegidas: exigen sesión iniciada */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <PermissionsProvider>
                <PasswordChangeGate>
                  <AppShell />
                </PasswordChangeGate>
              </PermissionsProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<RequireModule module="dashboard"><Suspense fallback={<PageLoader />}><DashboardPage /></Suspense></RequireModule>} />
          <Route path="pedidos" element={<RequireModule module="pedidos"><Suspense fallback={<PageLoader />}><PedidosPage /></Suspense></RequireModule>} />
          <Route path="pedidos/historico" element={<RequireModule module="pedidos"><Suspense fallback={<PageLoader />}><HistoricoPage /></Suspense></RequireModule>} />
          <Route path="proveedores" element={<RequireModule module="proveedores"><Suspense fallback={<PageLoader />}><ProveedoresPage /></Suspense></RequireModule>} />
          <Route path="inventario" element={<RequireModule module="inventario"><Suspense fallback={<PageLoader />}><InventarioPage /></Suspense></RequireModule>} />
          <Route path="deposito" element={<RequireModule module="deposito"><Suspense fallback={<PageLoader />}><DepositoPage /></Suspense></RequireModule>} />
          <Route path="almacenes/:sede" element={<RequireModule module="inventario"><Suspense fallback={<PageLoader />}><AlmacenCentroPage /></Suspense></RequireModule>} />
          <Route path="produccion" element={<RequireModule module="produccion"><Suspense fallback={<PageLoader />}><ProduccionPage /></Suspense></RequireModule>} />
          <Route path="refinacion" element={<RequireModule module="refinacion"><Suspense fallback={<PageLoader />}><RefinacionPage /></Suspense></RequireModule>} />
          <Route path="salidas" element={<RequireModule module="salidas"><Suspense fallback={<PageLoader />}><SalidasPage /></Suspense></RequireModule>} />
          <Route path="cocina" element={<RequireModule module="cocina"><Suspense fallback={<PageLoader />}><CocinaPage /></Suspense></RequireModule>} />
          {/* Pantallas de teléfono (13-10): hace falta la pantalla dada al rol Y lectura en su módulo. */}
          <Route path="cocina/telefono" element={<RequireVistaTelefono vista="comidas"><Suspense fallback={<PageLoader />}><CocinaMovilView /></Suspense></RequireVistaTelefono>} />
          <Route path="combustible" element={<RequireModule module="combustible"><Suspense fallback={<PageLoader />}><CombustiblePage /></Suspense></RequireModule>} />
          <Route path="combustible/surtidor" element={<RequireVistaTelefono vista="surtidor"><Suspense fallback={<PageLoader />}><SurtidorMovilView /></Suspense></RequireVistaTelefono>} />
          {/* «Mis pantallas»: el inicio de un rol solo teléfono con más de una pantalla. */}
          <Route path="telefono" element={<Suspense fallback={<PageLoader />}><TelefonoInicioPage /></Suspense>} />
          <Route path="acopio" element={<RequireModule module="acopio"><Suspense fallback={<PageLoader />}><AcopioPage /></Suspense></RequireModule>} />
          <Route path="acopio/reporte-preliminar" element={<RequireModule module="acopio_reporte"><Suspense fallback={<PageLoader />}><ReportePreliminarPage /></Suspense></RequireModule>} />
          <Route path="acopio/global-mineral-tin" element={<RequireModule module="acopio_gmt"><Suspense fallback={<PageLoader />}><GlobalMineralTinPage /></Suspense></RequireModule>} />
          <Route path="acopio/peramanal-ender" element={<RequireModule module="acopio_peramanal"><Suspense fallback={<PageLoader />}><PeramanalEnderPage /></Suspense></RequireModule>} />
          <Route path="acopio/esmeralda-ali" element={<RequireModule module="acopio_esmeralda"><Suspense fallback={<PageLoader />}><EsmeraldaAliPage /></Suspense></RequireModule>} />
          <Route path="acopio/los-pijiguaos" element={<RequireModule module="acopio_pijiguaos"><Suspense fallback={<PageLoader />}><PijiguaosPage /></Suspense></RequireModule>} />
          <Route path="maquinaria" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><MaquinariaPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/servicio-mantenimiento" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><ServicioMantenimientoPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/equipo/:id" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><EquipoExpedientePage /></Suspense></RequireModule>} />
          <Route path="maquinaria/ordenes" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><OrdenesServicioPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/averias" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><AveriasEstadosPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/lavados" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><LavadosPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/repuestos" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><RepuestosComprasPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/repuestos-equipo" element={<RequireModule module="maquinaria"><Suspense fallback={<PageLoader />}><RepuestosPorEquipoPage /></Suspense></RequireModule>} />
          <Route path="maquinaria/telefono" element={<RequireVistaTelefono vista="maquinaria"><Suspense fallback={<PageLoader />}><MaquinariaMovilView /></Suspense></RequireVistaTelefono>} />
          <Route path="choferes" element={<RequireModule module="choferes"><Suspense fallback={<PageLoader />}><ChoferesPage /></Suspense></RequireModule>} />
          <Route path="ventas" element={<RequireModule module="ventas"><Suspense fallback={<PageLoader />}><VentasPage /></Suspense></RequireModule>} />
          <Route path="tesoreria" element={<RequireModule module="tesoreria"><Suspense fallback={<PageLoader />}><TesoreriaPage /></Suspense></RequireModule>} />
          <Route path="retenciones" element={<RequireModule module="retenciones"><Suspense fallback={<PageLoader />}><RetencionesPage /></Suspense></RequireModule>} />
          <Route path="retenciones/telefono" element={<RequireVistaTelefono vista="retenciones"><Suspense fallback={<PageLoader />}><RetencionesMovilView /></Suspense></RequireVistaTelefono>} />
          <Route path="retenciones/nueva" element={<Navigate to="/app/retenciones" replace />} />
          <Route path="recepciones" element={<RequireModule module="recepciones"><Suspense fallback={<PageLoader />}><RecepcionesPage /></Suspense></RequireModule>} />
          <Route path="rrhh" element={<RequireModule module="rrhh"><Suspense fallback={<PageLoader />}><RrhhPage /></Suspense></RequireModule>} />
          <Route path="asignaciones" element={<RequireModule module="asignaciones"><Suspense fallback={<PageLoader />}><AsignacionesPage /></Suspense></RequireModule>} />
          <Route path="documentacion" element={<RequireModule module="documentacion"><Suspense fallback={<PageLoader />}><DocumentacionPage /></Suspense></RequireModule>} />
          <Route path="usuarios" element={<RequireModule module="usuarios"><Suspense fallback={<PageLoader />}><UsuariosPage /></Suspense></RequireModule>} />
          <Route path="auditoria" element={<RequireModule module="auditoria"><Suspense fallback={<PageLoader />}><AuditoriaPage /></Suspense></RequireModule>} />
          <Route path="ajustes" element={<RequireModule module="ajustes"><Suspense fallback={<PageLoader />}><AjustesPage /></Suspense></RequireModule>} />
          <Route path="sin-acceso" element={<SinAccesoPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </ChunkErrorBoundary>
  );
}
