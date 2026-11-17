import { describe, it, expect } from 'vitest';
import {
  parseChatBlocks,
  tokenizeInline,
  esReferenciaValida,
  etiquetaTipoReferencia,
} from './ChatFormato';
import {
  extraerMenciones,
  resolverDestinatariosMenciones,
} from './chatMenciones';
import {
  normalizarDepartamento,
  ordenarDepartamentos,
  formatearFaseOrden,
  inferirTipoOperacion,
  identificarTokensBloque,
  obtenerTokenEnCursor,
  ejecutarBorradoToken,
  construirReferenciasOrden,
} from './ChatOrden';
import type { Usuario } from '@/shared/lib/types';

describe('ChatFormato · Bloques y sintaxis estilo WhatsApp / Slack / Telegram', () => {
  it('parsea listas con viñetas (-, •, *) correctamente', () => {
    const texto = `Lista de tareas:
- Primer elemento
• Segundo elemento
* Tercer elemento con *negrita*`;

    const blocks = parseChatBlocks(texto);
    expect(blocks.length).toBe(4);
    expect(blocks[0].type).toBe('line');
    expect(blocks[1].type).toBe('bullet');
    expect(blocks[1].content).toBe('Primer elemento');
    expect(blocks[2].type).toBe('bullet');
    expect(blocks[2].content).toBe('Segundo elemento');
    expect(blocks[3].type).toBe('bullet');
    expect(blocks[3].content).toBe('Tercer elemento con *negrita*');
  });

  it('parsea listas numeradas (1., 2.)', () => {
    const texto = `Pasos a seguir:
1. Cotizar con proveedores
2. Aprobar mejor oferta`;

    const blocks = parseChatBlocks(texto);
    expect(blocks[1].type).toBe('numbered');
    expect(blocks[1].num).toBe('1');
    expect(blocks[1].content).toBe('Cotizar con proveedores');
    expect(blocks[2].type).toBe('numbered');
    expect(blocks[2].num).toBe('2');
  });

  it('parsea citas con > al inicio de la línea', () => {
    const texto = `> Esto es una instrucción importante del Gerente`;
    const blocks = parseChatBlocks(texto);
    expect(blocks[0].type).toBe('quote');
    expect(blocks[0].content).toBe('Esto es una instrucción importante del Gerente');
  });

  it('parsea bloques de código cercados con ```', () => {
    const texto = '```\nconst x = 10;\nconsole.log(x);\n```';
    const blocks = parseChatBlocks(texto);
    expect(blocks[0].type).toBe('codeblock');
    expect(blocks[0].content).toContain('const x = 10;');
  });
});

describe('ChatFormato · Inline Tokenizer', () => {
  it('reconoce negrita (* y **), cursiva (_), tachado (~ y ~~) y código (`...`)', () => {
    const texto = 'Texto con *negrita*, _cursiva_, ~tachado~ y `código inline`';
    const tokens = tokenizeInline(texto);

    const boldToken = tokens.find((t) => t.type === 'bold');
    expect(boldToken?.content).toBe('negrita');

    const italicToken = tokens.find((t) => t.type === 'italic');
    expect(italicToken?.content).toBe('cursiva');

    const strikeToken = tokens.find((t) => t.type === 'strike');
    expect(strikeToken?.content).toBe('tachado');

    const codeToken = tokens.find((t) => t.type === 'code');
    expect(codeToken?.content).toBe('código inline');
  });

  it('reconoce formato anidado como **HOLA TEXTO_CURSIVA_**', () => {
    const texto = '**HOLA TEXTO_CURSIVA_**';
    const tokens = tokenizeInline(texto);

    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe('bold');
    expect(tokens[0].content).toBe('HOLA TEXTO_CURSIVA_');
  });

  it('reconoce enlaces web (URLs)', () => {
    const texto = 'Favor revisar https://goldentouch.app/documento';
    const tokens = tokenizeInline(texto);
    const urlToken = tokens.find((t) => t.type === 'url');
    expect(urlToken?.raw).toBe('https://goldentouch.app/documento');
  });
});

describe('ChatFormato · Referencias (#) y Exclusiones requeridas', () => {
  it('valida referencias admitidas (#OC, #SP, #CS, #SS, #GF)', () => {
    expect(esReferenciaValida('#OC-2026-0041')).toBe(true);
    expect(esReferenciaValida('OC-2026-0041')).toBe(true);
    expect(esReferenciaValida('#SP-2026-0010')).toBe(true);
    expect(esReferenciaValida('#CS-2026-0005')).toBe(true);
    expect(esReferenciaValida('#SS-2026-0002')).toBe(true);
    expect(esReferenciaValida('#GF-2026-0001')).toBe(true);
  });

  it('REQUISITO CRÍTICO: Excluye compras directas (#CD-...) y servicios directos (#SD-...)', () => {
    expect(esReferenciaValida('#CD-2026-0001')).toBe(false);
    expect(esReferenciaValida('CD-2026-0001')).toBe(false);
    expect(esReferenciaValida('#SD-2026-0002')).toBe(false);
    expect(esReferenciaValida('SD-2026-0002')).toBe(false);
  });

  it('tokeniza referencias permitidas y deja CD/SD como texto plano', () => {
    const texto = 'Referenciar #OC-2026-0041 y #SP-2026-0010 pero no tocar #CD-2026-0099 ni #SD-2026-0001';
    const tokens = tokenizeInline(texto);

    const refTokens = tokens.filter((t) => t.type === 'ref');
    expect(refTokens.map((r) => r.content)).toEqual(['OC-2026-0041', 'SP-2026-0010']);

    const cdRef = refTokens.find((r) => r.content.includes('CD-'));
    const sdRef = refTokens.find((r) => r.content.includes('SD-'));
    expect(cdRef).toBeUndefined();
    expect(sdRef).toBeUndefined();
  });

  it('asigna la etiqueta humana correcta según el prefijo', () => {
    expect(etiquetaTipoReferencia('#OC-001')).toBe('Orden de Compra');
    expect(etiquetaTipoReferencia('#SP-001')).toBe('Solicitud de Pedido');
    expect(etiquetaTipoReferencia('#CS-001')).toBe('Control de Servicio');
    expect(etiquetaTipoReferencia('#SS-001')).toBe('Solicitud de Servicio');
    expect(etiquetaTipoReferencia('#GF-001')).toBe('Gasto Fijo (Administración)');
  });
});

describe('chatMenciones · Menciones (@) y Exclusión Estricta de Archivados/Deshabilitados', () => {
  it('extrae menciones compuestas conocidas y menciones por correo', () => {
    const texto = 'Hola @Nazaret Salazar, favor coordinar con @Kelvin Peña y @touchgolden1127@gmail.com';
    const menciones = extraerMenciones(texto);

    expect(menciones).toContain('@Nazaret Salazar');
    expect(menciones).toContain('@Kelvin Peña');
    expect(menciones).toContain('@touchgolden1127@gmail.com');
  });

  it('no engulle palabras posteriores en menciones de un solo término', () => {
    const texto = 'Hola @Kelvin por favor revisa el monto';
    const menciones = extraerMenciones(texto);
    expect(menciones).toEqual(['@Kelvin']);
  });

  it('EXCLUSIÓN ESTRICTA: Usuarios archivados o inactivos NUNCA son destinatarios de mención', () => {
    const mockDbUsuarios: Partial<Usuario>[] = [
      { id: '1', nombre: 'KELVIN', apellido: 'PEÑA', email: 'comprasanalista9@gmail.com', estado: 'activo', archivado_en: null },
      { id: '2', nombre: 'ERICK', apellido: 'FLORES', email: 'analista4mgg@gmail.com', estado: 'inactivo', archivado_en: '2026-10-15T00:00:00Z' },
      { id: '3', nombre: 'JAVIER', apellido: 'LEIVA', email: 'analistaadministrativobra@gmail.com', estado: 'inactivo', archivado_en: '2026-10-15T00:00:00Z' },
      { id: '4', nombre: 'JOSE', apellido: 'LIENDRO', email: 'analistadecomprasgt@gmail.com', estado: 'inactivo', archivado_en: '2026-10-15T00:00:00Z' },
      { id: '5', nombre: 'TEODORO', apellido: 'GARCIA', email: 'admingometales@gmail.com', estado: 'inactivo', archivado_en: '2026-10-15T00:00:00Z' },
      { id: '6', nombre: 'MARIANA', apellido: 'TOVAR', email: 'mariana.trabajo.gt@gmail.com', estado: 'inactivo', archivado_en: '2026-10-15T00:00:00Z' },
    ];

    const menciones = [
      '@Kelvin Peña',
      '@Erick Flores',
      '@Javier Leiva',
      '@Jose Liendro',
      '@Teodoro Garcia',
      '@Mariana Tovar',
    ];

    const destinatarios = resolverDestinatariosMenciones(menciones, mockDbUsuarios as Usuario[]);

    // Solo KELVIN PEÑA debe ser resuelto
    expect(destinatarios.map((d) => d.email)).toEqual(['comprasanalista9@gmail.com']);
    expect(destinatarios.some((d) => d.nombre.includes('ERICK'))).toBe(false);
    expect(destinatarios.some((d) => d.nombre.includes('JAVIER'))).toBe(false);
    expect(destinatarios.some((d) => d.nombre.includes('JOSE'))).toBe(false);
    expect(destinatarios.some((d) => d.nombre.includes('TEODORO'))).toBe(false);
    expect(destinatarios.some((d) => d.nombre.includes('MARIANA'))).toBe(false);
  });
});

describe('ChatOrden · Inteligencia contextual y clasificación departamental', () => {
  it('normaliza departamentos correctamente por nombre e inferencia de correo', () => {
    expect(normalizarDepartamento('Compras y Adquisiciones')).toBe('COMPRAS');
    expect(normalizarDepartamento('Tesorería y Finanzas')).toBe('TESORERIA');
    expect(normalizarDepartamento('Administración')).toBe('ADMINISTRACION');
    expect(normalizarDepartamento(null, 'comprasanalista9@gmail.com')).toBe('COMPRAS');
    expect(normalizarDepartamento(null, 'jhzgcontabilidad@gmail.com')).toBe('TESORERIA');
    expect(normalizarDepartamento(null, 'edinsontrabajogt@gmail.com')).toBe('ADMINISTRACION');
    expect(normalizarDepartamento(null, 'touchgolden1127@gmail.com')).toBe('DIRECTIVA');
  });

  it('ordena departamentos según el contexto: Compras primero para compras, Tesorería primero para tesorería', () => {
    const deptos = ['ADMINISTRACION', 'TESORERIA', 'ALMACEN', 'COMPRAS'];

    const ordCompras = ordenarDepartamentos(deptos, 'compras');
    expect(ordCompras[0]).toBe('COMPRAS');
    expect(ordCompras[1]).toBe('TESORERIA');
    expect(ordCompras[2]).toBe('ADMINISTRACION');

    const ordTesoreria = ordenarDepartamentos(deptos, 'tesoreria');
    expect(ordTesoreria[0]).toBe('TESORERIA');
    expect(ordTesoreria[1]).toBe('COMPRAS');
    expect(ordTesoreria[2]).toBe('ADMINISTRACION');

    const ordAdmin = ordenarDepartamentos(deptos, 'administracion');
    expect(ordAdmin[0]).toBe('ADMINISTRACION');
    expect(ordAdmin[1]).toBe('TESORERIA');
    expect(ordAdmin[2]).toBe('COMPRAS');
  });

  it('formatea la fase operativa en texto legible', () => {
    expect(formatearFaseOrden('enviada_revision_almacen')).toBe('Revisión Almacén');
    expect(formatearFaseOrden('pendiente_aprobacion')).toBe('Por Aprobar');
    expect(formatearFaseOrden('aprobada')).toBe('Aprobada');
    expect(formatearFaseOrden('pendiente_pago')).toBe('Por Pagar');
    expect(formatearFaseOrden('pagada')).toBe('Pagada');
  });

  it('infiere el tipo de operación según el código', () => {
    expect(inferirTipoOperacion('SP-2026-0561')).toBe('Solicitud de Pedido');
    expect(inferirTipoOperacion('OC-2026-0041')).toBe('Orden de Compra');
    expect(inferirTipoOperacion('CS-2026-0010')).toBe('Control de Servicio');
    expect(inferirTipoOperacion('GF-2026-0001')).toBe('Gasto Fijo');
  });
});

describe('ChatOrden · Referenciación (#): Primera Plana Limpia vs Autocompletado', () => {
  const ordenesMock = [
    {
      id: 'madre-1',
      codigo: 'SP-2026-0500',
      oc_codigo: null,
      op_padre_id: null,
      tipo: 'producto',
      motivo: 'Compra mayor de repuestos',
    },
    {
      id: 'hija-1',
      codigo: 'SP-2026-0501',
      oc_codigo: 'OC-2026-0121',
      op_padre_id: 'madre-1',
      tipo: 'producto',
      motivo: 'Reparto filtros - Proveedor A',
    },
    {
      id: 'hija-2',
      codigo: 'SP-2026-0502',
      oc_codigo: 'OC-2026-0122',
      op_padre_id: 'madre-1',
      tipo: 'producto',
      motivo: 'Reparto correas - Proveedor B',
    },
    {
      id: 'indep-3',
      codigo: 'SP-2026-0561',
      oc_codigo: 'OC-2026-0130',
      op_padre_id: null,
      tipo: 'producto',
      motivo: 'Laptop Dell Ryzen 7 para Sistemas',
    },
    {
      id: 'indep-4',
      codigo: 'SP-2026-0565',
      oc_codigo: null,
      op_padre_id: null,
      tipo: 'producto',
      motivo: 'Orden activa sin madre ni hija',
    },
    {
      id: 'directa-5',
      codigo: 'CD-2026-0099',
      oc_codigo: null,
      op_padre_id: null,
      tipo: 'producto',
      motivo: 'Compra directa prohibida en chat',
    },
  ];

  it('REQUISITO CLAVE: En primera plana (# sin query) solo se exhibe la orden activa y los comandos, NO todas las SPs', () => {
    const ordenActiva = ordenesMock[4]; // SP-2026-0565 (indep-4)
    const refs = construirReferenciasOrden({
      ordenActual: ordenActiva,
      ordenLabel: 'SP-2026-0565',
      todasLasOrdenes: ordenesMock,
      contextoModulo: 'compras',
      query: '', // Primera plana
    });

    // 1. La orden activa SIEMPRE va de primera
    expect(refs[0].codigo).toBe('SP-2026-0565');
    expect(refs[0].sublabel).toBe('Actual');

    // 2. Comandos en primera plana
    const codigos = refs.map((r) => r.codigo);
    expect(codigos).toContain('OC-');
    expect(codigos).toContain('SP-');
    expect(codigos).toContain('CS-');
    expect(codigos).toContain('SS-');

    // 3. NO debe exhibir las otras SPs del catálogo (ej. SP-2026-0561, SP-2026-0500)
    expect(codigos).not.toContain('SP-2026-0561');
    expect(codigos).not.toContain('SP-2026-0500');

    // 4. Como no tiene madre ni hija, NO debe haber badges de madre ni hija
    expect(refs.some((r) => r.sublabel === 'Orden Madre')).toBe(false);
    expect(refs.some((r) => r.sublabel === 'Orden Hija')).toBe(false);
  });

  it('Madre o hija solo aparece si la orden activa realmente las tiene', () => {
    // Caso con orden hija:
    const ordenHija = ordenesMock[1]; // hija-1
    const refsHija = construirReferenciasOrden({
      ordenActual: ordenHija,
      ordenLabel: 'OC-2026-0121',
      todasLasOrdenes: ordenesMock,
      contextoModulo: 'compras',
      query: '',
    });

    const refMadre = refsHija.find((r) => r.sublabel === 'Orden Madre');
    expect(refMadre).toBeDefined();
    expect(refMadre?.codigo).toBe('SP-2026-0500');

    // Caso con orden madre:
    const ordenMadre = ordenesMock[0]; // madre-1
    const refsMadre = construirReferenciasOrden({
      ordenActual: ordenMadre,
      ordenLabel: 'SP-2026-0500',
      todasLasOrdenes: ordenesMock,
      contextoModulo: 'compras',
      query: '',
    });

    const hijas = refsMadre.filter((r) => r.sublabel === 'Orden Hija');
    expect(hijas.length).toBe(2);
  });

  it('Autocompletado con números o motivos: busca en el catálogo cuando se teclea tras #', () => {
    // Usuario escribe "#0561" o "#laptop"
    const refsPorNumero = construirReferenciasOrden({
      todasLasOrdenes: ordenesMock,
      query: '0561',
    });
    expect(refsPorNumero.some((r) => r.codigo === 'SP-2026-0561')).toBe(true);

    const refsPorMotivo = construirReferenciasOrden({
      todasLasOrdenes: ordenesMock,
      query: 'laptop',
    });
    expect(refsPorMotivo.some((r) => r.codigo === 'SP-2026-0561')).toBe(true);
    expect(refsPorMotivo[0].label).toContain('Laptop Dell Ryzen 7');
  });

  it('excluye estrictamente Compras Directas (CD-) y Servicios Directos (SD-) de las sugerencias', () => {
    const refs = construirReferenciasOrden({
      todasLasOrdenes: ordenesMock,
      query: 'CD-',
    });
    expect(refs.length).toBe(0);
    expect(refs.some((r) => r.codigo.startsWith('CD-'))).toBe(false);
  });
});

describe('ChatOrden · Bloques de referencia y borrado inteligente con 2 toques', () => {
  const nombresConocidos = ['NAZARET SALAZAR', 'KELVIN PEÑA', 'JESUS LOZADA'];

  it('identifica tokens de bloques (@mención y #referencia) con sus límites exactos', () => {
    const texto = 'Hola @NAZARET SALAZAR por favor ver #SP-2026-0565 gracias';
    const tokens = identificarTokensBloque(texto, nombresConocidos);

    expect(tokens.length).toBe(2);
    expect(tokens[0].tipo).toBe('mencion');
    expect(tokens[0].contenido).toBe('NAZARET SALAZAR');
    expect(tokens[0].textoCompleto).toBe('@NAZARET SALAZAR');

    expect(tokens[1].tipo).toBe('referencia');
    expect(tokens[1].contenido).toBe('SP-2026-0565');
    expect(tokens[1].textoCompleto).toBe('#SP-2026-0565');
  });

  it('detecta el token sobre el que está el cursor', () => {
    const texto = 'Hola @NAZARET SALAZAR ';
    const tok = obtenerTokenEnCursor(texto, 22, nombresConocidos);
    expect(tok).not.toBeNull();
    expect(tok?.contenido).toBe('NAZARET SALAZAR');

    const tokFuera = obtenerTokenEnCursor(texto, 2, nombresConocidos);
    expect(tokFuera).toBeNull();
  });

  it('BORRADO EN 2 TOQUES: Toque 1 borra el contenido del bloque hasta @ o #', () => {
    const texto = 'Hola @NAZARET SALAZAR ';
    const resultadoToque1 = ejecutarBorradoToken(texto, texto.length, nombresConocidos);

    expect(resultadoToque1.borradoBloque).toBe(true);
    expect(resultadoToque1.nuevoTexto).toBe('Hola @');
    expect(resultadoToque1.nuevaPos).toBe('Hola @'.length);
    expect(resultadoToque1.tipoMenu).toBe('mencion');
  });

  it('BORRADO EN 2 TOQUES: Toque 2 permite el borrado normal del carácter @ o #', () => {
    const textoToque2 = 'Hola @';
    const resultadoToque2 = ejecutarBorradoToken(textoToque2, textoToque2.length, nombresConocidos);
    expect(resultadoToque2.borradoBloque).toBe(false);
  });

  it('BORRADO EN 2 TOQUES: Funciona idénticamente para referencias #SP-xxxx', () => {
    const texto = 'Revisar #SP-2026-0565 ';
    const res1 = ejecutarBorradoToken(texto, texto.length, nombresConocidos);

    expect(res1.borradoBloque).toBe(true);
    expect(res1.nuevoTexto).toBe('Revisar #');
    expect(res1.nuevaPos).toBe('Revisar #'.length);
    expect(res1.tipoMenu).toBe('referencia');

    const res2 = ejecutarBorradoToken('Revisar #', 'Revisar #'.length, nombresConocidos);
    expect(res2.borradoBloque).toBe(false);
  });

  it('BORRADO DENTRO DEL BLOQUE: Si el cursor está en medio de un nombre, borra todo el bloque hasta @', () => {
    const texto = '@NAZARET SALAZAR';
    const res = ejecutarBorradoToken(texto, 4, nombresConocidos);

    expect(res.borradoBloque).toBe(true);
    expect(res.nuevoTexto).toBe('@');
    expect(res.nuevaPos).toBe(1);
  });
});
