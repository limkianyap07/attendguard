import crypto from 'crypto';

export const QR_WINDOW_SECONDS = 15;

const SECRET = process.env.QR_SECRET || 'attendguard-dev-secret';

export function getCurrentWindow(): number {
  return Math.floor(Date.now() / 1000 / QR_WINDOW_SECONDS);
}

export function generateQrToken(sessionId: string, window: number): string {
  const payload = `${sessionId}:${window}`;
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
}

export function validateQrToken(sessionId: string, window: number, token: string): boolean {
  const expected = generateQrToken(sessionId, window);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export function isTokenExpired(qrWindow: number): boolean {
  return qrWindow < getCurrentWindow();
}

export function getMsUntilNextWindow(): number {
  const windowMs = QR_WINDOW_SECONDS * 1000;
  return windowMs - (Date.now() % windowMs);
}

export function getSecondsRemainingInWindow(): number {
  return Math.ceil(getMsUntilNextWindow() / 1000);
}

export function buildQrPayload(sessionId: string, window?: number) {
  const w = window ?? getCurrentWindow();
  const token = generateQrToken(sessionId, w);
  const studentAppUrl = process.env.STUDENT_APP_URL || 'http://localhost:5174';
  return {
    sessionId,
    window: w,
    token,
    expiresAt: (w + 1) * QR_WINDOW_SECONDS * 1000,
    secondsRemaining: getSecondsRemainingInWindow(),
    checkInUrl: `${studentAppUrl}/checkin?sessionId=${sessionId}&window=${w}&token=${token}`,
  };
}
