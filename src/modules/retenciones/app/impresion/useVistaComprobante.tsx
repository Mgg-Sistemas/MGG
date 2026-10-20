/* ============================================================
   MGG · Retenciones · Impresión · «🖨 <IMP>» abre la hoja fiel

   Junta las retenciones del comprobante, lee la configuración, el catálogo y
   la dirección del proveedor por la puerta, y abre VistaComprobante.
   HOJA_FIEL_EN_PRODUCCION decide si la hoja fiel reemplaza al PDF de hoy fuera
   de local: queda apagado hasta que la hoja se vea y se imprima en el
   navegador (verificación de Master). Mientras tanto, en producción «🖨» sigue
   abriendo el PDF de hoy (puerta.verComprobante).
   ============================================================ */

import { useState, type ReactNode } from 'react';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { datosComprobante, retencionesDelComprobante, tieneHoja } from './datosComprobante';
import type { DatosComprobante } from './tipos';
import { VistaComprobante } from './VistaComprobante';

export const HOJA_FIEL_EN_PRODUCCION = false;

export function useVistaComprobante(libro: readonly RetencionPracticada[]): { abrir: (r: RetencionPracticada) => Promise<void>; vista: ReactNode } {
  const puerta = usePuerta();
  const [abierta, setAbierta] = useState<{ datos: DatosComprobante; titulo: string } | null>(null);

  const abrir = async (r: RetencionPracticada) => {
    const hojaFiel = (import.meta.env.DEV || HOJA_FIEL_EN_PRODUCCION) && tieneHoja(r.tipo) && r.direccion === 'practicada';
    if (!hojaFiel) { await puerta.verComprobante(r); return; }
    const [config, conceptos, direccion] = await Promise.all([
      puerta.config(), puerta.conceptos(false),
      r.contraparteId && puerta.direccionProveedor ? puerta.direccionProveedor(r.contraparteId) : Promise.resolve(''),
    ]);
    const datos = datosComprobante(retencionesDelComprobante(r, libro), { config, conceptos, direccionSujeto: direccion });
    setAbierta({ datos, titulo: `Comprobante de retención de ${nombreImpuesto(r.tipo)}${r.numeroComprobante ? ` · N° ${r.numeroComprobante}` : ''}` });
  };

  const vista = abierta ? <VistaComprobante datos={abierta.datos} titulo={abierta.titulo} onCerrar={() => setAbierta(null)} /> : null;
  return { abrir, vista };
}
