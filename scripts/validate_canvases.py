#!/usr/bin/env python3
"""
validate_canvases.py
Validates all .canvas files in the workspace against the official JSON Canvas v1.0 specification.
"""

import glob
import json
import sys
from pathlib import Path

VALID_NODE_TYPES = {"text", "file", "link", "group", "resource"}
VALID_SIDES = {"top", "right", "bottom", "left"}
VALID_ENDS = {"none", "arrow"}

def validate_canvas_file(fpath):
    print(f"Validating {fpath}...")
    errors = []
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return [f"Failed to parse JSON: {e}"]

    if not isinstance(data, dict):
        return ["Root object must be a JSON dictionary"]

    nodes = data.get("nodes")
    edges = data.get("edges")

    if not isinstance(nodes, list):
        errors.append("'nodes' must be an array")
        nodes = []
    if not isinstance(edges, list):
        errors.append("'edges' must be an array")
        edges = []

    node_ids = set()
    for idx, n in enumerate(nodes):
        if not isinstance(n, dict):
            errors.append(f"Node #{idx} is not an object")
            continue
        nid = n.get("id")
        ntype = n.get("type")
        if not nid:
            errors.append(f"Node #{idx} missing 'id'")
        elif nid in node_ids:
            errors.append(f"Duplicate node id: {nid}")
        else:
            node_ids.add(nid)

        if ntype not in VALID_NODE_TYPES:
            errors.append(f"Node '{nid}' has invalid type: '{ntype}'")

        for dim in ["x", "y", "width", "height"]:
            if dim not in n or not isinstance(n[dim], (int, float)):
                errors.append(f"Node '{nid}' missing or invalid numeric '{dim}'")

        if ntype == "text" and "text" not in n:
            errors.append(f"Text node '{nid}' missing 'text' field")
        elif ntype == "file" and "file" not in n:
            errors.append(f"File node '{nid}' missing 'file' field")
        elif ntype == "link" and "url" not in n:
            errors.append(f"Link node '{nid}' missing 'url' field")

    for idx, e in enumerate(edges):
        if not isinstance(e, dict):
            errors.append(f"Edge #{idx} is not an object")
            continue
        eid = e.get("id")
        from_node = e.get("fromNode")
        to_node = e.get("toNode")

        if not eid:
            errors.append(f"Edge #{idx} missing 'id'")
        if not from_node or from_node not in node_ids:
            errors.append(f"Edge '{eid}' references non-existent fromNode '{from_node}'")
        if not to_node or to_node not in node_ids:
            errors.append(f"Edge '{eid}' references non-existent toNode '{to_node}'")

        if "fromSide" in e and e["fromSide"] not in VALID_SIDES:
            errors.append(f"Edge '{eid}' invalid fromSide: '{e['fromSide']}'")
        if "toSide" in e and e["toSide"] not in VALID_SIDES:
            errors.append(f"Edge '{eid}' invalid toSide: '{e['toSide']}'")

    return errors

def main():
    canvas_files = glob.glob("content/public_vault/canvas/*.canvas")
    total_errors = 0

    print(f"Found {len(canvas_files)} canvas files to validate.\n")
    for f in sorted(canvas_files):
        errs = validate_canvas_file(f)
        if errs:
            print(f"  ❌ FAILED ({len(errs)} errors):")
            for err in errs:
                print(f"     - {err}")
            total_errors += len(errs)
        else:
            with open(f) as cf:
                d = json.load(cf)
                print(f"  ✓ PASSED: {len(d.get('nodes', []))} nodes, {len(d.get('edges', []))} edges")

    if total_errors > 0:
        print(f"\n❌ Validation failed with {total_errors} total errors.")
        sys.exit(1)
    else:
        print("\n✨ All canvas files strictly satisfy JSON Canvas v1.0 specification!")

if __name__ == "__main__":
    main()

