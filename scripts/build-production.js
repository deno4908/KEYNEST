// A developer .env may set NODE_ENV=development. Build artifacts must always
// use React's production runtime, including when built outside GitHub Actions.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build({ mode: 'production' });
