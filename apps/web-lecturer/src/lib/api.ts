export const API_URL = import.meta.env.VITE_API_URL || 'https://attendguard-api.onrender.com/api';
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Request failed');
  }
  return res.json();
}

export const EMOTIONS = [
  { value: 'HAPPY', label: 'Smile / Happy', emoji: '😊' },
  { value: 'SURPRISED', label: 'Surprised', emoji: '😲' },
  { value: 'ANGRY', label: 'Angry', emoji: '😠' },
  { value: 'SAD', label: 'Sad', emoji: '😢' },
  { value: 'NEUTRAL', label: 'Neutral', emoji: '😐' },
];

export function emotionLabel(value: string) {
  return EMOTIONS.find((e) => e.value === value)?.label || value;
}
