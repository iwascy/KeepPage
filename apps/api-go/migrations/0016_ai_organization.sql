CREATE TABLE ai_provider_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  model VARCHAR(120) NOT NULL,
  connection_status VARCHAR(24) NOT NULL DEFAULT 'unverified',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_organization_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  updated_items INTEGER NOT NULL DEFAULT 0,
  unchanged_items INTEGER NOT NULL DEFAULT 0,
  low_confidence_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  folder_updated_items INTEGER NOT NULL DEFAULT 0,
  tags_updated_items INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(80),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_organization_jobs_user_created_idx
ON ai_organization_jobs(user_id, created_at DESC);

CREATE UNIQUE INDEX ai_organization_jobs_user_active_idx
ON ai_organization_jobs(user_id)
WHERE status IN ('queued', 'classifying', 'applying');

CREATE TABLE ai_organization_job_items (
  job_id UUID NOT NULL REFERENCES ai_organization_jobs(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL,
  bookmark_updated_at_snapshot TIMESTAMPTZ NOT NULL,
  title_snapshot TEXT NOT NULL,
  site_snapshot VARCHAR(255) NOT NULL,
  source_folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  target_folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  source_tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION,
  status VARCHAR(32) NOT NULL,
  error_code VARCHAR(80),
  PRIMARY KEY (job_id, bookmark_id)
);

CREATE INDEX ai_organization_job_items_status_idx
ON ai_organization_job_items(job_id, status);
