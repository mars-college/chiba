# cable3 Ingestion Spec (v0)

Status: draft implementation target.

This document defines deterministic ingestion behavior for `cable3` control-plane.

## Goals

- Accept external media sources without ad-hoc/manual DB edits.
- Persist imported assets to NAS-backed storage.
- Emit typed resource records (`media`, optional `playlist`) in control DB.
- Provide predictable constraints and error responses.

## Storage

- Base share root: `SHARE_ROOT` environment variable.
- Asset root path: `${SHARE_ROOT}/chiba-cable/assets`.
- Thumbnail root path: `${SHARE_ROOT}/chiba-cable/assets/.thumbs`.
- If `SHARE_ROOT` is unset, implementation may use a local default for development.
- Optional object backend:
  - `CHIBA3_THUMBNAIL_BACKEND=minio`
  - thumbnails are uploaded to `CHIBA3_S3_BUCKET` and media rows store both
    `thumbnailUrl` and `thumbnailObjectKey`.

## API Surface

Base: `/api/v1/ingest`

1) `POST /api/v1/ingest/upload`
- Content-Type: `multipart/form-data`
- Inputs:
  - `files`: up to 20 media files (non-zip path)
  - OR a single zip archive (`archive` or `files` entry ending in `.zip`)
- Constraints:
  - max request body size: 2GB
  - when non-zip upload is used, reject `files.length > 20`
  - zip mode may contain any number of supported media files
- Behavior:
  - write ingested media files to asset root
  - detect media kind by extension/mime (image/video/audio)
  - generate thumbnails for image/video where feasible
  - upsert imported media into control DB
- Response:
  - `ok`, counts, imported media IDs, warnings

2) `POST /api/v1/ingest/youtube`
- Body:
  - `url` (required)
  - optional `title`, `artist`, `mediaId`, `cache`
- Behavior:
  - download with `yt-dlp` into asset root
  - create/update one media resource with `sourceType=path`
  - optional thumbnail generation (best effort)
- Response:
  - `ok`, imported media record metadata

3) `POST /api/v1/ingest/eden-collection`
- Body:
  - `collectionId` or `url` (required)
  - optional `db` (`PROD|STAGE`)
  - optional `playlistId`
- Behavior:
  - fetch collection creations from Eden API
  - ingest creation media into asset root where feasible
  - upsert media resources
  - generate/update playlist resource for the collection
- Response:
  - `ok`, media count, playlist id, warnings

4) `GET /api/v1/assets/thumbs/:filename`
- Serves thumbnail files for UI previews.

5) Queued ingestion endpoints
- `POST /api/v1/ingest/jobs/upload`
- `POST /api/v1/ingest/jobs/youtube`
- `POST /api/v1/ingest/jobs/eden-collection`
- `GET /api/v1/ingest/jobs`
- `GET /api/v1/ingest/jobs/:jobId`
- Job states: `queued` -> `running` -> `succeeded|failed`
- Job payload includes progress (`current`, `total`, `percent`, optional `message`)
  and terminal `result`/`error`.

## DB/Contracts Expectations

- `media` resources include optional `thumbnailUrl`.
- `media` resources include optional `thumbnailObjectKey`.
- Upload/youtube/eden ingest all emit records compatible with `ResourceSnapshot`.

## Determinism Rules

- Deterministic media IDs when not provided:
  - derived from stable hash of source identity.
- Deterministic output ordering:
  - preserve ingestion order; sort extracted zip file paths lexicographically.
- Deterministic constraints:
  - hard reject when limits are exceeded (no partial acceptance on invalid request shape).

## Error Model

- `400` invalid request shape.
- `413` payload too large or file-count limit exceeded.
- `422` unsupported media input.
- `502` upstream source failure (Eden/YouTube fetch).
- `500` unexpected ingestion failure.
