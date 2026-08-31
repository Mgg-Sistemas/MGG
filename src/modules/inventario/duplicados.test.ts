import { describe, it, expect } from 'vitest';
import {
  hayExacto, normalizarNombre, parecidoNombre, productosSimilares, tokensNombre,
  type ProductoComparable,
} from './duplicados';

const p = (id: string, sku: string, nombre: string, extra: Partial<ProductoComparable> = {}): ProductoComparable =>
  ({ id, sku, nombre, estado: 'activo', ...extra });

// Duplicados reales del catálogo de producción.
const CATALOGO: ProductoComparable[] = [
  p('1', 'INS-001', 'PINTURA EPOXICA GRIS', { almacen: 'General' }),
  p('2', 'INS-088', 'PINTURA EPÓXICA GRIS', { almacen: 'Los Pinos' }),
  p('3', 'MIN-CASITERITA', 'CASITERITA', { almacen: 'CASITERITA LOS PINOS' }),
  p('4', 'SNO2', 'CASITERITA (SNO2)', { almacen: 'General' }),
  p('5', 'VIV-012', 'HARINA DE MAIZ PAN', { almacen: 'Viveres y Art. Limpieza' }),
  p('6', 'COMB-01', 'DIESEL', { almacen: 'General' }),
  p('7', 'REP-441', 'FILTRO DE ACEITE CATERPILLAR', { marca: 'CAT' }),
  p('8', 'REP-442', 'FILTRO DE AIRE CATERPILLAR', { marca: 'CAT' }),
];

describe('normalizarNombre', () => {
  it('ignora acentos, mayúsculas, signos y espacios de más', () => {
    expect(normalizarNombre('Pintura Epóxica  Gris')).toBe('PINTURA EPOXICA GRIS');
    expect(normalizarNombre('Harina P.A.N.')).toBe('HARINA P A N');
    expect(normalizarNombre('  DIÉSEL ')).toBe('DIESEL');
    expect(normalizarNombre(null)).toBe('');
  });
});

describe('tokensNombre', () => {
  it('descarta las palabras de relleno y las unidades', () => {
    expect(tokensNombre('HARINA DE MAIZ x KG')).toEqual(['HARINA', 'MAIZ']);
    expect(tokensNombre('SACO DE CEMENTO')).toEqual(['CEMENTO']);
  });

  it('CONSERVA la medida, que es lo único que distingue medio catálogo', () => {
    // «3/8» normaliza a «3 8»: descartándolos por cortos, TORNILLO 3/8 y TORNILLO 1/2
    // quedaban los dos en «TORNILLO» a secas y el sistema los daba por el mismo.
    expect(tokensNombre('TORNILLO 3/8')).toEqual(['TORNILLO', '3', '8']);
    expect(tokensNombre('DISCO DE CORTE 7\"')).toEqual(['DISCO', 'CORT', '7']);
  });

  it('las letras sueltas sí se descartan', () => {
    expect(tokensNombre('DISCO 7\" X .045\"')).toEqual(['DISCO', '7', '045']);
  });

  it('el singular y el plural son el mismo token', () => {
    expect(tokensNombre('SARDINAS')).toEqual(tokensNombre('SARDINA'));
    expect(tokensNombre('GUANTES')).toEqual(tokensNombre('GUANTE'));
    expect(tokensNombre('MARCADORES')).toEqual(tokensNombre('MARCADOR'));
    expect(tokensNombre('TORNILLOS')).toEqual(tokensNombre('TORNILLO'));
  });
});

describe('parecidoNombre', () => {
  it('el mismo nombre con otra tipografía da 1', () => {
    expect(parecidoNombre('PINTURA EPOXICA GRIS', 'Pintura Epóxica Gris')).toBe(1);
  });

  it('reconoce el genérico dentro del nombre largo', () => {
    // HARINA y PAN compartidos sobre {HARINA, PAN, MAIZ} = 2/3.
    expect(parecidoNombre('HARINA PAN', 'HARINA DE MAIZ PAN')).toBeCloseTo(2 / 3, 5);
  });

  it('no confunde materiales distintos que comparten una palabra', () => {
    // FILTRO y CATERPILLAR compartidos sobre {FILTRO, CATERPILLAR, ACEIT, AIRE} = 2/4.
    expect(parecidoNombre('FILTRO DE ACEITE CATERPILLAR', 'FILTRO DE AIRE CATERPILLAR')).toBeCloseTo(0.5, 5);
    expect(parecidoNombre('TORNILLO', 'CEMENTO')).toBe(0);
  });

  it('NO da por iguales dos materiales que solo se diferencian en la medida', () => {
    // Este es el falso positivo que hacía inservible el aviso: dividiendo por el
    // nombre más corto, «TORNILLO 1/2» daba 1 contra CUALQUIER tornillo del catálogo
    // y encima frenaba el alta.
    expect(parecidoNombre('TORNILLO 3/8', 'TORNILLO 1/2')).toBeLessThan(0.5);
    expect(parecidoNombre('TORNILLO 1/2', 'TORNILLO AUTOTALADRANTE')).toBeLessThan(0.5);
    expect(parecidoNombre('DISCO DE CORTE 4 1/2\"', 'DISCO DE CORTE 7\"')).toBeLessThan(0.5);
    expect(parecidoNombre('MANGUERA 5/8', 'MANGUERA HIDRAULICA 1/2\" ALTA PRESION')).toBeLessThan(0.5);
    expect(parecidoNombre('ELECTRODO 7018 1/8', 'ELECTRODO 7018 5/32')).toBeLessThan(0.5);
  });

  it('las familias que solo cambian la MEDIDA no se marcan entre sí', () => {
    // Casos reales del catálogo: 12 tubos EMT, 9 brocas Tolsen, 6 dados de roscado.
    expect(parecidoNombre(
      'TUBO EMT ACERO GALVANIZADO 3/4" 0.9MTS',
      'TUBO EMT ACERO GALVANIZADO 3/4" 1.18MTS',
    )).toBeLessThan(0.5);
    expect(parecidoNombre(
      'BROCA DE ALTA VELOCIDAD TOLSEN 1/16\'\'',
      'BROCA DE ALTA VELOCIDAD TOLSEN 1/4\'\'',
    )).toBeLessThan(0.5);
    expect(parecidoNombre("DADO DE ROSCADO 1'' ULUSTOOL", "DADO DE ROSCADO 1/2'' ULUSTOOL")).toBeLessThan(0.5);
    expect(parecidoNombre('CARBONATO DE CALCIO (CACO3) M10', 'CARBONATO DE CALCIO (CACO3) M20')).toBeLessThan(0.5);
    expect(parecidoNombre('AGUA NEVADA 355 ML', 'AGUA NEVADA 600 ML')).toBeLessThan(0.5);
  });

  it('pero la MISMA medida sigue contando como parecido', () => {
    expect(parecidoNombre('DISCO DE ESMERIL 7"', 'DISCO DE ESMERIL 7" X 1/4" X 7/8" EXXEL')).toBeGreaterThan(0);
    // Idéntico salvo espacios: sigue siendo el mismo nombre.
    expect(parecidoNombre('TIRRAJE 45293113/45293123', 'TIRRAJE 45293113 / 45293123')).toBe(1);
  });

  it('el plural NO esconde un duplicado', () => {
    expect(parecidoNombre('SARDINA', 'SARDINAS')).toBe(1);
    expect(parecidoNombre('GUANTE DE CARNAZA', 'GUANTES DE CARNAZA')).toBe(1);
  });

  it('un nombre vacío no se parece a nada', () => {
    expect(parecidoNombre('', 'CEMENTO')).toBe(0);
    expect(parecidoNombre('CEMENTO', null)).toBe(0);
  });
});

describe('productosSimilares', () => {
  it('detecta el duplicado exacto que solo cambia el acento', () => {
    const dups = productosSimilares('PINTURA EPOXICA GRIS', CATALOGO);
    expect(dups[0].producto.sku).toBe('INS-001');
    expect(dups[0].nivel).toBe('exacto');
    expect(hayExacto(dups)).toBe(true);
    // Los dos duplicados del catálogo aparecen.
    expect(dups.filter((d) => d.nivel === 'exacto')).toHaveLength(2);
  });

  it('«exacto» significa MISMO NOMBRE: es lo único que frena el alta', () => {
    // Un parecido alto avisa pero NO bloquea: bloquear un material legítimamente
    // parecido enseña al operador a saltarse el aviso.
    const dups = productosSimilares('FILTRO DE ACEITE CATERPILLAR 1R-0716', CATALOGO);
    expect(hayExacto(dups)).toBe(false);
  });

  it('la familia de tornillos y discos NO se marca entre sí', () => {
    const familia = [
      p('t1', 'FER-001', 'TORNILLO AUTOTALADRANTE'),
      p('t2', 'FER-002', 'TORNILLO TIRA FONDO 12X3'),
      p('t3', 'FER-003', 'DISCO DE CORTE 7\"'),
      p('t4', 'FER-004', 'MANGUERA HIDRAULICA 1/2\" ALTA PRESION'),
    ];
    expect(productosSimilares('TORNILLO 1/2', familia)).toEqual([]);
    expect(productosSimilares('DISCO DE CORTE 4 1/2\"', familia)).toEqual([]);
    expect(productosSimilares('MANGUERA 5/8', familia)).toEqual([]);
  });

  it('el caso de la harina: ya existe en otra sede, no hay que crearla de nuevo', () => {
    const dups = productosSimilares('HARINA PAN', CATALOGO);
    expect(dups.map((d) => d.producto.sku)).toContain('VIV-012');
    expect(dups[0].producto.almacen).toBe('Viveres y Art. Limpieza');
  });

  it('reconoce el SKU cargado con el nombre químico', () => {
    const dups = productosSimilares('CASITERITA', CATALOGO);
    expect(dups.map((d) => d.producto.sku)).toEqual(expect.arrayContaining(['MIN-CASITERITA', 'SNO2']));
  });

  it('no avisa por un material realmente nuevo', () => {
    expect(productosSimilares('GUANTES DE CARNAZA', CATALOGO)).toEqual([]);
  });

  it('los duplicados REALES del catálogo de producción siguen detectándose', () => {
    // Pares que hoy existen en la base con dos SKU distintos. Todos tienen que dar
    // 'exacto', que es el único nivel que frena el alta.
    const pares = [
      ['PINTURA EPOXICA GRIS', 'PINTURA EPOXICA GRIS'],
      ['ARROZ', 'ARROZ'],
      ['PAÑO DE COCINA', 'PAÑO DE COCINA'],
      ['CASITERITA', 'CASITERITA'],
      ['DISCO DE CORTE 7"', 'DISCO DE CORTE 7"'],
      ['ADAPTADOR HEMBRA DE 1"', 'ADAPTADOR HEMBRA DE 1"'],
      ['AZUCAR KONFIT 1KG', 'AZUCAR KONFIT 1KG'],
      ["BROCHA DE 4''", 'BROCHA DE (4")'],                        // mismo material, escrito distinto
      ['TIRRAJE 45293113/45293123', 'TIRRAJE 45293113 / 45293123'],
      ['LENTE DE SEGURIDAD BÁSICO', 'LENTE DE SEGURIDAD BASICO'],  // solo cambia el acento
    ];
    for (const [a, b] of pares) {
      const dups = productosSimilares(a, [p('x', 'SKU-X', b)]);
      expect(dups, `${a} vs ${b}`).toHaveLength(1);
      expect(dups[0].nivel, `${a} vs ${b}`).toBe('exacto');
    }
  });

  it('con menos de 3 letras todavía no se molesta al usuario', () => {
    expect(productosSimilares('PI', CATALOGO)).toEqual([]);
    expect(productosSimilares('', CATALOGO)).toEqual([]);
  });

  it('al editar no se sugiere a sí mismo', () => {
    const dups = productosSimilares('PINTURA EPOXICA GRIS', CATALOGO, { excluirId: '1' });
    expect(dups.map((d) => d.producto.id)).not.toContain('1');
    expect(dups.map((d) => d.producto.id)).toContain('2');
  });

  it('respeta el límite y ordena del más parecido al menos', () => {
    const dups = productosSimilares('FILTRO CATERPILLAR', CATALOGO, { limite: 1 });
    expect(dups).toHaveLength(1);
    expect(dups[0].score).toBeGreaterThanOrEqual(0.6);
  });

  it('también compara contra el nombre de búsqueda cargado en la ficha', () => {
    const cat = [p('9', 'VIV-099', 'ACEITE VATEL', { nombre_busqueda: 'ACEITE DE COCINA' })];
    const dups = productosSimilares('ACEITE DE COCINA', cat);
    expect(dups).toHaveLength(1);
    expect(dups[0].nivel).toBe('exacto');
  });
});
