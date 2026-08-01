import { defineConfig, loadEnv } from 'vite';

/**
 * Mounts api/lead.js on the Vite dev server so the lead form works locally
 * exactly as it does on Vercel. Production deploys ignore this plugin; Vercel
 * serves api/lead.js as a serverless function.
 */
function leadApiDevPlugin(env) {
  return {
    name: 'kumonscan-lead-api-dev',
    configureServer(server) {
      if (env.DATABASE_URL && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = env.DATABASE_URL;
      }
      server.middlewares.use('/api/lead', async (req, res) => {
        const { default: handler } = await import('./api/lead.js');
        await handler(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [leadApiDevPlugin(env)],
  };
});
