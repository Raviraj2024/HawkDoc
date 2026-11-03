"""Add template intake questions and fill answers."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_intake_questions"
down_revision = "0003_claim_page_provenance"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("form_templates", sa.Column("intake_questions", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.add_column("fill_sessions", sa.Column("intake_answers", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))


def downgrade():
    op.drop_column("fill_sessions", "intake_answers")
    op.drop_column("form_templates", "intake_questions")
