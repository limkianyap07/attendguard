import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const lecturer = await prisma.user.upsert({
    where: { email: 'dr.smith@university.edu' },
    update: {},
    create: {
      role: 'LECTURER',
      name: 'Dr. Sarah Smith',
      email: 'dr.smith@university.edu',
    },
  });

  const students = [
    { student_id: 'STU001', name: 'Alice Chen', email: 'alice@student.edu' },
    { student_id: 'STU002', name: 'Bob Martinez', email: 'bob@student.edu' },
    { student_id: 'STU003', name: 'Carol Williams', email: 'carol@student.edu' },
  ];

  for (const s of students) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { role: 'STUDENT', ...s },
    });
  }

  console.log('Seeded lecturer:', lecturer.email);
  console.log('Seeded 3 demo students (enroll faces via dashboard)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
