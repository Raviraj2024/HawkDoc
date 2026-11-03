import type { AuditEvent, Claim, Decision, Entity, FillSession, FillSummary, FormField, FormTemplate, IntakeQuestion, Requirement, ReviewIssue, UploadedDocument } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  templates: () => request<FormTemplate[]>('/api/templates'),
  template: (id: string) => request<FormTemplate>(`/api/templates/${id}`),
  createTemplate: (name: string, file: File) => { const data = new FormData(); data.append('name', name); data.append('file', file); return request<FormTemplate>('/api/templates', { method: 'POST', body: data }) },
  deleteTemplate: (id: string) => request<void>(`/api/templates/${id}`, { method: 'DELETE' }),
  parseTemplate: (id: string, replaceExisting = false) => request(`/api/templates/${id}/parse?replace_existing=${replaceExisting}`, { method: 'POST' }),
  addField: (templateId: string, body: Omit<FormField, 'id' | 'template_id'>) => request<FormField>(`/api/templates/${templateId}/fields`, json('POST', body)),
  patchField: (templateId: string, fieldId: string, body: Partial<FormField>) => request<FormField>(`/api/templates/${templateId}/fields/${fieldId}`, json('PATCH', body)),
  sourcePolicies: (templateId: string, items: {field_id:string;source_policy:Record<string,unknown>}[]) => request<{count:number}>(`/api/templates/${templateId}/field-source-policies`, json('PUT', items)),
  deleteField: (templateId: string, fieldId: string) => request<void>(`/api/templates/${templateId}/fields/${fieldId}`, { method: 'DELETE' }),
  requirements: (templateId: string, body: Requirement[]) => request(`/api/templates/${templateId}/requirements`, json('PUT', body.map(({ type_key, label, required, description }) => ({ type_key, label, required, description })))),
  questions: (templateId: string, body: IntakeQuestion[]) => request(`/api/templates/${templateId}/questions`, json('PUT', body)),
  confirmTemplate: (id: string) => request(`/api/templates/${id}/confirm`, { method: 'POST' }),
  createFill: (templateId: string) => request<FillSession>('/api/fills', json('POST', { template_id: templateId })),
  fills: () => request<FillSummary[]>('/api/fills'),
  fill: (id: string) => request<FillSession>(`/api/fills/${id}`),
  saveAnswers: (id: string, answers: Record<string,string>) => request<FillSession>(`/api/fills/${id}/answers`, json('PUT', {answers})),
  uploadDocument: (fillId: string, file: File, typeKey: string, subjectTag: string) => { const data = new FormData(); data.append('file', file); if (typeKey) data.append('type_key', typeKey); if (subjectTag) data.append('subject_tag', subjectTag); return request<UploadedDocument>(`/api/fills/${fillId}/documents`, { method: 'POST', body: data }) },
  uploadDocuments: (fillId: string, files: File[], typeKey: string, subjectTag: string) => { const data = new FormData(); files.forEach(file => data.append('files', file)); if(typeKey)data.append('type_key',typeKey);if(subjectTag)data.append('subject_tag',subjectTag);return request<UploadedDocument[]>(`/api/fills/${fillId}/documents/bulk`, { method: 'POST', body: data }) },
  documents: (id: string) => request<UploadedDocument[]>(`/api/fills/${id}/documents`),
  confirmDocumentType: (fillId: string, documentId: string, typeKey: string) => request<{status:string}>(`/api/fills/${fillId}/documents/${documentId}/type`, json('POST', { type_key:typeKey, actor:'reviewer', reason:'Reviewer confirmed the document type before extraction' })),
  process: (id: string) => request<{status:string}>(`/api/fills/${id}/process`, { method: 'POST' }),
  entities: (id: string) => request<{entities:Entity[]}>(`/api/fills/${id}/entities`),
  claims: (id: string) => request<Claim[]>(`/api/fills/${id}/claims`),
  decisions: (id: string) => request<Decision[]>(`/api/fills/${id}/fields`),
  issues: (id: string) => request<ReviewIssue[]>(`/api/fills/${id}/issues`),
  audit: (id: string) => request<AuditEvent[]>(`/api/fills/${id}/audit`),
  resolveIssue: (fillId: string, issueId: string, body: unknown) => request(`/api/fills/${fillId}/issues/${issueId}/resolve`, json('POST', body)),
  overrideField: (fillId: string, fieldId: string, value: string | null) => request(`/api/fills/${fillId}/fields/${fieldId}`, json('PATCH', { value, actor: 'reviewer', reason: 'Reviewer edited the final field value' })),
  export: (id: string, draft: boolean) => request<{id:string}>(`/api/fills/${id}/export`, json('POST', { actor: 'reviewer', allow_unresolved_draft: draft })),
}

