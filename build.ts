// build.ts
const entrypoints = ['./index.ts']; // Update to your entry file(s)
const outdir = './dist';

const { success, outputs, logs } = await Bun.build({
  entrypoints,
  outdir,
  target: 'node',
  format: 'cjs',
  sourcemap: 'external',
  packages: 'external',
  naming: {
    entry: '[name].js',
  },
})

if (!success) {
  console.error('❌ Bun build failed:');
  for (const log of logs) {
    console.error(log.toString());
  }
  process.exit(1);
}

console.log('✅ Bun build succeeded:');
for (const output of outputs) {
  console.log('  -', output.path);
}
