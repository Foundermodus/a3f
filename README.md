# A3F Sticker Directory

Public directory of A3F event participants. Each participant registers with a name, email, sticker label, and a photo of their sticker. The frontend is a static site (GitHub Pages); the backend (Express + SQLite) runs on `albumyoo`.

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
| POST   | `/api/submit`               | multipart: name, email, sticker_label, photo |
| GET    | `/api/participants`         | `?sticker=…`, `?sort=name|sticker` |
| GET    | `/api/stats`                | totals + by sticker |
| DELETE | `/api/participants/:id`     | requires `X-Admin-Key` header |
| GET    | `/uploads/<file>`           | static photo serving |

Security:
- ADMIN_KEY required for delete
- CORS restricted to GitHub Pages origin
- Rate limits on submit and read endpoints
- Image re-encoded with `sharp` (rotate, resize ≤1024, JPEG)

## Frontend (GitHub Pages)

1. Edit `frontend/config.js` → set `window.A3F_API_BASE` to the public URL of albumyoo.
2. Push to `main` — GitHub Actions deploys to Pages.
3. Enable Pages: Settings → Pages → Source: GitHub Actions.

## License

MIT
