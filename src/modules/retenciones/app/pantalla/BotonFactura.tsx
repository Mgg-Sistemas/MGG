/* MGG · Retenciones v8 · «📎 Factura» o «📎 Sin archivo» (maqueta, v8BotonFactura). */

import { toast } from '@/shared/ui/Toast';
import { usePuerta, type ArchivoFactura } from '../datos/puerta';

export function BotonFactura({ archivos, nombre }: { archivos: ArchivoFactura[] | undefined; nombre: string }) {
  const puerta = usePuerta();
  if (!puerta.verFactura) return null;
  if (!archivos?.length) {
    return <button type="button" className="mini" disabled title="Sin archivo de factura en Compras" aria-label="Sin archivo de factura en Compras">📎 Sin archivo</button>;
  }
  const abrir = () => {
    puerta.verFactura?.(archivos[0]).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo abrir la factura.', 'error'));
  };
  return <button type="button" className="mini" aria-label={`Ver el archivo de la factura ${nombre}`} onClick={abrir}>📎 Factura</button>;
}
