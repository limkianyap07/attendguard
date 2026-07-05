import { useEffect, useRef, useState } from 'react';
import { loadFaceModels, captureFaceEmbedding } from '../lib/faceApi';
import { api } from '../lib/api';

interface Student {
  id: string;
  student_id: string;
  name: string;
  email: string;
  enrolled: boolean;
}

export function FaceEnrollment({ student, onEnrolled }: { student: Student; onEnrolled: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);

  useEffect(() => {
    loadFaceModels().then(() => setModelsReady(true)).catch(() => setError('Failed to load face models'));
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    if (!cameraOn) return;

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
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          await video.play();
        }
      } catch {
        if (!cancelled) {
          setError('Camera access denied.');
          setCameraOn(false);
        }
      }
    };

    const frame = requestAnimationFrame(() => { void start(); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [cameraOn]);

  const startCamera = () => {
    setError('');
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(true);
  };

  const capture = async () => {
    if (!videoRef.current || !modelsReady) return;
    setLoading(true);
    setError('');
    try {
      const embedding = await captureFaceEmbedding(videoRef.current);
      if (!embedding) {
        setError('No face detected. Center your face in the frame.');
        return;
      }
      await api(`/api/users/students/${student.id}/face`, {
        method: 'PUT',
        body: JSON.stringify({ face_embedding: embedding }),
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onEnrolled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enrollment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-xl p-4 mt-2">
      <p className="text-sm text-slate-400 mb-3">
        Enrolling <span className="text-sky-400">{student.name}</span> ({student.student_id})
      </p>
      {!cameraOn ? (
        <button onClick={startCamera} disabled={!modelsReady} className="w-full py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium disabled:opacity-50">
          {modelsReady ? 'Open Camera' : 'Loading AI models...'}
        </button>
      ) : (
        <div className="space-y-3">
          <video ref={videoRef} autoPlay muted playsInline className="w-full min-h-[200px] rounded-lg border border-slate-700 object-cover bg-black -scale-x-100" />
          <button onClick={capture} disabled={loading} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium">
            {loading ? 'Processing...' : 'Capture Face Reference'}
          </button>
        </div>
      )}
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  );
}
