# Smart Form Template Mapper backend

FastAPI backend for the workflow specified in `Complete_PRD.md`. It persists templates, fields, requirements, fill sessions, evidence claims, resolved entities, review decisions, exports, and append-only audit events in Supabase PostgreSQL. No seed or demo data is created.

## Run

1. Put the Baseten key in `.env` as `BASETEN_API_KEY`.
2. Create a virtual environment and install `requirements.txt`.
3. Run `alembic upgrade head`.
4. Start with `uvicorn app.main:app --reload`.

OpenAPI is available at `/docs`. Uploaded files and exports are private local files under `storage/`; API downloads are served through explicit endpoints rather than a public static mount.

## Frontend

The React/TypeScript workspace is in `frontend/`.

1. Run the API on `http://127.0.0.1:8000`.
2. In `frontend/`, run `npm install` and `npm run dev`.
3. Open `http://127.0.0.1:5173`.

The Vite development server proxies `/api` to FastAPI. Run `npm run build` for a production bundle in `frontend/dist/`.

## Important behavior

- Model output is schema-validated before persistence.
- Documents are treated as untrusted data in model prompts.
- Claims retain page and normalized bounding-box provenance.
- Mapping requires attribute, entity role, source policy, and context compatibility.
- Material conflicts are never silently resolved.
- Manual overrides survive reprocessing and are recorded in the audit trail.
- Export defaults to allowing a clearly marked draft when unresolved issues remain; set `ALLOW_DRAFT_EXPORT=false` to block it.

