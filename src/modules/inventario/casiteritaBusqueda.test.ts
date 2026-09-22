import { describe, it, expect } from 'vitest';
import type { CasiteritaDetalle } from './casiteritaDetalle.repository';
import { filtrarCasiterita, normalizar, textoDeFila, type UsoDeFila } from './casiteritaBusqueda';

function fila(p: Partial<CasiteritaDetalle> = {}): CasiteritaDetalle {
  return {
    id: 'id-1', grupo_id: null, cierre_id: null,
    procedencia: 'BARRIDA', precinto: null, n_analisis: null,
    categoria: 'saco', cant: 1,
    peso_neto_kgs: 7.5, peso_casiterita_kgs: 7, prom_sn: null, peso_puro_sn: null,
    tasa: 18.74, almacen: 'SNO₂ CASITERITA ALMACEN', nota: null,
    actor: null, actor_name: null, stock_kg: 7,
    created_at: '2026-09-01T10:00:00Z', updated_at: null,
    ...p,
  } as CasiteritaDetalle;
}

const filas = [
  fila({ id: 'a', procedencia: 'BARRIDA', precinto: '0012', n_analisis: '2214', categoria: 'saco', peso_neto_kgs: 7.5, peso_casiterita_kgs: 7, tasa: 18.74, prom_sn: 65 }),
  fila({ id: 'b', procedencia: 'CENTRO ACOPIO LA ESPERANZA', precinto: '0099', n_analisis: '2217', categoria: 'bigbag', peso_neto_kgs: 1050, peso_casiterita_kgs: 1048.5, tasa: 20, prom_sn: 58.4 }),
  fila({ id: 'c', procedencia: 'PERAMANAL', precinto: 'A-15', n_analisis: null, categoria: 'tobo', peso_neto_kgs: 30, peso_casiterita_kgs: 29, tasa: null, nota: 'revisar humedad' }),
];

describe('el texto normalizado', () => {
  it('quita acentos y pasa a minúscula', () => {
    expect(normalizar('  ANÁLISIS 22  ')).toBe('analisis 22');
    expect(normalizar('PROCEDENCIA ÑU')).toBe('procedencia nu');
  });
  it('un valor vacío no rompe nada', () => {
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});

describe('qué se puede buscar de una fila', () => {
  it('el precinto, el análisis, la procedencia y la categoría', () => {
    const t = textoDeFila(filas[0]);
    expect(t).toContain('0012');
    expect(t).toContain('2214');
    expect(t).toContain('barrida');
    expect(t).toContain('saco');
  });

  it('un número escrito como se ve en pantalla y como se piensa', () => {
    const t = textoDeFila(filas[0]);
    expect(t).toContain('7,50');   // como lo muestra la tabla
    expect(t).toContain('7.5');    // como lo escribe quien piensa en decimales
    expect(t).toContain('18,74');  // la tasa
  });

  it('el miles con punto y sin punto', () => {
    const t = textoDeFila(filas[1]);
    expect(t).toContain('1.048,50');   // como lo muestra la tabla
    expect(t).toContain('1048,50');    // como se teclea sin el punto de miles
    expect(t).toContain('1048.50');    // con punto decimal
  });

  it('un número se encuentra escribiendo solo la parte entera', () => {
    // Es lo que hace la gente: se acuerda de «1048», no de «1.048,50».
    expect(filtrarCasiterita(filas, '1048').map((f) => f.id)).toEqual(['b']);
    expect(filtrarCasiterita(filas, '1.048').map((f) => f.id)).toEqual(['b']);
  });

  it('el valor calculado (peso × tasa), que no es una columna guardada', () => {
    // 7 × 18,74 = 131,18 — es lo que se ve en la columna VALOR.
    expect(textoDeFila(filas[0])).toContain('131,18');
  });

  it('la nota', () => {
    expect(textoDeFila(filas[2])).toContain('humedad');
  });
});

describe('el estado del saco también se busca', () => {
  it('sin consumo dice «sin usar» y «disponible»', () => {
    const t = textoDeFila(filas[0]);
    expect(t).toContain('sin usar');
    expect(t).toContain('disponible');
  });

  it('con consumo parcial dice «parcial» y nombra la colada', () => {
    const uso: UsoDeFila = { kg: 3, coladas: [{ num: 5 }] };
    const t = textoDeFila(filas[0], uso);
    expect(t).toContain('parcial');
    expect(t).toContain('colada #5');
    expect(t).not.toContain('sin usar');
  });

  it('cuando se consumió entero dice «agotado»', () => {
    const t = textoDeFila(filas[0], { kg: 7, coladas: [{ num: 5 }] });
    expect(t).toContain('agotado');
    expect(t).not.toContain('parcial');
  });
});

describe('el filtro', () => {
  it('sin texto devuelve todo', () => {
    expect(filtrarCasiterita(filas, '')).toHaveLength(3);
    expect(filtrarCasiterita(filas, '   ')).toHaveLength(3);
  });

  it('encuentra por precinto', () => {
    expect(filtrarCasiterita(filas, '0099').map((f) => f.id)).toEqual(['b']);
    expect(filtrarCasiterita(filas, 'a-15').map((f) => f.id)).toEqual(['c']);
  });

  it('encuentra por número de análisis', () => {
    expect(filtrarCasiterita(filas, '2217').map((f) => f.id)).toEqual(['b']);
  });

  it('encuentra por procedencia, sin importar acentos ni mayúsculas', () => {
    expect(filtrarCasiterita(filas, 'esperanza').map((f) => f.id)).toEqual(['b']);
    expect(filtrarCasiterita(filas, 'PERAMANAL').map((f) => f.id)).toEqual(['c']);
  });

  it('encuentra por categoría con el nombre que se ve en pantalla', () => {
    expect(filtrarCasiterita(filas, 'big bag').map((f) => f.id)).toEqual(['b']);
    expect(filtrarCasiterita(filas, 'tobo').map((f) => f.id)).toEqual(['c']);
  });

  it('encuentra por un peso escrito como se ve', () => {
    expect(filtrarCasiterita(filas, '7,50').map((f) => f.id)).toEqual(['a']);
  });

  it('encuentra por tasa', () => {
    expect(filtrarCasiterita(filas, '18,74').map((f) => f.id)).toEqual(['a']);
  });

  it('varias palabras se exigen TODAS, en cualquier orden', () => {
    expect(filtrarCasiterita(filas, 'esperanza big').map((f) => f.id)).toEqual(['b']);
    expect(filtrarCasiterita(filas, 'big esperanza').map((f) => f.id)).toEqual(['b']);
    // «barrida» y «big bag» no coinciden en la misma fila.
    expect(filtrarCasiterita(filas, 'barrida big')).toHaveLength(0);
  });

  it('busca por el estado usando el consumo que se le pase', () => {
    const usos = new Map<string, UsoDeFila>([['a', { kg: 3, coladas: [{ num: 5 }] }]]);
    expect(filtrarCasiterita(filas, 'parcial', usos).map((f) => f.id)).toEqual(['a']);
    expect(filtrarCasiterita(filas, 'colada 5', usos).map((f) => f.id)).toEqual(['a']);
    expect(filtrarCasiterita(filas, 'sin usar', usos).map((f) => f.id).sort()).toEqual(['b', 'c']);
  });

  it('lo que no está no aparece', () => {
    expect(filtrarCasiterita(filas, 'zanahoria')).toHaveLength(0);
  });

  it('conserva el orden en que venían las filas', () => {
    expect(filtrarCasiterita(filas, '0').map((f) => f.id)).toEqual(
      filas.filter((f) => filtrarCasiterita([f], '0').length).map((f) => f.id),
    );
  });
});
