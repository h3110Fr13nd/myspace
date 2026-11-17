-- 0008 down: first-class service principals

DROP TABLE IF EXISTS service_account_principals;
DROP TABLE IF EXISTS service_accounts;
DROP INDEX IF EXISTS idx_sa_principals_principal;
DROP INDEX IF EXISTS idx_service_accounts_kind;
