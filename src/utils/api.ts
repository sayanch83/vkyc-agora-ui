// src/utils/api.ts
// Central API service — all components import from here.
// Set VKYC_API_BASE in your environment or stencil.config.ts.
// Falls back to localhost:3001 for local dev.

const BASE = (typeof window !== 'undefined' && (window as any).__VKYC_API__)
  ? (window as any).__VKYC_API__
  : 'http://localhost:3001/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const get  = <T>(path: string)              => request<T>('GET',  path);
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body);

// ── Agent ──────────────────────────────────────────────────────────────────
export const AgentAPI = {
  getCases:    ()                                    => get('/agent/cases'),
  getCase:     (id: string)                          => get(`/agent/cases/${id}`),
  acceptCase:  (id: string, officer: {officerId:string;officerName:string}) =>
                                                        post(`/agent/cases/${id}/accept`, officer),
  runLiveness: (sessionId: string)                   => post(`/agent/sessions/${sessionId}/liveness`, {}),
  runFaceMatch:(sessionId: string)                   => post(`/agent/sessions/${sessionId}/face-match`, {}),
  runOCR:      (sessionId: string)                   => post(`/agent/sessions/${sessionId}/ocr`, {}),
  submitDecision: (sessionId: string, payload: {
    decision: string;
    remarks: string;
    questionnaire: Record<string,string>;
    questionnaireResponses: Record<string,string>;
  })                                                 => post(`/agent/sessions/${sessionId}/decision`, payload),
};

// ── Applicant ──────────────────────────────────────────────────────────────
export const ApplicantAPI = {
  submitConsent:  (appId: string, consents: Record<string,string>) =>
                    post('/applicant/consent', { appId, consents }),
  getQueuePos:    (appId: string)   => get(`/applicant/queue/${appId}`),
  submitLiveness: (appId: string, score?: number) =>
                    post('/applicant/liveness', { appId, score }),
  getSlots:       ()                => get('/applicant/slots'),
  reschedule:     (appId: string, slot: string) =>
                    post('/applicant/reschedule', { appId, slot }),
};

// ── Auditor ────────────────────────────────────────────────────────────────
export const AuditorAPI = {
  getCases:      (status?: string) => get(`/auditor/cases${status ? `?status=${status}` : ''}`),
  getCase:       (id: string)      => get(`/auditor/cases/${id}`),
  submitDecision:(id: string, payload: { decision: string; remarks: string }) =>
                    post(`/auditor/cases/${id}/decision`, payload),
};
