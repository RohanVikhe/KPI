# Windows IIS + Node Service Deployment

This project is split into:

- `client`: React + Vite frontend
- `server`: Express + Prisma backend API

Recommended production setup on a Windows RDP server:

- IIS serves the React build over HTTPS
- IIS reverse proxies `/api` and `/health` to the Node backend
- Node backend runs as a Windows Service with WinSW

## 1. Server Prerequisites

Install these on the Windows server:

- Node.js LTS
- IIS
- IIS URL Rewrite
- IIS Application Request Routing (ARR)
- WinSW
- MySQL or access to your production MySQL database

Enable ARR proxy:

1. Open IIS Manager
2. Click the server node
3. Open `Application Request Routing Cache`
4. Click `Server Proxy Settings`
5. Enable `Proxy`

## 2. Backend Production Environment

Create `server\.env.production` using `server\.env.production.example`.

Example:

```env
NODE_ENV="production"
PORT=4000
DATABASE_URL="mysql://root:password@localhost:3306/kpi"
JWT_SECRET="replace-with-a-random-secret-32-characters-minimum"
JWT_EXPIRES_IN="50d"
CORS_ORIGIN="https://your-domain.com"
```

Notes:

- Keep `PORT=4000` unless you also update the IIS reverse-proxy target in `client\public\web.config`
- `CORS_ORIGIN` can contain comma-separated origins if needed
- The app already reads env vars from `dotenv/config`

## 3. Frontend Production Environment

Create `client\.env.production` using `client\.env.production.example`.

Use:

```env
VITE_API_URL="/api"
```

This keeps browser calls on the same HTTPS domain and lets IIS proxy them to the Node backend.

## 4. Build The Application

From the repo root:

```powershell
cd D:\KPI\client
npm ci
npm run build

cd D:\KPI\server
npm ci
npx prisma generate
npm run build
```

If this is a brand-new empty database and the schema is not created yet, run:

```powershell
cd D:\KPI\server
npx prisma db push
```

The backend also runs the default template seed at startup.

## 5. Install The Backend As A Windows Service

This repo includes:

- `server\deploy\install-backend-service.ps1`

Default assumptions in that script:

- repo path is `D:\KPI\server`
- Node is at `C:\Program Files\nodejs\node.exe`
- WinSW wrapper exe is at `D:\KPI\server\deploy\KPI-API.exe`
- service name is `KPI-API`

Before running the script:

1. Download the WinSW executable on the server
2. Rename it to `KPI-API.exe`
3. Place it in `D:\KPI\server\deploy`

Why this is needed:

- Windows cannot run `node dist\index.js` directly as a proper service by itself
- you need a service wrapper such as WinSW
- this approach avoids NSSM and still gives you a real Windows Service

Run:

```powershell
cd D:\KPI\server\deploy
powershell -ExecutionPolicy Bypass -File .\install-backend-service.ps1
```

What it does:

- checks for `dist\index.js`
- checks for `.env.production`
- creates `server\logs`
- writes a WinSW XML config next to `KPI-API.exe`
- installs or updates the `KPI-API` service through WinSW
- points the service to `node dist\index.js`
- loads env through `DOTENV_CONFIG_PATH`
- enables auto-start

After install, confirm:

```powershell
Get-Service KPI-API
```

Backend health check:

```powershell
Invoke-WebRequest http://127.0.0.1:4000/health
```

## 6. Configure IIS Site

The file `client\public\web.config` is included in the Vite build automatically, so after `npm run build` it will be present in `client\dist\web.config`.

Create or update an IIS site with:

- Physical path: `D:\KPI\client\dist`
- Binding: your domain on port `443`
- SSL certificate: your IIS certificate

Recommended app pool settings:

- `.NET CLR version`: `No Managed Code`
- `Managed pipeline mode`: `Integrated`
- `Start Mode`: `AlwaysRunning`

The included `web.config` does:

- `/api/*` -> `http://127.0.0.1:4000/api/*`
- `/health` -> `http://127.0.0.1:4000/health`
- all non-file routes -> `/index.html`

## 7. SSL Certificate

In IIS:

1. Import the certificate into `Server Certificates`
2. Open your site
3. Click `Bindings...`
4. Add or edit the `https` binding on port `443`
5. Select your certificate

If you want all traffic forced to HTTPS, add an HTTP to HTTPS redirect in IIS.

## 8. Deploy Updates Later

When you update the app:

```powershell
cd D:\KPI\client
npm ci
npm run build

cd D:\KPI\server
npm ci
npx prisma generate
npm run build

cd D:\KPI\server\deploy
powershell -ExecutionPolicy Bypass -File .\install-backend-service.ps1
```

IIS will serve the updated frontend build, and the PowerShell script will restart the backend service with the new server build.

## 9. Quick Validation

Check these after deployment:

- `https://your-domain.com` loads the React app
- `https://your-domain.com/health` returns `{ "status": "ok" }`
- login works
- API calls succeed without mixed-content or CORS errors
- `KPI-API` is `Running`

## 10. Files Added For Deployment

- `client\public\web.config`
- `client\.env.production.example`
- `server\.env.production.example`
- `server\deploy\install-backend-service.ps1`
