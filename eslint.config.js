import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  vue: true,
  jsonc: true,
  typescript: true,

  ignores: [
    'vscode-dts/**',
    'temp/**',
  ],
}, {
  rules: {
    'ts/no-use-before-define': 'off',
  },
})
