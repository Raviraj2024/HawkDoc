export type TemplateStatus = 'uploaded' | 'mapping' | 'needs_template_review' | 'ready' | 'error'
export type FieldStatus = 'auto_supported' | 'human_reviewed' | 'unresolved' | 'not_applicable'

export interface FormField {
  id: string; template_id: string; display_label: string; canonical_key: string
  semantic_target: string; entity_role: string; field_type: string; page_index: number
  bbox_norm: number[]; format: string | null; required: boolean; mapping_status: string
  source_policy: Record<string, unknown>; instruction: string | null; auto_fillable: boolean
  group_key: string | null; cell_config: Record<string, unknown> | null
}

export interface Requirement {
  id?: string; type_key: string; label: string; required: boolean; description: string | null
}

export interface IntakeQuestion {
  key: string; prompt: string; answer_type: 'text' | 'select' | 'yes_no'; required: boolean; options: string[]
}

export interface FormTemplate {
  id: string; name: string; original_filename: string; page_count: number; searchable: boolean
  status: TemplateStatus; version: number; created_at: string; fields?: FormField[]; requirements?: Requirement[]; intake_questions?: IntakeQuestion[]
}

export interface FillSession {
  id: string; template_id: string; template_version: number; status: string
  error_detail: string | null; created_at: string; exported_at: string | null; intake_answers: Record<string,string>
}

export interface FillSummary extends FillSession {
  template_name: string; document_count: number; claim_count: number
  open_issue_count: number; last_activity_at: string
}

export interface UploadedDocument {
  id: string; original_filename: string; type_key: string | null; subject_tag: string | null
  status: string; classification: { status?: string; classification_status?: string; summary?: string; reasoning?: string | null } | null; created_at: string
}

export interface Entity {
  id: string; display_name: string | null; entity_type: string; roles: string[]; status: string
}

export interface Claim {
  id: string; document_id: string; entity_id: string | null; entity_role: string | null
  attribute: string; value_raw: string; observed_text: string; page_index: number; bbox_norm: number[] | null
  entity_link_status: string
}

export interface Decision {
  id: string; field_id: string; target_entity_id: string | null; candidate_claim_ids: string[]
  selected_claim_id: string | null; resolved_value: string | null; status: FieldStatus
  reason_code: string | null; human_override: boolean
}

export interface ReviewIssue {
  id: string; field_id: string | null; entity_id: string | null; issue_type: string
  attribute: string | null; candidate_claim_ids: string[]; reason: string
  suggested_claim_id: string | null; suggested_reason: string | null; status: string
}

export interface AuditEvent {
  id: string; actor: string; action: string; target_type: string; reason: string | null; timestamp: string
}

