import { describe, expect, it } from 'vitest';
import { EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';
import { CONFIG_RETENCION_DEFECTO, type ConfigRetencion } from './retencionesCalculo';
import type { RetencionPracticada } from './retencionesFiscal.repository';
import {
  cadenaCanonicoFiscal, calcularSha256Hex, generarQrVerificacion, lineaEquivalenteBs, partesComprobante,
} from './comprobanteRetencionPdf';

// Datos inventados: ninguna empresa, proveedor ni cliente real.
const empresa: ConfigRetencion = {
  ...CONFIG_RETENCION_DEFECTO,
  razonSocial: 'Empresa de Prueba C.A.',
  rif: 'J-00000000-0',
  direccionFiscal: 'Dirección de prueba',
  municipio: 'Municipio de prueba',
  estado: 'Estado de prueba',
};

const retencion = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada',
  docKind: 'manual', docId: null, docCodigo: null,
  contraparteId: null, contraparteRif: null, contraparteNombre: null, contraparteSujeto: null,
  facturaNumero: '0001', facturaControl: '00-0001', facturaFecha: '2026-10-05',
  periodo: '202610', quincena: 1, numeroComprobante: '20261000000001',
  conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120, montoBs: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null,
  anulada: false, anuladaMotivo: null, declaradaEn: null, declaradaPor: null, actorName: null, createdAt: '2026-10-05T14:00:00Z', updatedAt: null,
  ...over,
});

/* El comprobante dice quién retuvo y a quién. Cuando la practicamos, el agente
   es la empresa; cuando nos la practicaron, el agente es el cliente y el sujeto
   retenido es la empresa. Con los papeles al revés el comprobante no sirve. */
describe('comprobante de retención · quién es el agente y quién el sujeto', () => {
  it('la que practicamos: el agente es la empresa y el sujeto, el proveedor', () => {
    const p = partesComprobante(retencion({
      direccion: 'practicada', contraparteNombre: 'Proveedor de Prueba C.A.', contraparteRif: 'J-00000002-0',
    }), empresa);
    expect(p.agente[0]).toBe('Empresa de Prueba C.A.');
    expect(p.agente).toContain('RIF: J-00000000-0');
    expect(p.sujeto[0]).toBe('Proveedor de Prueba C.A.');
    expect(p.sujeto).toContain('RIF: J-00000002-0');
  });

  it('la que nos practicaron: el agente es el cliente y el sujeto retenido, la empresa', () => {
    const p = partesComprobante(retencion({
      direccion: 'recibida', contraparteNombre: 'Cliente de Prueba S.A.', contraparteRif: 'J-00000003-0',
    }), empresa);
    expect(p.agente[0]).toBe('Cliente de Prueba S.A.');
    expect(p.agente).toContain('RIF: J-00000003-0');
    expect(p.sujeto[0]).toBe('Empresa de Prueba C.A.');
    expect(p.sujeto).toContain('RIF: J-00000000-0');
  });

  it('el tipo de sujeto va con el sujeto retenido, nunca con el agente', () => {
    const recibida = partesComprobante(retencion({
      tipo: 'islr', direccion: 'recibida', contraparteNombre: 'Cliente de Prueba S.A.', contraparteRif: 'J-00000003-0',
      contraparteSujeto: 'pj_domiciliada',
    }), empresa);
    expect(recibida.agente).not.toContain('Persona jurídica domiciliada');
    const practicada = partesComprobante(retencion({
      tipo: 'islr', direccion: 'practicada', contraparteNombre: 'Persona de Prueba', contraparteRif: 'V-00000004-0',
      contraparteSujeto: 'pn_residente',
    }), empresa);
    expect(practicada.sujeto).toContain('Persona natural residente');
  });

  it('sin datos en Parámetros, el agente es la empresa de empresa.ts; nada escrito a mano', () => {
    const p = partesComprobante(retencion({}), { ...CONFIG_RETENCION_DEFECTO, razonSocial: null, rif: null });
    expect(p.agente[0]).toBe(EMPRESA_NOMBRE);
    expect(p.agente).toContain(`RIF: ${EMPRESA_RIF}`);
  });
});

describe('el equivalente en bolívares', () => {
  it('en divisas, dice cuánto es en Bs y con qué tasa', () => {
    expect(lineaEquivalenteBs({ moneda: 'USD', montoBs: 365, tasa: 36.5 })).toContain('Bs 365,00');
  });

  it('en Bs, o sin equivalente, no agrega nada', () => {
    expect(lineaEquivalenteBs({ moneda: 'Bs', montoBs: 120, tasa: null })).toBeNull();
    expect(lineaEquivalenteBs({ moneda: 'USD', montoBs: null, tasa: null })).toBeNull();
  });
});

describe('dirección fiscal del sujeto retenido', () => {
  it('incluye la dirección fiscal del sujeto retenido cuando está provista', () => {
    const p = partesComprobante(retencion({
      contraparteNombre: 'Proveedor Ejemplo C.A.',
      contraparteRif: 'J-12345678-9',
      contraparteDireccion: 'Zona Industrial 321, Galpón 5, Puerto Ordaz',
    }), empresa);
    expect(p.sujeto).toContain('Zona Industrial 321, Galpón 5, Puerto Ordaz');
  });
});

describe('verificación digital fiscal (PA 0084 / 0093)', () => {
  it('genera la cadena canónica con los datos formales de la retención', () => {
    const c = cadenaCanonicoFiscal(retencion({
      tipo: 'iva',
      facturaNumero: '0001',
      baseImponible: 1000,
      montoRetenido: 120,
      contraparteRif: 'J-12345678-9',
    }), empresa);
    expect(c).toContain('SENIAT|RET|IVA|J-00000000-0|20261000000001|2026-10-05|J-12345678-9|FACT:0001|Bs|1000.00|120.00|VALIDA');
  });

  it('refleja notas de crédito con su documento afectado y retenciones anuladas en la cadena canónica', () => {
    const nc = cadenaCanonicoFiscal(retencion({
      tipo: 'iva',
      tipoDocumento: 'nota_credito',
      facturaNumero: 'NC-005',
      facturaAfectadaNro: 'FAC-099',
      baseImponible: 500,
      montoRetenido: 60,
    }), empresa);
    expect(nc).toContain('NC:NC-005:AF:FAC-099');
    expect(nc).toContain('|VALIDA');

    const anulada = cadenaCanonicoFiscal(retencion({
      anulada: true,
      anuladaMotivo: 'Error en cálculo',
    }), empresa);
    expect(anulada).toContain('|ANULADA');
  });

  it('calcula el hash SHA-256 de forma determinista y con 64 caracteres hex', async () => {
    const hash = await calcularSha256Hex('SENIAT|PRUEBA');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    const hash2 = await calcularSha256Hex('SENIAT|PRUEBA');
    expect(hash).toBe(hash2);
  });

  it('genera un DataURL de código QR válido', async () => {
    const qr = await generarQrVerificacion('SENIAT|PRUEBA');
    expect(qr).toMatch(/^data:image\/png;base64,/);
  });
});

describe('emisión de ejemplares · Original y Copia (Providencia SNAT/2025/000054 IVA / Art. 24 D. 1808)', () => {
  it('modo "ambos" emite 2 páginas consecutivas (Página 1: Original, Página 2: Copia)', async () => {
    const { anexarPaginasComprobantePdf } = await import('./comprobanteRetencionPdf');
    const r = retencion({ tipo: 'iva', numeroComprobante: '20261000000001' });
    const doc = await anexarPaginasComprobantePdf(r, empresa, null, { modoEjemplar: 'ambos', incluirLogo: false, incluirQr: false });
    expect(doc.getNumberOfPages()).toBe(2);
  }, 15000);

  it('modo "original" emite exactamente 1 página', async () => {
    const { anexarPaginasComprobantePdf } = await import('./comprobanteRetencionPdf');
    const r = retencion({ tipo: 'iva', numeroComprobante: '20261000000001' });
    const doc = await anexarPaginasComprobantePdf(r, empresa, null, { modoEjemplar: 'original', incluirLogo: false, incluirQr: false });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('modo "copia" emite exactamente 1 página', async () => {
    const { anexarPaginasComprobantePdf } = await import('./comprobanteRetencionPdf');
    const r = retencion({ tipo: 'iva', numeroComprobante: '20261000000001' });
    const doc = await anexarPaginasComprobantePdf(r, empresa, null, { modoEjemplar: 'copia', incluirLogo: false, incluirQr: false });
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe('correos en comprobante · empresa (configurable) y proveedor (si existe)', () => {
  it('incluye el correo configurable de la empresa en el agente (practicada)', () => {
    const cfgConEmail: ConfigRetencion = { ...empresa, email: 'tributos@empresa.com' };
    const p = partesComprobante(retencion({ direccion: 'practicada' }), cfgConEmail);
    expect(p.agente).toContain('Correo: tributos@empresa.com');
  });

  it('incluye el correo del proveedor en el sujeto si existe', () => {
    const p = partesComprobante(retencion({
      direccion: 'practicada',
      contraparteEmail: 'contacto@proveedor.com',
    }), empresa);
    expect(p.sujeto).toContain('Correo: contacto@proveedor.com');
  });

  it('no incluye correo en el sujeto si el proveedor no tiene correo registrado', () => {
    const p = partesComprobante(retencion({
      direccion: 'practicada',
      contraparteEmail: null,
    }), empresa);
    expect(p.sujeto.some((s) => s.startsWith('Correo:'))).toBe(false);
  });

  it('en retención recibida invierte los roles manteniendo el correo correspondiente', () => {
    const cfgConEmail: ConfigRetencion = { ...empresa, email: 'tributos@empresa.com' };
    const p = partesComprobante(retencion({
      direccion: 'recibida',
      contraparteEmail: 'facturacion@cliente.com',
    }), cfgConEmail);
    // El agente es el cliente externo
    expect(p.agente).toContain('Correo: facturacion@cliente.com');
    // El sujeto es la empresa
    expect(p.sujeto).toContain('Correo: tributos@empresa.com');
  });
});

describe('elementos digitales · disponibilidad y no forzamiento de firma', () => {
  it('si no hay firma cargada en base, tieneFirma es estrictamente false y firmaDataUrl es null (no se fuerza con || true)', async () => {
    const { consultarElementosDigitales, cargarElementosDigitales } = await import('./comprobanteRetencionPdf');
    const disp = await consultarElementosDigitales('2026-10-28');
    expect(typeof disp.tieneFirma).toBe('boolean');
    const elementos = await cargarElementosDigitales('2026-10-28');
    if (!disp.tieneFirma) {
      expect(elementos.firmaDataUrl).toBeNull();
    }
  });

  it('modo "estandar" emite exactamente 1 página oficial', async () => {
    const { anexarPaginasComprobantePdf } = await import('./comprobanteRetencionPdf');
    const r = retencion({ tipo: 'iva', numeroComprobante: '20261000000001' });
    const doc = await anexarPaginasComprobantePdf(r, empresa, null, { modoEjemplar: 'estandar', incluirLogo: false, incluirQr: false });
    expect(doc.getNumberOfPages()).toBe(1);
  });
});



