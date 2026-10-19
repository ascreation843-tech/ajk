import { handle } from '@hono/node-server/vercel';
import app from '../dist/index.js';

const nodeHandler = handle(app);

export default function handler(req, res) {
  // If Vercel rewrote the request to /api/index.js, restore the original client path
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && matchedPath !== '/api/index.js') {
    const queryIndex = req.url ? req.url.indexOf('?') : -1;
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
    req.url = matchedPath + queryString;
  }
  return nodeHandler(req, res);
}

export const config = {
  maxDuration: 30,
};
