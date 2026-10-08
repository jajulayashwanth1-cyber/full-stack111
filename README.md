# FarmDirect / Agrimarket — Full Stack (Frontend + Backend)

This package connects your existing frontend to a real backend API:

```
agrimarket/
├── backend/         Node.js + Express API (JWT auth, JSON file database)
│   ├── server.js
│   ├── routes/       auth.js, products.js, orders.js, users.js
│   ├── middleware/   auth.js (JWT verify + role guard)
│   ├── lib/db.js     simple JSON-file "database" with seed demo data
│   └── package.json
└── frontend/
    ├── index.html    same UI as before, now loads app.js
    └── app.js        all the logic, rewritten to call the backend via fetch()
```

## 1. Run the backend

```bash
cd backend
npm install
cp .env.example .env      # edit JWT_SECRET if you like
npm start
```

You should see: `FarmDirect/Agrimarket API running on http://localhost:4000`

The first run auto-creates `backend/data.json` with the same demo accounts and
crops your prototype already used:

| Role   | Email               | Password    |
|--------|---------------------|-------------|
| Farmer | john@farmer.com     | password123 |
| Buyer  | jane@buyer.com      | password123 |
| Admin  | admin@platform.com  | admin123    |

`data.json` **is your database** for this demo setup — delete it any time to
reset to the seed data, or swap `lib/db.js` for a real database client later
without touching the route files (they only call the functions exported from
`lib/db.js`).

## 2. Run the frontend

Any static file server works, e.g. from the `frontend/` folder:

```bash
cd frontend
python3 -m http.server 5500
```

Then open `http://localhost:5500` in your browser. The page is hard-coded to
call the API at `http://localhost:4000/api` (see the top of `app.js` —
`API_BASE_URL`). Change that constant, or set `window.API_BASE_URL` before
`app.js` loads, if you deploy the backend somewhere else.

**CORS**: the backend allows all origins by default (`CORS_ORIGIN=*` in
`.env`). Lock this down to your actual frontend domain before deploying
publicly.

## 3. How login works now

Login is still 2-step (password, then a 4-digit code), matching your
original UI:

1. `POST /api/auth/login` checks email/password/role. If correct, the
   server generates a one-time code and returns it in the response as
   `devOtp` (and prints it to the backend console) **only because there is
   no real email/SMS provider wired up yet**. In production you'd send this
   via email/SMS and drop `devOtp` from the response.
2. `POST /api/auth/verify-otp` checks the code and returns a JWT.
3. The frontend stores the JWT in `localStorage` and sends it as
   `Authorization: Bearer <token>` on every request that needs it.

## 4. API summary

| Method | Path                          | Auth        | What it does |
|--------|-------------------------------|-------------|--------------|
| POST   | /api/auth/register            | —           | Create farmer (pending) or buyer (instant) account |
| POST   | /api/auth/login                | —           | Validate password, issue OTP |
| POST   | /api/auth/verify-otp           | —           | Verify OTP, issue JWT |
| GET    | /api/auth/me                   | any         | Current user |
| PUT    | /api/auth/profile              | any         | Update name/phone/avatar |
| GET    | /api/products                  | —           | Approved marketplace listings (supports `?q=search`) |
| GET    | /api/products/mine              | farmer      | Farmer's own listings |
| POST   | /api/products                   | farmer      | Add a crop listing |
| PATCH  | /api/products/:id/status        | admin       | Approve/delist a listing |
| POST   | /api/orders                     | buyer       | Place an order (creates escrow-held order) |
| GET    | /api/orders/mine                 | buyer       | Buyer's own orders |
| GET    | /api/orders/farmer                | farmer      | Orders containing the farmer's produce |
| GET    | /api/orders                       | admin       | All orders |
| GET    | /api/orders/:id                    | owner/admin | One order (used for receipts) |
| PATCH  | /api/orders/:id/disburse            | admin       | Release escrow to the farmer |
| GET    | /api/users                          | admin       | All non-admin users |
| GET    | /api/users/pending-farmers            | admin       | Farmers awaiting approval |
| PATCH  | /api/users/:id/approve                | admin       | Approve a pending farmer |
| PATCH  | /api/users/:id/toggle-block             | admin       | Block/unblock a user |

## 5. Notes / things to harden before going live

- **Database**: `lib/db.js` reads/writes a single JSON file on every call.
  Fine for a prototype/demo; swap it for Postgres/MongoDB before real traffic
  (keep the same function names and the routes barely change).
- **OTP delivery**: currently returned in the API response for convenience.
  Wire up a real email/SMS provider (SendGrid, Twilio, etc.) and stop
  returning `devOtp`.
- **Image uploads**: crop photos and profile pictures are sent as base64
  data URLs and stored inline in `data.json`. For real usage, upload to
  S3/Cloud Storage and store just the URL.
- **Escrow / payments**: there's no real payment gateway integration — UPI,
  card, and COD selections are recorded, but no money actually moves.
  Plug in Razorpay/Stripe/PayU for real transactions.
- **Admin crop moderation tab**: it currently reads from the public
  `/api/products` endpoint (approved-only). Add a dedicated admin endpoint
  that returns every status (pending/delisted too) if you want full
  moderation visibility.
