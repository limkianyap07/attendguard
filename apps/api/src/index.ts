import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { prisma } from './lib/prisma';
import {
  buildQrPayload,
  getCurrentWindow,
  getSecondsRemainingInWindow,
  QR_WINDOW_SECONDS,
} from './lib/qrToken';
import { sessionsRouter } from './routes/sessions';
import { usersRouter } from './routes/users';
import { createCheckinRouter } from './routes/checkin';
import { auditRouter } from './routes/audit';

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const io = new Server(httpServer, { cors: { origin: '*' } });

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'AttendGuard API', qrWindowSeconds: QR_WINDOW_SECONDS });
});

app.use('/api/users', usersRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/checkin', createCheckinRouter(io));
app.use('/api/audit', auditRouter);

type SessionTimers = { interval?: ReturnType<typeof setInterval> };
const activeSessionTimers = new Map<string, SessionTimers>();

function stopQrRotation(sessionId: string) {
  const timers = activeSessionTimers.get(sessionId);
  if (!timers) return;
  if (timers.interval) clearInterval(timers.interval);
  activeSessionTimers.delete(sessionId);
}

function startQrRotation(sessionId: string) {
  if (activeSessionTimers.has(sessionId)) return;

  let lastWindow = -1;
  const timers: SessionTimers = {};
  activeSessionTimers.set(sessionId, timers);

  const tick = async () => {
    const session = await prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'ACTIVE') {
      stopQrRotation(sessionId);
      return;
    }

    const currentWindow = getCurrentWindow();
    if (currentWindow !== lastWindow) {
      lastWindow = currentWindow;
      const qr = buildQrPayload(sessionId, currentWindow);
      io.to(`session:${sessionId}`).emit('qr_update', {
        ...qr,
        secondsRemaining: getSecondsRemainingInWindow(),
      });
    }
  };

  void tick();
  timers.interval = setInterval(() => void tick(), 1000);
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('join_session', async (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    console.log(`${socket.id} joined session:${sessionId}`);

    const session = await prisma.classSession.findUnique({ where: { id: sessionId } });
    if (session?.status === 'ACTIVE') {
      const qr = buildQrPayload(sessionId);
      socket.emit('qr_update', {
        ...qr,
        secondsRemaining: getSecondsRemainingInWindow(),
      });
    }

    startQrRotation(sessionId);
  });

  socket.on('leave_session', (sessionId: string) => {
    socket.leave(`session:${sessionId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`AttendGuard API running on https://attendguard-api.onrender.com`);
  console.log(`QR token window: ${QR_WINDOW_SECONDS}s | window #${getCurrentWindow()}`);
});
