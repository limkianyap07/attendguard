import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { buildQrPayload, getCurrentWindow, QR_WINDOW_SECONDS } from '../lib/qrToken';

export const sessionsRouter = Router();

sessionsRouter.post('/', async (req, res) => {
  const {
    lecturer_id,
    course_name,
    location_lat,
    location_lng,
    radius_meters = 50,
    required_emotion,
  } = req.body;

  if (!lecturer_id || !course_name || location_lat == null || location_lng == null || !required_emotion) {
    return res.status(400).json({ error: 'Missing required session fields' });
  }

  const session = await prisma.classSession.create({
    data: {
      lecturer_id,
      course_name,
      location_lat: Number(location_lat),
      location_lng: Number(location_lng),
      radius_meters: Number(radius_meters),
      required_emotion: required_emotion.toUpperCase(),
      status: 'ACTIVE',
    },
    include: { lecturer: { select: { name: true, email: true } } },
  });

  res.status(201).json(session);
});

sessionsRouter.get('/', async (_req, res) => {
  const sessions = await prisma.classSession.findMany({
    include: {
      lecturer: { select: { name: true } },
      _count: { select: { attendance: true, fraud_logs: true } },
    },
    orderBy: { created_at: 'desc' },
  });
  res.json(sessions);
});

sessionsRouter.get('/latest/active', async (_req, res) => {
  const session = await prisma.classSession.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { created_at: 'desc' },
  });
  if (!session) return res.status(404).json({ error: 'No active session' });
  res.json(session);
});

sessionsRouter.get('/:id', async (req, res) => {
  const session = await prisma.classSession.findUnique({
    where: { id: req.params.id },
    include: { lecturer: { select: { name: true, email: true } } },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

sessionsRouter.get('/:id/qr', async (req, res) => {
  const session = await prisma.classSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'ACTIVE') return res.status(400).json({ error: 'Session is not active' });

  const qr = buildQrPayload(session.id);
  res.json({
    ...qr,
    windowSeconds: QR_WINDOW_SECONDS,
    currentWindow: getCurrentWindow(),
    session: {
      course_name: session.course_name,
      required_emotion: session.required_emotion,
      location_lat: session.location_lat,
      location_lng: session.location_lng,
      radius_meters: session.radius_meters,
    },
  });
});

sessionsRouter.get('/:id/dashboard', async (req, res) => {
  const session = await prisma.classSession.findUnique({
    where: { id: req.params.id },
    include: {
      attendance: {
        include: { student: { select: { student_id: true, name: true } } },
        orderBy: { checked_in_at: 'desc' },
      },
      fraud_logs: {
        include: { student: { select: { student_id: true, name: true } } },
        orderBy: { attempted_at: 'desc' },
      },
    },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

sessionsRouter.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const session = await prisma.classSession.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json(session);
});
