import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';
import { createHash } from 'crypto';

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex');
}

const router = Router();

// POST /api/lead — capture a new lead
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check if customer already exists
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE email = $1',
      [email]
    );

    if (existing) {
      res.json({ id: existing.id, existing: true });
      return;
    }

    // Create new customer
    const passwordHash = hashPassword(password);
    const newCustomer = await queryOne<{ id: string }>(
      'INSERT INTO customers (name, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, phone, passwordHash]
    );

    res.json({ id: newCustomer?.id, existing: false });
  } catch (err: any) {
    console.error('Lead capture error:', err);
    res.status(500).json({ error: err.message || 'Failed to save' });
  }
});

export default router;
