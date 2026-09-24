/**
 * node:sqlite prints an ExperimentalWarning on Node 22. Import this module
 * before anything that touches the database so the filter is installed first.
 * Every other warning is still printed.
 */
process.removeAllListeners('warning');
process.on('warning', (warning: Error & { name: string }) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(`${warning.name}: ${warning.message}`);
});

export {};
