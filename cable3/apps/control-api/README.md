# cable3 control-api

Future control-plane API for cable3.

Initial responsibilities:
- desired state write/read
- manifest fetch by screen/revision
- apply operation status
- node runtime report ingest/query

## Ingestion Endpoints (v0)

- `POST /api/v1/ingest/upload`
  - `multipart/form-data`
  - accepts up to 20 media files OR one zip archive
- `POST /api/v1/ingest/youtube`
  - downloads via `yt-dlp`
  - default selector prefers Pi-safe H.264/AAC and caps to 720p
  - env overrides:
    - `CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT` (default `720`)
    - `CHIBA3_INGEST_YOUTUBE_FORMAT` (full `yt-dlp -f` override)
    - `CHIBA3_INGEST_YOUTUBE_TRANSCODE` (default `true`, force H.264/AAC output for Pi)
- `POST /api/v1/ingest/eden-collection`
  - imports Eden collection media + playlist
- `GET /api/v1/assets/thumbs/:fileName`
  - serves generated thumbnails

Queued ingestion endpoints:

- `POST /api/v1/ingest/jobs/upload`
- `POST /api/v1/ingest/jobs/youtube`
- `POST /api/v1/ingest/jobs/eden-collection`
- `GET /api/v1/ingest/jobs`
- `GET /api/v1/ingest/jobs/:jobId`

Node inventory endpoints (DB-backed):

- `GET /api/ops/nodes`
- `POST /api/ops/nodes`
- `PUT /api/ops/nodes/:nodeId`
- `DELETE /api/ops/nodes/:nodeId`
- `GET /api/ops/nodes/export?format=json|toml`
- `GET /api/ops/nodes/:nodeId/runtime-status`
- `GET /api/ops/nodes/:nodeId/cache`
- `DELETE /api/ops/nodes/:nodeId/cache`
- `POST /api/ops/nodes/:nodeId/input`
  - typed input passthrough proxy to node runtime (`/api/input`)
  - useful for interactive web channels on Linux nodes (`xdotool` backend)

Thumbnail/object storage backends:

- local filesystem (default)
- MinIO/S3 via env:
  - `CHIBA3_THUMBNAIL_BACKEND=minio`
  - `CHIBA3_S3_ENDPOINT_URL`
  - `CHIBA3_S3_BUCKET`
  - `CHIBA3_S3_ACCESS_KEY`
  - `CHIBA3_S3_SECRET_KEY`
  - optional `CHIBA3_S3_PUBLIC_BASE_URL`

See `cable3/docs/INGESTION_SPEC.md` for full behavior/limits.
