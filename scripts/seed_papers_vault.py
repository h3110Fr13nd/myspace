import os
import json
import re
import psycopg2
from pathlib import Path

DB_HOST = os.getenv("PGHOST", "localhost")
DB_PORT = int(os.getenv("PGPORT", "5435"))
DB_USER = os.getenv("PGUSER", "postgres")
DB_PASS = os.getenv("PGPASSWORD", "postgres")
DB_NAME = os.getenv("PGDATABASE", "workspace_db")

RESEARCH_DIR = Path("content/public_vault/research")

def main():
    print(f"Connecting to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}...")
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME
    )
    cur = conn.cursor()

    owner_id = "user:demo"

    # 1. Research Root Folder
    root_folder_id = "folder:research_vault_root"
    cur.execute(
        """
        INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
        VALUES (%s, 'folder', 'tenant_default', NULL, %s, %s, 'Academic Research Vault', %s, true, false)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, is_public = true, is_draft = false;
        """,
        (root_folder_id, owner_id, root_folder_id, json.dumps({"isResearchRoot": True}))
    )

    subfolders = [
        ("folder:research_papers", "77 Research Papers", "papers", "paper"),
        ("folder:research_authors", "Authors Directory", "authors", "author"),
        ("folder:research_venues", "Venues & Journals", "venues", "venue"),
        ("folder:research_institutions", "Institutions & Labs", "institutions", "institution"),
        ("folder:research_tracks", "Research Tracks", "tracks", "track"),
        ("folder:research_methodologies", "Methodologies & Algorithms", "methodologies", "methodology"),
    ]

    total_inserted = 0

    for sf_id, sf_name, sf_dir, sf_type in subfolders:
        cur.execute(
            """
            INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
            VALUES (%s, 'folder', 'tenant_default', %s, %s, %s, %s, %s, true, false)
            ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, is_public = true, is_draft = false;
            """,
            (sf_id, root_folder_id, owner_id, f"{root_folder_id}/{sf_id}", sf_name, json.dumps({"category": sf_dir}))
        )

        target_dir = RESEARCH_DIR / sf_dir
        if not target_dir.exists():
            continue

        for file in target_dir.glob("*.md"):
            slug = file.stem
            resource_type = "paper" if sf_type == "paper" else "document"
            doc_id = f"paper:{slug}" if sf_type == "paper" else f"document:{slug}"
            doc_path = f"{root_folder_id}/{sf_id}/{doc_id}"

            raw_content = file.read_text(encoding="utf-8")

            title_match = re.search(r'title:\s*"(.*?)"', raw_content)
            title = title_match.group(1) if title_match else slug

            summary_match = re.search(r'summary:\s*"(.*?)"', raw_content)
            summary = summary_match.group(1) if summary_match else ""

            author_match = re.search(r'author:\s*"(.*?)"', raw_content)
            author = author_match.group(1) if author_match else ""

            venue_match = re.search(r'venue:\s*"(.*?)"', raw_content)
            venue = venue_match.group(1) if venue_match else ""

            doi_match = re.search(r'doi:\s*"(.*?)"', raw_content)
            doi = doi_match.group(1) if doi_match else ""

            tags_match = re.search(r'tags:\s*(\[.*?\])', raw_content, re.DOTALL)
            tags = []
            if tags_match:
                try:
                    tags = json.loads(tags_match.group(1).replace("'", '"'))
                except:
                    tags = []

            wikilinks = []
            wl_match = re.search(r"wikilinks:\s*(\[.*?\])", raw_content, re.DOTALL)
            if wl_match:
                try:
                    wikilinks = json.loads(wl_match.group(1).replace("'", '"'))
                except:
                    wikilinks = []

            meta = {
                "slug": slug,
                "wikilinks": wikilinks,
                "category": sf_dir,
                "entityType": sf_type,
                "filePath": str(file.resolve())
            }
            if summary:
                meta["summary"] = summary
            if author:
                meta["author"] = author
            if venue:
                meta["venue"] = venue
            if doi:
                meta["doi"] = doi
            if tags:
                meta["tags"] = tags

            cur.execute(
                """
                INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
                VALUES (%s, %s, 'tenant_default', %s, %s, %s, %s, %s, true, false)
                ON CONFLICT (id) DO UPDATE SET
                    type = EXCLUDED.type,
                    title = EXCLUDED.title,
                    metadata = EXCLUDED.metadata,
                    is_public = true,
                    is_draft = false;
                """,
                (doc_id, resource_type, sf_id, owner_id, doc_path, title, json.dumps(meta))
            )
            total_inserted += 1

    # Master Overview
    master_path = RESEARCH_DIR / "index.md"
    if master_path.exists():
        doc_id = "document:research-overview-index"
        master_meta = {
            "slug": "research-overview-index",
            "category": "research_overview",
            "filePath": str(master_path.resolve()),
            "wikilinks": [
                "track-1-foundational-overviews-surveys",
                "track-2-drl-workflow-scheduling",
                "track-5-computation-offloading-resource-allocation"
            ]
        }
        cur.execute(
            """
            INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
            VALUES (%s, 'document', 'tenant_default', %s, %s, %s, 'Academic Research Knowledge Graph — 77 Papers Synthesis Matrix', %s, true, false)
            ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, metadata = EXCLUDED.metadata, is_public = true, is_draft = false;
            """,
            (doc_id, root_folder_id, owner_id, f"{root_folder_id}/{doc_id}", json.dumps(master_meta))
        )
        total_inserted += 1

    conn.commit()
    cur.close()
    conn.close()
    print(f"✓ Successfully seeded {total_inserted} research entities into PostgreSQL!")

if __name__ == "__main__":
    main()
