import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';
import crypto from 'crypto';

export interface AuthRequest extends Request {
  user?: DecodedIdToken & { role?: string; name?: string };
}

const SESSION_SECRET = process.env.GEMINI_API_KEY || 'kr-agro-tank-stock-secret-key-2026';

export function createLocalSessionToken(payload: {
  uid: string;
  email: string;
  name: string;
  role: string;
}): string {
  const data = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `local.${data}.${signature}`;
}

export function verifyLocalSessionToken(token: string): {
  uid: string;
  email: string;
  name: string;
  role: string;
} | null {
  if (!token.startsWith('local.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, data, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];

  // 1. Check signed local session token (for standard email/password login)
  const localPayload = verifyLocalSessionToken(token);
  if (localPayload) {
    req.user = {
      uid: localPayload.uid,
      email: localPayload.email,
      name: localPayload.name,
      role: localPayload.role,
    } as unknown as DecodedIdToken & { role?: string; name?: string };
    return next();
  }

  // 2. Verify Firebase ID Token via Firebase Admin SDK
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
