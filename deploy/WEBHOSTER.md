# Deploying Feather & Bone on WebHoster.pk (cPanel)

Everything runs on your WebHoster cPanel account (`https://speed.webhoster.pk:2083`),
with the database on MongoDB Atlas:

| Piece                                      | Folder on the server                      | Address                             |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------- |
| Storefront, back office, POS (React build) | `/home/<cpanel-user>/public_html`         | `https://featherbonepk.com`         |
| API (Node.js app)                          | `/home/<cpanel-user>/featherbone-api`     | `https://backend.featherbonepk.com` |
| Uploaded photos and videos                 | `/home/<cpanel-user>/featherbone-uploads` | served by the API at `/uploads/…`   |
| Database                                   | MongoDB Atlas (cloud)                     | —                                   |

`<cpanel-user>` is your cPanel username. It's shown in the right-hand sidebar of cPanel,
and the home folder is `/home/<cpanel-user>`.

**Why the API gets its own subdomain:** `backend.featherbonepk.com` is on the same
domain as the site, so the login cookie works with the strictest browser setting
(`SameSite=Strict`). It also means everything the API serves (`/api/v1`, `/uploads`,
`/health`, `/sitemap.xml` and the live-update socket) sits at the root of its own
address, so no rewrite rules are needed.

---

## 0. One-time checks before you start

1. **Your plan includes "Setup Node.js App".** In cPanel, look under _Software_. If it's
   missing, ask WebHoster to enable Node.js on your package.
2. **Outbound port 27017 is open.** cPanel has no MongoDB, so the API connects out
   to Atlas on TCP port 27017, which many shared hosts block. Open a ticket now so it's
   ready when you need it:

   > Please allow outbound TCP connections on port 27017 from my account (`<cpanel-user>`)
   > to MongoDB Atlas (`*.mongodb.net`). My Node.js app needs it to reach its database.

   You'll confirm it in step 5 with `check:db`. If WebHoster won't open it, see
   [Fallback: keep the API on Railway](#fallback-keep-the-api-on-railway).

3. **MongoDB Atlas** ([cloud.mongodb.com](https://cloud.mongodb.com)):
   - _Database Access_: create a database user and password.
   - _Network Access_: add your server's IP (cPanel sidebar, **Shared IP Address**),
     or `0.0.0.0/0`.
   - _Database → Connect → Drivers_: copy the `mongodb+srv://…` connection string.

---

## 1. Build the upload packages (on your PC)

```bash
npm install
npm run package:webhoster
```

This writes two files to `deploy/out/`:

- `featherbone-backend.zip`: the API, without `node_modules`, tests or any `.env`
- `featherbone-frontend.zip`: the built site, already pointed at
  `https://backend.featherbonepk.com/api/v1`, with its `.htaccess`

The script refuses to build if the API address is missing, is `localhost`, or is not HTTPS.

---

## 2. Create the API subdomain and SSL

1. cPanel → **Domains** (on older cPanel: **Subdomains**) → **Create A New Domain**:
   `backend.featherbonepk.com`. Leave the suggested document root as it is
   (e.g. `/home/<cpanel-user>/backend.featherbonepk.com`). It's **not** where the app goes.
2. If the domain's DNS is managed somewhere other than WebHoster, add an **A record**
   `backend` → your server's IP there.
3. cPanel → **SSL/TLS Status** → **Run AutoSSL**. Wait until `featherbonepk.com`,
   `www.featherbonepk.com` and `backend.featherbonepk.com` all show a valid certificate.
4. cPanel → **Domains** → turn **Force HTTPS Redirect** on for `featherbonepk.com`
   and `backend.featherbonepk.com`.

---

## 3. Upload the API

1. cPanel → **File Manager** → your home folder (`/home/<cpanel-user>`, **not**
   `public_html`). Create a folder named **`featherbone-api`** and open it.
2. **Upload** `featherbone-backend.zip`, then right-click it → **Extract** (into this
   same folder), then delete the zip.
   You should now see `cpanel-start.cjs`, `package.json`, `.env.example`, `src/` and
   `scripts/`. To see dotfiles, open _Settings_ (top right) → **Show Hidden Files**.
3. Copy `.env.example` to **`.env`** in the same folder and edit it. Every line marked
   ► needs your value:

   | Setting                                                     | What to put                                                                                                                                                 |
   | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `MONGODB_URI`                                               | the Atlas string from step 0, with your password and `/featherbone` as the database name                                                                    |
   | `SMTP_PASSWORD`                                             | the password of a mailbox you create in cPanel → **Email Accounts**: `noreply@featherbonepk.com`                                                            |
   | `SMTP_HOST`                                                 | the "Secure SSL/TLS" outgoing server shown under that mailbox's **Connect Devices** (usually `mail.featherbonepk.com`, or `speed.webhoster.pk`), port `465` |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_POS_SECRET` | three **different** random values. Generate each with `openssl rand -hex 32`                                                                                |

   `CLIENT_URL`, `ALLOWED_ORIGINS`, `UPLOAD_DIR=../featherbone-uploads` and the rest are
   already set for this layout. The API refuses to start while any secret still contains
   `change-me`, which is deliberate.

> Never put `featherbone-api` inside `public_html` or a domain's document root. Apache
> would serve `.env`, with your database password, to anyone who asks.

---

## 4. Create the Node.js application

cPanel → **Software → Setup Node.js App** → **Create Application**:

| Field                    | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| Node.js version          | the highest offered that is **20 or newer** (22.x preferred) |
| Application mode         | **Production**                                               |
| Application root         | `featherbone-api`                                            |
| Application URL          | `backend.featherbonepk.com`, leaving the path box empty      |
| Application startup file | **`cpanel-start.cjs`**                                       |

Click **Create**, then:

1. Press **Run NPM Install** and wait for it to finish. It installs the production
   packages (exact versions, listed in the zip's `package.json`) into cPanel's own Node
   environment. Never upload a `node_modules` folder: cPanel refuses to install while
   one exists.
2. Press **Restart**.

The startup file must be `cpanel-start.cjs`, not `src/server.js` or `app.js`. Under
cPanel, `src/server.js` loads but never starts listening, and the panel only shows a
generic error. The comments in `backend/cpanel-start.cjs` explain why.

---

## 5. Check the API

Open **https://backend.featherbonepk.com/health**. You want to see
`"status":"ok"` and **`"database":"connected"`**.

If it says `"database":"disconnected"`, go back to **Setup Node.js App** → your app →
**Run JS script** → **`check:db`**:

| Output                       | Meaning                                  | Fix                                                                   |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `BLOCKED … 27017`            | WebHoster's firewall blocks the port     | the support ticket in step 0 (Atlas settings cannot fix this)         |
| `HANDSHAKE FAILED` + auth    | wrong username/password in `MONGODB_URI` | Atlas → Database Access; percent-encode `@ : / ? # %` in the password |
| `HANDSHAKE FAILED` otherwise | the server IP is not allowed in Atlas    | Atlas → Network Access                                                |
| `DNS FAILED`                 | typo in the cluster address              | copy the string again from Atlas                                      |

Then **Run JS script → `doctor`**. Every line should be `PASS`; `WARN` on payment
providers is fine. It also logs in to your mail server for real, so a wrong SMTP password
shows up here instead of when a customer asks for a password reset.

The API reconnects to the database by itself once it can, without a restart. After any
**`.env` edit, press Restart.**

---

## 6. Create the owner (super admin) account

Pick whichever is easiest:

- **Setup Node.js App → Run JS script → `owner`.** With no arguments it creates
  `owner@featherandbone.pk` and prints a generated password **once**. Copy it, sign in,
  and change the email and password from your admin profile.
- **cPanel Terminal** (if your plan has it): copy the _"Enter to the virtual
  environment"_ command shown at the top of your app's page, run it, then
  `npm run owner -- --email you@featherbonepk.com`.
- **From your PC**: set `MONGODB_URI` in your local `backend/.env` to the same Atlas
  string, then `npm run owner -- --email you@featherbonepk.com`.

---

## 7. Upload the storefront

1. **File Manager → `public_html`** (of `featherbonepk.com`). Turn on
   **Show Hidden Files**. Move any old site files out of the way, especially an old
   `index.html`, `assets/` folder and `.htaccess`.
2. **Upload** `featherbone-frontend.zip` → **Extract** here → delete the zip. Check that
   `.htaccess` is present. Without it, refreshing any page other than the home page
   gives a 404.
3. Open **https://featherbonepk.com**. Staff sign in at `/admin/login`, and the till
   at `/pos/login`.

---

## 8. Optional: reservations cron job (only with JazzCash/EasyPaisa)

cPanel may stop an idle Node app, which pauses the in-process cleanup of abandoned
online payments. Add a cron job in cPanel → **Cron Jobs**, every 10 minutes
(`*/10 * * * *`). Use the _"Enter to the virtual environment"_ command from your app's
page as the start, for example:

```bash
source /home/<cpanel-user>/nodevenv/featherbone-api/22/bin/activate && cd /home/<cpanel-user>/featherbone-api && npm run expire:reservations >/dev/null 2>&1
```

With cash on delivery only (the default) you don't need this.

---

## Updating the site later

1. On your PC: `npm run package:webhoster`
2. **API:** in `featherbone-api`, delete everything **except `.env`** (and the
   `node_modules` link cPanel created), extract the new `featherbone-backend.zip`,
   press **Run NPM Install** if dependencies changed, then **Restart**. Photos are safe:
   they live in `featherbone-uploads`, beside the app, not inside it.
3. **Storefront:** delete the old `assets/` folder in `public_html`, then extract the new
   `featherbone-frontend.zip` over the rest.

---

## Fallback: keep the API on Railway

If WebHoster can't open port 27017, host only the storefront on WebHoster and keep the
existing Railway API:

```bash
npm run package:webhoster -- --api-url=https://featherbonepk-production.up.railway.app/api/v1
```

Upload just `featherbone-frontend.zip` (step 7). On Railway, `CLIENT_URL` must be
`https://featherbonepk.com` and `ALLOWED_ORIGINS` must include
`https://www.featherbonepk.com`. The cookie switches to the cross-site setting by itself.

---

## Troubleshooting

| Symptom                                                                                   | Likely cause                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend.featherbonepk.com` shows "It appears that the application has not started" / 503 | Read **`stderr.log`** in `featherbone-api`. Usually a `.env` value is missing or invalid (the message names it), the SMTP settings are empty, or the startup file isn't `cpanel-start.cjs`. |
| "Run NPM Install" fails mentioning `node_modules`                                         | A real `node_modules` folder was uploaded. Delete it and run the install again.                                                                                                             |
| Site loads but sign-in or the menu fail with a "network error"                            | Check `https://backend.featherbonepk.com/health` first. If it's healthy, `CLIENT_URL` / `ALLOWED_ORIGINS` don't match the address in the browser bar.                                       |
| Refreshing a page gives 404                                                               | `.htaccess` is missing from `public_html`.                                                                                                                                                  |
| Uploaded product photos don't appear                                                      | `doctor` → _Uploads_ line; `UPLOAD_DIR` must be writable.                                                                                                                                   |
| Password-reset emails never arrive                                                        | `doctor` → _Email_ line; try `SMTP_HOST=speed.webhoster.pk`.                                                                                                                                |
| Kitchen display shows offline                                                             | Open `/health` (API up?). Live updates fall back to polling automatically if the host blocks WebSockets.                                                                                    |
| Google Search Console rejects the sitemap                                                 | Add `featherbonepk.com` as a **Domain** property (DNS verified), then submit `https://backend.featherbonepk.com/sitemap.xml`.                                                               |
