import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models import (DocumentRequirement, EntityRelationship, ExtractedClaim, FieldDecision,
                        FillSession, FormField, ResolvedEntity, ReviewIssue, UploadedDocument)
from app.services.audit import audit
from app.services.muse import MuseClient
from app.services.muse import FIELD_BATCH_SIZE


ATTRIBUTE_ALIASES = {
    "father_parent_full_name": {"father_name"},
    "mobile_number": {"contact_number", "phone_number"},
    "area_locality": {"residence_street_and_area"},
    "city": {"residence_city"},
    "state_province": {"residence_state"},
    "postal_zip_code": {"residence_postal_code"},
    "employer_company_name": {"employer_name"},
    "employee_number_reference": {"employee_code", "employee_reference"},
    "current_designation": {"designation", "job_title"},
    "employment_start_date": {"date_of_joining", "join_date"},
    "gross_monthly_income_inr": {"total_gross_earnings", "monthly_gross_salary"},
    "net_monthly_income_inr": {"net_pay", "monthly_net_salary"},
    "requested_amount": {"loan_amount"},
    "term_months": {"repayment_term"},
    "purpose": {"loan_purpose"},
    "salary_account_name": {"account_holder_name"},
    "institution_name": {"organization_name"},
    "account_reference_last4": {"account_reference", "salary_bank_reference"},
    "average_monthly_salary_credit": {"total_credit", "net_pay"},
    "date_of_application": {"document_date"},
    "house_apartment_street": {"residence_flat_unit", "residence_street_and_area", "applicant_address", "service_address"},
}

ATTRIBUTE_ROLES = {
    "father_parent_full_name": {"applicant", "father"},
    "employer_company_name": {"employer"},
    "employee_number_reference": {"employee"},
    "current_designation": {"employee"},
    "employment_start_date": {"employee"},
    "gross_monthly_income_inr": {"employee", "payroll_document"},
    "net_monthly_income_inr": {"employee", "payroll_document"},
    "requested_amount": {"applicant", "primary_subject"},
    "term_months": {"applicant", "primary_subject"},
    "purpose": {"applicant", "primary_subject"},
    "salary_account_name": {"applicant", "account_holder"},
    "institution_name": {"issuing_institution"},
    "account_reference_last4": {"account", "payroll_document"},
    "average_monthly_salary_credit": {"account", "payroll_document"},
    "date_of_application": {"primary_subject"},
    "house_apartment_street": {"applicant", "customer"},
}

CHECKLIST_DOCUMENT_TYPES = {
    "identity_information_record": {"applicant_information_record", "identity_information_record"},
    "residential_address_evidence": {"electricity_bill", "utility_bill", "residential_address_evidence"},
    "recent_bank_statements": {"bank_statement", "bank_statements", "account_statement"},
    "recent_salary_statements": {"salary_slip", "pay_advice", "salary_statement"},
    "employment_confirmation": {"employment_verification_letter", "employment_confirmation"},
    "loan_purpose_request_letter": {"loan_request_letter", "loan_purpose_request_letter"},
}

PREFERRED_ATTRIBUTES = {
    "house_apartment_street": {"applicant_address"},
}


def normalize(attribute: str, value: str) -> str:
    value = re.sub(r"\s+", " ", value.strip())
    if attribute in {"full_name", "name", "address"}:
        return value.casefold()
    if attribute == "employer_company_name":
        normalized = re.sub(r"\b(private|pvt|limited|ltd|incorporated|inc|llp)\b\.?", "", value, flags=re.IGNORECASE)
        return re.sub(r"[^a-z0-9]", "", normalized.casefold())
    if attribute in {"phone_number", "identifier", "policy_number", "account_number"}:
        return re.sub(r"[\s-]", "", value).casefold()
    if attribute in {"date_of_birth", "dob", "date", "employment_start_date", "date_of_application", "date_signed"}:
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %B %Y", "%d %b %Y"):
            try: return datetime.strptime(value, fmt).date().isoformat()
            except ValueError: pass
    if attribute in {"gross_monthly_income_inr", "net_monthly_income_inr", "requested_amount",
                     "average_monthly_salary_credit", "existing_monthly_debt"}:
        numeric = re.sub(r"[^0-9.-]", "", value)
        if numeric:
            return numeric.lstrip("0") or "0"
    return value.casefold()


def create_issue(db, fill_id, issue_type, reason, field_id=None, entity_id=None, attribute=None, candidates=None):
    issue = ReviewIssue(fill_session_id=fill_id, field_id=field_id, entity_id=entity_id,
                        issue_type=issue_type, attribute=attribute, candidate_claim_ids=candidates or [], reason=reason)
    db.add(issue)
    return issue


def document_processing_status(document_type: str | None, classification_status: str) -> str:
    """Only supported content classifications may enter automatic extraction."""
    return "classified" if document_type and classification_status == "supported" else "needs_review"


def _field_spec(field: FormField) -> dict:
    return {
        "id": str(field.id),
        "display_label": field.display_label,
        "canonical_key": field.canonical_key,
        "semantic_target": field.semantic_target,
        "entity_role": field.entity_role,
        "field_type": field.field_type,
        "format": field.format,
        "instruction": field.instruction,
        "source_policy": field.source_policy or {},
    }


def _store_field_bundle(db: Session, fill: FillSession, document: UploadedDocument, bundle,
                        model_name: str, entities_by_identity: dict,
                        extraction_stage: str = "field_targeted") -> None:
    local_entities = {}
    claim_rows = []
    for item in bundle.claims:
        identity = (item.entity_role or "", (item.entity_display_name or item.local_entity_key).strip().casefold())
        entity = entities_by_identity.get(identity)
        if not entity:
            entity = ResolvedEntity(fill_session_id=fill.id, entity_type=item.entity_type,
                display_name=item.entity_display_name, roles=[item.entity_role] if item.entity_role else [],
                status="supported" if item.entity_link_status == "supported" else "needs_confirmation")
            db.add(entity); db.flush(); entities_by_identity[identity] = entity
        elif item.entity_role and item.entity_role not in (entity.roles or []):
            entity.roles = [*(entity.roles or []), item.entity_role]
        local_entities[item.local_entity_key] = entity
        claim = ExtractedClaim(document_id=document.id, entity_id=entity.id, entity_role=item.entity_role,
            attribute=item.attribute, value_raw=item.value_raw,
            value_normalized=normalize(item.attribute, item.value_normalized), observed_text=item.observed_text,
            page_index=item.page_index, bbox_norm=None, relation_context=item.relation_context,
            temporal_context=item.temporal_context, quality={"status": item.quality_status},
            entity_link_status=item.entity_link_status,
            model_metadata={"provider": "baseten", "model": model_name,
                            "pipeline": "contextual_field_v2", "extraction_stage": extraction_stage,
                            "document_type": document.type_key,
                            "target_field_id": item.target_field_id})
        db.add(claim); db.flush(); claim_rows.append(claim)
    for relationship in bundle.relationships:
        source = local_entities.get(relationship.source_local_entity_key)
        target = local_entities.get(relationship.target_local_entity_key)
        if source and target:
            evidence = [str(claim_rows[index].id) for index in relationship.evidence_claim_indexes
                        if 0 <= index < len(claim_rows)]
            db.add(EntityRelationship(fill_session_id=fill.id, source_entity_id=source.id,
                predicate=relationship.predicate, target_entity_id=target.id,
                evidence_claim_ids=evidence, status=relationship.status))


def _claim_index(claims) -> list[dict]:
    """Compact general extraction into routing context without repeating values or page duplicates."""
    seen = set()
    result = []
    for claim in claims:
        key = (claim.attribute, claim.entity_role or "", str(claim.relation_context or {}),
               str(claim.temporal_context or {}))
        if key in seen:
            continue
        seen.add(key)
        result.append({
            "attribute": claim.attribute,
            "entity_role": claim.entity_role,
            "relation_context": claim.relation_context,
            "temporal_context": claim.temporal_context,
        })
    return result


def _joined_reasoning(*parts: tuple[str, str | None]) -> str | None:
    sections = [f"{label}:\n{text}" for label, text in parts if text]
    return "\n\n".join(sections) or None


def process_fill(db: Session, fill: FillSession) -> None:
    fill.status, fill.error_detail = "extracting", None
    db.query(ReviewIssue).filter(ReviewIssue.fill_session_id == fill.id, ReviewIssue.status == "open").delete()
    requirements = db.query(DocumentRequirement).filter(DocumentRequirement.template_id == fill.template_id).all()
    template_fields = db.query(FormField).filter(FormField.template_id == fill.template_id).all()
    snapshot_questions = fill.template_snapshot.get("template", {}).get("intake_questions", [])
    intake_context = {item.get("prompt", item["key"]): fill.intake_answers[item["key"]]
                      for item in snapshot_questions if fill.intake_answers.get(item.get("key"))}
    docs = db.query(UploadedDocument).filter(UploadedDocument.fill_session_id == fill.id).all()
    try:
        client = MuseClient()
        type_catalog = [{"type_key": requirement.type_key, "label": requirement.label,
                         "description": requirement.description} for requirement in requirements]
        document_profiles = []
        for document in docs:
            profile = client.profile_document(document.file_uri, document.content_type,
                                              type_catalog, document.subject_tag)
            document_profiles.append({"id": str(document.id), "filename": document.original_filename,
                "type_key": profile["document_type"], "document_type": profile["document_type"],
                "subject_tag": document.subject_tag,
                "summary": profile["summary"], "visible_attributes": profile["visible_attributes"],
                "entity_roles": profile["entity_roles"], "classification_status": profile["classification_status"],
                "profile_reasoning": profile.get("reasoning")})

        corpus_assignments = client.resolve_document_types(type_catalog, document_profiles)
        for document, profile in zip(docs, document_profiles):
            assignment = corpus_assignments[str(document.id)]
            document.type_key = assignment["document_type"]
            document.status = document_processing_status(document.type_key, assignment["classification_status"])
            profile.update({
                "type_key": document.type_key,
                "document_type": document.type_key,
                "classification_status": assignment["classification_status"],
                "corpus_classification_reason": assignment.get("reason"),
            })
            document.classification = {
                "document_type": document.type_key,
                "classification_status": assignment["classification_status"],
                "summary": profile["summary"],
                "visible_attributes": profile["visible_attributes"],
                "entity_roles": profile["entity_roles"],
                "reasoning": _joined_reasoning(
                    ("Per-document visual profile", profile.get("profile_reasoning")),
                    ("Full evidence-set type resolution", assignment.get("reason")),
                ),
                "status": assignment["classification_status"],
                "pipeline": "contextual_field_v2",
                "type_source": "full_evidence_set_content",
            }
        db.flush()

        extractable_fields = [field for field in template_fields if field.auto_fillable
                              and field.field_type != "signature"
                              and not field.semantic_target.startswith(("checklist.", "declaration."))]
        document_by_id = {str(document.id): document for document in docs if document.status == "classified"}
        extractable_profiles = [profile for profile in document_profiles
                                if str(profile["id"]) in document_by_id]
        entities_by_identity = {}

        for profile in extractable_profiles:
            document = document_by_id[str(profile["id"])]
            inventory = client.extract_document(document.file_uri, document.content_type,
                document.subject_tag, [document.type_key], intake_context=intake_context)
            _store_field_bundle(db, fill, document, inventory, client.settings.muse_vision_model,
                                entities_by_identity, extraction_stage="document_inventory")
            profile["extracted_attributes"] = sorted({claim.attribute for claim in inventory.claims})
            profile["extracted_field_index"] = _claim_index(inventory.claims)
            profile["inventory_claim_count"] = len(inventory.claims)
            classification = document.classification or {}
            document.classification = {
                **classification,
                "extracted_attributes": profile["extracted_attributes"],
                "extracted_field_index": profile["extracted_field_index"],
                "inventory_claim_count": len(inventory.claims),
                "reasoning": _joined_reasoning(
                    ("Classification", classification.get("reasoning")),
                    ("General document extraction", inventory.reasoning),
                ),
            }

        for start in range(0, len(extractable_fields), FIELD_BATCH_SIZE):
            field_batch = extractable_fields[start:start + FIELD_BATCH_SIZE]
            specs = [_field_spec(field) for field in field_batch]
            routes = client.route_field_batch(specs, extractable_profiles) if extractable_profiles else {}
            for document_id, document in document_by_id.items():
                routed_specs = [spec for spec in specs if document_id in routes.get(str(spec["id"]), [])]
                if not routed_specs:
                    continue
                profile = next(item for item in document_profiles if item["id"] == document_id)
                bundle = client.extract_fields_from_document(document.file_uri, document.content_type,
                    document.subject_tag, profile, routed_specs, intake_context)
                _store_field_bundle(db, fill, document, bundle, client.settings.muse_vision_model,
                                    entities_by_identity, extraction_stage="field_targeted")

        for document in docs:
            if document.subject_tag:
                continue
            roles = [claim.entity_role for claim in db.query(ExtractedClaim).filter_by(document_id=document.id).all()
                     if claim.entity_role and claim.entity_link_status == "supported"]
            if roles:
                document.subject_tag = Counter(roles).most_common(1)[0][0]
        _check_requirements(db, fill, requirements, docs)
        fill.status = "mapping_values"
        map_fields(db, fill)
        db.flush()
        open_count = db.query(ReviewIssue).filter(ReviewIssue.fill_session_id == fill.id, ReviewIssue.status == "open").count()
        pending_document_reviews = any(document.status == "needs_review" for document in docs)
        fill.status = "needs_review" if open_count or pending_document_reviews else "ready_to_export"
        audit(db, fill_session_id=fill.id, actor="system", action="processing_completed",
              target_type="fill_session", target_id=fill.id, after={"status": fill.status, "open_issues": open_count})
        db.commit()
    except Exception as exc:
        db.rollback()
        fill = db.get(FillSession, fill.id)
        fill.status, fill.error_detail = "error", str(exc)[:2000]
        audit(db, fill_session_id=fill.id, actor="system", action="processing_failed", target_type="fill_session",
              target_id=fill.id, after={"error": str(exc)[:500]})
        db.commit()
        raise


def _check_requirements(db, fill, requirements, docs):
    accepted_statuses = {"classified", "human_reviewed"}
    present = {d.type_key for d in docs if d.status in accepted_statuses}
    pending_document_review = any(d.status == "needs_review" for d in docs)
    if not pending_document_review:
        for req in requirements:
            if req.required and req.type_key not in present:
                create_issue(db, fill.id, "missing_required_document", f"Required document is missing: {req.label}")
    for doc in docs:
        if doc.status == "wrong_type":
            create_issue(db, fill.id, "wrong_document_type", f"Document type could not be verified: {doc.original_filename}")


def process_reviewed_document(db: Session, fill: FillSession, document: UploadedDocument) -> None:
    """Extract one human-classified document, then refresh the fill's derived review state."""
    try:
        client = MuseClient()
        fields = db.query(FormField).filter(FormField.template_id == fill.template_id).all()
        snapshot_questions = fill.template_snapshot.get("template", {}).get("intake_questions", [])
        intake_context = {item.get("prompt", item["key"]): fill.intake_answers[item["key"]]
                          for item in snapshot_questions if fill.intake_answers.get(item.get("key"))}
        classification = document.classification or {}
        profile = {
            "id": str(document.id),
            "filename": document.original_filename,
            "type_key": document.type_key,
            "document_type": document.type_key,
            "subject_tag": document.subject_tag,
            "summary": classification.get("summary", ""),
            "visible_attributes": classification.get("visible_attributes", []),
            "entity_roles": classification.get("entity_roles", []),
            "classification_status": "supported",
        }
        extractable_fields = [field for field in fields if field.auto_fillable
                              and field.field_type != "signature"
                              and not field.semantic_target.startswith(("checklist.", "declaration."))]
        entities_by_identity = {}
        for entity in db.query(ResolvedEntity).filter(ResolvedEntity.fill_session_id == fill.id).all():
            display_name = (entity.display_name or "").strip().casefold()
            for role in entity.roles or []:
                entities_by_identity[(role, display_name)] = entity

        inventory = client.extract_document(document.file_uri, document.content_type,
            document.subject_tag, [document.type_key], intake_context=intake_context)
        _store_field_bundle(db, fill, document, inventory, client.settings.muse_vision_model,
                            entities_by_identity, extraction_stage="document_inventory")
        profile["extracted_attributes"] = sorted({claim.attribute for claim in inventory.claims})
        profile["extracted_field_index"] = _claim_index(inventory.claims)
        profile["inventory_claim_count"] = len(inventory.claims)
        classification = document.classification or {}
        document.classification = {
            **classification,
            "extracted_attributes": profile["extracted_attributes"],
            "extracted_field_index": profile["extracted_field_index"],
            "inventory_claim_count": len(inventory.claims),
            "reasoning": _joined_reasoning(
                ("Classification", classification.get("reasoning")),
                ("General document extraction", inventory.reasoning),
            ),
        }

        for start in range(0, len(extractable_fields), FIELD_BATCH_SIZE):
            field_batch = extractable_fields[start:start + FIELD_BATCH_SIZE]
            specs = [_field_spec(field) for field in field_batch]
            routes = client.route_field_batch(specs, [profile])
            routed_specs = [spec for spec in specs if str(document.id) in routes.get(str(spec["id"]), [])]
            if not routed_specs:
                continue
            bundle = client.extract_fields_from_document(document.file_uri, document.content_type,
                document.subject_tag, profile, routed_specs, intake_context)
            _store_field_bundle(db, fill, document, bundle, client.settings.muse_vision_model,
                                entities_by_identity, extraction_stage="field_targeted")

        if not document.subject_tag:
            roles = [claim.entity_role for claim in db.query(ExtractedClaim).filter_by(document_id=document.id).all()
                     if claim.entity_role and claim.entity_link_status == "supported"]
            if roles:
                document.subject_tag = Counter(roles).most_common(1)[0][0]
        document.status = "human_reviewed"
        db.query(ReviewIssue).filter(ReviewIssue.fill_session_id == fill.id,
                                     ReviewIssue.status == "open").delete(synchronize_session=False)
        requirements = db.query(DocumentRequirement).filter(DocumentRequirement.template_id == fill.template_id).all()
        documents = db.query(UploadedDocument).filter(UploadedDocument.fill_session_id == fill.id).all()
        _check_requirements(db, fill, requirements, documents)
        fill.status = "mapping_values"
        map_fields(db, fill)
        db.flush()
        open_count = db.query(ReviewIssue).filter_by(fill_session_id=fill.id, status="open").count()
        pending_document_reviews = any(item.status == "needs_review" for item in documents)
        fill.status = "needs_review" if open_count or pending_document_reviews else "ready_to_export"
        audit(db, fill_session_id=fill.id, actor="system", action="reviewed_document_extracted",
              target_type="uploaded_document", target_id=document.id,
              after={"type_key": document.type_key, "status": document.status, "open_issues": open_count})
        db.commit()
    except Exception as exc:
        db.rollback()
        fill = db.get(FillSession, fill.id)
        document = db.get(UploadedDocument, document.id)
        fill.status, fill.error_detail = "error", str(exc)[:2000]
        document.status = "needs_review"
        audit(db, fill_session_id=fill.id, actor="system", action="reviewed_document_extraction_failed",
              target_type="uploaded_document", target_id=document.id, after={"error": str(exc)[:500]})
        db.commit()
        raise


def map_fields(db: Session, fill: FillSession) -> None:
    fields = db.query(FormField).filter(FormField.template_id == fill.template_id).all()
    claims = (db.query(ExtractedClaim).join(UploadedDocument)
              .filter(UploadedDocument.fill_session_id == fill.id).all())
    entities = {e.id: e for e in db.query(ResolvedEntity).filter(ResolvedEntity.fill_session_id == fill.id).all()}
    documents = db.query(UploadedDocument).filter(UploadedDocument.fill_session_id == fill.id).all()
    accepted_statuses = {"classified", "human_reviewed"}
    accepted_document_ids = {d.id for d in documents if d.status in accepted_statuses}
    claims = [claim for claim in claims if claim.document_id in accepted_document_ids]
    present_document_types = {d.type_key for d in documents if d.status in accepted_statuses and d.type_key}
    pending_document_review = any(d.status == "needs_review" for d in documents)
    for field in fields:
        decision = db.query(FieldDecision).filter_by(fill_session_id=fill.id, field_id=field.id).first()
        if decision and decision.human_override:
            continue
        if not decision:
            decision = FieldDecision(fill_session_id=fill.id, field_id=field.id); db.add(decision)
        decision.target_entity_id = None
        decision.selected_claim_id = None
        decision.resolved_value = None
        decision.candidate_claim_ids = []
        attribute = field.semantic_target.split(".")[-1]
        if field.semantic_target.startswith("checklist."):
            expected_types = CHECKLIST_DOCUMENT_TYPES.get(attribute, {attribute})
            if expected_types & present_document_types:
                decision.resolved_value, decision.status, decision.reason_code = "Yes", "auto_supported", None
            elif pending_document_review:
                decision.resolved_value, decision.status, decision.reason_code = None, "unresolved", "document_type_review_pending"
            else:
                decision.resolved_value, decision.status, decision.reason_code = None, "unresolved", "missing_document"
                create_issue(db, fill.id, "missing_required_document", "No matching uploaded document supports this checklist item", field.id, attribute=attribute)
            continue
        if field.semantic_target.startswith("declaration."):
            decision.resolved_value, decision.status, decision.reason_code = None, "unresolved", "review_required_by_policy"
            create_issue(db, fill.id, "review_required_by_policy", "Declaration and signature fields require explicit applicant or reviewer action", field.id, attribute=attribute)
            continue
        accepted_attributes = {attribute, field.canonical_key} | ATTRIBUTE_ALIASES.get(attribute, set()) | ATTRIBUTE_ALIASES.get(field.canonical_key, set())
        accepted_roles = ATTRIBUTE_ROLES.get(attribute) or ATTRIBUTE_ROLES.get(field.canonical_key) or {field.entity_role}
        targeted = [claim for claim in claims
                    if str((claim.model_metadata or {}).get("target_field_id") or "") == str(field.id)
                    and claim.entity_link_status == "supported" and claim.entity_id in entities]
        eligible = targeted or [c for c in claims if c.attribute in accepted_attributes
                                and c.entity_link_status == "supported" and c.entity_id in entities
                                and accepted_roles.intersection(entities[c.entity_id].roles)]
        preferred = PREFERRED_ATTRIBUTES.get(attribute) or PREFERRED_ATTRIBUTES.get(field.canonical_key)
        if preferred and any(c.attribute in preferred for c in eligible):
            eligible = [c for c in eligible if c.attribute in preferred]
        allowed = field.source_policy.get("allowed_types", []) if field.source_policy else []
        if allowed:
            docs = {d.id: d for d in documents}
            eligible = [c for c in eligible if docs[c.document_id].type_key in allowed]
        decision.candidate_claim_ids = [str(c.id) for c in eligible]
        if not field.auto_fillable or field.field_type == "signature":
            decision.status, decision.reason_code = "unresolved", "review_required_by_policy"
            create_issue(db, fill.id, "review_required_by_policy", "Field requires manual review", field.id, attribute=attribute)
        elif not eligible:
            decision.status, decision.reason_code = "unresolved", "insufficient_evidence"
            if pending_document_review:
                decision.reason_code = "document_type_review_pending"
            else:
                create_issue(db, fill.id, "insufficient_evidence", "No eligible evidence supports this field", field.id, attribute=attribute)
        else:
            groups = {}
            for claim in eligible: groups.setdefault(normalize(attribute, claim.value_normalized), []).append(claim)
            if len(groups) > 1:
                decision.status, decision.reason_code = "unresolved", "same_entity_attribute_different_values"
                create_issue(db, fill.id, "material_conflict", "Comparable claims have materially different values",
                             field.id, eligible[0].entity_id, attribute, [str(c.id) for c in eligible])
            else:
                selected = eligible[0]
                decision.target_entity_id, decision.selected_claim_id = selected.entity_id, selected.id
                value = selected.value_raw
                if attribute == "account_reference_last4":
                    compact = re.sub(r"[^A-Za-z0-9]", "", value)
                    value = compact[-4:] if len(compact) >= 4 else value
                decision.resolved_value, decision.status, decision.reason_code = value, "auto_supported", None

