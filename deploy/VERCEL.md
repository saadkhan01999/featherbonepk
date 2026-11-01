# Deploying the Feather & Bone API on Vercel

The storefront stays on WebHoster; only the API moves to Vercel:

| Piece                                         | Where                                      | Address                                                                                              |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Storefront, back office, POS, kitchen screens | WebHoster cPanel, `public_html`            | `https://featherbonepk.com`                                                                          |
| API                                           | Vercel (project root directory: `backend`) | `https://featherbonepk.vercel.app` (now) → `https://backend.featherbonepk.com` (recommended, step 3) |
| Database                                      | MongoDB Atlas                              | —                                                                                                    |
| Uploaded photos and videos                    | Cloudinary                                 | `https://res.cloudinary.com/…`                                                                       |

**The storefront is currently built against `https://featherbonepk.vercel.app/api/v1`**
(`frontend/.env.production`). That works in Chrome, Edge and Firefox. **Safari, which
includes every browser on iPhone and iPad, will sign users out whenever the page
reloads.** The login cookie comes from `vercel.app`, a different site from
`featherbonepk.com`, so it's a third-party cookie, and Safari blocks those. Customers
can still browse and order; staff on iPads would have to sign in again after each
reload.

The cure is the custom domain in step 3. On `backend.featherbonepk.com` the cookie
belongs to the same site as the storefront. After step 3, change `VITE_API_URL` in
`frontend/.env.production` to `https://backend.featherbonepk.com/api/v1`, rebuild
(`npm run package:webhoster`) and upload the new zip. Nothing on Vercel changes.

---

## What is different on Vercel

Vercel runs the API as a serverless function: started on demand, with no permanent
disk and no long-lived connections. The code handles each difference:

| On a normal server                                                                   | On Vercel                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live updates over a socket (kitchen, orders)                                         | **Polling.** The client sees there is no live channel and stops trying. The kitchen display refreshes every 15 s, incoming website orders every 20 s, the Orders page and customer order tracking every 30 s, and the till every 60 s. |
| Uploads saved to disk                                                                | **Cloudinary is required.** The API refuses to start with `UPLOAD_DRIVER=local` on Vercel, because photos would be lost.                                                                                                               |
| Uploads up to 5 MB (video 50 MB)                                                     | **Up to 4 MB**, the most a Vercel request body can carry. Larger files get a clear "this file is X MB" message.                                                                                                                        |
| A background job every minute (abandoned online payments, forgotten kitchen tickets) | A **daily** Vercel Cron job at 03:00 Pakistan time, set in `backend/vercel.json`. The Hobby plan allows only daily jobs. On Pro you can change the schedule to `*/10 * * * *`.                                                         |

With cash on delivery only (the default), the daily job is enough.

---

## 0. Before you start

1. **MongoDB Atlas → Network Access → Add IP Address → `0.0.0.0/0`.** Vercel's
   outgoing IP addresses change constantly. The database username and password
   still protect the data.
2. **Cloudinary** (free plan is fine): [cloudinary.com](https://cloudinary.com)
   → Dashboard → copy the _Cloud name_, _API Key_ and _API Secret_.
3. **A mailbox for password-reset emails**: WebHoster cPanel → Email Accounts →
   `noreply@featherbonepk.com`. Note its password and the "Secure SSL/TLS" outgoing
   server from **Connect Devices** (usually `mail.featherbonepk.com`, port 465).
4. **Four random secrets**: three JWT secrets plus `CRON_SECRET`. Run
   `openssl rand -hex 32` four times (or use any password generator, 64 characters).

---

## 1. Create the Vercel project

1. [vercel.com/new](https://vercel.com/new) → **Import** the GitHub repository
   `saadkhan01999/featherbonepk`.
2. **Root Directory → Edit → `backend`.** This step matters most: the repository
   holds both the website and the API, and the API lives in `backend/`.
3. **Framework Preset**: _Express_ (detected automatically). Leave Build Command,
   Output Directory and Install Command empty; `backend/vercel.json` sets them.
4. **Environment Variables**: open `backend/.env.vercel.example`, fill in every value,
   then paste the whole block into the _Key_ field (Vercel splits a pasted `.env` into
   separate variables), or use **Import .env**. Select the **Production** environment
   only.
5. **Deploy.**

`backend/index.js` is the entry Vercel uses. The build log shows
`Multiple entrypoints found: index.js, src/app.js. Using index.js.`, which is correct.

## 2. Check it

Open `https://<your-project>.vercel.app/health` (the address is shown on the
deployment page). You want `"status":"ok"` and **`"database":"connected"`**.

| You see                          | Fix                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `"database":"disconnected"`      | Atlas Network Access is missing `0.0.0.0/0`, or `MONGODB_URI` is wrong. **Logs** (Vercel → Project → Logs) shows the exact reason.    |
| `500 FUNCTION_INVOCATION_FAILED` | A variable is missing or invalid. **Logs** shows a line starting with `✖` that names it. Fix it, then **Deployments → ⋯ → Redeploy**. |

## 3. Recommended: point `backend.featherbonepk.com` at Vercel

Optional for launch; needed for iPhone/iPad/Safari sign-in to persist (see the top
of this guide). `featherbonepk.vercel.app` keeps working alongside it.

1. Vercel → Project → **Settings → Domains → Add** → `backend.featherbonepk.com`.
   Vercel shows a **CNAME** record to create (name `backend`, plus a value such as
   `cname.vercel-dns.com`; use the exact value Vercel shows).
2. In **WebHoster cPanel**:
   - If you created `backend.featherbonepk.com` there during the cPanel attempt,
     remove it: **Setup Node.js App** → delete the app, then **Domains** → remove
     `backend.featherbonepk.com`. Otherwise its old address would compete with
     Vercel's.
   - **Zone Editor** → `featherbonepk.com` → **+ Add Record** → type **CNAME**,
     name `backend`, the value from Vercel. Save.
3. Wait until Vercel shows **Valid Configuration** and issues the certificate (minutes,
   occasionally up to an hour). Then
   `https://backend.featherbonepk.com/health` must show `"database":"connected"`.
4. Change `VITE_API_URL` in `frontend/.env.production` to
   `https://backend.featherbonepk.com/api/v1`, run `npm run package:webhoster`, and
   upload the new storefront zip (step 4).

If your domain's DNS is managed somewhere other than WebHoster, add the same CNAME there.

## 4. Upload the storefront

On your PC: `npm run package:webhoster`, then upload **only**
`deploy/out/featherbone-frontend.zip` to `public_html` (WebHoster guide, step 7).
It's built against whatever `VITE_API_URL` says in `frontend/.env.production`
(currently `https://featherbonepk.vercel.app/api/v1`), and the script prints that
address before building.

## 5. Check the scheduled sweep

Vercel → Project → **Settings → Cron Jobs** lists `/api/v1/cron/sweep`. To run it
once by hand:

```bash
curl -H "Authorization: Bearer <your CRON_SECRET>" https://featherbonepk.vercel.app/api/v1/cron/sweep
```

It answers with how many abandoned reservations and stale kitchen tickets it closed.
Without the right secret it refuses (401). If `CRON_SECRET` isn't set, it says so (503).

## 6. Function region (speed)

Every request talks to Atlas several times, so the function should run near the
database. Atlas → Database shows the cluster's region (e.g. _AWS Mumbai
ap-south-1_). In Vercel → Project → **Settings → Functions → Function Region**, choose
the closest one (Mumbai → `bom1`, N. Virginia → `iad1`, Frankfurt → `fra1`), then
redeploy.

## 7. Owner account and existing data

- The database already in use keeps its accounts, so sign in as before. For a new
  owner, run on your PC with `MONGODB_URI` set to the Atlas string in
  `backend/.env`: `npm run owner -- --email you@featherbonepk.com`.
- If product photos were uploaded while an earlier API stored them **on its own disk**
  (paths starting `/uploads/…`), Vercel can't serve them. Where those files still
  exist, run `npm run migrate:media` (dry run), then
  `npm run migrate:media -- --apply` to move them to Cloudinary. Photos already on
  Cloudinary need nothing.

## 8. When everything works

Turn off the old Railway service, and the cPanel Node.js app if you created one, so
only one API serves the database.

---

## Updating later

Push to the `main` branch. Vercel redeploys the API automatically. For website
changes, run `npm run package:webhoster` and upload the new frontend zip to
`public_html`.

## Troubleshooting

| Symptom                                                                   | Likely cause                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signing in works, then you're signed out on reload (especially on iPhone) | The site is calling a `*.vercel.app` address. Use `backend.featherbonepk.com` (step 3).                                                                                                                                                                                                                                                                         |
| "Could not reach the server" everywhere                                   | Open the API's `/api/v1/health` (`https://featherbonepk.vercel.app/api/v1/health`, or `https://backend.featherbonepk.com/api/v1/health` after step 3). If it doesn't load, the deployment failed (Vercel → Logs), or after step 3 the DNS or certificate isn't ready. If it loads, `CLIENT_URL` / `ALLOWED_ORIGINS` don't match the address in the browser bar. |
| Kitchen display shows "Offline — polling"                                 | Expected on Vercel: it refreshes every 15 s instead of instantly.                                                                                                                                                                                                                                                                                               |
| "This file is X MB, and the server accepts uploads up to 4 MB"            | Vercel's request limit. Use a smaller or compressed image.                                                                                                                                                                                                                                                                                                      |
| Images uploaded before the move are broken                                | Step 7, `migrate:media`.                                                                                                                                                                                                                                                                                                                                        |
| Password-reset emails don't arrive                                        | Vercel Logs. Check the `SMTP_*` values; try `SMTP_HOST=speed.webhoster.pk`.                                                                                                                                                                                                                                                                                     |
