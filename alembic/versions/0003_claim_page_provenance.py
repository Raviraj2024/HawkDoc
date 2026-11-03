"""Use document and page provenance for extracted claims."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_claim_page_provenance"
down_revision = "0002_expand_form_field_text"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("extracted_claims", "bbox_norm", existing_type=postgresql.JSONB(), nullable=True)


def downgrade():
    op.execute("UPDATE extracted_claims SET bbox_norm = '[0,0,1,1]'::jsonb WHERE bbox_norm IS NULL")
    op.alter_column("extracted_claims", "bbox_norm", existing_type=postgresql.JSONB(), nullable=False)
