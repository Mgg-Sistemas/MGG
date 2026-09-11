/* ============================================================
   MGG · ESLint

   El plugin de hooks estaba instalado hace meses pero NO había archivo
   de configuración: `npm run lint` no revisaba nada. Así entró en
   producción un `useMemo` debajo de dos `return` tempranos, que tiró el
   error #310 de React y dejó el detalle de una OC en «Esta pantalla
   falló» apenas terminaban de cargar las ofertas.

   La regla que importa acá es `rules-of-hooks`: un hook que se ejecuta
   en unos renders y en otros no rompe la pantalla entera, y no hay test
   unitario que lo agarre. Va como ERROR.

   `exhaustive-deps` queda como aviso: es útil, pero hay dependencias
   omitidas a propósito en el código y convertirlas en error frenaría el
   trabajo sin arreglar nada roto.
   ============================================================ */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-*', 'node_modules', 'supabase/.temp', 'docs', '*.cjs'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // El resto queda en AVISO, a propósito. Son de estilo —una barra de más
      // dentro de un corchete, un espacio raro— y hoy hay 23 repartidas por
      // archivos que nadie está tocando. Como error, `npm run lint` fallaría
      // siempre y dejaría de servir como filtro justo para lo que sí importa.
      // Siguen saliendo en pantalla: se ven, no frenan.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
      'prefer-const': 'warn',
    },
  },
);
