# SpotLock — Parking Spot Saver

Mobile-first Parking Spot Saver with live GPS spot saving, elapsed time counter, real-time distance tracking, Google Maps nearby parking discovery & walking directions, garage notes/photos, and offline radar fallback.

## Features

- **Save Parking Spot:** One-tap GPS capture with timestamp and optional garage note (`Level 2, pillar B`) or photo.
- **Nearby Available Parking:** Live Google Maps view centered on your current GPS position with nearby parking pins and custom map-tap pin saving.
- **Live Distance & Navigation:** Real-time distance to your parked car plus one-tap Google Maps directions and Android `geo:` intent support.
- **Offline Ready:** Works offline inside parking garages using `localStorage` and a built-in GPS/compass mini-map fallback.

## Deploy to Render

1. Push this repository to GitHub.
2. Create a **New Web Service** on [Render](https://render.com) connected to your repo.
3. Render reads `render.yaml` automatically, or set:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `NODE_VERSION` = `22`
     - `VITE_GOOGLE_MAPS_API_KEY` = your Google Maps Platform API key
     - `GEMINI_API_KEY` = *(optional)* your Gemini API key for AI parking summaries

## Local Development

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.
