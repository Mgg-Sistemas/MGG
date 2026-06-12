import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './modules/landing/LandingPage';
import { LoginPage } from './modules/auth/LoginPage';
import { AppShell } from './shared/ui/AppShell';
import { ProtectedRoute } from './modules/auth/ProtectedRoute';
import { PermissionsProvider, RequireModule, HomeRedirect } from './modules/auth/PermissionsContext';
import { ToastHost } from './shared/ui/Toast';
import { PasswordChangeGate } from './modules/usuarios/PasswordChangeGate';
import { lazyReload, ChunkErrorBoundary } from './shared/lib/lazyReload';

// Lazy: las páginas internas se descargan en chunks separados al navegarlas.
// lazyReload(): si un chunk fue borrado por un despliegue nuevo, recarga sola.
const DashboardPage = lazyReload(() => import('./modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PedidosPage = lazyReload(() => import('./modules/pedidos/PedidosPage').then((m) => ({ default: m.PedidosPage })));
const HistoricoPage = lazyReload(() => import('./modules/pedidos/HistoricoPage').then((m) => ({ default: m.HistoricoPage })));
const ProveedoresPage = lazyReload(() => import('./modules/proveedores/ProveedoresPage').then((m) => ({ default: m.ProveedoresPage })));
const InventarioPage = lazyReload(() => import('./modules/inventario/InventarioPage').then((m) => ({ default: m.InventarioPage })));
const ProduccionPage = lazyReload(() => import('./modules/produccion/ProduccionPage').then((m) => ({ default: m.ProduccionPage })));
const SalidasPage = lazyReload(() => import('./modules/salidas/SalidasPage').then((m) => ({ default: m.SalidasPage })));
const CombustiblePage = lazyReload(() => import('./modules/combustible/CombustiblePage').then((m) => ({ default: m.CombustiblePage })));
const AcopioPage = lazyReload(() => import('./modules/acopio/AcopioPage').then((m) => ({ default: m.AcopioPage })));
const TesoreriaPage = lazyReload(() => import('./modules/tesoreria/TesoreriaPage').then((m) => ({ default: m.TesoreriaPage })));
const RetencionesPage = lazyReload(() => import('./modules/retenciones/RetencionesPage').then((m) => ({ default: m.RetencionesPage })));
const RrhhPage = lazyReload(() => import('./modules/rrhh/RrhhPage').then((m) => ({ default: m.RrhhPage })));
const UsuariosPage = lazyReload(() => import('./modules/usuarios/UsuariosPage').then((m) => ({ default: m.UsuariosPage })));
const AjustesPage = lazyReload(() => import('./modules/ajustes/AjustesPage').then((m) => ({ default: m.AjustesPage })));
const CambiarClavePage = lazyReload(() => import('./modules/usuarios/CambiarClavePage').then((m) => ({ default: m.CambiarClavePage })));

function PageLoader() {
  return <div className="p-8 muted">Cargando…</div>;
}

function SinAccesoPage() {
  return (
    <div className="card" style={{ padding: '2rem', maxWidth: 520, margin: '2rem auto', textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Sin acceso</h2>
      <p className="muted">
        Tu rol no tiene permisos sobre ningún módulo. Pedile a un administrador que ajuste tus
        permisos en <strong>Usuarios → Roles y Permisos</strong>.
      </p>
    </div>
  );
}

export function App() {
  return (
    <ChunkErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/cambiar-clave"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader />}>
                <CambiarClavePage />
              </Suspense>
            </ProtectedRoute>
          }
        />
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
          <Route path="produccion" element={<RequireModule module="produccion"><Suspense fallback={<PageLoader />}><ProduccionPage /></Suspense></RequireModule>} />
          <Route path="salidas" element={<RequireModule module="salidas"><Suspense fallback={<PageLoader />}><SalidasPage /></Suspense></RequireModule>} />
          <Route path="combustible" element={<RequireModule module="combustible"><Suspense fallback={<PageLoader />}><CombustiblePage /></Suspense></RequireModule>} />
          <Route path="acopio" element={<RequireModule module="acopio"><Suspense fallback={<PageLoader />}><AcopioPage /></Suspense></RequireModule>} />
          <Route path="tesoreria" element={<RequireModule module="tesoreria"><Suspense fallback={<PageLoader />}><TesoreriaPage /></Suspense></RequireModule>} />
          <Route path="retenciones" element={<RequireModule module="retenciones"><Suspense fallback={<PageLoader />}><RetencionesPage /></Suspense></RequireModule>} />
          <Route path="rrhh" element={<RequireModule module="rrhh"><Suspense fallback={<PageLoader />}><RrhhPage /></Suspense></RequireModule>} />
          <Route path="usuarios" element={<RequireModule module="usuarios"><Suspense fallback={<PageLoader />}><UsuariosPage /></Suspense></RequireModule>} />
          <Route path="ajustes" element={<RequireModule module="ajustes"><Suspense fallback={<PageLoader />}><AjustesPage /></Suspense></RequireModule>} />
          <Route path="sin-acceso" element={<SinAccesoPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </ChunkErrorBoundary>
  );
}
