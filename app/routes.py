import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from app.config import get_settings
from app.database import get_db
from app.models import *
from app.schemas import *
from app.services.audit import audit
from app.services.muse import MuseClient
from app.services.pdf import inspect_pdf, render_filled, render_page_png
from app.services.processing import map_fields, process_fill, process_reviewed_document
from app.services.storage import private_path, save_upload

router = APIRouter(prefix="/api")


def need(db, model, object_id):
    obj = db.get(model, object_id)
    if not obj: raise HTTPException(404, f"{model.__name__} not found")
    return obj


def dump(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(__import__("sqlalchemy").text("select 1"))
    return {"status": "ok"}


@router.get("/templates")
def list_templates(db: Session = Depends(get_db)):
    return [dump(x) for x in db.query(FormTemplate).order_by(FormTemplate.created_at.desc()).all()]


@router.post("/templates", status_code=201)
async def create_template(name: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    if file.content_type != "application/pdf": raise HTTPException(415, "Blank form must be a PDF")
    template_id = uuid.uuid4()
    uri, _, _ = await save_upload(file, "templates", str(template_id))
    try: count, metadata, searchable = inspect_pdf(uri)
    except Exception as exc: Path(uri).unlink(missing_ok=True); raise HTTPException(400, str(exc))
    obj = FormTemplate(id=template_id, name=name, file_uri=uri, original_filename=file.filename or "form.pdf",
                       page_count=count, page_metadata=metadata, searchable=searchable)
    db.add(obj); audit(db, actor="user", action="template_created", target_type="form_template", target_id=obj.id,
                       after={"name": name, "page_count": count}); db.commit(); db.refresh(obj)
    return dump(obj)


@router.get("/templates/{template_id}")
def get_template(template_id: uuid.UUID, db: Session = Depends(get_db)):
    obj = need(db, FormTemplate, template_id)
    return {**dump(obj), "fields": [dump(x) for x in obj.fields], "requirements": [dump(x) for x in obj.requirements]}


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: uuid.UUID, db: Session = Depends(get_db)):
    template = need(db, FormTemplate, template_id)
    fields = db.query(FormField).filter(FormField.template_id == template_id).all()
    fills = db.query(FillSession).filter(FillSession.template_id == template_id).all()
    field_ids = [field.id for field in fields]
    fill_ids = [fill.id for fill in fills]
    documents = db.query(UploadedDocument).filter(UploadedDocument.fill_session_id.in_(fill_ids)).all() if fill_ids else []
    exports = db.query(ExportArtifact).filter(ExportArtifact.fill_session_id.in_(fill_ids)).all() if fill_ids else []
    file_uris = [template.file_uri, *(document.file_uri for document in documents), *(artifact.file_uri for artifact in exports)]

    if fill_ids:
        db.query(AuditEvent).filter(AuditEvent.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        db.query(ReviewIssue).filter(ReviewIssue.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        db.query(FieldDecision).filter(FieldDecision.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        db.query(EntityRelationship).filter(EntityRelationship.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        document_ids = [document.id for document in documents]
        if document_ids:
            db.query(ExtractedClaim).filter(ExtractedClaim.document_id.in_(document_ids)).delete(synchronize_session=False)
        db.query(ResolvedEntity).filter(ResolvedEntity.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        db.query(ExportArtifact).filter(ExportArtifact.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        db.query(UploadedDocument).filter(UploadedDocument.fill_session_id.in_(fill_ids)).delete(synchronize_session=False)
        db.query(FillSession).filter(FillSession.id.in_(fill_ids)).delete(synchronize_session=False)

    target_ids = [str(template_id), *(str(field_id) for field_id in field_ids)]
    db.query(AuditEvent).filter(AuditEvent.target_id.in_(target_ids)).delete(synchronize_session=False)
    db.query(DocumentRequirement).filter(DocumentRequirement.template_id == template_id).delete(synchronize_session=False)
    db.query(FormField).filter(FormField.template_id == template_id).delete(synchronize_session=False)
    db.query(FormTemplate).filter(FormTemplate.id == template_id).delete(synchronize_session=False)
    db.commit()

    for uri in file_uris:
        try:
            private_path(uri).unlink(missing_ok=True)
        except (HTTPException, OSError):
            pass


@router.get("/templates/{template_id}/file")
def template_file(template_id: uuid.UUID, db: Session = Depends(get_db)):
    obj = need(db, FormTemplate, template_id)
    return FileResponse(private_path(obj.file_uri), media_type="application/pdf", filename=obj.original_filename)


@router.get("/templates/{template_id}/pages/{page_index}/preview")
def template_page_preview(template_id: uuid.UUID, page_index: int, db: Session = Depends(get_db)):
    obj = need(db, FormTemplate, template_id)
    try:
        content = render_page_png(obj.file_uri, page_index)
    except IndexError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(content=content, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/templates/{template_id}/parse")
def parse_template(template_id: uuid.UUID, replace_existing: bool = False, db: Session = Depends(get_db)):
    obj = need(db, FormTemplate, template_id); obj.status = "mapping"
    try: proposals = MuseClient().discover_fields(obj.file_uri)
    except Exception as exc: obj.status = "error"; db.commit(); raise HTTPException(502, str(exc))
    if replace_existing and obj.status == "ready":
        raise HTTPException(409, "A ready template cannot have its mapping replaced; edit fields individually")
    if replace_existing:
        db.query(FormField).filter(FormField.template_id == obj.id).delete(synchronize_session=False)
        db.flush()
    if replace_existing or not obj.fields:
        for proposal in proposals:
            db.add(FormField(template_id=obj.id, **proposal.model_dump()))
    obj.status = "needs_template_review"
    audit(db, actor="model", action="field_discovery", target_type="form_template", target_id=obj.id,
          after={"proposal_count": len(proposals), "replaced_existing": replace_existing}); db.commit()
    return {"status": obj.status, "fields": [p.model_dump() for p in proposals]}


@router.get("/templates/{template_id}/fields")
def fields(template_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FormTemplate, template_id)
    return [dump(x) for x in db.query(FormField).filter_by(template_id=template_id).all()]


@router.post("/templates/{template_id}/fields", status_code=201)
def add_field(template_id: uuid.UUID, body: FieldCreate, db: Session = Depends(get_db)):
    template = need(db, FormTemplate, template_id)
    if body.page_index >= template.page_count: raise HTTPException(422, "page_index exceeds page count")
    obj = FormField(template_id=template_id, **body.model_dump()); db.add(obj); template.version += 1
    template.status = "needs_template_review"
    audit(db, actor="reviewer", action="field_added", target_type="form_field", target_id=obj.id, after=body.model_dump(mode="json")); db.commit(); db.refresh(obj)
    return dump(obj)


@router.patch("/templates/{template_id}/fields/{field_id}")
def patch_field(template_id: uuid.UUID, field_id: uuid.UUID, body: FieldPatch, db: Session = Depends(get_db)):
    template, obj = need(db, FormTemplate, template_id), need(db, FormField, field_id)
    if obj.template_id != template_id: raise HTTPException(404, "Field not in template")
    before = dump(obj); changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items(): setattr(obj, key, value)
    template.version += 1
    if changes.get("mapping_status") != "confirmed" or any(key in changes for key in ("bbox_norm", "page_index", "semantic_target", "entity_role", "field_type")):
        template.status = "needs_template_review"
    audit(db, actor="reviewer", action="field_updated", target_type="form_field", target_id=obj.id,
        before=jsonable_encoder(before), after=body.model_dump(exclude_unset=True, mode="json")); db.commit()
    return dump(obj)


@router.put("/templates/{template_id}/field-source-policies")
def save_field_source_policies(template_id: uuid.UUID, body: list[FieldSourcePolicyIn], db: Session = Depends(get_db)):
    template = need(db, FormTemplate, template_id)
    allowed_requirement_types = {item.type_key for item in template.requirements}
    updated = []
    for item in body:
        field = need(db, FormField, item.field_id)
        if field.template_id != template_id:
            raise HTTPException(404, "Field not in template")
        selected_types = item.source_policy.get("allowed_types", [])
        unknown = set(selected_types) - allowed_requirement_types
        if unknown:
            raise HTTPException(422, f"Unknown document types for {field.display_label}: {', '.join(sorted(unknown))}")
        field.source_policy = item.source_policy
        updated.append(str(field.id))
    if updated:
        template.version += 1
        audit(db, actor="reviewer", action="field_source_policies_updated", target_type="form_template",
              target_id=template.id, after={"field_ids": updated, "field_count": len(updated)})
    db.commit()
    return {"count": len(updated)}


@router.delete("/templates/{template_id}/fields/{field_id}", status_code=204)
def delete_field(template_id: uuid.UUID, field_id: uuid.UUID, db: Session = Depends(get_db)):
    template, obj = need(db, FormTemplate, template_id), need(db, FormField, field_id)
    if obj.template_id != template_id: raise HTTPException(404, "Field not in template")
    audit(db, actor="reviewer", action="field_deleted", target_type="form_field", target_id=obj.id, before={"label": obj.display_label})
    db.delete(obj); template.version += 1; template.status = "needs_template_review"; db.commit()


@router.put("/templates/{template_id}/requirements")
def requirements(template_id: uuid.UUID, body: list[RequirementIn], db: Session = Depends(get_db)):
    template = need(db, FormTemplate, template_id)
    keys = [item.type_key for item in body]
    duplicate_keys = sorted({key for key in keys if keys.count(key) > 1})
    if duplicate_keys:
        raise HTTPException(422, f"Document requirement keys must be unique: {', '.join(duplicate_keys)}")
    db.query(DocumentRequirement).filter_by(template_id=template_id).delete()
    for item in body: db.add(DocumentRequirement(template_id=template_id, **item.model_dump()))
    template.version += 1; audit(db, actor="reviewer", action="requirements_replaced", target_type="form_template", target_id=template.id,
        after={"requirements": [x.model_dump() for x in body]}); db.commit()
    return {"count": len(body)}


@router.put("/templates/{template_id}/questions")
def template_questions(template_id: uuid.UUID, body: list[IntakeQuestionIn], db: Session = Depends(get_db)):
    template = need(db, FormTemplate, template_id)
    keys = [item.key for item in body]
    if len(keys) != len(set(keys)):
        raise HTTPException(422, "Question keys must be unique")
    for item in body:
        if item.answer_type == "select" and not item.options:
            raise HTTPException(422, f"Select question '{item.prompt}' requires at least one option")
    template.intake_questions = [item.model_dump() for item in body]
    template.version += 1
    audit(db, actor="reviewer", action="intake_questions_replaced", target_type="form_template", target_id=template.id,
          after={"question_count": len(body), "keys": keys})
    db.commit()
    return {"count": len(body)}


@router.post("/templates/{template_id}/confirm")
def confirm(template_id: uuid.UUID, db: Session = Depends(get_db)):
    obj = need(db, FormTemplate, template_id)
    if not obj.fields: raise HTTPException(409, "Template has no fields")
    if any(f.mapping_status != "confirmed" for f in obj.fields): raise HTTPException(409, "All fields must be confirmed")
    obj.status = "ready"; audit(db, actor="reviewer", action="template_confirmed", target_type="form_template", target_id=obj.id); db.commit()
    return {"status": obj.status}


@router.post("/fills", status_code=201)
def create_fill(body: FillCreate, db: Session = Depends(get_db)):
    template = need(db, FormTemplate, body.template_id)
    if template.status != "ready": raise HTTPException(409, "Template is not ready")
    snapshot = {"template": dump(template), "fields": [dump(x) for x in template.fields], "requirements": [dump(x) for x in template.requirements]}
    snapshot = jsonable_encoder(snapshot)
    status = "awaiting_answers" if template.intake_questions else "awaiting_documents"
    obj = FillSession(template_id=template.id, template_version=template.version, template_snapshot=snapshot, status=status); db.add(obj); db.flush()
    audit(db, fill_session_id=obj.id, actor="user", action="fill_created", target_type="fill_session", target_id=obj.id, after={"template_version": template.version}); db.commit(); db.refresh(obj)
    return dump(obj)


@router.get("/fills")
def list_fills(db: Session = Depends(get_db)):
    fills = db.query(FillSession).order_by(FillSession.created_at.desc()).all()
    result = []
    for fill in fills:
        template = db.get(FormTemplate, fill.template_id)
        latest_audit = (db.query(AuditEvent).filter(AuditEvent.fill_session_id == fill.id)
                        .order_by(AuditEvent.timestamp.desc()).first())
        issue_count = (db.query(ReviewIssue).filter_by(fill_session_id=fill.id, status="open")
                       .filter(ReviewIssue.issue_type != "wrong_document_type").count())
        document_review_count = (db.query(UploadedDocument)
                                 .filter(UploadedDocument.fill_session_id == fill.id,
                                         UploadedDocument.status.in_(["needs_review", "wrong_type"])).count())
        result.append({
            **dump(fill),
            "template_name": template.name if template else fill.template_snapshot.get("template", {}).get("name", "Deleted template"),
            "document_count": db.query(UploadedDocument).filter_by(fill_session_id=fill.id).count(),
            "claim_count": (db.query(ExtractedClaim).join(UploadedDocument)
                            .filter(UploadedDocument.fill_session_id == fill.id).count()),
            "open_issue_count": issue_count + document_review_count,
            "last_activity_at": latest_audit.timestamp if latest_audit else fill.created_at,
        })
    return result


@router.get("/fills/{fill_id}")
def get_fill(fill_id: uuid.UUID, db: Session = Depends(get_db)): return dump(need(db, FillSession, fill_id))


@router.put("/fills/{fill_id}/answers")
def save_intake_answers(fill_id: uuid.UUID, body: IntakeAnswersIn, db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id)
    questions = fill.template_snapshot.get("template", {}).get("intake_questions", [])
    valid_keys = {item["key"] for item in questions}
    answers = {key: str(value).strip() for key, value in body.answers.items() if key in valid_keys and str(value).strip()}
    missing = [item["prompt"] for item in questions if item.get("required") and not answers.get(item["key"])]
    if missing:
        raise HTTPException(422, {"message": "Required intake answers are missing", "questions": missing})
    fill.intake_answers = answers
    if fill.status == "awaiting_answers":
        fill.status = "awaiting_documents"
    audit(db, fill_session_id=fill.id, actor="user", action="intake_answers_submitted",
          target_type="fill_session", target_id=fill.id, after={"answered_keys": sorted(answers)})
    db.commit(); db.refresh(fill)
    return dump(fill)


@router.post("/fills/{fill_id}/documents", status_code=201)
async def upload_document(fill_id: uuid.UUID, file: UploadFile = File(...), type_key: str | None = Form(None), subject_tag: str | None = Form(None), db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id); doc_id = uuid.uuid4()
    if fill.status == "awaiting_answers":
        raise HTTPException(409, "Complete the intake questions before uploading evidence")
    if fill.status in {"extracting", "mapping_values"}:
        raise HTTPException(409, "Documents cannot be changed while evidence processing is running")
    uri, digest, _ = await save_upload(file, "fills", str(fill_id))
    if db.query(UploadedDocument).filter_by(fill_session_id=fill_id, sha256=digest).first(): Path(uri).unlink(missing_ok=True); raise HTTPException(409, "Duplicate document")
    obj = UploadedDocument(id=doc_id, fill_session_id=fill_id, type_key=type_key, file_uri=uri,
        original_filename=file.filename or "document", content_type=file.content_type or "application/octet-stream", sha256=digest, subject_tag=subject_tag)
    db.add(obj); audit(db, fill_session_id=fill.id, actor="user", action="document_uploaded", target_type="uploaded_document", target_id=obj.id,
        after={"filename": obj.original_filename, "type_key": type_key, "subject_tag": subject_tag}); db.commit(); db.refresh(obj)
    return dump(obj)


@router.post("/fills/{fill_id}/documents/bulk", status_code=201)
async def upload_documents_bulk(fill_id: uuid.UUID, files: list[UploadFile] = File(...), type_key: str | None = Form(None), subject_tag: str | None = Form(None), db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id)
    if fill.status == "awaiting_answers":
        raise HTTPException(409, "Complete the intake questions before uploading evidence")
    if fill.status in {"extracting", "mapping_values"}:
        raise HTTPException(409, "Documents cannot be changed while evidence processing is running")
    if not files:
        raise HTTPException(422, "Select at least one document")
    if len(files) > 20:
        raise HTTPException(413, "A bulk upload may contain at most 20 documents")
    protected_uris = {row[0] for row in db.query(UploadedDocument.file_uri).filter_by(fill_session_id=fill_id)}
    created_uris: list[str] = []
    created: list[UploadedDocument] = []
    try:
        for file in files:
            uri, digest, _ = await save_upload(file, "fills", str(fill_id))
            existing = db.query(UploadedDocument).filter_by(fill_session_id=fill_id, sha256=digest).first()
            if existing:
                if uri not in protected_uris:
                    Path(uri).unlink(missing_ok=True)
                raise HTTPException(409, f"Duplicate document: {file.filename or 'document'}")
            obj = UploadedDocument(id=uuid.uuid4(), fill_session_id=fill_id, type_key=type_key, file_uri=uri,
                original_filename=file.filename or "document", content_type=file.content_type or "application/octet-stream",
                sha256=digest, subject_tag=subject_tag)
            db.add(obj); db.flush()
            protected_uris.add(uri); created_uris.append(uri); created.append(obj)
            audit(db, fill_session_id=fill.id, actor="user", action="document_uploaded",
                target_type="uploaded_document", target_id=obj.id,
                after={"filename": obj.original_filename, "type_key": type_key, "subject_tag": subject_tag, "upload_mode": "bulk"})
        db.commit()
        return [dump(obj) for obj in created]
    except Exception:
        db.rollback()
        for uri in created_uris:
            if uri not in {row[0] for row in db.query(UploadedDocument.file_uri).filter_by(fill_session_id=fill_id)}:
                try:
                    private_path(uri).unlink(missing_ok=True)
                except (HTTPException, OSError):
                    pass
        raise


@router.get("/fills/{fill_id}/documents")
def fill_documents(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FillSession, fill_id)
    return [dump(x) for x in db.query(UploadedDocument).filter_by(fill_session_id=fill_id).order_by(UploadedDocument.created_at)]


@router.get("/fills/{fill_id}/documents/{document_id}/pages/{page_index}/preview")
def evidence_page_preview(fill_id: uuid.UUID, document_id: uuid.UUID, page_index: int, db: Session = Depends(get_db)):
    document = need(db, UploadedDocument, document_id)
    if document.fill_session_id != fill_id:
        raise HTTPException(404, "Document not found in this fill")
    if document.content_type == "application/pdf":
        try:
            content = render_page_png(document.file_uri, page_index)
        except IndexError as exc:
            raise HTTPException(404, str(exc)) from exc
        return Response(content=content, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
    if page_index != 0:
        raise HTTPException(404, "Image evidence has only one page")
    return Response(content=private_path(document.file_uri).read_bytes(), media_type=document.content_type,
                    headers={"Cache-Control": "private, max-age=3600"})


@router.post("/fills/{fill_id}/documents/{document_id}/type", status_code=202)
def confirm_document_type(fill_id: uuid.UUID, document_id: uuid.UUID, body: DocumentTypeConfirmation,
                          background: BackgroundTasks, db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id)
    document = need(db, UploadedDocument, document_id)
    if document.fill_session_id != fill.id:
        raise HTTPException(404, "Document not found in this fill")
    if document.status not in {"needs_review", "wrong_type"}:
        raise HTTPException(409, "Document type is not awaiting review")
    requirement = db.query(DocumentRequirement).filter_by(
        template_id=fill.template_id, type_key=body.type_key).first()
    if not requirement:
        raise HTTPException(422, "Document type is not configured for this template")
    if fill.status in {"extracting", "mapping_values"}:
        raise HTTPException(409, "Evidence processing is already running")

    before = {"type_key": document.type_key, "status": document.status,
              "classification_status": (document.classification or {}).get("classification_status")}
    document.type_key = body.type_key
    document.status = "extracting"
    document.classification = {
        **(document.classification or {}),
        "document_type": body.type_key,
        "classification_status": "supported",
        "status": "human_reviewed",
        "type_source": "human_review",
    }
    fill.status, fill.error_detail = "extracting", None
    audit(db, fill_session_id=fill.id, actor=body.actor, action="document_type_confirmed",
          target_type="uploaded_document", target_id=document.id, before=before,
          after={"type_key": body.type_key, "status": document.status}, reason=body.reason,
          operation_id=body.operation_id)
    db.commit()

    from app.database import SessionLocal
    def run(fid, did):
        with SessionLocal() as task_db:
            process_reviewed_document(task_db, need(task_db, FillSession, fid),
                                      need(task_db, UploadedDocument, did))
    background.add_task(run, fill.id, document.id)
    return {"status": fill.status, "document_id": document.id, "type_key": document.type_key}


@router.post("/fills/{fill_id}/precheck")
def precheck(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id); fill.status = "prechecking"
    required = {r.type_key for r in db.query(DocumentRequirement).filter_by(template_id=fill.template_id, required=True)}
    uploaded = {d.type_key for d in db.query(UploadedDocument).filter_by(fill_session_id=fill.id) if d.type_key}
    missing = sorted(required - uploaded); fill.status = "awaiting_documents" if missing else "extracting"; db.commit()
    return {"missing_required": missing, "status": fill.status}


@router.post("/fills/{fill_id}/process", status_code=202)
def process(fill_id: uuid.UUID, background: BackgroundTasks, db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id)
    if fill.status == "awaiting_answers":
        raise HTTPException(409, "Complete the intake questions before processing evidence")
    if fill.status in {"extracting", "mapping_values"}:
        raise HTTPException(409, "Evidence processing is already running")
    if fill.status in {"needs_review", "ready_to_export", "exported"}:
        raise HTTPException(409, "Evidence has already been processed for this fill")
    if not db.query(UploadedDocument).filter_by(fill_session_id=fill.id).first(): raise HTTPException(409, "No documents uploaded")
    fill.status = "extracting"; db.commit()
    from app.database import SessionLocal
    def run(fid):
        with SessionLocal() as task_db: process_fill(task_db, need(task_db, FillSession, fid))
    background.add_task(run, fill.id)
    return {"status": fill.status}


@router.get("/fills/{fill_id}/entities")
def entities(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FillSession, fill_id)
    return {"entities": [dump(x) for x in db.query(ResolvedEntity).filter_by(fill_session_id=fill_id)],
            "relationships": [dump(x) for x in db.query(EntityRelationship).filter_by(fill_session_id=fill_id)]}


@router.get("/fills/{fill_id}/claims")
def claims(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FillSession, fill_id)
    return [dump(x) for x in (db.query(ExtractedClaim).join(UploadedDocument)
            .filter(UploadedDocument.fill_session_id == fill_id).order_by(ExtractedClaim.created_at))]


@router.get("/fills/{fill_id}/fields")
def decisions(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FillSession, fill_id); return [dump(x) for x in db.query(FieldDecision).filter_by(fill_session_id=fill_id)]


@router.get("/fills/{fill_id}/issues")
def issues(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FillSession, fill_id); return [dump(x) for x in db.query(ReviewIssue).filter_by(fill_session_id=fill_id).order_by(ReviewIssue.created_at)]


@router.post("/fills/{fill_id}/issues/{issue_id}/resolve")
def resolve_issue(fill_id: uuid.UUID, issue_id: uuid.UUID, body: IssueResolution, db: Session = Depends(get_db)):
    fill, issue = need(db, FillSession, fill_id), need(db, ReviewIssue, issue_id)
    if issue.fill_session_id != fill.id or issue.status != "open": raise HTTPException(409, "Issue is not open for this fill")
    decision = db.query(FieldDecision).filter_by(fill_session_id=fill.id, field_id=issue.field_id).first() if issue.field_id else None
    if body.action == "choose_claim":
        claim = need(db, ExtractedClaim, body.selected_claim_id)
        if str(claim.id) not in issue.candidate_claim_ids: raise HTTPException(422, "Claim is not an issue candidate")
        decision.selected_claim_id, decision.resolved_value = claim.id, claim.value_raw
    elif body.action == "accept_suggestion":
        if not issue.suggested_claim_id: raise HTTPException(422, "Issue has no suggestion")
        claim = need(db, ExtractedClaim, issue.suggested_claim_id); decision.selected_claim_id, decision.resolved_value = claim.id, claim.value_raw
    elif body.action == "manual_edit":
        if body.manual_value is None: raise HTTPException(422, "manual_value is required")
        decision.resolved_value, decision.selected_claim_id, decision.human_override = body.manual_value, None, True
    elif decision: decision.resolved_value, decision.status = None, "unresolved"
    if decision and body.action != "mark_unresolved": decision.status = "human_reviewed"
    issue.status, issue.resolution, issue.resolved_at = "resolved", body.model_dump(mode="json"), datetime.now(timezone.utc)
    audit(db, fill_session_id=fill.id, actor=body.actor, action="issue_resolved", target_type="review_issue", target_id=issue.id,
          after=body.model_dump(mode="json"), reason=body.reason, operation_id=body.operation_id)
    has_open_issue = db.query(ReviewIssue).filter_by(fill_session_id=fill.id, status="open").first()
    has_document_review = db.query(UploadedDocument).filter_by(fill_session_id=fill.id, status="needs_review").first()
    if not has_open_issue and not has_document_review: fill.status = "ready_to_export"
    db.commit(); return dump(issue)


@router.patch("/fills/{fill_id}/fields/{field_id}")
def override(fill_id: uuid.UUID, field_id: uuid.UUID, body: ManualOverride, db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id); need(db, FormField, field_id)
    decision = db.query(FieldDecision).filter_by(fill_session_id=fill.id, field_id=field_id).first()
    if not decision: decision = FieldDecision(fill_session_id=fill.id, field_id=field_id); db.add(decision)
    before = {"value": decision.resolved_value, "status": decision.status}; decision.resolved_value = body.value
    decision.selected_claim_id, decision.human_override, decision.status = None, True, "human_reviewed" if body.value is not None else "unresolved"
    audit(db, fill_session_id=fill.id, actor=body.actor, action="manual_override", target_type="field_decision", target_id=field_id,
          before=before, after={"value": body.value, "status": decision.status}, reason=body.reason, operation_id=body.operation_id); db.commit()
    return dump(decision)


@router.post("/fills/{fill_id}/claims/{claim_id}/entity")
def correct_entity(fill_id: uuid.UUID, claim_id: uuid.UUID, body: EntityCorrection, db: Session = Depends(get_db)):
    fill, claim, entity = need(db, FillSession, fill_id), need(db, ExtractedClaim, claim_id), need(db, ResolvedEntity, body.entity_id)
    if entity.fill_session_id != fill.id: raise HTTPException(422, "Entity belongs to another fill")
    old = claim.entity_id; claim.entity_id, claim.entity_link_status = entity.id, "supported"
    audit(db, fill_session_id=fill.id, actor=body.actor, action="change_entity_link", target_type="extracted_claim", target_id=claim.id,
          before={"entity_id": str(old)}, after={"entity_id": str(entity.id)}, reason=body.reason, operation_id=body.operation_id)
    map_fields(db, fill); db.commit(); return dump(claim)


@router.post("/fills/{fill_id}/export", status_code=201)
def export(fill_id: uuid.UUID, body: ExportRequest, db: Session = Depends(get_db)):
    fill = need(db, FillSession, fill_id)
    open_count = db.query(ReviewIssue).filter_by(fill_session_id=fill.id, status="open").count()
    if open_count and not (get_settings().allow_draft_export and body.allow_unresolved_draft): raise HTTPException(409, "Unresolved issues block final export; explicitly request a draft")
    template = need(db, FormTemplate, fill.template_id)
    rows = (db.query(FieldDecision, FormField).join(FormField, FieldDecision.field_id == FormField.id)
            .filter(FieldDecision.fill_session_id == fill.id).all())
    payload = [{"value": d.resolved_value, "page_index": f.page_index, "bbox_norm": f.bbox_norm, "field_type": f.field_type} for d,f in rows]
    artifact_id = uuid.uuid4(); destination = get_settings().storage_root / "exports" / str(fill.id) / f"{artifact_id}.pdf"
    render_filled(template.file_uri, payload, str(destination))
    state = "unresolved_draft" if open_count else "reviewed" if any(d.status == "human_reviewed" for d,_ in rows) else "ai_populated"
    artifact = ExportArtifact(id=artifact_id, fill_session_id=fill.id, format="pdf", file_uri=str(destination.resolve()), state=state, unresolved_count=open_count)
    db.add(artifact); fill.status, fill.exported_at = "exported", datetime.now(timezone.utc)
    audit(db, fill_session_id=fill.id, actor=body.actor, action="export_generated", target_type="export_artifact", target_id=artifact.id,
          after={"state": state, "unresolved_count": open_count}, operation_id=body.operation_id); db.commit(); db.refresh(artifact)
    return dump(artifact)


@router.get("/fills/{fill_id}/exports/{artifact_id}")
def download_export(fill_id: uuid.UUID, artifact_id: uuid.UUID, db: Session = Depends(get_db)):
    artifact = need(db, ExportArtifact, artifact_id)
    if artifact.fill_session_id != fill_id: raise HTTPException(404, "Export not found")
    return FileResponse(private_path(artifact.file_uri), media_type="application/pdf", filename=f"filled-{fill_id}.pdf")


@router.get("/fills/{fill_id}/audit")
def audit_log(fill_id: uuid.UUID, db: Session = Depends(get_db)):
    need(db, FillSession, fill_id); return [dump(x) for x in db.query(AuditEvent).filter_by(fill_session_id=fill_id).order_by(AuditEvent.timestamp)]

