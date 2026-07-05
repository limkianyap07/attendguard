import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const auditRouter = Router();

auditRouter.get('/history', async (_req, res) => {
  const [attendance, fraud_logs] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { final_status: 'PRESENT' },
      include: {
        student: { select: { student_id: true, name: true } },
        session: { select: { id: true, course_name: true, required_emotion: true } },
      },
      orderBy: { checked_in_at: 'desc' },
    }),
    prisma.fraudLog.findMany({
      include: {
        student: { select: { student_id: true, name: true } },
        session: { select: { id: true, course_name: true } },
      },
      orderBy: { attempted_at: 'desc' },
    }),
  ]);

  res.json({
    attendance: attendance.map((a) => ({
      id: a.id,
      sessionId: a.session_id,
      courseName: a.session.course_name,
      studentId: a.student.student_id,
      studentName: a.student.name,
      emotion: a.session.required_emotion,
      checkedInAt: a.checked_in_at,
      geoVerified: a.geo_verified,
      faceVerified: a.face_verified,
      emotionVerified: a.emotion_verified,
    })),
    fraud_logs: fraud_logs.map((f) => ({
      id: f.id,
      sessionId: f.session_id,
      courseName: f.session.course_name,
      studentId: f.student.student_id,
      studentName: f.student.name,
      reason: f.rejection_reason,
      attemptedAt: f.attempted_at,
    })),
    totals: { verified: attendance.length, fraud: fraud_logs.length },
  });
});
