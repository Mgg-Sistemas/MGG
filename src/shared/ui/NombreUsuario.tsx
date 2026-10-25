/* MGG · Muestra a la persona («Nombre Apellido») en vez de su correo.
   Ver `useNombreUsuario` para la regla. */
import { useNombreUsuario } from '@/shared/lib/useNombreUsuario';

export function NombreUsuario({ nombre, correo, fecha, vacio = '—' }: {
  /** Nombre sellado en la fila (puede venir vacío o ser un correo). */
  nombre?: string | null;
  /** Correo de la cuenta que hizo la acción. */
  correo?: string | null;
  /** Con fecha, el nombre que la persona tenía ese día. */
  fecha?: string | null;
  /** Qué mostrar si no hay ni nombre ni correo. */
  vacio?: string;
}) {
  const nombreDe = useNombreUsuario();
  return <>{nombreDe(nombre, correo, fecha) || vacio}</>;
}
