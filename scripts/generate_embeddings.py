import os
import json
import psycopg2
from fastembed import TextEmbedding

DB_HOST = os.getenv("PGHOST", "localhost")
DB_PORT = int(os.getenv("PGPORT", "5435"))
DB_USER = os.getenv("PGUSER", "postgres")
DB_PASS = os.getenv("PGPASSWORD", "postgres")
DB_NAME = os.getenv("PGDATABASE", "workspace_db")

def main():
    print("Loading fast ONNX-based embedding model 'BAAI/bge-small-en-v1.5' (384 dims)...")
    model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")

    print(f"Connecting to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}...")
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME
    )
    cur = conn.cursor()

    print("Fetching text resources (papers, blogs, documents)...")
    cur.execute(
        """
        SELECT id, type, title, metadata
        FROM resources
        WHERE type IN ('paper', 'blog', 'document', 'canvas');
        """
    )
    rows = cur.fetchall()
    print(f"Found {len(rows)} text resources to vectorize.")

    total_embedded = 0
    batch_size = 32

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = []
        ids = []

        for r_id, r_type, title, metadata in batch:
            meta = metadata if isinstance(metadata, dict) else (json.loads(metadata) if metadata else {})
            
            summary = meta.get("summary") or meta.get("description") or meta.get("abstract") or ""
            tags = meta.get("tags") or []
            if isinstance(tags, list):
                tags_str = " ".join(tags)
            else:
                tags_str = str(tags)
            
            takeaways = meta.get("takeaways") or []
            if isinstance(takeaways, list):
                takeaways_str = " ".join(takeaways)
            else:
                takeaways_str = str(takeaways)

            composite_text = f"{title}. {summary} {tags_str} {takeaways_str}".strip()
            texts.append(composite_text)
            ids.append(r_id)

        embeddings = list(model.embed(texts))

        for r_id, emb in zip(ids, embeddings):
            emb_list = emb.tolist()
            cur.execute(
                """
                INSERT INTO resource_embeddings (resource_id, embedding, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (resource_id) DO UPDATE SET
                    embedding = EXCLUDED.embedding,
                    updated_at = CURRENT_TIMESTAMP;
                """,
                (r_id, emb_list)
            )
            total_embedded += 1

        conn.commit()
        print(f"Vectorized {total_embedded}/{len(rows)} resources...")

    cur.close()
    conn.close()
    print(f"✓ Completed! Successfully stored {total_embedded} vector embeddings in PostgreSQL.")

if __name__ == "__main__":
    main()

