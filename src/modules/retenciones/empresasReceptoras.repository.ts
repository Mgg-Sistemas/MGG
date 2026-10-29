/* ============================================================
   MGG · Retenciones · Empresas receptoras (Multi-Empresa)
   Alineado 1:1 con Golden Touch empresasReceptoras.repository.ts

   Permite clasificar las facturas y retenciones según la empresa
   receptora (Mineral Group Guayana C.A., Golden Touch 1127 C.A.,
   Minería TS / MTO, etc.).
   
   Doble propósito por rol:
   1. Para Facturas (móvil/campo): selección táctil rápida o tipear
      cualquier empresa/código con un botón ("✏ Escribir otra").
   2. Para Retención / Impuestos (oficina): gestión completa de la
      ficha fiscal (RIF, domicilio fiscal, municipio, licencia,
      régimen de agente IVA/ISLR, reportes independientes sin afectar a MGG).
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { EMPRESA_NOMBRE, EMPRESA_RIF, EMPRESA_DOMICILIO, EMPRESA_EMAIL } from '@/shared/lib/empresa';
import { rifEmpresaParaGuardar } from '@/modules/libroFiscal/parametrosEmpresa';

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

export const EMPRESAS_POR_DEFECTO: EmpresaReceptora[] = [
  {
    id: 'empresa-mgg',
    clave: 'mgg',
    nombre: EMPRESA_NOMBRE || 'Mineral Group Guayana C.A.',
    nombreCorto: 'MGG',
    rif: EMPRESA_RIF || 'J-50221930-7',
    colorBadge: '#2563eb',
    activo: true,
    orden: 1,
    direccionFiscal: EMPRESA_DOMICILIO || 'Zona Industrial Los Pinos, Puerto Ordaz, Estado Bolívar',
    municipio: 'Caroní',
    estado: 'Bolívar',
    email: EMPRESA_EMAIL || 'administracion@mgg.com',
    esAgenteRetencionIva: true,
    esContribuyenteEspecial: true,
    retieneIslr: true,
    retieneMunicipal: true,
    pctIvaGeneral: 75,
    imprimirOriginalYCopia: true,
  },
  {
    id: 'empresa-golden-touch',
    clave: 'golden_touch',
    nombre: 'Golden Touch 1127 C.A.',
    nombreCorto: 'Golden Touch',
    rif: 'J-50112745-6',
    colorBadge: '#eab308',
    activo: true,
    orden: 2,
    direccionFiscal: 'Caracas / Bolívar, Venezuela',
    municipio: 'Caroní',
    estado: 'Bolívar',
    email: 'administracion@goldentouch1127.com',
    esAgenteRetencionIva: true,
    esContribuyenteEspecial: false,
    retieneIslr: true,
    retieneMunicipal: true,
    pctIvaGeneral: 75,
    imprimirOriginalYCopia: true,
  },
  {
    id: 'empresa-mineria-ts',
    clave: 'mineria_ts',
    nombre: 'Minería TS C.A.',
    nombreCorto: 'Minería TS / MTO',
    rif: 'J-50348912-3',
    colorBadge: '#d97706',
    activo: true,
    orden: 3,
    direccionFiscal: 'El Callao, Estado Bolívar, Venezuela',
    municipio: 'El Callao',
    estado: 'Bolívar',
    email: 'contacto@minerats.com',
    esAgenteRetencionIva: true,
    esContribuyenteEspecial: false,
    retieneIslr: true,
    retieneMunicipal: false,
    pctIvaGeneral: 75,
    imprimirOriginalYCopia: true,
  },
];

const LOCAL_STORAGE_KEY = 'mgg.retenciones.empresas_receptoras';
let _memoriaEmpresas: EmpresaReceptora[] = [...EMPRESAS_POR_DEFECTO];

function leerCacheLocal(): EmpresaReceptora[] {
  if (typeof window === 'undefined') return _memoriaEmpresas;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return EMPRESAS_POR_DEFECTO;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : EMPRESAS_POR_DEFECTO;
  } catch {
    return EMPRESAS_POR_DEFECTO;
  }
}

function guardarCacheLocal(empresas: EmpresaReceptora[]): void {
  _memoriaEmpresas = empresas;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(empresas));
  } catch {
    /* ignore */
  }
}

function mapearFilaEmpresa(r: Record<string, unknown>, idx: number): EmpresaReceptora {
  return {
    id: String(r.id),
    clave: String(r.clave || r.id),
    nombre: String(r.nombre || 'Empresa sin nombre'),
    nombreCorto: r.nombre_corto ? String(r.nombre_corto) : (r.nombreCorto ? String(r.nombreCorto) : undefined),
    rif: String(r.rif || 'S/RIF'),
    colorBadge: String(r.color_badge || r.colorBadge || '#64748b'),
    activo: r.activo !== false,
    orden: Number(r.orden ?? idx + 1),
    email: r.email ? String(r.email) : undefined,
    telefono: r.telefono ? String(r.telefono) : undefined,
    direccionFiscal: r.direccion_fiscal ? String(r.direccion_fiscal) : (r.direccionFiscal ? String(r.direccionFiscal) : undefined),
    municipio: r.municipio ? String(r.municipio) : undefined,
    estado: r.estado ? String(r.estado) : undefined,
    licenciaMunicipal: r.licencia_municipal ? String(r.licencia_municipal) : (r.licenciaMunicipal ? String(r.licenciaMunicipal) : undefined),
    esAgenteRetencionIva: r.es_agente_iva != null ? Boolean(r.es_agente_iva) : (r.esAgenteRetencionIva != null ? Boolean(r.esAgenteRetencionIva) : true),
    esContribuyenteEspecial: r.es_contribuyente_especial != null ? Boolean(r.es_contribuyente_especial) : (r.esContribuyenteEspecial != null ? Boolean(r.esContribuyenteEspecial) : false),
    retieneIslr: r.retiene_islr != null ? Boolean(r.retiene_islr) : (r.retieneIslr != null ? Boolean(r.retieneIslr) : true),
    retieneMunicipal: r.retiene_municipal != null ? Boolean(r.retiene_municipal) : (r.retieneMunicipal != null ? Boolean(r.retieneMunicipal) : true),
    pctIvaGeneral: r.pct_iva_general != null ? Number(r.pct_iva_general) : (r.pctIvaGeneral != null ? Number(r.pctIvaGeneral) : 75),
    imprimirOriginalYCopia: r.imprimir_original_y_copia != null ? Boolean(r.imprimir_original_y_copia) : (r.imprimirOriginalYCopia != null ? Boolean(r.imprimirOriginalYCopia) : true),
  };
}

export async function listEmpresasReceptoras(): Promise<EmpresaReceptora[]> {
  try {
    const { data, error } = await supabase
      .from('retencion_empresas_receptoras')
      .select('*')
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });

    if (!error && data && data.length > 0) {
      const mapeadas: EmpresaReceptora[] = data.map((r, idx) => mapearFilaEmpresa(r as Record<string, unknown>, idx));
      guardarCacheLocal(mapeadas);
      return mapeadas;
    }
  } catch {
    /* fallback a cache local */
  }
  return leerCacheLocal();
}

/**
 * Guarda o actualiza una empresa receptora.
 * Valida el RIF si se ingresa.
 */
export async function guardarEmpresaReceptora(
  empresa: Omit<EmpresaReceptora, 'id' | 'clave' | 'orden'> & { id?: string; clave?: string; orden?: number },
): Promise<EmpresaReceptora> {
  const id = empresa.id || `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const claveCalculada = (empresa.clave || empresa.nombreCorto || empresa.nombre)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 30);

  // Si tiene RIF, verificar con rifEmpresaParaGuardar
  let rifNormalizado = empresa.rif?.trim().toUpperCase() || 'S/RIF';
  if (rifNormalizado && rifNormalizado !== 'S/RIF') {
    const r = rifEmpresaParaGuardar(rifNormalizado);
    if (!r.error && r.rif) {
      rifNormalizado = r.rif;
    }
  }

  const registro: EmpresaReceptora = {
    id,
    clave: claveCalculada || id,
    nombre: empresa.nombre.trim(),
    nombreCorto: empresa.nombreCorto?.trim() || undefined,
    rif: rifNormalizado,
    colorBadge: empresa.colorBadge || '#2563eb',
    activo: empresa.activo !== false,
    orden: empresa.orden || 10,
    email: empresa.email?.trim() || undefined,
    telefono: empresa.telefono?.trim() || undefined,
    direccionFiscal: empresa.direccionFiscal?.trim() || undefined,
    municipio: empresa.municipio?.trim() || undefined,
    estado: empresa.estado?.trim() || undefined,
    licenciaMunicipal: empresa.licenciaMunicipal?.trim() || undefined,
    esAgenteRetencionIva: empresa.esAgenteRetencionIva ?? true,
    esContribuyenteEspecial: empresa.esContribuyenteEspecial ?? false,
    retieneIslr: empresa.retieneIslr ?? true,
    retieneMunicipal: empresa.retieneMunicipal ?? false,
    pctIvaGeneral: empresa.pctIvaGeneral ?? 75,
    imprimirOriginalYCopia: empresa.imprimirOriginalYCopia ?? true,
  };

  try {
    const { error } = await supabase.from('retencion_empresas_receptoras').upsert({
      id: registro.id,
      clave: registro.clave,
      nombre: registro.nombre,
      nombre_corto: registro.nombreCorto || null,
      rif: registro.rif,
      color_badge: registro.colorBadge,
      activo: registro.activo,
      orden: registro.orden,
      email: registro.email || null,
      telefono: registro.telefono || null,
      direccion_fiscal: registro.direccionFiscal || null,
      municipio: registro.municipio || null,
      estado: registro.estado || null,
      licencia_municipal: registro.licenciaMunicipal || null,
      es_agente_iva: registro.esAgenteRetencionIva,
      es_contribuyente_especial: registro.esContribuyenteEspecial,
      retiene_islr: registro.retieneIslr,
      retiene_municipal: registro.retieneMunicipal,
      pct_iva_general: registro.pctIvaGeneral,
      imprimir_original_y_copia: registro.imprimirOriginalYCopia,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('Upsert en retencion_empresas_receptoras no disponible, usando fallback local:', error.message);
    }
  } catch {
    // Fallback a localStorage
  }

  // Guardar en cache local siempre para disponibilidad inmediata
  const actuales = leerCacheLocal();
  const idx = actuales.findIndex((e) => e.id === registro.id || e.clave === registro.clave);
  if (idx >= 0) {
    actuales[idx] = registro;
  } else {
    actuales.push(registro);
  }
  guardarCacheLocal(actuales);

  return registro;
}

export async function eliminarEmpresaReceptora(id: string): Promise<void> {
  try {
    await supabase.from('retencion_empresas_receptoras').delete().eq('id', id);
  } catch {
    /* ignore */
  }
  const actuales = leerCacheLocal().filter((e) => e.id !== id);
  guardarCacheLocal(actuales.length > 0 ? actuales : EMPRESAS_POR_DEFECTO);
}
