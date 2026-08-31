/* ==== MGG · Inventario · sectorización · el hook que consultan las pantallas ====
   Separado de `sectorizacion.ts` a propósito: ahí viven las funciones puras
   (se testean sin base ni React) y acá el enganche con la sesión.

   El hook resuelve la sede de cada almacén por su cuenta (la tabla `almacenes`
   está cacheada y ya la piden todos los desplegables), así los 7 caminos que
   mueven stock preguntan lo mismo con una línea, sin pasarse listas entre sí. */

import { useEffect, useMemo, useState } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { Almacen } from '@/shared/lib/types';
import { listAlmacenes } from './almacenes.repository';
import { motivoAlmacenAjeno, puedeMoverEnAlmacen, sedesDeUsuario } from './sectorizacion';

export interface Sectorizacion {
  /** Sedes donde este usuario puede mover. `null` = sin restricción. */
  sedes: string[] | null;
  /** true si le aplica la restricción (para mostrar el aviso y el botón de traslado). */
  sectorizado: boolean;
  /** Para pasarle a `AlmacenPicker`/`AlmacenSelectAgrupado` como `soloSedes`. */
  soloSedes: string[] | undefined;
  /** true cuando ya se sabe de qué sede es cada almacén. */
  listo: boolean;
  /** ¿Puede mover en este almacén? Mientras no esté `listo` no bloquea nada. */
  puedeMover: (almacen: string | null | undefined) => boolean;
  /** Mensaje de por qué no, o `null` si sí puede. */
  motivo: (almacen: string | null | undefined) => string | null;
}

/**
 * Sector del usuario logueado. Los almacenistas VEN todo el inventario pero solo
 * pueden mover en sus sedes; lo ajeno se pide por solicitud de traslado.
 */
export function useSectorizacion(): Sectorizacion {
  const { appUser } = usePermissions();
  // La clave es el CONTENIDO de la asignación, no la identidad del objeto: el realtime
  // de `usuarios` reemplaza `appUser` en cada evento y, dependiendo del objeto, el
  // efecto de abajo se relanzaría por cambios que no tienen nada que ver con el sector.
  const claveSector = `${(appUser?.sedes_asignadas ?? []).join('|')}#${appUser?.email ?? ''}`;
  const sedes = useMemo(
    () => sedesDeUsuario(appUser),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claveSector],
  );

  // Los dos espacios: un almacén de depósito también tiene sede, y si no estuviera
  // en la lista se leería como «sede desconocida» y quedaría bloqueado sin motivo.
  const [almacenes, setAlmacenes] = useState<Almacen[] | null>(null);
  useEffect(() => {
    if (!sedes) { setAlmacenes([]); return; }      // sin restricción: no hace falta resolver nada
    let cancel = false;
    Promise.all([
      listAlmacenes('principal').catch(() => [] as Almacen[]),
      listAlmacenes('deposito').catch(() => [] as Almacen[]),
    ]).then(([p, d]) => { if (!cancel) setAlmacenes([...p, ...d]); });
    return () => { cancel = true; };
  }, [sedes]);

  return useMemo(() => {
    const listo = almacenes !== null;
    return {
      sedes,
      sectorizado: sedes !== null,
      soloSedes: sedes ?? undefined,
      listo,
      // Sin restricción, o antes de saber de qué sede es cada almacén, no se bloquea:
      // el desplegable ya viene filtrado por `soloSedes` y la guarda del submit
      // exige `listo` antes de dejar guardar.
      puedeMover: (almacen) => (!sedes || !listo ? true : puedeMoverEnAlmacen(almacen, almacenes ?? [], sedes)),
      motivo: (almacen) => (!sedes || !listo ? null : motivoAlmacenAjeno(almacen, almacenes ?? [], sedes)),
    };
  }, [sedes, almacenes]);
}
