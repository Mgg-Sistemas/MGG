import { describe, it, expect } from 'vitest';
import { crearRepoDemo } from './demo/datosDemoAdministracion';
import { saldoGestion } from './administracionHonorarios';
import type { GestionInput } from './admin.repository';

const gi = (over: Partial<GestionInput>): GestionInput => ({
  empresaClave: 'GT', profesionalId: 'p1', categoriaId: null, centroAcopioId: null, documentoId: null,
  concepto: 'Redacción de poder', costoTotal: 200, moneda: 'USD', tasaRef: null,
  fecha: '2026-11-07', fechaPactada: null, estado: 'abierta', notaAcuerdo: null, ...over,
});

describe('AdminRepo · envíos a Tesorería (puente atómico, reversible)', () => {
  it('parcial → pagar baja saldo; rechaza sobre-envío y reversa de pagado; reversa no-pagado no baja saldo', async () => {
    const repo = crearRepoDemo();
    const g = await repo.crearGestion(gi({ costoTotal: 200, moneda: 'USD' }));

    const env = await repo.crearEnvio({ gestion: g, monto: 50, profesionalNombre: 'Abg. Ana', actor: 'tester' });
    expect(env.estado).toBe('enviado');
    // Aún no pagado → saldo sigue 200.
    expect(saldoGestion(g, await repo.listEnvios(g.id))).toBe(200);

    // Tesorería paga (simulado).
    repo.__marcarEnvioPagado(env.id);
    const envios1 = await repo.listEnvios(g.id);
    expect(envios1.find((e) => e.id === env.id)?.estado).toBe('pagado');
    expect(saldoGestion(g, envios1)).toBe(150);

    // Sobre-envío (200 > saldo 150) → rechazado.
    await expect(repo.crearEnvio({ gestion: g, monto: 200, profesionalNombre: 'Abg. Ana', actor: 't' })).rejects.toThrow();

    // Reversar un envío YA PAGADO → rechazado.
    await expect(repo.reversarEnvio(env.id)).rejects.toThrow();

    // Crear 30 (no pagado) y reversarlo → 'reversado'; no baja el saldo.
    const env2 = await repo.crearEnvio({ gestion: g, monto: 30, profesionalNombre: 'Abg. Ana', actor: 't' });
    await repo.reversarEnvio(env2.id);
    const envios2 = await repo.listEnvios(g.id);
    expect(envios2.find((e) => e.id === env2.id)?.estado).toBe('reversado');
    expect(saldoGestion(g, envios2)).toBe(150);
  });

  it('NO deja sobre-comprometer con envíos pendientes (dos envíos no pagados que sumen más del costo)', async () => {
    const repo = crearRepoDemo();
    const g = await repo.crearGestion(gi({ costoTotal: 200, moneda: 'USD' }));
    await repo.crearEnvio({ gestion: g, monto: 200, profesionalNombre: 'Abg. Ana', actor: 't' }); // 'enviado', no pagado
    // Aunque el saldo (costo − pagado) siga en 200, ya está TODO comprometido → rechaza.
    await expect(repo.crearEnvio({ gestion: g, monto: 1, profesionalNombre: 'Abg. Ana', actor: 't' })).rejects.toThrow();
  });
});
