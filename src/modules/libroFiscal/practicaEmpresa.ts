/* ============================================================
   Golden Touch · Retenciones · ¿La empresa practica el impuesto? (D2b)

   Una sola fuente para «quién retiene qué», también en el registro: la RPC
   retencion_empresa_practica (L6), igual que el tablero «Por realizar».

   - Empresa NO-GT (empresaFicha presente): la práctica sale de la RPC por empresa
     y fecha (detrás del detector regimenPorEmpresaDisponible, que vive dentro de
     impuestosQuePractica). Mientras la RPC no resuelve (o no está), cae a
     puedePracticar(config) como degradación.
   - GT / single-empresa (empresaFicha null): se sigue con puedePracticar(config),
     que es su capacidad de R1 global; no cambia nada.

   Así el régimen deja de leerse de las banderas de la ficha (plastilina que D2b
   retira de configDesdeFicha) y queda en una sola fuente, tablero Y registro.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { impuestosQuePractica } from './noAplica.repository';
import { puedePracticar, TIPOS_IMPUESTO, type ConfigRetencion, type TipoImpuesto } from './retencionesCalculo';
import { tipoAGt } from './retencionesFiscal.repository';

/** Devuelve `puede(tipo, config)`: para NO-GT usa la RPC; para GT/single, puedePracticar(config). */
export function usePuedePracticarEmpresa(
  empresaFicha: unknown | null | undefined,
  empresaId: string | null | undefined,
  fecha: string,
): (tipo: TipoImpuesto, config: ConfigRetencion) => boolean {
  const esNoGt = !!empresaFicha;
  const [practica, setPractica] = useState<Set<TipoImpuesto> | null>(null);
  useEffect(() => {
    if (!esNoGt) { setPractica(null); return; }
    let vivo = true;
    const f = (fecha || hoyVenezuela()).slice(0, 10);
    impuestosQuePractica(TIPOS_IMPUESTO.map((t) => tipoAGt(t.key)), f, empresaId ?? undefined)
      .then((s) => { if (vivo) setPractica(s ? new Set(TIPOS_IMPUESTO.map((t) => t.key).filter((k) => s.has(tipoAGt(k)))) : null); })
      .catch(() => { if (vivo) setPractica(null); });
    return () => { vivo = false; };
  }, [esNoGt, empresaId, fecha]);
  return useCallback(
    (tipo: TipoImpuesto, config: ConfigRetencion) =>
      (esNoGt ? (practica ? practica.has(tipo) : puedePracticar(tipo, config)) : puedePracticar(tipo, config)),
    [esNoGt, practica],
  );
}
