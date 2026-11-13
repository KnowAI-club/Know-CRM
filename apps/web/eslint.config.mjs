import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'scripts/**'] },
  {
    // The app does not use the React Compiler; data loading and form syncing in
    // effects are intentional, so the compiler-only purity rules are disabled.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
];

export default config;
