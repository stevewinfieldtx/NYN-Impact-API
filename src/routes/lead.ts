import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../db';

const router = Router();

// POST /api/lead — capture a new lead
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
      res.status(400).json({ error: 'All fields are required' });
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
    const newCustomer = await queryOne<{ id: string }>(
      'INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3) RETURNING id',
      [name, email, phone]
    );

    res.json({ id: newCustomer?.id, existing: false });
  } catch (err: any) {
    console.error('Lead capture error:', err);
    res.status(500).json({ error: err.message || 'Failed to save' });
  }
});

export default router;
