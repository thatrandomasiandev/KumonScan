import './loadEnv.js';
import app from './app.js';
import { closeStaleOpenSessions } from './sessionHygiene.js';

const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', async () => {
  // Boot-time maintenance runs across all centers (null = unscoped on purpose).
  const closed = await closeStaleOpenSessions(null);
  if (closed > 0) {
    console.log(`Closed ${closed} stale open session(s) from prior days / duplicates`);
  }
  console.log(`KumonScan server running on http://0.0.0.0:${PORT}`);
});
