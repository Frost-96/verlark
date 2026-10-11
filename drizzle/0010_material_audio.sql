ALTER TABLE learning_content_version ADD COLUMN unreferenced_since timestamptz DEFAULT now();
ALTER TABLE learning_content_version ADD COLUMN audio_cleaned_at timestamptz;
CREATE TABLE learning_content_practice_reference (
  practice_id uuid PRIMARY KEY,
  content_version_id uuid NOT NULL REFERENCES learning_content_version(id)
);
CREATE INDEX content_reference_version_idx ON learning_content_practice_reference(content_version_id);
-- Infrastructure migration backfills references without a reverse business-module dependency.
INSERT INTO learning_content_practice_reference (practice_id, content_version_id)
SELECT id, content_version_id FROM practice WHERE deleted_at IS NULL;
UPDATE learning_content_version SET unreferenced_since = NULL
WHERE id IN (SELECT content_version_id FROM learning_content_practice_reference);

CREATE UNIQUE INDEX content_private_audio_reference_idx ON learning_content_version ((content->'privateAudio'->>'reference'));
ALTER TABLE learning_content_version ADD COLUMN audio_cleanup_token uuid;
ALTER TABLE learning_content_version ADD COLUMN audio_cleanup_lease_until timestamptz;
