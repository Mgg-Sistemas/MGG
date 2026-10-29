/* ============================================================
   MGG · Mis pantallas de teléfono (13-10-2026, traído de Golden Touch)

   El inicio de quien tiene varias pantallas de teléfono: un botón grande por
   cada una. Quien tiene una sola entra directo a ella y no pasa por aquí.
   ============================================================ */
import { Link } from 'react-router-dom';
import { usePermissions } from './PermissionsContext';
import { useFlujoRevisionAlmacen } from '@/modules/pedidos/revisionAlmacen.repository';

export function TelefonoInicioPage() {
  const { loading, appUser, vistasTelefono: todas } = usePermissions();
  // «Solicitudes de Pedido» solo con el flujo SP → Almacén → Compras prendido (29-10-2026).
  const flujoAlmacen = useFlujoRevisionAlmacen();
  const vistasTelefono = todas.filter((v) => v.key !== 'solicitudes' || flujoAlmacen);
  if (loading) return <div className="p-8 muted">Cargando…</div>;

  return (
    <div className="surtidor">
      <header className="surt-head">
        <div>
          <h1>📱 Mis pantallas</h1>
          <div className="muted" style={{ fontSize: '.85rem' }}>{appUser?.nombre?.trim() || appUser?.email || ''}</div>
        </div>
      </header>

      {!vistasTelefono.length ? (
        <div className="aviso warning sm" style={{ margin: '.75rem 0' }}>
          <span className="aviso-icono">📵</span>
          <div>
            Tu rol todavía no tiene pantallas de teléfono. Pídele a un administrador que te las asigne en
            <strong> Usuarios → Roles y Permisos</strong>.
          </div>
        </div>
      ) : (
        <>
          <div className="surt-rotulo">¿Qué vas a cargar?</div>
          <div className="telefono-pantallas">
            {vistasTelefono.map((v) => (
              <Link key={v.key} to={v.ruta} className="surt-btn">
                <span className="icono" aria-hidden>{v.icono}</span>
                <span>{v.label}</span>
                <small>{v.descripcion}</small>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
