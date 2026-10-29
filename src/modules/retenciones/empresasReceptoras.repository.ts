/* ============================================================
   MGG · Retenciones · Empresas receptoras (Multi-Empresa)
   Alineado 1:1 con Golden Touch (GT) empresasReceptoras.repository.ts

   Permite clasificar las facturas y retenciones según la empresa
   receptora (Mineral Group Guayana C.A., Golden Touch 1127 C.A.,
   Minería TS / MTO, etc.).
   
   Doble propósito por rol:
   1. Para Facturas (móvil/campo): selección táctil rápida o tipear
      cualquier empresa/código con un botón ("➕ Nueva empresa").
   2. Para Retención / Impuestos (oficina): gestión completa de la
      ficha fiscal (RIF, domicilio fiscal, municipio, licencia,
      régimen de agente IVA/ISLR, reportes independientes sin afectar a MGG).
   ============================================================ */

import {
  listEmpresasFiscales,
  guardarDatosFiscalesEmpresa,
  crearEmpresaFiscal,
  type DatosFiscalesEmpresa,
} from './empresasFiscales.repository';

export interface EmpresaReceptora {
  id: string;
  clave: string;
  nombre: string;
  nombreCorto?: string;
  rif: string;
  colorBadge: string;
  activo: boolean;
  orden: number;

  // Ficha fiscal completa (para Retención / Impuestos)
  email?: string;
  telefono?: string;
  direccionFiscal?: string;
  municipio?: string;
  estado?: string;
  licenciaMunicipal?: string;

  // Régimen fiscal y condición de agente
  esAgenteRetencionIva?: boolean;
  esContribuyenteEspecial?: boolean;
  retieneIslr?: boolean;
  retieneMunicipal?: boolean;
  pctIvaGeneral?: number;
  imprimirOriginalYCopia?: boolean;
}

export function aEmpresaReceptora(d: DatosFiscalesEmpresa, idx = 0): EmpresaReceptora {
  const clave = d.codigo.toLowerCase();
  const colorMap: Record<string, string> = {
    mgg: '#2563eb',
    golden: '#eab308',
    goldentouch: '#eab308',
    mineriats: '#d97706',
    mto: '#d97706',
  };

  return {
    id: `empresa-${clave.replace(/[^a-z0-9]+/g, '-')}`,
    clave,
    nombre: d.razonSocial,
    nombreCorto: d.codigo,
    rif: d.rif,
    colorBadge: colorMap[clave] || '#64748b',
    activo: d.activa !== false,
    orden: idx + 1,
    email: d.email || undefined,
    telefono: d.telefono || undefined,
    direccionFiscal: d.direccionFiscal || undefined,
    municipio: d.municipio || undefined,
    estado: d.estado || undefined,
    esAgenteRetencionIva: d.esAgenteRetencionIva,
    esContribuyenteEspecial: d.esContribuyenteEspecial,
    retieneIslr: true,
    retieneMunicipal: false,
    pctIvaGeneral: d.pctIvaGeneral,
    imprimirOriginalYCopia: true,
  };
}

export async function listEmpresasReceptoras(): Promise<EmpresaReceptora[]> {
  const lista = await listEmpresasFiscales();
  return lista.map((e, idx) => aEmpresaReceptora(e, idx));
}

export async function guardarEmpresaReceptora(
  empresa: Partial<EmpresaReceptora> & { nombre: string; rif: string; clave?: string }
): Promise<EmpresaReceptora> {
  const codigo = (empresa.nombreCorto || empresa.clave || empresa.nombre.slice(0, 10))
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');

  const fiscalInput: DatosFiscalesEmpresa = {
    codigo,
    razonSocial: empresa.nombre.trim(),
    rif: empresa.rif.trim(),
    direccionFiscal: empresa.direccionFiscal?.trim() || null,
    ciudad: null,
    municipio: empresa.municipio?.trim() || null,
    estado: empresa.estado?.trim() || null,
    telefono: empresa.telefono?.trim() || null,
    email: empresa.email?.trim() || null,
    esContribuyenteEspecial: empresa.esContribuyenteEspecial ?? false,
    esAgenteRetencionIva: empresa.esAgenteRetencionIva ?? true,
    pctIvaGeneral: empresa.pctIvaGeneral ?? 75,
    pctIvaEspecial: 100,
    activa: empresa.activo !== false,
  };

  await guardarDatosFiscalesEmpresa(fiscalInput);
  return aEmpresaReceptora(fiscalInput);
}

export { crearEmpresaFiscal };

