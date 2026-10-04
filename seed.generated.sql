

INSERT INTO registry_meta(key,value,updated_at) VALUES
('certified_sources','0',CURRENT_TIMESTAMP),
('certified_unique_hosts','0',CURRENT_TIMESTAMP),
('institutional_registry_ready','1',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;
