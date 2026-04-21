// src/utils/constants.ts
// Shared design tokens, types, and constants across all three VKYC UIs

export const VKYC_COLORS = {
  navy:      '#0A1628',
  navyMid:   '#0F2040',
  blue:      '#1B4FD8',
  blueBright:'#2563EB',
  blueMid:   '#3B82F6',
  teal:      '#0D9488',
  tealLight: '#14B8A6',
  gold:      '#F59E0B',
  goldLight: '#FCD34D',
  success:   '#10B981',
  error:     '#EF4444',
  warning:   '#F59E0B',
  white:     '#FFFFFF',
  gray50:    '#F8FAFC',
  gray100:   '#F1F5F9',
  gray200:   '#E2E8F0',
  gray300:   '#CBD5E1',
  gray400:   '#94A3B8',
  gray500:   '#64748B',
  gray600:   '#475569',
  gray700:   '#334155',
  gray800:   '#1E293B',
  gray900:   '#0F172A',
};

export const CONSENT_ITEMS = [
  { id: 'c1', text: 'I consent to this Video KYC session being recorded and stored for regulatory compliance as required by RBI.' },
  { id: 'c2', text: 'I confirm I am voluntarily participating in this Video KYC of my own free will, without any coercion.' },
  { id: 'c3', text: 'I consent to my biometric data (face image, liveness score) being collected for identity verification.' },
  { id: 'c4', text: 'I confirm no other person is visible or audible in my surroundings during this session.' },
  { id: 'c5', text: 'I consent to my location being geo-tagged and recorded as required under RBI V-CIP regulations.' },
  { id: 'c6', text: 'I confirm I am physically present and this KYC is being conducted for my own loan/account application.' },
];

export const APPLICANT_STEPS = [
  { id: 'welcome',   label: 'Welcome',   icon: '👋' },
  { id: 'consent',   label: 'Consent',   icon: '📋' },
  { id: 'aadhaar',   label: 'Aadhaar',   icon: '🔐' },
  { id: 'queue',     label: 'Queue',     icon: '⏳' },
  { id: 'liveness',  label: 'Liveness',  icon: '👁️' },
  { id: 'session',   label: 'Session',   icon: '📹' },
  { id: 'complete',  label: 'Complete',  icon: '✅' },
];

export const SESSION_SUBSTEPS = ['face', 'code', 'pan', 'signature', 'waiting'] as const;
export type SessionSubStep = typeof SESSION_SUBSTEPS[number];

export const QUESTIONNAIRE_ITEMS = [
  { id: 'q1', label: 'Full Name',         prompt: 'Ask customer to state their full name',                          hint: 'Verify against application' },
  { id: 'q2', label: 'Address & Pincode', prompt: 'Ask customer to state complete address including pincode',        hint: 'Verify against application' },
  { id: 'q3', label: 'Date of Birth',     prompt: 'Ask customer to state their date of birth',                      hint: 'Verify against application & Aadhaar' },
  { id: 'q4', label: 'Mobile Number',     prompt: 'Ask customer to confirm their Aadhaar-linked mobile number',     hint: 'Should match registered number' },
];

export const AUDITOR_CHECK_SECTIONS = [
  {
    id: 'acceptance',
    label: 'Acceptance Check',
    checks: [
      { id: 'consent',   label: 'Consent Recorded',          required: true },
      { id: 'recording', label: 'Recording Consent',         required: true },
      { id: 'location',  label: 'Location Captured',         required: true },
    ],
  },
  {
    id: 'risk',
    label: 'Risk Mapping Check',
    checks: [
      { id: 'liveness',  label: 'Liveness Verified',         required: true },
      { id: 'aadhaar',   label: 'Aadhaar eKYC Freshness',    required: true },
    ],
  },
  {
    id: 'identity',
    label: 'Identity Check',
    checks: [
      { id: 'pan_face',  label: 'PAN Face Match',            required: true },
      { id: 'adh_face',  label: 'Aadhaar Face Match',        required: true },
      { id: 'ocr',       label: 'OCR Data Verified',         required: true },
      { id: 'questions', label: 'Questionnaire Completed',   required: true },
    ],
  },
];

export type ConsentMap   = Record<string, boolean>;
export type CheckStatus  = 'pending' | 'checking' | 'pass' | 'fail' | 'warn';
export type QuestionnaireMap = Record<string, 'Confirmed' | 'Mismatch' | 'N/A' | ''>;
export type Decision     = 'approve' | 'reject' | 'escalate' | null;
