import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def uid(): return uuid.uuid4()
def now(): return datetime.now(timezone.utc)


class FormTemplate(Base):
    __tablename__ = "form_templates"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    file_uri: Mapped[str] = mapped_column(Text)
    original_filename: Mapped[str] = mapped_column(String(255))
    page_count: Mapped[int] = mapped_column(Integer)
    page_metadata: Mapped[list] = mapped_column(JSONB, default=list)
    searchable: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(40), default="uploaded")
    version: Mapped[int] = mapped_column(Integer, default=1)
    intake_questions: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    fields = relationship("FormField", cascade="all, delete-orphan")
    requirements = relationship("DocumentRequirement", cascade="all, delete-orphan")


class FormField(Base):
    __tablename__ = "form_fields"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form_templates.id", ondelete="CASCADE"), index=True)
    display_label: Mapped[str] = mapped_column(Text)
    canonical_key: Mapped[str] = mapped_column(Text)
    semantic_target: Mapped[str] = mapped_column(Text)
    entity_role: Mapped[str] = mapped_column(Text)
    field_type: Mapped[str] = mapped_column(Text)
    page_index: Mapped[int] = mapped_column(Integer)
    bbox_norm: Mapped[list] = mapped_column(JSONB)
    pdf_rect: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    format: Mapped[str | None] = mapped_column(Text, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    mapping_status: Mapped[str] = mapped_column(String(40), default="needs_review")
    source_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    cell_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    auto_fillable: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DocumentRequirement(Base):
    __tablename__ = "document_requirements"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form_templates.id", ondelete="CASCADE"), index=True)
    type_key: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(200))
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("template_id", "type_key"),)


class FillSession(Base):
    __tablename__ = "fill_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form_templates.id"), index=True)
    template_version: Mapped[int] = mapped_column(Integer)
    template_snapshot: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(40), default="awaiting_documents")
    intake_answers: Mapped[dict] = mapped_column(JSONB, default=dict)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    exported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UploadedDocument(Base):
    __tablename__ = "uploaded_documents"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), index=True)
    type_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_uri: Mapped[str] = mapped_column(Text)
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    subject_tag: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="received")
    classification: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("fill_session_id", "sha256"),)


class ResolvedEntity(Base):
    __tablename__ = "resolved_entities"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), default="person")
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    roles: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    status: Mapped[str] = mapped_column(String(40), default="needs_confirmation")
    evidence_claim_ids: Mapped[list] = mapped_column(JSONB, default=list)


class ExtractedClaim(Base):
    __tablename__ = "extracted_claims"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("uploaded_documents.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("resolved_entities.id"), nullable=True, index=True)
    entity_role: Mapped[str | None] = mapped_column(String(80), nullable=True)
    attribute: Mapped[str] = mapped_column(String(120), index=True)
    value_raw: Mapped[str] = mapped_column(Text)
    value_normalized: Mapped[str] = mapped_column(Text)
    observed_text: Mapped[str] = mapped_column(Text)
    page_index: Mapped[int] = mapped_column(Integer)
    bbox_norm: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    relation_context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    temporal_context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    provenance_type: Mapped[str] = mapped_column(String(40), default="direct_observation")
    quality: Mapped[dict] = mapped_column(JSONB, default=dict)
    entity_link_status: Mapped[str] = mapped_column(String(40), default="needs_confirmation")
    model_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EntityRelationship(Base):
    __tablename__ = "entity_relationships"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), index=True)
    source_entity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resolved_entities.id"))
    predicate: Mapped[str] = mapped_column(String(80))
    target_entity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("resolved_entities.id"))
    evidence_claim_ids: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(40), default="needs_confirmation")


class FieldDecision(Base):
    __tablename__ = "field_decisions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), index=True)
    field_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form_fields.id"), index=True)
    target_entity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("resolved_entities.id"), nullable=True)
    candidate_claim_ids: Mapped[list] = mapped_column(JSONB, default=list)
    selected_claim_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("extracted_claims.id"), nullable=True)
    resolved_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="unresolved")
    reason_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    human_override: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    __table_args__ = (UniqueConstraint("fill_session_id", "field_id"),)


class ReviewIssue(Base):
    __tablename__ = "review_issues"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), index=True)
    field_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("form_fields.id"), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("resolved_entities.id"), nullable=True)
    issue_type: Mapped[str] = mapped_column(String(80), index=True)
    attribute: Mapped[str | None] = mapped_column(String(120), nullable=True)
    candidate_claim_ids: Mapped[list] = mapped_column(JSONB, default=list)
    reason: Mapped[str] = mapped_column(Text)
    suggested_claim_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("extracted_claims.id"), nullable=True)
    suggested_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    requires_human_review: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(40), default="open")
    resolution: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(80))
    target_id: Mapped[str] = mapped_column(String(100))
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    operation_id: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class ExportArtifact(Base):
    __tablename__ = "export_artifacts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)
    fill_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fill_sessions.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(20))
    file_uri: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(30))
    unresolved_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

