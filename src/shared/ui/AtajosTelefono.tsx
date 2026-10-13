/* ============================================================
   MGG · Atajos entre pantallas de teléfono (02-10-2026 · 13-10-2026)

   Una persona de teléfono puede tener varias pantallas (surtidor y comidas,
   por ejemplo). Arriba de cada una se le ofrecen las OTRAS que tiene dadas en
   su rol, con un toque. Sin otras pantallas no pinta nada: una persona con
   una sola no tiene por qué ver una barra vacía. Desde el 13-10 las pantallas
   se otorgan por rol en Roles y Permisos, no salen del permiso del módulo.
   ============================================================ */
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';

export function AtajosTelefono({ actual }: { actual: string }) {
  const { vistasTelefono } = usePermissions();
  const rutaActual = actual.startsWith('/') ? actual : `/app/${actual}`;
  const otras = vistasTelefono.filter((v) => v.ruta !== rutaActual);
  if (!otras.length) return null;
  return (
    <nav aria-label="Otras pantallas de teléfono" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', margin: '0 0 .75rem' }}>
      <span className="muted" style={{ fontSize: '.78rem' }}>Ir a:</span>
      {otras.map((v) => (
        <Link key={v.key} to={v.ruta} className="btn btn-sm btn-ghost">{v.icono} {v.label}</Link>
      ))}
    </nav>
  );
}
