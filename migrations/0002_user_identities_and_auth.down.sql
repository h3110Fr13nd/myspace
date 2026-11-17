-- Migration: 0002_user_identities_and_auth.down.sql
-- Description: Revert user identities table

DROP TABLE IF EXISTS user_identities CASCADE;
