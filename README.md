# A3F Sticker Directory

Public participant gallery for A3F. Flow:

1. Print or display the QR code (Header → "QR-Code anzeigen") — points to the landing page.
2. Participants scan → land on the form, enter name + upload sticker photo.
3. Everyone sees the live grid (photo + name).

Frontend is static (GitHub Pages); backend (Express + SQLite) runs on `albumyoo`.

## Repo layout

```
a3f/
├── backend/        # Node.js + Express + SQLite (runs on albumyoo)
│   ├── server.js
│   ├── db.js
│   ├── package.json
│   ├── .env.example
│   ├── data/       # SQLite DB (gitignored)
│   └── uploads/    # Uploaded sticker photos (gitignored)
├── frontend/       # Static site, served from GitHub Pages
│   ├── index.html
│   ├── app.js
│   ├── qr.js       # QR rendering helper (loads qrcode-generator from jsDelivr)
│   ├── config.js   # Edit A3F_API_BASE before deploy
│   └── style.css
└── .github/workflows/deploy.yml   # GitHub Pages deploy
```

## Backend (albumyoo)

```bash
cd backend
cp .env.example .env
# edit .env: ADMIN_KEY, CORS_ORIGIN
npm install
npm start
```

Endpoints:

| Method | Path                        | Notes |
|--------|-----------------------------|-------|
| GET    | `/health`                   | health check |
| POST   | `/api/submit`               | multipart: `name`, `photo` |
| GET    | `/api/participants`         | `?sort=name` |
| GET    | `/api/stats`                | total count |
| DELETE | `/api/participants/:id`     | requires `X-Admin-Key` header |
| GET    | `/uploads/<file>`           | static photo serving |

Security:
- `ADMIN_KEY` required for delete
- CORS restricted to GitHub Pages origin (set `CORS_ORIGIN` in `.env`)
- Rate limits on submit (5/min) and read (120/min)
- Image re-encoded with `sharp` (rotate, resize ≤1024, JPEG)

## Frontend (GitHub Pages)

1. Edit `frontend/config.js` → set `window.A3F_API_BASE` to the public URL of albumyoo.
2. Push to `main` — GitHub Actions deploys to Pages.
3. Enable Pages: Settings → Pages → Source: GitHub Actions.
4. Click "QR-Code anzeigen" in the header — print/display the QR for the event.

## License

MIT
