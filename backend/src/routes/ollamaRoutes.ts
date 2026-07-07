import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

/** Proxy to local Ollama so the Selenium chat page avoids CORS issues. */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { model, messages, stream } = req.body ?? {};
    if (!model || !Array.isArray(messages)) {
      return res.status(400).json({ message: 'model and messages are required' });
    }

    const ollamaRes = await fetch(`${config.ollama.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: stream !== false,
      }),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      return res.status(ollamaRes.status).json({
        message: `Ollama error: ${text.slice(0, 500)}`,
      });
    }

    if (stream !== false && ollamaRes.body) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = ollamaRes.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      };
      pump().catch((err) => {
        console.error('Ollama stream proxy error:', err);
        if (!res.headersSent) res.status(500).json({ message: 'Stream failed' });
        else res.end();
      });
      return;
    }

    const data = await ollamaRes.json();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ollama proxy failed';
    res.status(502).json({
      message: `${message}. Is Ollama running? (ollama serve / open Ollama desktop)`,
    });
  }
});

router.get('/models', async (_req: Request, res: Response) => {
  try {
    const ollamaRes = await fetch(`${config.ollama.apiUrl}/api/tags`);
    if (!ollamaRes.ok) {
      return res.status(502).json({ message: 'Could not reach Ollama' });
    }
    const data = await ollamaRes.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({
      message: err instanceof Error ? err.message : 'Ollama unreachable',
    });
  }
});

export default router;
