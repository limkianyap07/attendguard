import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';

let loadPromise: Promise<void> | null = null;

export async function loadFaceModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return loadPromise;
}

export async function captureFaceEmbedding(video: HTMLVideoElement): Promise<number[] | null> {
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  return detection ? Array.from(detection.descriptor) : null;
}

export async function detectFace(video: HTMLVideoElement) {
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
    .withFaceExpressions();

  if (!detection) return null;

  const expressions = detection.expressions.asSortedArray();
  const topEmotion = expressions[0]?.expression || 'neutral';

  return {
    embedding: Array.from(detection.descriptor),
    detectedEmotion: topEmotion,
    expressions: expressions.slice(0, 3).map((e) => ({
      emotion: e.expression,
      score: e.probability,
    })),
    confidence: detection.detection.score,
  };
}

export function emotionMatches(required: string, detected: string): boolean {
  const map: Record<string, string[]> = {
    HAPPY: ['happy'],
    SMILE: ['happy'],
    SURPRISED: ['surprised'],
    ANGRY: ['angry'],
    SAD: ['sad'],
    NEUTRAL: ['neutral'],
    FEAR: ['fearful'],
    DISGUST: ['disgusted'],
  };
  const aliases = map[required.toUpperCase()] || [required.toLowerCase()];
  return aliases.includes(detected.toLowerCase());
}
