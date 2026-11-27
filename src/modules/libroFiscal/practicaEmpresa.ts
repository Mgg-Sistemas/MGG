/* ============================================================
   Golden Touch · Retenciones · ¿La empresa practica el impuesto? (D2b)

   Una sola fuente para «quién retiene qué», tanto en el libro como en el
   registro: la RPC retencion_empresa_practica (L6) para TODAS las empresas
   (incluida Golden Touch y empresas secundarias).

   - Consulta la RPC `retencion_empresa_practica` por empresa y fecha.
   - Mientras la RPC no resuelve (o si falla/no está disponible), cae
     estrictamente a `puedePracticar(tipo, config)` como degradación segura.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { impuestosQuePractica } from './noAplica.repository';
import { puedePracticar, TIPOS_IMPUESTO, type ConfigRetencion, type TipoImpuesto } from './retencionesCalculo';
import { tipoAGt } from './retencionesFiscal.repository';
import { esEmpresaGt } from '../retenciones/empresaActual';

/** Devuelve `puede(tipo, config)`: para GT se rige directamente por la gobernanza de Parámetros (ISLR + ISAE, sin IVA); para empresas externas del buzón consulta la RPC retencion_empresa_practica. */
export function usePuedePracticarEmpresa(
  _empresaFicha: unknown | null | undefined,
  empresaId: string | null | undefined,
  fecha: string,
): (tipo: TipoImpuesto, config: ConfigRetencion) => boolean {
  const [practica, setPractica] = useState<Set<TipoImpuesto> | null>(null);
  const esGt = !empresaId || esEmpresaGt({ id: empresaId }) || (_empresaFicha ? esEmpresaGt(_empresaFicha as any) : false);

  useEffect(() => {
    let vivo = true;
    const f = (fecha || hoyVenezuela()).slice(0, 10);
    if (!esGt) {
      impuestosQuePractica(TIPOS_IMPUESTO.map((t) => tipoAGt(t.key)), f, empresaId ?? undefined)
        .then((s) => {
          if (vivo) {
            setPractica(s ? new Set(TIPOS_IMPUESTO.map((t) => t.key).filter((k) => s.has(tipoAGt(k)))) : null);
          }
        })
        .catch(() => {
          if (vivo) setPractica(null);
        });
    } else {
      setPractica(null);
    }
    return () => { vivo = false; };
  }, [empresaId, fecha, esGt]);

  return useCallback(
    (tipo: TipoImpuesto, config: ConfigRetencion) => {
      if (esGt) {
        // Golden Touch es Contribuyente Ordinario ante el SENIAT: NO retiene IVA a proveedores salvo designación formal como Contribuyente Especial
        if (tipo === 'iva') return config.esContribuyenteEspecial === true;
        if (tipo === 'municipal') return config.retieneMunicipal !== false;
        return puedePracticar(tipo, config);
      }
      return practica ? practica.has(tipo) : puedePracticar(tipo, config);
    },
    [esGt, practica],
  );
}
