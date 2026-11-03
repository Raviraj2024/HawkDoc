from typing import Any
from sqlalchemy.orm import Session
from app.models import AuditEvent


def audit(db: Session, *, fill_session_id=None, actor: str, action: str, target_type: str,
          target_id, before: dict[str, Any] | None = None, after: dict[str, Any] | None = None,
          reason: str | None = None, operation_id: str | None = None) -> AuditEvent:
    if operation_id:
        existing = db.query(AuditEvent).filter(AuditEvent.operation_id == operation_id).first()
        if existing:
            return existing
    event = AuditEvent(fill_session_id=fill_session_id, actor=actor, action=action,
                       target_type=target_type, target_id=str(target_id), before=before,
                       after=after, reason=reason, operation_id=operation_id)
    db.add(event)
    return event

