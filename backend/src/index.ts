import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import jobRoutes from './routes/jobRoutes';
import ollamaRoutes from './routes/ollamaRoutes';
import resumeRoutes from './routes/resumeRoutes';
import { openApiSpec } from './swagger/openapi';
import { startJobScheduler } from './services/schedulerService';
import { warmOllamaModel } from './services/ollamaService';

const app = express();
const PORT = config.port;
const HOST = config.host;

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5001', 'http://127.0.0.1:5001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.text({ type: ['text/plain', 'text/*'], limit: '2mb' }));

// Clear error when Swagger Try-it-out pastes raw newlines into JSON strings
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    return res.status(400).json({
      message:
        'Invalid JSON (often caused by unescaped newlines in jobDescription). ' +
        'In Swagger, use the form fields under application/x-www-form-urlencoded, ' +
        'or POST text/plain with the raw JD, or escape newlines as \\n in JSON.',
    });
  }
  return next(err);
});

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(config.uploadsDir));

// Swagger UI — no auth
app.get('/api-docs.json', (_req, res) => {
  res.json(openApiSpec);
});
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec as object, {
    customSiteTitle: 'ResumeMaker API',
    swaggerOptions: {
      persistAuthorization: false,
      tryItOutEnabled: true,
      requestTimeout: 900000,
      displayRequestDuration: true,
    },
  })
);

app.use('/api/resume', resumeRoutes);
app.use('/api/ollama', ollamaRoutes);
app.use('/api/jobs', jobRoutes);

async function startServer() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('MongoDB connected successfully');

    app.listen(PORT, HOST, () => {
      const baseUrl = `http://${HOST}:${PORT}`;
      console.log(`Server running on ${baseUrl}`);
      console.log(`Swagger UI: ${baseUrl}/api-docs`);
      console.log(`Uploads: ${path.resolve(config.uploadsDir)}`);
    });

    startJobScheduler();
    if (config.resumeAgent.provider === 'ollama') {
      warmOllamaModel().catch((err) => console.warn('Ollama warm-up error:', err));
    }
  } catch (err) {
    console.error('MongoDB connection error — HTTP server was not started:', err);
    process.exitCode = 1;
  }
}

void startServer();
