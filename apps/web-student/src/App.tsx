import { useEffect, useRef, useState, useCallback } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { loadFaceModels, detectFace, captureFaceEmbedding, emotionMatches } from './lib/faceApi';
import { api, emotionLabel } from './lib/api';

type Step = 'identity' | 'enroll' | 'scan' | 'location' | 'biometric' | 'result';

interface QrPayload {
  sessionId: string;
  window: number;
  token: string;
}

interface SessionInfo {
  course_name: string;
  required_emotion: string;
  location_lat: number;
  location_lng: number;
  radius_meters: number;
}

function parseQr(raw: string): QrPayload | null {
  try {
    const data = JSON.parse(raw);
    if (data.sessionId && data.token != null && data.window != null) return data;
  } catch { /* URL fallback below */ }

  try {
    const url = new URL(raw);
    const sessionId = url.searchParams.get('sessionId');
    const token = url.searchParams.get('token');
    const window = url.searchParams.get('window');
    if (sessionId && token && window) {
      return { sessionId, token, window: Number(window) };
    }
  } catch { /* ignore */ }
  return null;
}

async function attachStream(video: HTMLVideoElement, stream: MediaStream) {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
}

export default function App() {
  const [step, setStep] = useState<Step>('identity');
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [, setEnrolled] = useState(false);
  const [qrPayload, setQrPayload] = useState<QrPayload | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [liveEmotion, setLiveEmotion] = useState('');
  const [expressions, setExpressions] = useState<{ emotion: string; score: number }[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enrollError, setEnrollError] = useState('');
  const [enrollCameraOn, setEnrollCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const enrollVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadFaceModels().then(() => setModelsReady(true)).catch(console.error);

    const params = new URLSearchParams(globalThis.location.search);
    const sessionId = params.get('sessionId');
    const token = params.get('token');
    const qrWindow = params.get('window');
    if (sessionId && token && qrWindow) {
      setQrPayload({ sessionId, token, window: Number(qrWindow) });
      setStep('identity');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (detectInterval.current) {
      clearInterval(detectInterval.current);
      detectInterval.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (enrollVideoRef.current) enrollVideoRef.current.srcObject = null;
    setEnrollCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Enroll camera: start AFTER video element is mounted
  useEffect(() => {
    if (step !== 'enroll' || !enrollCameraOn) return;

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = enrollVideoRef.current;
        if (!video) {
          setEnrollError('Camera preview unavailable. Click retry.');
          return;
        }
        await attachStream(video, stream);
      } catch {
        if (!cancelled) {
          setEnrollError('Camera access denied. Allow camera permission and retry.');
          setEnrollCameraOn(false);
        }
      }
    };

    // Wait one frame so the <video> ref is attached after enrollCameraOn=true
    const frame = requestAnimationFrame(() => { void start(); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [step, enrollCameraOn]);

  // Biometric camera: start AFTER video element is mounted
  useEffect(() => {
    if (step !== 'biometric') return;

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        await attachStream(video, stream);

        detectInterval.current = setInterval(async () => {
          if (!videoRef.current) return;
          const face = await detectFace(videoRef.current);
          if (face) {
            setLiveEmotion(face.detectedEmotion);
            setExpressions(face.expressions);
          }
        }, 800);
      } catch {
        if (!cancelled) {
          setResult({ success: false, message: 'Camera access denied. Allow camera to continue.' });
          setStep('result');
        }
      }
    };

    const frame = requestAnimationFrame(() => { void start(); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (detectInterval.current) {
        clearInterval(detectInterval.current);
        detectInterval.current = null;
      }
    };
  }, [step]);

  const proceedAfterIdentity = async (isEnrolled: boolean) => {
    if (qrPayload) {
      const session = await api<SessionInfo>(`/api/sessions/${qrPayload.sessionId}`);
      setSessionInfo(session);
      setStep('location');
    } else {
      setStep('scan');
    }
    if (isEnrolled) setEnrolled(true);
  };

  const verifyStudent = async () => {
    if (!studentId.trim()) return;
    try {
      const student = await api<{ id: string; name: string; enrolled: boolean }>(
        `/api/users/students/by-student-id/${studentId.trim().toUpperCase()}`
      );
      setStudentName(student.name);
      setEnrolled(student.enrolled);

      if (!student.enrolled) {
        setStep('enroll');
        return;
      }

      await proceedAfterIdentity(true);
    } catch {
      setResult({ success: false, message: 'Student ID not found. Ask your lecturer to register you first.' });
      setStep('result');
    }
  };

  const startEnrollCamera = () => {
    setEnrollError('');
    stopCamera();
    setEnrollCameraOn(true);
  };

  const saveFaceEnrollment = async () => {
    if (!enrollVideoRef.current || !modelsReady) return;
    setSubmitting(true);
    setEnrollError('');
    try {
      const embedding = await captureFaceEmbedding(enrollVideoRef.current);
      if (!embedding) {
        setEnrollError('No face detected. Center your face and try again.');
        return;
      }

      await api(`/api/users/students/by-student-id/${studentId.trim().toUpperCase()}/face`, {
        method: 'PUT',
        body: JSON.stringify({ face_embedding: embedding }),
      });

      stopCamera();
      setEnrolled(true);
      await proceedAfterIdentity(true);
    } catch (e) {
      setEnrollError(e instanceof Error ? e.message : 'Face enrollment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onQrScan = async (raw: string) => {
    const payload = parseQr(raw);
    if (!payload) return;
    setQrPayload(payload);
    try {
      const session = await api<SessionInfo>(`/api/sessions/${payload.sessionId}`);
      setSessionInfo(session);
      setStep('location');
    } catch {
      setResult({ success: false, message: 'Invalid or inactive session.' });
      setStep('result');
    }
  };

  const fetchLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); },
      () => setResult({ success: false, message: 'GPS access denied. Enable location to continue.' })
    );
  };

  useEffect(() => {
    if (step === 'location') fetchLocation();
  }, [step]);

  const submitCheckIn = async () => {
    if (!qrPayload || !lat || !lng || !videoRef.current || !sessionInfo) return;
    setSubmitting(true);

    try {
      const face = await detectFace(videoRef.current);
      stopCamera();
      if (!face) {
        setResult({ success: false, message: 'No face detected. Try again with good lighting.' });
        setStep('result');
        return;
      }

      if (!emotionMatches(sessionInfo.required_emotion, face.detectedEmotion)) {
        setResult({
          success: false,
          message: `Wrong emotion! Required: ${emotionLabel(sessionInfo.required_emotion)}, detected: ${face.detectedEmotion}`,
        });
        setStep('result');
        return;
      }

      const data = await api<{ success: boolean; message: string }>('/api/checkin', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: qrPayload.sessionId,
          studentId: studentId.trim().toUpperCase(),
          window: qrPayload.window,
          token: qrPayload.token,
          latitude: lat,
          longitude: lng,
          faceEmbedding: face.embedding,
          detectedEmotion: face.detectedEmotion,
        }),
      });

      setResult({ success: true, message: data.message });
    } catch (e) {
      setResult({ success: false, message: e instanceof Error ? e.message : 'Check-in failed' });
    } finally {
      setSubmitting(false);
      setStep('result');
    }
  };

  const reset = () => {
    stopCamera();
    setStep('identity');
    setQrPayload(null);
    setSessionInfo(null);
    setResult(null);
    setLat(null);
    setLng(null);
    setLiveEmotion('');
    setEnrollError('');
  };

  const steps: { key: Step; label: string }[] = [
    { key: 'identity', label: 'ID' },
    { key: 'scan', label: 'QR' },
    { key: 'location', label: 'GPS' },
    { key: 'biometric', label: 'Face' },
    { key: 'result', label: 'Done' },
  ];

  const stepIndex = step === 'enroll'
    ? 0
    : steps.findIndex((s) => s.key === step);

  const videoClass = 'w-full min-h-[240px] rounded-xl border border-sky-500/50 object-cover bg-black -scale-x-100';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950/30 to-slate-950 flex items-start justify-center p-4">
      <div className="w-full max-w-md mt-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold"><span className="text-sky-400">Attend</span>Guard</h1>
          <p className="text-slate-500 text-sm">Student Check-In Portal</p>
        </div>

        <div className="flex justify-between mb-6 px-2">
          {steps.slice(0, 4).map((s, i) => (
            <div key={s.key} className="flex flex-col items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${
                i <= stepIndex ? 'border-sky-400 bg-sky-600 text-white' : 'border-slate-700 text-slate-600'
              }`}>{i + 1}</div>
              <span className="text-[10px] text-slate-500 mt-1">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl p-6">
          {step === 'identity' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Enter Student ID</h2>
              <input value={studentId} onChange={(e) => setStudentId(e.target.value.toUpperCase())}
                placeholder="e.g. CS01087991" autoFocus
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 text-lg tracking-wider" />
              <button onClick={verifyStudent}
                className="w-full py-3 bg-sky-600 hover:bg-sky-500 rounded-xl font-semibold transition">
                Continue
              </button>
            </div>
          )}

          {step === 'enroll' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">First-Time Face Setup</h2>
              <p className="text-sm text-slate-400">
                Welcome, <span className="text-sky-300">{studentName}</span>! Your ID is registered.
                Capture your face once to link it to your account.
              </p>
              {!enrollCameraOn ? (
                <button onClick={startEnrollCamera} disabled={!modelsReady}
                  className="w-full py-3 bg-sky-600 hover:bg-sky-500 rounded-xl font-semibold disabled:opacity-50">
                  {modelsReady ? 'Open Camera & Enroll Face' : 'Loading AI models...'}
                </button>
              ) : (
                <div className="space-y-3">
                  <video ref={enrollVideoRef} autoPlay muted playsInline className={videoClass} />
                  <button onClick={saveFaceEnrollment} disabled={submitting}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold disabled:opacity-50">
                    {submitting ? 'Saving to database...' : 'Save Face & Continue'}
                  </button>
                  <button onClick={startEnrollCamera} type="button"
                    className="w-full py-2 text-sm text-sky-400 hover:underline">
                    Retry camera
                  </button>
                </div>
              )}
              {enrollError && <p className="text-red-400 text-sm">{enrollError}</p>}
            </div>
          )}

          {step === 'scan' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Scan Lecturer QR</h2>
              <p className="text-sm text-slate-400">Point camera at the live QR code on the projector</p>
              <div className="rounded-xl overflow-hidden border-2 border-sky-500/50">
                <Scanner
                  onScan={(res) => { if (res[0]?.rawValue) onQrScan(res[0].rawValue); }}
                  onError={() => {}}
                  styles={{ container: { width: '100%' } }}
                />
              </div>
            </div>
          )}

          {step === 'location' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">GPS Verification</h2>
              {sessionInfo && (
                <div className="text-sm bg-slate-900/60 rounded-xl p-4 border border-slate-700">
                  <p className="text-sky-300 font-medium">{sessionInfo.course_name}</p>
                  <p className="text-slate-400 mt-1">
                    Challenge: <span className="text-amber-300">{emotionLabel(sessionInfo.required_emotion)}</span>
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between bg-slate-900/60 rounded-xl p-4 border border-slate-700">
                <span className="text-sky-400 text-sm">Location Lock</span>
                <span className="text-xs text-slate-400 font-mono">
                  {lat ? `${lat.toFixed(5)}, ${lng?.toFixed(5)}` : 'Acquiring GPS...'}
                </span>
              </div>
              <button onClick={fetchLocation} className="text-xs text-sky-400 hover:underline">Refresh GPS</button>
              <button onClick={() => setStep('biometric')} disabled={!lat || !lng || !modelsReady}
                className="w-full py-3 bg-sky-600 hover:bg-sky-500 rounded-xl font-semibold disabled:opacity-40 transition">
                {!modelsReady ? 'Loading face models...' : 'Start Biometric Check'}
              </button>
            </div>
          )}

          {step === 'biometric' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Biometric Liveness</h2>
              {sessionInfo && (
                <div className="text-center py-2 bg-amber-900/30 border border-amber-700/50 rounded-xl">
                  <p className="text-amber-300 text-sm font-medium">
                    Show: {emotionLabel(sessionInfo.required_emotion)}
                  </p>
                </div>
              )}
              <div className="relative rounded-xl overflow-hidden border-2 border-sky-500/50">
                <video ref={videoRef} autoPlay muted playsInline className={videoClass} />
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-48 border-2 border-dashed border-sky-400/70 rounded-2xl" />
                  <div className="scan-line absolute left-0 right-0 h-0.5 bg-sky-400/60" />
                </div>
              </div>
              {liveEmotion && (
                <div className="text-sm text-center">
                  <span className="text-slate-400">Detected: </span>
                  <span className={`font-medium ${emotionMatches(sessionInfo?.required_emotion || '', liveEmotion) ? 'text-emerald-400' : 'text-red-400'}`}>
                    {liveEmotion}
                  </span>
                </div>
              )}
              {expressions.length > 0 && (
                <div className="flex gap-2 justify-center flex-wrap">
                  {expressions.map((e) => (
                    <span key={e.emotion} className="text-xs px-2 py-1 bg-slate-800 rounded-full">
                      {e.emotion} {(e.score * 100).toFixed(0)}%
                    </span>
                  ))}
                </div>
              )}
              <button onClick={submitCheckIn} disabled={submitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold disabled:opacity-50 transition">
                {submitting ? 'Verifying all 3 layers...' : 'Submit Attendance'}
              </button>
            </div>
          )}

          {step === 'result' && result && (
            <div className="text-center space-y-4 py-4">
              <div className="text-6xl">{result.success ? '✅' : '❌'}</div>
              <h2 className={`text-xl font-bold ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.success ? 'Attendance Verified!' : 'Check-In Rejected'}
              </h2>
              <p className="text-slate-400 text-sm">{result.message}</p>
              {result.success && studentName && (
                <p className="text-sky-300">Welcome, {studentName}</p>
              )}
              <button onClick={reset} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm">
                Check In Again
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-4">
          Token + GPS + Face + Emotion — all layers must pass
        </p>
      </div>
    </div>
  );
}
