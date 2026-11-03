import uuid
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


def validate_bbox(value: list[float]) -> list[float]:
    if len(value) != 4 or any(v < 0 or v > 1 for v in value) or value[0] >= value[2] or value[1] >= value[3]:
        raise ValueError("bbox_norm must be [x_min,y_min,x_max,y_max] in [0,1]")
    return value


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BBoxMixin(BaseModel):
    bbox_norm: list[float]

    @field_validator("bbox_norm")
    @classmethod
    def valid_bbox(cls, value):
        return validate_bbox(value)


class FieldCreate(BBoxMixin):
    display_label: str
    canonical_key: str
    semantic_target: str
    entity_role: str
    field_type: Literal["text", "multiline", "number", "date", "checkbox", "radio", "signature", "character_comb"]
    page_index: int = Field(ge=0)
    format: str | None = None
    required: bool = False
    mapping_status: str = "needs_review"
    source_policy: dict[str, Any] = Field(default_factory=dict)
    instruction: str | None = None
    group_key: str | None = None
    cell_config: dict[str, Any] | None = None
    auto_fillable: bool = True


class FieldPatch(BaseModel):
    display_label: str | None = None
    canonical_key: str | None = None
    semantic_target: str | None = None
    entity_role: str | None = None
    field_type: str | None = None
    page_index: int | None = Field(default=None, ge=0)
    bbox_norm: list[float] | None = None
    format: str | None = None
    required: bool | None = None
    mapping_status: str | None = None
    source_policy: dict[str, Any] | None = None
    instruction: str | None = None
    group_key: str | None = None
    cell_config: dict[str, Any] | None = None
    auto_fillable: bool | None = None

    @field_validator("bbox_norm")
    @classmethod
    def valid_optional_bbox(cls, value):
        return validate_bbox(value) if value is not None else value


class FieldSourcePolicyIn(BaseModel):
    field_id: uuid.UUID
    source_policy: dict[str, Any] = Field(default_factory=dict)


class RequirementIn(BaseModel):
    type_key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")
    label: str
    required: bool = True
    description: str | None = None


class IntakeQuestionIn(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")
    prompt: str = Field(min_length=1, max_length=500)
    answer_type: Literal["text", "select", "yes_no"] = "text"
    required: bool = True
    options: list[str] = Field(default_factory=list)


class IntakeAnswersIn(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)


class FillCreate(BaseModel):
    template_id: uuid.UUID


class ManualOverride(BaseModel):
    value: str | None
    actor: str = "reviewer"
    reason: str
    operation_id: str | None = None


class IssueResolution(BaseModel):
    action: Literal["accept_suggestion", "choose_claim", "manual_edit", "mark_unresolved"]
    selected_claim_id: uuid.UUID | None = None
    manual_value: str | None = None
    actor: str = "reviewer"
    reason: str
    operation_id: str | None = None


class DocumentTypeConfirmation(BaseModel):
    type_key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")
    actor: str = "reviewer"
    reason: str = "Reviewer confirmed the document type"
    operation_id: str | None = None


class EntityCorrection(BaseModel):
    entity_id: uuid.UUID
    actor: str = "reviewer"
    reason: str
    operation_id: str | None = None


class ExportRequest(BaseModel):
    actor: str = "reviewer"
    allow_unresolved_draft: bool = False
    operation_id: str | None = None


class ModelFieldProposal(BBoxMixin):
    display_label: str
    canonical_key: str
    semantic_target: str
    entity_role: str
    field_type: str
    page_index: int
    format: str | None = None
    required: bool = False
    source_policy: dict[str, Any] = Field(default_factory=dict)
    instruction: str | None = None

    @field_validator("field_type", mode="before")
    @classmethod
    def normalize_field_type(cls, value):
        normalized = str(value or "text").strip().lower().replace("-", "_").replace(" ", "_")
        aliases = {
            "checkbox_group": "checkbox", "checkboxes": "checkbox", "yes_no_checkbox": "checkbox",
            "radio_group": "radio", "radio_button": "radio", "dropdown": "text",
            "single_line_text": "text", "free_text": "text", "textarea": "multiline",
            "integer": "number", "numeric": "number", "currency": "number",
            "comb": "character_comb", "comb_field": "character_comb",
        }
        normalized = aliases.get(normalized, normalized)
        allowed = {"text", "multiline", "number", "date", "checkbox", "radio", "signature", "character_comb"}
        return normalized if normalized in allowed else "text"

    @field_validator("source_policy", mode="before")
    @classmethod
    def normalize_source_policy(cls, value):
        if value is None:
            return {}
        if isinstance(value, str):
            return {"model_rule": value}
        if isinstance(value, list):
            return {"allowed_types": value}
        return value


class ModelClaim(BaseModel):
    target_field_id: str | None = None
    local_entity_key: str
    entity_type: str = "person"
    entity_display_name: str | None = None
    entity_role: str | None = None
    attribute: str
    value_raw: str
    value_normalized: str
    observed_text: str
    page_index: int
    relation_context: dict[str, Any] | None = None
    temporal_context: dict[str, Any] | None = None
    quality_status: str = "readable"
    entity_link_status: Literal["supported", "needs_confirmation", "contradicted"] = "needs_confirmation"


class ModelRelationship(BaseModel):
    source_local_entity_key: str
    predicate: str
    target_local_entity_key: str
    evidence_claim_indexes: list[int] = Field(default_factory=list)
    status: Literal["supported", "needs_confirmation", "contradicted"]


class ExtractionBundle(BaseModel):
    document_type: str | None = None
    classification_status: str
    claims: list[ModelClaim] = Field(default_factory=list)
    relationships: list[ModelRelationship] = Field(default_factory=list)
    reasoning: str | None = None

