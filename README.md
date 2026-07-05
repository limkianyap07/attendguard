# AttendGuard

Enterprise anti-fraud class attendance system with 3-layer verification:

1. **Time-based cryptographic QR** — rotates every 15 seconds
2. **Geofencing** — Haversine GPS verification within classroom radius
3. **Biometric liveness** — face-api.js identity + randomized emotion challenge

## Quick Start

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

| App | URL |
|-----|-----|
| Lecturer Dashboard | http://localhost:5173 |
| Student Check-In | http://localhost:5174 |
| API | http://localhost:4000 |

## Demo Credentials

- **Lecturer:** `dr.smith@university.edu`
- **Students:** `STU001` (Alice), `STU002` (Bob), `STU003` (Carol)

Enroll student faces via the Lecturer dashboard before check-in.
