# Fast VPN (backend + Android app)

## 1. Backend
**VPS (one click)**
```bash
git clone https://github.com/YOU/REPO.git && cd REPO
sudo PORT=3000 bash deploy/install.sh
```
Installs Node 20, a systemd service, ufw + iptables rules (SSH + your port, persisted) and prints your API key.
Check: `curl http://IP:3000/health`, then `curl -H "x-api-key: KEY" http://IP:3000/api/best`

**Koyeb**: New service -> GitHub repo -> Dockerfile, work directory `backend`, port 8000, env `API_KEY=...`.

If `/health` shows `lastError` (HTTP 403 / no servers parsed): the site blocks bots or its HTML differs.
Adjust `parseListing()` in `backend/src/scraper.js`, or set `SOURCE_COOKIE` in `.env`.

## 2. Android app
Engine = official **OpenVPN for Android** (de.blinkt.openvpn); this app picks the server and tells it to connect.

GitHub repo settings:
- Variables: `BACKEND_URL` (e.g. `https://your-app.koyeb.app` or `http://IP:3000`)
- Secrets: `API_KEY`, and for signed builds: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`

Create a keystore once (keep and back it up):
```bash
keytool -genkeypair -v -keystore release.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks   # paste into KEYSTORE_BASE64
```
Push to `main` -> Actions artifacts: debug APK always; signed APK + AAB when keystore secrets exist.

Local build: `./scripts/fetch-aidl.sh && BACKEND_URL=... gradle :app:assembleDebug`
