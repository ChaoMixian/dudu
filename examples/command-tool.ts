// Execute with bun; this module is never imported by the server.
const input = JSON.parse(await Bun.stdin.text());
if (input.tool !== 'echo' || typeof input.arguments?.text !== 'string') {
  console.error('Expected tool echo and arguments.text string');
  process.exit(1);
}
console.log(JSON.stringify({ text: input.arguments.text, label: input.config?.label ?? null }));
export {};
