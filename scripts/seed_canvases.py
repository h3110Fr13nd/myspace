#!/usr/bin/env python3
"""
seed_canvases.py
Registers all .canvas files in content/public_vault/canvas/ into the PostgreSQL resources table
with type = 'canvas', storing full canvasData in JSONB metadata, and granting viewer access.
"""

import glob
import json
import os
from pathlib import Path
import psycopg2
from psycopg2.extras import Json

DB_URI = os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5435/workspace_db")
CANVAS_DIR = Path("content/public_vault/canvas")

def main():
    conn = psycopg2.connect(DB_URI)
    conn.autocommit = True
    cur = conn.cursor()

    # 1. Ensure Canvas Folder Resource exists
    cur.execute("""
        INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
        VALUES ('folder:public_vault_canvas', 'folder', 'tenant:default', 'space:main', 'user:demo', 'space:main/folder:public_vault_canvas', 'Canvas Boards', '{"category": "canvas"}'::jsonb, true, false)
        ON CONFLICT (id) DO UPDATE SET updated_at = NOW();
    """)

    canvas_files = sorted(glob.glob(str(CANVAS_DIR / "*.canvas")))
    print(f"Found {len(canvas_files)} canvas files to seed into PostgreSQL.")

    for fpath in canvas_files:
        p = Path(fpath)
        slug = p.stem
        canvas_id = f"canvas:{slug}"

        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)

        title = data.get("title")
        if not title:
            # Check for header node text
            for n in data.get("nodes", []):
                if n.get("type") == "text" and n.get("text", "").startswith("#"):
                    title = n["text"].split("\n")[0].replace("#", "").strip()
                    break
        if not title:
            title = slug.replace("-", " ").replace("_", " ").title()

        nodes = data.get("nodes", [])
        edges = data.get("edges", [])

        # Extract summary from first text node
        summary = ""
        for n in nodes:
            if n.get("type") == "text" and n.get("text"):
                lines = [l for l in n["text"].split("\n") if l and not l.startswith("#")]
                if lines:
                    summary = lines[0][:200]
                    break
        if not summary:
            summary = f"Interactive spatial canvas board with {len(nodes)} nodes and {len(edges)} connections."

        # Wikilinks from resourceId nodes
        wikilinks = [n["resourceId"] for n in nodes if n.get("resourceId")]

        metadata = {
            "slug": slug,
            "category": "canvas",
            "entityType": "canvas",
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "summary": summary,
            "filePath": f"/app/content/public_vault/canvas/{p.name}",
            "canvasData": data,
            "wikilinks": wikilinks,
        }

        path_val = f"space:main/folder:public_vault_canvas/{canvas_id}"

        cur.execute("""
            INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata, is_public, is_draft)
            VALUES (%s, 'canvas', 'tenant:default', 'folder:public_vault_canvas', 'user:demo', %s, %s, %s, true, false)
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                parent_id = EXCLUDED.parent_id,
                metadata = EXCLUDED.metadata,
                is_public = EXCLUDED.is_public,
                is_draft = EXCLUDED.is_draft,
                updated_at = NOW();
        """, (canvas_id, path_val, title, Json(metadata)))

        print(f"  ✓ Seeded {canvas_id} ('{title}') - {len(nodes)} nodes, {len(edges)} edges")

    cur.close()
    conn.close()
    print("\n🎉 All canvases successfully seeded into database!")

if __name__ == "__main__":
    main()

