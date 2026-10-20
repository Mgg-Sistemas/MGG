/* ============================================================
   MGG · Retenciones v8 · El perfil fiscal, con sus datos de la puerta

   Lo que conectan las pantallas (el registro, la Vista agrupada): con
   capacidades.perfilProveedor lee el perfil, sus actividades, su licencia y
   los tipos de licencia, y guarda por la puerta. Sin ella, el diálogo sale
   solo en local, sin datos y sin guardar (con la marca 2.1).
   ============================================================ */

import { useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type DatosPerfil, type TipoLicencia } from '../datos/puerta';
import { PerfilProveedorDialogo, type PropsPerfil } from './PerfilProveedorDialogo';

type Props = Omit<PropsPerfil, 'perfil' | 'actividades' | 'licencia' | 'historialLicencia' | 'tiposLicencia' | 'disponible' | 'onGuardar'>;

export function PerfilFiscal(props: Props) {
  const puerta = usePuerta();
  const conBase = puerta.capacidades.perfilProveedor && !!puerta.perfilProveedor;
  const [datos, setDatos] = useState<{ d: DatosPerfil; tipos: TipoLicencia[] } | null>(null);
  const { proveedor, onCerrar } = props;

  useEffect(() => {
    if (!conBase || !puerta.perfilProveedor) return;
    let vivo = true;
    Promise.all([puerta.perfilProveedor(proveedor.id), puerta.tiposLicencia ? puerta.tiposLicencia() : Promise.resolve([])])
      .then(([d, tipos]) => { if (vivo) setDatos({ d, tipos }); })
      .catch((e: unknown) => { toast(e instanceof Error ? e.message : 'No se pudo leer el perfil fiscal.', 'error'); onCerrar(); });
    return () => { vivo = false; };
  }, [conBase, puerta, proveedor.id, onCerrar]);

  if (!conBase) return <PerfilProveedorDialogo {...props} />;
  if (!datos) return null;
  const guardar = puerta.guardarPerfilProveedor;
  return (
    <PerfilProveedorDialogo {...props} disponible perfil={datos.d.perfil} actividades={datos.d.actividades} licencia={datos.d.licencia}
      historialLicencia={datos.d.historial} tiposLicencia={datos.tipos}
      onGuardar={guardar ? async (c) => { await guardar(proveedor.id, c); toast('Perfil fiscal guardado.', 'success'); } : undefined} />
  );
}
