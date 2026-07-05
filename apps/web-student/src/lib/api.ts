export const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000`;

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText || 'Request failed');
  return data;
}

export const EMOTION_MAP: Record<string, string[]> = {
  HAPPY: ['happy'],
  SMILE: ['happy'],
  SURPRISED: ['surprised'],
  ANGRY: ['angry'],
  SAD: ['sad'],
  NEUTRAL: ['neutral'],
  FEAR: ['fearful'],
  DISGUST: ['disgusted'],
};

export function emotionLabel(value: string) {
  const labels: Record<string, string> = {
    HAPPY: 'Smile / Happy',
    SURPRISED: 'Surprised',
    ANGRY: 'Angry',
    SAD: 'Sad',
    NEUTRAL: 'Neutral',
  };
  return labels[value] || value;
}
