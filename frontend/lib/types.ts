export type Mode = "victim" | "suspect_recording" | "informant";
export type Priority = "IMMEDIATE" | "HIGH" | "STANDARD";

export interface Evidence {
  segment_id: string; t_start: number; t_end: number; char_start: number; char_end: number; quote: string;
}
export interface CaseField {
  name: string; label: string; value: string; display: string; confidence: number;
  status: "predicted" | "reported" | "verified" | "corrected" | "missing";
  evidence: Evidence[]; note?: string | null; model_value?: string | null; updated_by?: string | null;
}
export interface SegmentT {
  id: string; start: number; end: number; text: string; speaker?: string | null;
  language?: string | null; low_confidence: boolean; recording_id?: string | null;
}
export interface Triage {
  priority: Priority; score: number; headline: string; reasons: string[]; missing: string[];
  next_action: string; human_safety: string[]; evidence_status: string;
}
export interface Distress {
  enabled: boolean; level: "off" | "abstain" | "low" | "elevated" | "high"; score: number | null;
  confidence: string; timeline: { t: number; score: number; label?: string | null; p?: number | null }[]; reasons: string[]; abstain_reasons: string[]; label: string;
}
export interface Safety {
  coercion: boolean; crisis: boolean; coercion_hits: Hit[]; crisis_hits: Hit[];
  coercion_message?: string | null; crisis_message?: string | null; playbook_advice?: string;
}
export interface Hit { segment_id: string; phrase: string; quote: string; t_start: number; t_end: number }
export interface Prompt { key: string; question: string; kind: string; priority: number }
export interface CaseSummary {
  id: string; created_at: string; mode: Mode; channel: string; status: string; caller_label: string;
  district?: string | null; priority: Priority; priority_score: number; synthetic: boolean;
  playbook: { key: string | null; label: string; confidence: number }; amount: number;
  headline?: string; coercion: boolean; crisis: boolean; language?: string | null; intake_seconds?: number | null;
}
export interface LinkT {
  id: number; kind: "identifier" | "script" | "voice"; score: number; status: "candidate" | "confirmed" | "rejected";
  detail: { reason?: string; type?: string; value?: string; method?: string }; other: CaseSummary;
}
export interface Recording { id: string; kind: string; filename: string; sha256: string; duration?: number | null; size_bytes: number; has_voiceprint: boolean }
export interface CaseDetail extends CaseSummary {
  call_started_at: string; segments: SegmentT[]; fields: CaseField[]; triage: Triage; distress: Distress;
  safety: Safety; tactics: { items?: { key: string; label: string; cues: string[] }[]; note?: string };
  copilot: Prompt[]; recordings: Recording[]; links: LinkT[];
}
export interface Ring {
  id: string; cases: string[]; size: number; districts: string[]; total_amount: number; shared_identifiers: string[];
  link_kinds: string[]; confirmed: number; candidates: number; playbooks: string[]; synthetic: boolean;
}
export interface Stats {
  open_cases: number; immediate: number; safety_alerts: number; rings: number; linked_cases: number;
  reported_loss: number; median_intake_seconds: number | null; last_24h: number;
}
export interface AuditEventT { id: number; ts: string; actor: string; action: string; case_id: string | null; payload: string; hash: string; prev_hash: string; model_version?: string | null }
export interface Health { ok: boolean; version: string; models: { name: string; model: string; loaded: boolean; state?: string; error?: string | null; license?: string | null }[]; validated_languages: string[] }
