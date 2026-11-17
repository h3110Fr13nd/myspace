# 04 - Canvas, Sheets, Forms & Node Access Control

**Module**: 04 Canvas, Sheets, Forms & Node Access Control  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Spatial JSON Canvas Specification & Extending Nodes

The canvas system is built on the **JSON Canvas specification** (MIT License), an open JSON-based format for spatial data consisting of `nodes` and `edges`.

### Node-Level Resource Identifiers
To enforce per-node authorization without breaking JSON Canvas spec validity, custom metadata attributes are attached to individual nodes:

```json
{
  "nodes": [
    {
      "id": "n_node_101",
      "x": 100,
      "y": 200,
      "width": 400,
      "height": 300,
      "type": "group",
      "label": "Financial Analysis Q3",
      "resourceId": "sheet:q3_sheet_id",
      "resourceType": "sheet"
    },
    {
      "id": "n_node_102",
      "x": 550,
      "y": 200,
      "width": 350,
      "height": 450,
      "type": "file",
      "file": "vault/forms/feedback_form.json",
      "resourceId": "form:feedback_form_id",
      "resourceType": "form"
    }
  ],
  "edges": [
    {
      "id": "e_edge_1",
      "fromNode": "n_node_101",
      "toNode": "n_node_102",
      "label": "feeds into"
    }
  ]
}
```

---

## 2. Embedded Interactive Components

### 2.1 Spreadsheets / Sheets Nodes (FortuneSheet / Luckysheet)
- **Component**: **FortuneSheet** (MIT License, open-source descendant of Luckysheet).
- **Functionality**: Full-featured data grid rendering inside canvas nodes or dedicated sheet views (formulas, cell formatting, multi-sheet tabs).
- **Access Enforcement**: Server filters cell values or entire sheets before streaming JSON data to client components based on `check(user, 'viewer', sheet_id)`.

### 2.2 Dynamic Forms Nodes (`@rjsf/core`)
- **Component**: **React JSON Schema Form (`@rjsf/core`)** (Apache-2.0).
- **Functionality**: Generates dynamic input forms, surveys, or data entry interfaces derived from standard JSON Schema definitions.
- **Access Enforcement**: Separate permissions for form viewing (`viewer`), form editing/schema modification (`editor`), and form response submission (`submitter`).

---

## 3. Server-Side Filtering Rule

> **CRITICAL RULE**: Never perform authorization filtering by hiding elements via CSS or client-side Javascript conditionals. If a canvas node or sheet is restricted for `user:bob`, the Astro SSR payload **must completely strip that node's data** from the server response payload.

---

## 4. Pivot Notice & Alternatives Matrix

### Pivot Option A: Canvas Editor Engine — React Flow vs. Custom Canvas Renderer
- **When to Pivot**: If freeform infinite drawing, connector routing, and diagramming mechanics require established DAG node engines.
- **Alternatives**:
  1. **React Flow** (MIT): Outstanding developer experience for node-based workflows and DAG diagrams.
  2. **tldraw Open-Source Core** (Apache-2.0 / Custom): If freehand whiteboard drawing is the primary canvas requirement.
- **Migration Cost**: Low to Moderate.

### Pivot Option B: Spreadsheet Engine — Univer / Handsontable FOSS
- **When to Pivot**: If enterprise formulas, pivot tables, or multi-user collaborative cell cursors are needed.
- **Alternatives**:
  1. **Univer** (Apache-2.0): Modern, modular architecture supporting Docs, Sheets, and Slides in one engine.
  2. **Handsontable (Community Edition)**: Extremely battle-tested grid control.
- **Migration Cost**: Moderate.

---

## 5. Next Steps & References
- Review local Docker deployment in [05 Local Docker Environment](05_local_docker_environment.md).
- Review Production deployment in [06 Production Deployment & DevOps](06_production_deployment_and_devops.md).
