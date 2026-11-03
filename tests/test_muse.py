from types import SimpleNamespace

import pytest

from app.services.muse import FIELD_BATCH_SIZE, MODAL_FALLBACK_MODEL, MuseClient, _normalize_extraction


def test_normalize_extraction_accepts_model_schema_variations():
    data = _normalize_extraction({
        "classification_status": "verified",
        "claims": [{
            "local_entity_key": "applicant", "attribute": "full_name", "value_raw": "Jane Doe",
            "value_normalized": "Jane Doe", "observed_text": "Jane Doe", "page_index": 0,
            "relation_context": "Applicant particulars", "temporal_context": "2026-10-25",
            "entity_link_status": "primary_subject",
        }],
        "relationships": [{"relationship_type": "related_to", "source_claim_indexes": [0]}],
    })
    assert data["classification_status"] == "supported"
    assert data["claims"][0]["relation_context"] == {"description": "Applicant particulars"}
    assert data["claims"][0]["temporal_context"] == {"description": "2026-10-25"}
    assert data["claims"][0]["entity_link_status"] == "supported"
    assert data["relationships"] == []
import app.services.muse as muse_module


class FakeCompletions:
    def __init__(self, content):
        self.content = content

    def create(self, **_kwargs):
        message = SimpleNamespace(content=self.content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class RecordingCompletions:
    def __init__(self, content=None, error=None):
        self.content = content
        self.error = error
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        message = SimpleNamespace(content=self.content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def client_with(content):
    client = object.__new__(MuseClient)
    client.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions(content)))
    return client


def test_json_accepts_fenced_model_response():
    result = client_with('```json\n{"fields": []}\n```')._json("model", [])
    assert result == {"fields": []}


def test_json_extracts_object_from_explanatory_text():
    result = client_with('Result follows: {"fields": []}')._json("model", [])
    assert result == {"fields": []}


def test_modal_fallback_uses_exact_model_and_preserves_primary_model():
    primary = RecordingCompletions(error=RuntimeError("primary unavailable"))
    modal = RecordingCompletions(content='{"result": "ok"}')
    client = object.__new__(MuseClient)
    client.client = SimpleNamespace(chat=SimpleNamespace(completions=primary))
    client.modal_client = SimpleNamespace(chat=SimpleNamespace(completions=modal))

    data, reasoning = client._json_with_reasoning(
        "unchanged-baseten-model", [{"role": "user", "content": "Return JSON"}], "medium")

    assert data == {"result": "ok"}
    assert primary.calls[0]["model"] == "unchanged-baseten-model"
    assert modal.calls[0]["model"] == MODAL_FALLBACK_MODEL
    assert modal.calls[0]["extra_body"] == {"reasoning_effort": "medium"}
    assert "reasoning_effort" not in modal.calls[0]
    assert "Modal fallback used" in reasoning


def test_modal_fallback_retries_schema_invalid_primary_response():
    primary = RecordingCompletions(content='{"unexpected": true}')
    modal = RecordingCompletions(content='{"required_key": "value"}')
    client = object.__new__(MuseClient)
    client.client = SimpleNamespace(chat=SimpleNamespace(completions=primary))
    client.modal_client = SimpleNamespace(chat=SimpleNamespace(completions=modal))

    data, _ = client._json_with_reasoning(
        "baseten-model", [], validator=lambda payload: payload["required_key"])

    assert data == {"required_key": "value"}
    assert len(primary.calls) == 1
    assert len(modal.calls) == 1


def test_evidence_images_are_chunked_to_seven(monkeypatch):
    monkeypatch.setattr(muse_module, "page_images", lambda _path: ["image"] * 15)
    client = object.__new__(MuseClient)
    client.settings = SimpleNamespace(muse_vision_model="model")
    image_counts = []

    def fake_json(_model, messages, **_kwargs):
        content = messages[0]["content"]
        image_counts.append(sum(item["type"] == "image_url" for item in content))
        return ({"document_type": "identity", "classification_status": "supported", "claims": [], "relationships": []}, "Checked visible page content")

    client._json_with_reasoning = fake_json
    result = client.extract_document("document.pdf", "application/pdf", None, [])
    assert image_counts == [7, 7, 1]
    assert result.document_type == "identity"
    assert "Checked visible page content" in result.reasoning


def test_field_router_enforces_source_policy_and_batch_limit():
    client = object.__new__(MuseClient)
    client.settings = SimpleNamespace(muse_text_model="text-model")
    client._json = lambda *_args, **_kwargs: {"routes": [{
        "field_id": "field-1", "document_ids": ["wrong-doc", "salary-doc"]
    }]}
    fields = [{"id": "field-1", "source_policy": {"allowed_types": ["salary_slip"]}}]
    documents = [
        {"id": "wrong-doc", "type_key": "bank_statement"},
        {"id": "salary-doc", "type_key": "salary_slip"},
    ]
    assert client.route_field_batch(fields, documents) == {"field-1": ["salary-doc"]}
    with pytest.raises(ValueError):
        client.route_field_batch([{"id": str(index)} for index in range(FIELD_BATCH_SIZE + 1)], documents)


def test_document_type_is_resolved_from_content_context_and_exact_catalog(monkeypatch):
    monkeypatch.setattr(muse_module, "image_as_base64", lambda _path: "image")
    client = object.__new__(MuseClient)
    client.settings = SimpleNamespace(muse_vision_model="vision-model", muse_text_model="text-model")
    client._json_with_reasoning = lambda *_args, **_kwargs: ({
        "document_type": "invented_utility_type",
        "classification_status": "supported",
        "summary": "Residential electricity service statement with meter and service address",
        "visible_attributes": ["service_address", "meter_number", "billing_period"],
        "entity_roles": ["customer"],
    }, "Read visible utility account content")
    client._json = lambda *_args, **_kwargs: {
        "document_type": "electricity_bill", "classification_status": "supported",
        "reason": "The visible meter, billing period, and service address match the canonical type.",
    }
    catalog = [
        {"type_key": "electricity_bill", "label": "Electricity Bill"},
        {"type_key": "employment_verification_letter", "label": "Employment Verification Letter"},
    ]
    result = client.profile_document("misleading_filename.png", "image/png", catalog, "applicant")
    assert result["document_type"] == "electricity_bill"
    assert result["classification_status"] == "supported"
    assert "service_address" in result["visible_attributes"]


def test_document_types_are_resolved_with_full_evidence_set_context():
    client = object.__new__(MuseClient)
    client.settings = SimpleNamespace(muse_text_model="text-model")
    captured = {}

    def fake_json(_model, messages, **_kwargs):
        captured["prompt"] = messages[0]["content"]
        return {"assignments": [
            {"document_id": "doc-1", "document_type": "employment_verification_letter",
             "classification_status": "supported", "reason": "HR confirmation content"},
            {"document_id": "doc-2", "document_type": "electricity_bill",
             "classification_status": "supported", "reason": "Residential service billing content"},
        ]}

    client._json = fake_json
    catalog = [
        {"type_key": "employment_verification_letter", "label": "Employment Verification Letter"},
        {"type_key": "electricity_bill", "label": "Electricity Bill"},
    ]
    profiles = [
        {"id": "doc-1", "filename": "do-not-use-this-name.pdf", "summary": "Employer confirms current employment",
         "visible_attributes": ["employee_reference"], "entity_roles": ["employee"],
         "type_key": None, "classification_status": "needs_confirmation"},
        {"id": "doc-2", "filename": "also-hidden.pdf", "summary": "Utility account and service address",
         "visible_attributes": ["service_address"], "entity_roles": ["customer"],
         "type_key": "electricity_bill", "classification_status": "supported"},
    ]
    result = client.resolve_document_types(catalog, profiles)
    assert result["doc-1"]["document_type"] == "employment_verification_letter"
    assert result["doc-2"]["document_type"] == "electricity_bill"
    assert "doc-1" in captured["prompt"] and "doc-2" in captured["prompt"]
    assert "do-not-use-this-name.pdf" not in captured["prompt"]


def test_field_extraction_uses_exact_target_field_attribute(monkeypatch):
    monkeypatch.setattr(muse_module, "image_as_base64", lambda _path: "image")
    client = object.__new__(MuseClient)
    client.settings = SimpleNamespace(muse_vision_model="vision-model")
    client._json_with_reasoning = lambda *_args, **_kwargs: ({
        "claims": [{
            "target_field_id": "field-1", "local_entity_key": "applicant", "entity_role": "applicant",
            "attribute": "random_model_name", "value_raw": "Jane Doe", "value_normalized": "Jane Doe",
            "observed_text": "Name: Jane Doe", "page_index": 0, "entity_link_status": "supported",
        }],
        "relationships": [],
    }, "Directly visible")
    fields = [{"id": "field-1", "semantic_target": "applicant.full_name", "entity_role": "applicant"}]
    result = client.extract_fields_from_document("document.png", "image/png", "applicant",
        {"document_type": "identity_record"}, fields)
    assert len(result.claims) == 1
    assert result.claims[0].attribute == "full_name"
    assert result.claims[0].target_field_id == "field-1"
