/* ============================================================
   MGG · RRHH · Alerta de Cumpleañeros del día
   Wrapper idéntico a Golden Touch (GT) para interoperabilidad.
   ============================================================ */
import { useMemo } from 'react';
import type { Personal } from '@/shared/lib/types';
import { CumpleaneroBanner } from './CumpleaneroBanner';
import { obtenerCumpleaneros, type Cumpleanero } from './cumpleanos';

interface Props {
  cumpleaneros?: Cumpleanero[];
  personal?: Personal[];
}

export function CumpleaneroAlerta({ cumpleaneros, personal }: Props) {
  const lista = useMemo(() => {
    if (cumpleaneros) return cumpleaneros;
    if (personal) return obtenerCumpleaneros(personal);
    return [];
  }, [cumpleaneros, personal]);

  return <CumpleaneroBanner cumpleaneros={lista} />;
}

export default CumpleaneroAlerta;
