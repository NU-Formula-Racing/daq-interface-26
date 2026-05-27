-- Migration 0011 promoted signal_definitions.id from SMALLINT to INTEGER,
-- but ALTER TABLE ... ALTER COLUMN TYPE doesn't widen the underlying
-- sequence — `signal_definitions_id_seq` is still capped at SMALLINT max
-- (32767). Once we hit that ceiling new imports fail with:
--   psycopg.errors.SequenceGeneratorLimitExceeded: nextval: reached
--   maximum value of sequence "signal_definitions_id_seq" (32767)
--
-- Widen the sequence to match the column.

ALTER SEQUENCE signal_definitions_id_seq AS INTEGER MAXVALUE 2147483647;
