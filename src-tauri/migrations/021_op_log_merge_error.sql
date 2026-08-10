ALTER TABLE op_log ADD COLUMN merge_error TEXT;
CREATE INDEX op_log_merge_error ON op_log(merge_error) WHERE merge_error IS NOT NULL;
