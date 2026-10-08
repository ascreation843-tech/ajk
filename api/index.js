import { Hono } from 'hono'
import { handle } from 'hono/vercel'

const app = new Hono()

app.get('/api/ping', (c) => c.json({ success: true, message: 'Pong! Vercel is alive.' }))
app.get('/api/health', (c) => c.json({ status: 'ok', message: 'Lazy entry point is active' }))

app.all('*', async (c) => {
  try {
    const { default: realApp } = await import('../dist/index.js');
    return realApp.fetch(c.req.raw, c.env, c.executionCtx);
  } catch (err) {
    console.error('CRITICAL: Failed to lazy-load main app:', err);
    return c.json({
      success: false,
      message: 'Failed to initialize main application',
      error: err.message
    }, 500);
  }
})

export const config = {
  runtime: 'nodejs'
}

export default handle(app)
