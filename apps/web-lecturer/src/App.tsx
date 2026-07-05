import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { io, Socket } from 'socket.io-client';
import { api, API_URL, EMOTIONS, emotionLabel } from './lib/api';
import { FaceEnrollment } from './components/FaceEnrollment';

const VIEWING_SESSION_KEY = 'attendguard_viewing_session';
const QR_WINDOW_SECONDS = 15;

function getSecondsUntilQrRefresh(): number {
  const windowMs = QR_WINDOW_SECONDS * 1000;
  const remaining = windowMs - (Date.now() % windowMs);
  return Math.max(1, Math.ceil(remaining / 1000));
}

function getCurrentQrWindow(): number {
  return Math.floor(Date.now() / 1000 / QR_WINDOW_SECONDS);
}

interface Lecturer { id: string; name: string; email: string }
interface Student { id: string; student_id: string; name: string; email: string; enrolled: boolean }
interface Session {
  id: string; course_name: string; location_lat: number; location_lng: number;
  radius_meters: number; required_emotion: string; status: string;
}
interface AttendanceRow {
  id: string; sessionId?: string; courseName?: string;
  studentId: string; studentName: string; distance: string;
  emotion: string; checkedInAt: string;
}
interface FraudRow {
  id: string; sessionId?: string; courseName?: string;
  studentId: string; studentName: string; reason: string; message: string; attemptedAt: string;
}
interface QrData {
  sessionId: string; window: number; token: string; checkInUrl: string;
  expiresAt: number; secondsRemaining?: number;
}

export default function App() {
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [fraudLogs, setFraudLogs] = useState<FraudRow[]>([]);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(15);
  const [tab, setTab] = useState<'session' | 'students'>('session');
  const [restoring, setRestoring] = useState(true);
  const lastQrWindow = useRef(-1);

  const isLive = currentSession?.status === 'ACTIVE';

  const [form, setForm] = useState({
    lecturer_id: '',
    course_name: 'CS401 - Software Engineering',
    location_lat: 2.9650961,
    location_lng: 101.7318977,
    radius_meters: 50,
    required_emotion: 'HAPPY',
  });

  const [newStudent, setNewStudent] = useState({ student_id: '', name: '', email: '' });

  const loadStudents = () => api<Student[]>('/api/users/students').then(setStudents).catch(console.error);

  const loadAllHistory = async () => {
    const data = await api<{
      attendance: Array<{
        id: string; sessionId: string; courseName: string;
        studentId: string; studentName: string; emotion: string; checkedInAt: string;
      }>;
      fraud_logs: Array<{
        id: string; sessionId: string; courseName: string;
        studentId: string; studentName: string; reason: string; attemptedAt: string;
      }>;
    }>('/api/audit/history');

    setAttendance(data.attendance.map((a) => ({
      id: a.id,
      sessionId: a.sessionId,
      courseName: a.courseName,
      studentId: a.studentId,
      studentName: a.studentName,
      distance: '-',
      emotion: a.emotion,
      checkedInAt: a.checkedInAt,
    })));
    setFraudLogs(data.fraud_logs.map((f) => ({
      id: f.id,
      sessionId: f.sessionId,
      courseName: f.courseName,
      studentId: f.studentId,
      studentName: f.studentName,
      reason: f.reason,
      message: f.reason,
      attemptedAt: f.attemptedAt,
    })));
  };

  const restoreSession = async (sessionId: string) => {
    const session = await api<Session>(`/api/sessions/${sessionId}`);
    localStorage.setItem(VIEWING_SESSION_KEY, session.id);
    setCurrentSession(session);
    await loadAllHistory();

    if (session.status === 'ACTIVE') {
      try {
        const qr = await api<QrData>(`/api/sessions/${session.id}/qr`);
        setQrData(qr);
        lastQrWindow.current = qr.window;
      } catch {
        setQrData(null);
      }
    } else {
      setQrData(null);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        await api<Lecturer[]>('/api/users/lecturers').then(setLecturers);
        await loadStudents();
        await loadAllHistory();

        const savedId = localStorage.getItem(VIEWING_SESSION_KEY);
        if (savedId) {
          await restoreSession(savedId);
        } else {
          try {
            const active = await api<Session>('/api/sessions/latest/active');
            await restoreSession(active.id);
          } catch {
            /* no saved or active session */
          }
        }
      } finally {
        setRestoring(false);
      }
    };
    void init();
  }, []);

  useEffect(() => {
    if (lecturers.length && !form.lecturer_id) {
      setForm((f) => ({ ...f, lecturer_id: lecturers[0].id }));
    }
  }, [lecturers]);

  useEffect(() => {
    if (!isLive || !currentSession) return;
    let socket: Socket;

    socket = io(API_URL);
    socket.emit('join_session', currentSession.id);

    socket.on('qr_update', (data: QrData) => {
      setQrData(data);
      lastQrWindow.current = data.window;
    });

    socket.on('attendance_success', () => { void loadAllHistory(); });
    socket.on('fraud_alert', () => { void loadAllHistory(); });

    return () => { socket.disconnect(); };
  }, [isLive, currentSession?.id]);

  useEffect(() => {
    if (!isLive || !currentSession) return;

    const syncQrAndCountdown = async () => {
      setCountdown(getSecondsUntilQrRefresh());

      const windowNow = getCurrentQrWindow();
      if (windowNow !== lastQrWindow.current) {
        lastQrWindow.current = windowNow;
        try {
          const qr = await api<QrData>(`/api/sessions/${currentSession.id}/qr`);
          setQrData(qr);
        } catch {
          /* session may have ended */
        }
      }
    };

    void syncQrAndCountdown();
    const timer = setInterval(() => void syncQrAndCountdown(), 1000);
    return () => clearInterval(timer);
  }, [isLive, currentSession?.id]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAllHistory();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const createSession = async () => {
    const session = await api<Session>('/api/sessions', {
      method: 'POST', body: JSON.stringify(form),
    });
    await restoreSession(session.id);
    setTab('session');
  };

  const endSession = async () => {
    if (!currentSession) return;
    await api(`/api/sessions/${currentSession.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }),
    });
    setCurrentSession({ ...currentSession, status: 'COMPLETED' });
    setQrData(null);
    await loadAllHistory();
  };

  const registerStudent = async () => {
    const payload = {
      ...newStudent,
      student_id: newStudent.student_id.trim().toUpperCase(),
    };
    const created = await api<{ id: string }>('/api/users/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setNewStudent({ student_id: '', name: '', email: '' });
    await loadStudents();
    setEnrollingId(created.id);
  };

  const useMyLocation = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      setForm((f) => ({
        ...f,
        location_lat: pos.coords.latitude,
        location_lng: pos.coords.longitude,
      }));
    });
  };

  const qrValue = qrData
    ? JSON.stringify({ sessionId: qrData.sessionId, window: qrData.window, token: qrData.token })
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-4 md:p-8">
      <header className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-sky-400">Attend</span>Guard
          </h1>
          <p className="text-slate-400 text-sm mt-1">3-Layer Anti-Fraud Attendance System</p>
        </div>
        <div className="flex gap-3 text-sm">
          <span className="glass px-4 py-2 rounded-full text-emerald-400">Verified: {attendance.length}</span>
          <span className="glass px-4 py-2 rounded-full text-red-400">Fraud: {fraudLogs.length}</span>
          {isLive && (
            <span className="glass px-4 py-2 rounded-full text-sky-400 animate-pulse-ring">
              Live — {countdown}s
            </span>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex gap-2 mb-6">
        {(['session', 'students'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-sky-600 text-white' : 'glass text-slate-400 hover:text-white'}`}>
            {t === 'session' ? 'Live Session' : 'Student Registry'}
          </button>
        ))}
      </div>

      {tab === 'session' && (
        <div className="max-w-7xl mx-auto grid lg:grid-cols-[340px_1fr] gap-6">
          <div className="space-y-4">
            {restoring ? (
              <div className="glass rounded-2xl p-6 text-center text-slate-400">Loading session...</div>
            ) : !isLive ? (
              <div className="glass rounded-2xl p-6 glow-blue">
                {currentSession && (
                  <div className="mb-4 p-3 rounded-lg bg-slate-900/60 border border-slate-700 text-sm">
                    <p className="text-slate-400">Previous session</p>
                    <p className="text-sky-300 font-medium">{currentSession.course_name}</p>
                    <p className="text-xs text-slate-500 mt-1">Records below are saved in the database</p>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-sky-300 mb-4">Create Class Session</h2>
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="text-slate-400 block mb-1">Course Name</label>
                    <input value={form.course_name} onChange={(e) => setForm({ ...form, course_name: e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Latitude</label>
                      <input type="number" step="any" value={form.location_lat}
                        onChange={(e) => setForm({ ...form, location_lat: +e.target.value })}
                        className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Longitude</label>
                      <input type="number" step="any" value={form.location_lng}
                        onChange={(e) => setForm({ ...form, location_lng: +e.target.value })}
                        className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
                    </div>
                  </div>
                  <button onClick={useMyLocation} className="text-sky-400 text-xs hover:underline">
                    Use my current GPS location
                  </button>
                  <div>
                    <label className="text-slate-400 block mb-1">Radius (meters)</label>
                    <input type="number" value={form.radius_meters}
                      onChange={(e) => setForm({ ...form, radius_meters: +e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Required Emotion Challenge</label>
                    <select value={form.required_emotion}
                      onChange={(e) => setForm({ ...form, required_emotion: e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2">
                      {EMOTIONS.map((e) => (
                        <option key={e.value} value={e.value}>{e.emoji} {e.label}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={createSession}
                    className="w-full py-3 bg-sky-600 hover:bg-sky-500 rounded-xl font-semibold mt-2 transition">
                    Start Session
                  </button>
                </div>
              </div>
            ) : (
              <div className="glass rounded-2xl p-6 glow-blue text-center">
                <h2 className="text-lg font-semibold text-sky-300 mb-1">{currentSession!.course_name}</h2>
                <p className="text-slate-400 text-xs mb-4">
                  Emotion: {emotionLabel(currentSession!.required_emotion)} | Radius: {currentSession!.radius_meters}m
                </p>
                {qrValue && (
                  <div className="bg-white p-4 rounded-xl inline-block">
                    <QRCodeSVG value={qrValue} size={220} level="H" />
                  </div>
                )}
                <div className="mt-4">
                  <div className="text-4xl font-bold text-sky-400">{countdown}s</div>
                  <p className="text-xs text-slate-500 mt-1">QR refreshes every 15 seconds (synced to clock)</p>
                </div>
                <button onClick={endSession}
                  className="w-full mt-4 py-2 bg-red-700 hover:bg-red-600 rounded-xl text-sm font-medium">
                  End Session
                </button>
              </div>
            )}

            <div className="glass rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Verification Layers</h3>
              <ul className="space-y-2 text-xs text-slate-400">
                <li className="flex gap-2"><span className="text-sky-400">1.</span> HMAC-signed QR token (15s window)</li>
                <li className="flex gap-2"><span className="text-sky-400">2.</span> Haversine geofence check</li>
                <li className="flex gap-2"><span className="text-sky-400">3.</span> face-api.js identity + emotion</li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass rounded-2xl p-6 glow-green">
              <h3 className="text-emerald-400 font-semibold mb-1">Verified Attendance</h3>
              <p className="text-xs text-slate-500 mb-4">All sessions — saved permanently in database</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2">Session</th>
                      <th className="text-left py-2">Student</th>
                      <th className="text-left py-2">Name</th>
                      <th className="text-left py-2">Emotion</th>
                      <th className="text-left py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.length === 0 && (
                      <tr><td colSpan={5} className="py-8 text-center text-slate-600">No verified check-ins yet</td></tr>
                    )}
                    {attendance.map((row) => (
                      <tr key={row.id} className="border-b border-slate-800">
                        <td className="py-3 text-slate-400 text-xs">{row.courseName || '-'}</td>
                        <td className="text-sky-300">{row.studentId}</td>
                        <td>{row.studentName}</td>
                        <td className="text-emerald-400">{row.emotion}</td>
                        <td className="text-slate-500">{new Date(row.checkedInAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass rounded-2xl p-6 glow-red">
              <h3 className="text-red-400 font-semibold mb-1">Fraud Audit Log</h3>
              <p className="text-xs text-slate-500 mb-4">All sessions — saved permanently in database</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2">Session</th>
                      <th className="text-left py-2">Student</th>
                      <th className="text-left py-2">Name</th>
                      <th className="text-left py-2">Reason</th>
                      <th className="text-left py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fraudLogs.length === 0 && (
                      <tr><td colSpan={5} className="py-8 text-center text-slate-600">No fraud attempts</td></tr>
                    )}
                    {fraudLogs.map((row) => (
                      <tr key={row.id} className="border-b border-slate-800">
                        <td className="py-3 text-slate-400 text-xs">{row.courseName || '-'}</td>
                        <td className="text-red-300">{row.studentId}</td>
                        <td>{row.studentName}</td>
                        <td className="text-red-400">{row.reason}</td>
                        <td className="text-slate-500">{new Date(row.attemptedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'students' && (
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-sky-300 mb-2">Register New Student</h2>
            <p className="text-xs text-slate-500 mb-4">
              Adding a student saves their ID to the database. They must also enroll their face (here or on the student app) before check-in.
            </p>
            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <input placeholder="Student ID (STU004)" value={newStudent.student_id}
                onChange={(e) => setNewStudent({ ...newStudent, student_id: e.target.value })}
                className="bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
              <input placeholder="Full Name" value={newStudent.name}
                onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                className="bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
              <input placeholder="Email" value={newStudent.email}
                onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                className="bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2" />
            </div>
            <button onClick={registerStudent} className="mt-3 px-6 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium">
              Add Student
            </button>
          </div>

          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-sky-300 mb-4">Enrolled Students</h2>
            <div className="space-y-2">
              {students.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                  <div>
                    <span className="text-sky-300 font-medium">{s.student_id}</span>
                    <span className="mx-2 text-slate-600">|</span>
                    <span>{s.name}</span>
                    <span className={`ml-3 text-xs px-2 py-0.5 rounded-full ${s.enrolled ? 'bg-emerald-900/50 text-emerald-400' : 'bg-amber-900/50 text-amber-400'}`}>
                      {s.enrolled ? 'Face Enrolled' : 'ID Only — Enroll Face'}
                    </span>
                  </div>
                  <button onClick={() => setEnrollingId(enrollingId === s.id ? null : s.id)}
                    className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg">
                    {enrollingId === s.id ? 'Close' : 'Enroll Face'}
                  </button>
                </div>
              ))}
            </div>
            {enrollingId && (
              <FaceEnrollment
                student={students.find((s) => s.id === enrollingId)!}
                onEnrolled={() => { setEnrollingId(null); loadStudents(); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
