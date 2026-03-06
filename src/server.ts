import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat';
import contentRoutes from './routes/content';
import leadRoutes from './routes/lead';
import customerRoutes from './routes/customer';
import deployRoutes from './routes/deploy';
import interviewRoutes from './routes/interview';
import projectRoutes from './routes/project';
import aiSelfCorrectRoutes from './routes/aiSelfCorrect';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// ── Middleware ──
const allowedOrigins = process.env.FRONTEND_URL?.split(',').map(u => u.trim()) || ['http://localhost:3000'];
console.log('CORS allowed origins:', allowedOrigins);
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nyn-impact-api', timestamp: new Date().toISOString() });
});

// ── Routes ──
app.use('/api/chat', chatRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/lead', leadRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/ai-self-correct', aiSelfCorrectRoutes);

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`NYN Impact API running on port ${PORT}`);
});
