import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat';
import contentRoutes from './routes/content';
import leadRoutes from './routes/lead';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// ── Middleware ──
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
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

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`NYN Impact API running on port ${PORT}`);
});
