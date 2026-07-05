# AttendGuard

Enterprise anti-fraud class attendance system with 3-layer verification:
* **Time-based cryptographic QR:** Rotates every 15 seconds
* **Geofencing:** Haversine GPS verification within classroom radius
* **Biometric liveness:** face-api.js identity + randomized emotion challenge

---

## 🚀 Hackathon Live Demo

* **📺 3-Minute Demo Video:** [Insert your YouTube/Loom link here]
* **👨‍🏫 Lecturer Dashboard:** https://attendguard-lecturer.onrender.com/
* **🎓 Student Check-In:** https://attendguard-student.onrender.com/

### Demo Credentials
* **Lecturer:** `dr.smith@university.edu`
* **Students:** `STU001` (Alice), `STU002` (Bob), `STU003` (Carol)
*(Note: Enroll student faces via the Lecturer dashboard before testing student check-in).*

---

## 💻 Local Development Setup (Quick Start)

If you wish to run this project locally:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
Local App URLs
Lecturer Dashboard: http://localhost:5173

Student Check-In: http://localhost:5174

API: [https://attendguard-api.onrender.com](https://attendguard-api.onrender.com)


***

### ⚠️ ONE CRITICAL HACKATHON WARNING ⚠️

I noticed your original README mentions an **API running on `[https://attendguard-api.onrender.com](https://attendguard-api.onrender.com)`**. 

Since you successfully put the two front-end websites on the internet via Render, they are now public. However, if your API (backend and database) is still only on your local computer, your live websites will likely fail to log in or save data because they are trying to talk to a local server that isn't connected to the internet. 

Did you already deploy your backend to a server, or do you need help getting that API up on Ren
