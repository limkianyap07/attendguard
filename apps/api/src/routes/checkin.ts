import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { haversineDistanceMeters } from '../lib/haversine';
import { facesMatch, parseEmbedding } from '../lib/faceMatch';
import { isTokenExpired, validateQrToken } from '../lib/qrToken';
import type { Server } from 'socket.io';

const EMOTION_ALIASES: Record<string, string[]> = {
  SMILE: ['happy', 'smile'],
  HAPPY: ['happy', 'smile'],
  SURPRISED: ['surprised', 'surprise'],
  SURPRISE: ['surprised', 'surprise'],
  ANGRY: ['angry'],
  SAD: ['sad'],
  NEUTRAL: ['neutral'],
  FEAR: ['fearful', 'fear'],
  DISGUST: ['disgusted', 'disgust'],
};

function emotionMatches(required: string, detected: string): boolean {
  const req = required.toUpperCase();
  const det = detected.toLowerCase();
  const aliases = EMOTION_ALIASES[req] || [req.toLowerCase()];
  return aliases.includes(det);
}

export function createCheckinRouter(io: Server) {
  const router = Router();

  router.post('/', async (req, res) => {
    const {
      sessionId,
      studentId,
      window,
      token,
      latitude,
      longitude,
      faceEmbedding,
      detectedEmotion,
    } = req.body;

    if (!sessionId || !studentId || window == null || !token) {
      return res.status(400).json({ success: false, message: 'Missing check-in parameters' });
    }

    const session = await prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, message: 'Session not found or inactive' });
    }

    const student = await prisma.user.findUnique({ where: { student_id: studentId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not registered' });
    }

    const logFraud = async (reason: 'EXPIRED_QR' | 'OUT_OF_RANGE' | 'FACE_MISMATCH' | 'WRONG_EMOTION', message: string) => {
      const fraud = await prisma.fraudLog.create({
        data: { session_id: sessionId, student_id: student.id, rejection_reason: reason },
        include: { student: { select: { student_id: true, name: true } } },
      });
      io.to(`session:${sessionId}`).emit('fraud_alert', {
        id: fraud.id,
        studentId: student.student_id,
        studentName: student.name,
        reason,
        message,
        attemptedAt: fraud.attempted_at,
      });
      return res.status(400).json({ success: false, message, reason });
    };

    // Layer 1: Cryptographic QR token
    if (isTokenExpired(Number(window))) {
      return logFraud('EXPIRED_QR', 'QR code expired. Scan the current code on the lecturer screen.');
    }
    if (!validateQrToken(sessionId, Number(window), token)) {
      return logFraud('EXPIRED_QR', 'Invalid or tampered QR token.');
    }

    // Layer 2: Geofencing
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'GPS coordinates required' });
    }

    const distance = haversineDistanceMeters(
      session.location_lat,
      session.location_lng,
      Number(latitude),
      Number(longitude)
    );

    if (distance > session.radius_meters) {
      return logFraud(
        'OUT_OF_RANGE',
        `Outside classroom radius (${distance.toFixed(1)}m away, max ${session.radius_meters}m).`
      );
    }

    // Layer 3a: Face identity
    const storedEmbedding = parseEmbedding(student.face_embedding);
    if (!storedEmbedding) {
      return res.status(400).json({
        success: false,
        message: 'Face not enrolled. Ask lecturer to register your face first.',
      });
    }
    if (!Array.isArray(faceEmbedding) || faceEmbedding.length !== 128) {
      return res.status(400).json({ success: false, message: 'Face embedding required' });
    }
    if (!facesMatch(faceEmbedding, storedEmbedding)) {
      return logFraud('FACE_MISMATCH', 'Face does not match enrolled profile.');
    }

    // Layer 3b: Emotion challenge
    if (!detectedEmotion || !emotionMatches(session.required_emotion, detectedEmotion)) {
      return logFraud(
        'WRONG_EMOTION',
        `Required emotion: ${session.required_emotion}. Detected: ${detectedEmotion || 'none'}.`
      );
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { session_id_student_id: { session_id: sessionId, student_id: student.id } },
      create: {
        session_id: sessionId,
        student_id: student.id,
        geo_verified: true,
        face_verified: true,
        emotion_verified: true,
        final_status: 'PRESENT',
      },
      update: {
        checked_in_at: new Date(),
        geo_verified: true,
        face_verified: true,
        emotion_verified: true,
        final_status: 'PRESENT',
      },
      include: { student: { select: { student_id: true, name: true } } },
    });

    io.to(`session:${sessionId}`).emit('attendance_success', {
      id: record.id,
      studentId: student.student_id,
      studentName: student.name,
      distance: distance.toFixed(1),
      emotion: session.required_emotion,
      checkedInAt: record.checked_in_at,
    });

    res.json({
      success: true,
      message: 'Attendance verified — all 3 layers passed!',
      record: {
        id: record.id,
        distance: distance.toFixed(1),
        emotion: session.required_emotion,
        checkedInAt: record.checked_in_at,
      },
    });
  });

  return router;
}
