-- Migration v2: First-Class Paper Resource Type & Universal Vector Store

-- 1. Add 'paper' to resource_type enum
ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'paper';

-- 2. Create Universal Vector Embeddings Table
CREATE TABLE IF NOT EXISTS resource_embeddings (
    resource_id VARCHAR(512) PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    embedding vector(384) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_resource_embeddings_hnsw 
ON resource_embeddings USING hnsw (embedding vector_cosine_ops);

-- 3. Add GIN Index on metadata for fast JSONB querying
CREATE INDEX IF NOT EXISTS idx_resources_metadata_gin 
ON resources USING gin (metadata jsonb_path_ops);

