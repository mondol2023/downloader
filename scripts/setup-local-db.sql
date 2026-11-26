-- Run once as the postgres superuser:
--   psql -U postgres -h localhost -f scripts/setup-local-db.sql
-- The password must match DATABASE_URL in .env.
CREATE ROLE media WITH LOGIN PASSWORD 'media' CREATEDB;
CREATE DATABASE media_engine OWNER media;
