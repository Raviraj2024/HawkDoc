import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routes import requirements
from app.schemas import FieldCreate, FieldPatch, ModelFieldProposal, RequirementIn


def test_rejects_invalid_bbox():
    with pytest.raises(ValidationError):
        FieldCreate(display_label="Name", canonical_key="name", semantic_target="applicant.full_name",
                    entity_role="applicant", field_type="text", page_index=0, bbox_norm=[.5, .2, .4, .3])


def test_patch_rejects_zero_height_bbox_before_route_execution():
    with pytest.raises(ValidationError):
        FieldPatch(bbox_norm=[.1, .2, .4, .2])


def test_model_string_source_policy_is_preserved_as_structured_rule():
    proposal = ModelFieldProposal(display_label="Name", canonical_key="name",
        semantic_target="applicant.full_name", entity_role="applicant", field_type="text",
        page_index=0, bbox_norm=[.1, .2, .4, .3], source_policy="blank_form_only")
    assert proposal.source_policy == {"model_rule": "blank_form_only"}


def test_model_field_type_alias_is_normalized():
    proposal = ModelFieldProposal(display_label="Staff", canonical_key="staff",
        semantic_target="applicant.staff", entity_role="applicant", field_type="checkbox_group",
        page_index=0, bbox_norm=[.1, .2, .4, .3])
    assert proposal.field_type == "checkbox"


def test_duplicate_document_requirement_keys_are_rejected_before_database_write():
    class FakeSession:
        def get(self, _model, object_id):
            return SimpleNamespace(id=object_id)

        def query(self, _model):
            raise AssertionError("Duplicate payload must be rejected before modifying requirements")

    template_id = uuid.uuid4()
    duplicate = RequirementIn(type_key="nominee_and_family_details", label="Nominee and Family Details")
    with pytest.raises(HTTPException) as exc:
        requirements(template_id, [duplicate, duplicate], FakeSession())
    assert exc.value.status_code == 422
    assert "must be unique" in exc.value.detail

