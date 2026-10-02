/* ============================================================
   MGG · build para el servidor

   `npm run build` deja los assets apuntando a /proyecto/, porque en
   vite.config.ts `base` vale '/proyecto/' si nadie dice lo contrario.
   El servidor sirve la app en la raíz, así que un build hecho sin
   VITE_BASE_PATH=/ se copia bien, no da ningún error… y la página
   carga en BLANCO: el navegador pide /proyecto/assets/… y recibe 404.

   Poner la variable a mano no es portable: `VITE_BASE_PATH=/ npm run
   build` no funciona en PowerShell ni en cmd, que es desde donde se
   suben las entregas a mano. Por eso existe este script: hace el
   build del servidor igual en Windows, Linux y en el workflow.

   Uso: npm run build:prod
   ============================================================ */
import { spawnSync } from 'node:child_process';

// Las credenciales NO se hornean acá: salen del .env local (desarrollo) o de
// los secrets del workflow. Este script solo fija la base de las rutas.
const r = spawnSync('npm run build', {
  stdio: 'inherit',
  shell: true, // en Windows npm es un .cmd; el comando va entero, sin argumentos aparte
  env: { ...process.env, VITE_BASE_PATH: '/' },
});

if (r.status !== 0) process.exit(r.status ?? 1);

console.log('\n✔ Build para el servidor listo en dist/ (rutas en la raíz).');
console.log('  Copiar el CONTENIDO de dist/ a la carpeta que sirve nginx.');
