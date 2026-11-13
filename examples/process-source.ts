// Supervised source example: one JSON event per stdout line; diagnostics on stderr.
let seq = 0;
console.error('example source started');
setInterval(() => {
  console.log(JSON.stringify({ type: 'example.pulse', payload: { seq: ++seq, time: new Date().toISOString() } }));
}, 5000);
export {};
