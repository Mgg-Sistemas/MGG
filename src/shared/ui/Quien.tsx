import { useQuien } from '@/shared/lib/directorioUsuarios';

/**
 * «Nombre Apellido» de quien hizo algo, en vez de su correo.
 *   <Quien nombre={m.actor_name} correo={m.actor} />   ·   <Quien correo={r.created_by} />
 * `vacio` es lo que sale si no hay nada (por defecto, nada).
 */
export function Quien({ nombre, correo, vacio = '' }: { nombre?: string | null; correo?: string | null; vacio?: string }) {
  const quien = useQuien();
  return <>{quien(nombre, correo) || vacio}</>;
}
