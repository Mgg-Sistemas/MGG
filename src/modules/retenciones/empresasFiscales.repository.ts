/* ============================================================
   MGG · Retenciones · Empresas Fiscales y Datos Tributarios (29-10-2026)

   Permite gestionar la información fiscal completa de cada empresa del grupo
   (MGG, Golden Touch, MineriaTs / MTO, etc.):
   - RIF, Razón Social, Dirección Fiscal, Municipio y Estado.
   - Condición de Contribuyente Especial y Agente de Retención de IVA.
   - Porcentajes aplicables (75% / 100%).
   - Almacenado en `config['retenciones.empresas_fiscales']`, con semillas
     predeterminadas para que siempre haya datos fiscales disponibles.
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { normalizarRif, rifValido } from '@/shared/lib/rif';
import { listEmpresas } from '@/modules/rrhh/empresas.repository';

export const CLAVE_CONFIG_EMPRESAS = 'retenciones.empresas_fiscales';

export interface DatosFiscalesEmpresa {
  codigo: string;
  razonSocial: string;
  rif: string;
  direccionFiscal: string | null;
  ciudad: string | null;
  municipio: string | null;
  estado: string | null;
  telefono?: string | null;
  email?: string | null;
  esContribuyenteEspecial: boolean;
  esAgenteRetencionIva: boolean;
  pctIvaGeneral: number;
  pctIvaEspecial: number;
  prefijoComprobante?: string | null;
  activa: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

export const EMPRESAS_FISCALES_DEFECTO: DatosFiscalesEmpresa[] = [
  {
    codigo: 'MGG',
    razonSocial: 'Mineral Group Guayana C.A.',
    rif: 'J-50221930-7',
    direccionFiscal: 'Av. Caracas, Edif. MGG, Planta Baja, Puerto Ordaz',
    ciudad: 'Puerto Ordaz',
    municipio: 'Caroní',
    estado: 'Bolívar',
    telefono: '0286-9234567',
    email: 'administracion@mgg.com',
    esContribuyenteEspecial: true,
    esAgenteRetencionIva: true,
    pctIvaGeneral: 75,
    pctIvaEspecial: 100,
    prefijoComprobante: 'MGG',
    activa: true,
  },
  {
    codigo: 'GOLDEN',
    razonSocial: 'Golden Touch 1127 C.A.',
    rif: 'J-50129993-5',
    direccionFiscal: 'Av. Fuerzas Armadas, Centro Comercial Altavista, Puerto Ordaz',
    ciudad: 'Puerto Ordaz',
    municipio: 'Caroní',
    estado: 'Bolívar',
    telefono: '0286-9612345',
    email: 'contacto@goldentouch.com',
    esContribuyenteEspecial: true,
    esAgenteRetencionIva: true,
    pctIvaGeneral: 75,
    pctIvaEspecial: 100,
    prefijoComprobante: 'GT',
    activa: true,
  },
  {
    codigo: 'MINERIATS',
    razonSocial: 'Mineria Tin Oxide C.A.',
    rif: 'J-41234567-8',
    direccionFiscal: 'Zona Industrial Matanzas, Manzana 12, Parcela 4, Puerto Ordaz',
    ciudad: 'Puerto Ordaz',
    municipio: 'Caroní',
    estado: 'Bolívar',
    telefono: '0286-9945678',
    email: 'finanzas@mineriatinoxide.com',
    esContribuyenteEspecial: false,
    esAgenteRetencionIva: false,
    pctIvaGeneral: 75,
    pctIvaEspecial: 100,
    prefijoComprobante: 'MTO',
    activa: true,
  },
];

export async function leerMapaEmpresasFiscales(): Promise<Record<string, DatosFiscalesEmpresa>> {
  const res: Record<string, DatosFiscalesEmpresa> = {};
  for (const e of EMPRESAS_FISCALES_DEFECTO) res[e.codigo] = { ...e };

  // 1. Intentar leer de retencion_empresas_receptoras si la tabla existe (1:1 con GT)
  try {
    const { data, error } = await supabase.from('retencion_empresas_receptoras').select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      for (const r of data as Record<string, unknown>[]) {
        const cod = String(r.clave || r.nombre_corto || r.nombre || r.id).toUpperCase();
        res[cod] = {
          codigo: cod,
          razonSocial: String(r.nombre || cod),
          rif: String(r.rif || ''),
          direccionFiscal: r.direccion_fiscal ? String(r.direccion_fiscal) : null,
          ciudad: null,
          municipio: r.municipio ? String(r.municipio) : null,
          estado: r.estado ? String(r.estado) : null,
          telefono: r.telefono ? String(r.telefono) : null,
          email: r.email ? String(r.email) : null,
          esContribuyenteEspecial: Boolean(r.es_contribuyente_especial),
          esAgenteRetencionIva: Boolean(r.es_agente_iva),
          pctIvaGeneral: Number(r.pct_iva_general) || 75,
          pctIvaEspecial: 100,
          activa: r.activo !== false,
          updatedAt: r.updated_at ? String(r.updated_at) : undefined,
        };
      }
    }
  } catch {
    // Si la tabla aún no existe, continúa con config
  }

  // 2. Complementar con config['retenciones.empresas_fiscales']
  try {
    const { data } = await supabase.from('config').select('value').eq('key', CLAVE_CONFIG_EMPRESAS).maybeSingle();
    if (data?.value && typeof data.value === 'object') {
      const val = data.value as Record<string, unknown>;
      for (const [k, v] of Object.entries(val)) {
        if (v && typeof v === 'object') {
          const item = v as Record<string, unknown>;
          res[k.toUpperCase()] = {
            codigo: String(item.codigo || k).toUpperCase(),
            razonSocial: String(item.razonSocial || item.razon_social || k),
            rif: String(item.rif || ''),
            direccionFiscal: item.direccionFiscal ? String(item.direccionFiscal) : (item.direccion_fiscal ? String(item.direccion_fiscal) : null),
            ciudad: item.ciudad ? String(item.ciudad) : null,
            municipio: item.municipio ? String(item.municipio) : null,
            estado: item.estado ? String(item.estado) : null,
            telefono: item.telefono ? String(item.telefono) : null,
            email: item.email ? String(item.email) : null,
            esContribuyenteEspecial: item.esContribuyenteEspecial === true || item.es_contribuyente_especial === true,
            esAgenteRetencionIva: item.esAgenteRetencionIva === true || item.es_agente_retencion_iva === true,
            pctIvaGeneral: Number(item.pctIvaGeneral || item.pct_iva_general) || 75,
            pctIvaEspecial: Number(item.pctIvaEspecial || item.pct_iva_especial) || 100,
            prefijoComprobante: item.prefijoComprobante ? String(item.prefijoComprobante) : null,
            activa: item.activa !== false,
            updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
            updatedBy: item.updatedBy ? String(item.updatedBy) : undefined,
          };
        }
      }
    }
  } catch {
    // Fallback de config
  }

  return res;
}

/** Devuelve la lista consolidada de empresas con sus datos tributarios. */
export async function listEmpresasFiscales(): Promise<DatosFiscalesEmpresa[]> {
  const [mapaFiscal, empresasRrhh] = await Promise.all([
    leerMapaEmpresasFiscales(),
    listEmpresas().catch(() => []),
  ]);

  // Si en RRHH se agregaron empresas que no están en el mapa fiscal, añadirlas con defaults limpios
  for (const emp of empresasRrhh) {
    const k = emp.key.toUpperCase();
    if (!mapaFiscal[k]) {
      mapaFiscal[k] = {
        codigo: k,
        razonSocial: emp.razonSocial || emp.label || k,
        rif: emp.rif || '',
        direccionFiscal: null,
        ciudad: null,
        municipio: null,
        estado: null,
        esContribuyenteEspecial: false,
        esAgenteRetencionIva: false,
        pctIvaGeneral: 75,
        pctIvaEspecial: 100,
        activa: emp.activa !== false,
      };
    } else if (emp.rif && !mapaFiscal[k].rif) {
      mapaFiscal[k].rif = emp.rif;
    }
  }

  return Object.values(mapaFiscal).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Obtiene la información fiscal de una empresa específica. */
export async function getDatosFiscalesEmpresa(codigo: string): Promise<DatosFiscalesEmpresa> {
  const k = codigo.trim().toUpperCase();
  const mapa = await leerMapaEmpresasFiscales();
  if (mapa[k]) return mapa[k];

  return {
    codigo: k,
    razonSocial: k,
    rif: '',
    direccionFiscal: null,
    ciudad: null,
    municipio: null,
    estado: null,
    esContribuyenteEspecial: false,
    esAgenteRetencionIva: false,
    pctIvaGeneral: 75,
    pctIvaEspecial: 100,
    activa: true,
  };
}

/** Guarda o actualiza los datos fiscales de una empresa. */
export async function guardarDatosFiscalesEmpresa(
  d: DatosFiscalesEmpresa,
  actor?: string
): Promise<void> {
  const codigo = d.codigo.trim().toUpperCase();
  if (!codigo) throw new Error('El código de la empresa es obligatorio.');

  const razonSocial = d.razonSocial.trim();
  if (razonSocial.length < 3) throw new Error('La razón social debe tener al menos 3 caracteres.');

  let rifNorm = '';
  if (d.rif?.trim()) {
    const normalizado = normalizarRif(d.rif);
    if (!normalizado || !rifValido(normalizado)) {
      throw new Error(`El RIF «${d.rif}» no es válido según el formato SENIAT (ej. J-12345678-0).`);
    }
    rifNorm = normalizado;
  }

  const mapa = await leerMapaEmpresasFiscales();
  mapa[codigo] = {
    ...d,
    codigo,
    razonSocial,
    rif: rifNorm,
    direccionFiscal: d.direccionFiscal?.trim() || null,
    ciudad: d.ciudad?.trim() || null,
    municipio: d.municipio?.trim() || null,
    estado: d.estado?.trim() || null,
    telefono: d.telefono?.trim() || null,
    email: d.email?.trim() || null,
    pctIvaGeneral: Number(d.pctIvaGeneral) || 75,
    pctIvaEspecial: Number(d.pctIvaEspecial) || 100,
    prefijoComprobante: d.prefijoComprobante?.trim() || null,
    activa: d.activa !== false,
    updatedAt: new Date().toISOString(),
    updatedBy: actor || null,
  };

  const { error } = await supabase.from('config').upsert(
    {
      key: CLAVE_CONFIG_EMPRESAS,
      value: mapa,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  if (error) throw new Error(error.message || 'No se pudieron guardar los datos fiscales de la empresa.');

  // Sincronizar de forma idempotente con retencion_empresas_receptoras (1:1 con GT)
  try {
    await supabase.from('retencion_empresas_receptoras').upsert(
      {
        id: `empresa-${codigo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        clave: codigo.toLowerCase(),
        nombre: razonSocial,
        nombre_corto: codigo,
        rif: rifNorm,
        direccion_fiscal: d.direccionFiscal?.trim() || null,
        municipio: d.municipio?.trim() || null,
        estado: d.estado?.trim() || null,
        telefono: d.telefono?.trim() || null,
        email: d.email?.trim() || null,
        es_contribuyente_especial: d.esContribuyenteEspecial,
        es_agente_iva: d.esAgenteRetencionIva,
        pct_iva_general: Number(d.pctIvaGeneral) || 75,
        activo: d.activa !== false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clave' }
    );
  } catch {
    // Si la tabla física aún no fue migrada, se mantiene en config
  }
}

/**
 * Registra una nueva empresa fiscal.
 * Útil tanto desde la vista de teléfono (con datos sencillos) como desde la oficina.
 */
export async function crearEmpresaFiscal(
  input: {
    codigo: string;
    razonSocial: string;
    rif: string;
    direccionFiscal?: string | null;
    esContribuyenteEspecial?: boolean;
    esAgenteRetencionIva?: boolean;
  },
  actor?: string
): Promise<DatosFiscalesEmpresa> {
  const codigo = input.codigo.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
  if (!codigo) throw new Error('Indica un código para la empresa.');

  const razonSocial = input.razonSocial.trim();
  if (razonSocial.length < 3) throw new Error('Escribe la razón social completa de la empresa.');

  const rifNorm = normalizarRif(input.rif);
  if (!rifNorm || !rifValido(rifNorm)) throw new Error('El RIF no es válido (ej. J-12345678-0).');

  const nuevo: DatosFiscalesEmpresa = {
    codigo,
    razonSocial,
    rif: rifNorm,
    direccionFiscal: input.direccionFiscal?.trim() || null,
    ciudad: 'Puerto Ordaz',
    municipio: 'Caroní',
    estado: 'Bolívar',
    esContribuyenteEspecial: input.esContribuyenteEspecial ?? true,
    esAgenteRetencionIva: input.esAgenteRetencionIva ?? true,
    pctIvaGeneral: 75,
    pctIvaEspecial: 100,
    prefijoComprobante: codigo.slice(0, 4),
    activa: true,
  };

  await guardarDatosFiscalesEmpresa(nuevo, actor);
  return nuevo;
}

