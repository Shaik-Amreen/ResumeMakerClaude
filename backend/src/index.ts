import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import jobRoutes from './routes/jobRoutes';
import ollamaRoutes from './routes/ollamaRoutes';
import { startJobScheduler } from './services/schedulerService';

const app = express();
const PORT = config.port;

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5001', 'http://127.0.0.1:5001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(config.uploadsDir));
app.use('/api/ollama', ollamaRoutes);
app.use('/api/jobs', jobRoutes);

mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log('MongoDB connected successfully');
    startJobScheduler();
  })
  .catch((err) => console.error('MongoDB connection error:', err));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Uploads: ${path.resolve(config.uploadsDir)}`);
});
