# HawkDoc

HawkDoc is an AI-powered document intelligence workspace that turns uploaded evidence into completed, reviewable forms. It maps a blank PDF once, classifies supporting documents as a complete evidence set, extracts grounded values, links every answer to its source, and keeps human review in the loop when evidence is uncertain or conflicting.

## What HawkDoc does

```text
Blank PDF form -> Map fields -> Upload evidence -> Classify and extract
               -> Review exceptions -> Preview filled form -> Export with audit trail
```

- Discovers fillable areas in an uploaded PDF and lets a reviewer correct the mapping.
- Defines required document types, source policies, and optional pre-fill questions.
- Accepts PDF, PNG, and JPEG evidence, including bulk uploads.
- Classifies documents using the full uploaded evidence set as context.
- Builds a general field inventory for each document, then routes form fields in batches of 10 to only the most relevant sources.
- Preserves the source document, page, observed text, entity, and model reasoning behind extracted claims.
- Sends uncertain document types, unsupported fields, and material conflicts to a review queue instead of silently guessing.
- Supports manual corrections, document-type confirmation, filled-form preview, PDF export, and an append-only audit timeline.

## Technology

- **Frontend:** React, TypeScript, Vite, and Lucide icons
- **API:** FastAPI and Pydantic
- **Database:** PostgreSQL with SQLAlchemy and Alembic migrations
- **AI:** Meta Muse models through Baseten's OpenAI-compatible endpoint
- **Documents:** PyMuPDF and Pillow for PDF inspection, rendering, and export
- **Storage:** Private local storage for uploaded evidence and generated exports

## Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer
- A PostgreSQL database, such as a local instance or Supabase PostgreSQL
- A Baseten API key with access to the configured Muse text and vision models

## Local setup

### 1. Clone the repository

```bash
git clone https://github.com/Raviraj2024/HawkDoc.git
cd HawkDoc
```

### 2. Configure the backend

Create and activate a virtual environment:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

macOS or Linux:

```bash
source .venv/bin/activate
```

Install the Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Copy the environment template:

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS or Linux:

```bash
cp .env.example .env
```

Update the required values in `.env`:

```env
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/postgres
BASETEN_API_KEY=your_baseten_api_key
```

The remaining variables already have usable defaults:

| Variable | Purpose |
| --- | --- |
| `BASETEN_BASE_URL` | OpenAI-compatible Baseten endpoint |
| `MUSE_TEXT_MODEL` | Model used for classification, routing, and structured reasoning |
| `MUSE_VISION_MODEL` | Model used to inspect form and evidence pages |
| `STORAGE_ROOT` | Private upload and export directory |
| `MAX_UPLOAD_MB` | Maximum size of one uploaded file |
| `MAX_PDF_PAGES` | Maximum accepted PDF page count |
| `CORS_ORIGINS` | Frontend origins allowed to call the API |
| `ALLOW_DRAFT_EXPORT` | Allows clearly marked exports with unresolved review items |

Apply the database migrations:

```bash
alembic upgrade head
```

Start the API:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Useful backend URLs:

- Health check: `http://127.0.0.1:8000/api/health`
- Interactive API documentation: `http://127.0.0.1:8000/docs`

### 3. Configure the frontend

Open a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite development server proxies `/api` requests to the FastAPI server on port `8000`.

If PowerShell blocks `npm.ps1`, use the Windows executable directly:

```powershell
npm.cmd ci
npm.cmd run dev
```

## Suggested judge walkthrough

1. Open **Forms** and create a form template from a blank PDF.
2. Let HawkDoc detect its fields, review the boxes and semantic mappings, then configure required document types.
3. Confirm the template and open **Fill a form**.
4. Upload supporting PDFs or images individually or in bulk, then start evidence processing.
5. Inspect the **Review** queue. Confirm an uncertain document type, choose a supported claim, or enter a manual correction when needed.
6. Open **Filled form** to compare populated values with their source pages.
7. Open **Export & audit** to download the filled PDF and inspect the activity timeline.

HawkDoc does not create seed records or upload private sample documents. Judges can explore it with any blank PDF form and their own supporting PDF, PNG, or JPEG evidence.

## How evidence processing works

1. Each uploaded document is visually profiled without trusting its filename.
2. All document profiles are considered together and mapped to the template's exact document-type catalog.
3. Accepted documents receive a reusable inventory of visible fields, values, entity roles, and semantic context.
4. Mapped form fields are processed in batches of 10 and routed only to documents likely to contain the value in the correct context.
5. Targeted extraction creates source-backed claims; deterministic rules map compatible claims into the form.
6. Missing evidence, ambiguous entity links, policy-controlled fields, and genuine conflicts remain visible for human review.

Documents are treated as untrusted input in model prompts. Uploaded files remain under the private `storage/` directory, while page images are sent to the configured model endpoint during AI processing.

## Validation

Run the backend test suite from the project root:

```bash
python -m pytest -q
```

Build the frontend production bundle:

```bash
cd frontend
npm run build
```

## Project structure

```text
app/                 FastAPI routes, database models, schemas, and processing services
alembic/             PostgreSQL schema migrations
frontend/            React and TypeScript workspace
tests/               Backend unit tests for model normalization and processing rules
storage/             Runtime uploads and exports; ignored by Git
```

## Security and review guarantees

- Model responses are schema-validated before persistence.
- Document content is treated as data, never as model instructions.
- Automatic values retain evidence provenance and entity context.
- Uncertain document classifications require human confirmation before extraction.
- Manual corrections never rewrite the original extracted claim and are recorded in the audit trail.
- Material conflicts are surfaced for review rather than silently resolved.

## License

This project is available under the terms in [LICENSE](LICENSE).

