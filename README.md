# VKYC UI — Video KYC Web Components

RBI V-CIP compliant Video KYC frontend built as Stencil.js Web Components.

---

## Architecture

```
vkyc-ui  (this repo)          vkyc-api  (separate repo)
──────────────────────         ──────────────────────────
Stencil Web Components    →    Express REST API
GitHub Pages (static)          Railway / Render / any Node host
```

The UI calls the API for all data. Business logic and mock data live in the API — the UI only renders and calls `fetch()`.

---

## Components

| Tag | Role |
|---|---|
| `<vkyc-app>` | Launcher — role selector |
| `<vkyc-applicant>` | Customer-facing KYC journey |
| `<vkyc-agent>` | Officer dashboard and live session |
| `<vkyc-auditor>` | Compliance review and final approval |

---

## Local Development

Requires Node.js 18+ and `vkyc-api` running on port 3001.

```bash
git clone https://github.com/YOUR_ORG/vkyc-ui.git
cd vkyc-ui
npm install
npm start          # http://localhost:3333
```

---

## Deploy to GitHub Pages

1. **Settings → Pages → Source → GitHub Actions**
2. **Settings → Secrets → Actions** — add secret:
   - Name: `VKYC_API_BASE`
   - Value: `https://your-api.railway.app/api/v1`
3. Push to `main` — GitHub Actions builds and deploys automatically.

Live URL: `https://YOUR_USERNAME.github.io/vkyc-ui/`

---

## API calls

All fetch calls go through `src/utils/api.ts`:

```typescript
import { AgentAPI, ApplicantAPI, AuditorAPI } from './utils/api';

await AgentAPI.getCases();
await AgentAPI.acceptCase(id, { officerId, officerName });
await AgentAPI.runFaceMatch(sessionId);
await AgentAPI.submitDecision(sessionId, { decision, remarks, questionnaire });

await ApplicantAPI.getQueuePos(appId);
await ApplicantAPI.getSlots();
await ApplicantAPI.reschedule(appId, slot);

await AuditorAPI.getCases();
await AuditorAPI.submitDecision(id, { decision, remarks });
```

Point at a different API by setting before components load:
```html
<script>window.__VKYC_API__ = 'https://your-api.railway.app/api/v1';</script>
```
