import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const usersRouter = Router();

usersRouter.get('/lecturers', async (_req, res) => {
  const lecturers = await prisma.user.findMany({
    where: { role: 'LECTURER' },
    select: { id: true, name: true, email: true },
  });
  res.json(lecturers);
});

usersRouter.get('/students', async (_req, res) => {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT' },
    select: {
      id: true,
      student_id: true,
      name: true,
      email: true,
      face_embedding: true,
      created_at: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json(
    students.map((s) => ({
      ...s,
      enrolled: !!s.face_embedding,
      face_embedding: undefined,
    }))
  );
});

usersRouter.post('/students', async (req, res) => {
  const { name, email, face_embedding } = req.body;
  const student_id = String(req.body.student_id || '').trim().toUpperCase();
  if (!student_id || !name || !email) {
    return res.status(400).json({ error: 'student_id, name, and email are required' });
  }

  const student = await prisma.user.create({
    data: {
      role: 'STUDENT',
      student_id,
      name,
      email,
      face_embedding: face_embedding ? JSON.stringify(face_embedding) : null,
    },
  });

  res.status(201).json({
    id: student.id,
    student_id: student.student_id,
    name: student.name,
    email: student.email,
    enrolled: !!student.face_embedding,
  });
});

usersRouter.put('/students/:id/face', async (req, res) => {
  const { face_embedding } = req.body;
  if (!Array.isArray(face_embedding) || face_embedding.length !== 128) {
    return res.status(400).json({ error: 'Valid 128-d face embedding required' });
  }

  const student = await prisma.user.update({
    where: { id: req.params.id },
    data: { face_embedding: JSON.stringify(face_embedding) },
  });

  res.json({ id: student.id, enrolled: true });
});

usersRouter.put('/students/by-student-id/:studentId/face', async (req, res) => {
  const student_id = req.params.studentId.trim().toUpperCase();
  const { face_embedding } = req.body;
  if (!Array.isArray(face_embedding) || face_embedding.length !== 128) {
    return res.status(400).json({ error: 'Valid 128-d face embedding required' });
  }

  const student = await prisma.user.update({
    where: { student_id },
    data: { face_embedding: JSON.stringify(face_embedding) },
  });

  res.json({ id: student.id, student_id: student.student_id, enrolled: true });
});

usersRouter.get('/students/by-student-id/:studentId', async (req, res) => {
  const student_id = req.params.studentId.trim().toUpperCase();
  const student = await prisma.user.findUnique({
    where: { student_id },
    select: {
      id: true,
      student_id: true,
      name: true,
      email: true,
      face_embedding: true,
    },
  });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json({ ...student, enrolled: !!student.face_embedding });
});
