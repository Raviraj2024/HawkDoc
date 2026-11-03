"""Preserve model-authored form field metadata without VARCHAR truncation."""
from alembic import op
import sqlalchemy as sa

revision = "0002_expand_form_field_text"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    for column in ("display_label", "canonical_key", "semantic_target", "entity_role", "field_type", "format", "group_key"):
        op.alter_column("form_fields", column, type_=sa.Text(), existing_nullable=column in {"format", "group_key"})


def downgrade():
    lengths = {"display_label": 255, "canonical_key": 160, "semantic_target": 200,
               "entity_role": 80, "field_type": 40, "format": 80, "group_key": 120}
    for column, length in lengths.items():
        op.alter_column("form_fields", column, type_=sa.String(length), existing_nullable=column in {"format", "group_key"})
