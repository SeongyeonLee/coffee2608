# Specialty Coffee Archive

## Local test (optional, before pushing to GitHub)

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy

1. Push this whole folder to a GitHub repo (keep the folder structure as-is).
2. In Vercel: New Project → import that repo → it auto-detects Next.js → Deploy.
3. No environment variables needed — the Google Apps Script URL is hardcoded
   in `app/page.tsx` (`SHEET_API_URL`).

## Notes

- The Google Sheet backend is a single Apps Script Web App (`Code.gs`,
  deployed separately from this repo). If you redeploy the Apps Script and
  get a new `/exec` URL, update `SHEET_API_URL` in `app/page.tsx` and push again.
- Single-origin and blend beans are stored in separate sheet tabs
  (`SingleOrigin` / `Blend`), with brews logged to a third tab (`BrewLog`).
