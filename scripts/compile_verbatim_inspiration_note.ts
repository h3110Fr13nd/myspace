import * as fs from 'fs';
import * as path from 'path';

const DEMO_DIR = path.join(process.cwd(), 'inspiration', 'research-article-template', 'app', 'src', 'content', 'chapters', 'demo');
const TARGET_FILE = path.join(process.cwd(), 'content', 'user_demo', '01_agentic_ai_systems', 'scientific-writing-research-template-inspiration.md');

const CHAPTER_FILES = [
  'introduction.mdx',
  'built-with-this.mdx',
  'getting-started.mdx',
  'writing-your-content.mdx',
  'markdown.mdx',
  'components.mdx',
  'vibe-coding-charts.mdx',
  'import-content.mdx',
  'best-practices.mdx',
  'greetings.mdx',
];

async function main() {
  console.log(`[Compile Verbatim Inspiration Note] Reading all 10 demo chapters...`);
  
  let fullBody = `---
title: "Bringing paper to life: A modern template for scientific writing"
date: "2026-08-11"
author: "demo"
category: "Agentic AI Systems"
tags: ["research", "template", "scientific-writing", "distill"]
summary: "Publish-ready workflow that lets you focus on ideas, not infrastructure. Grounded in modern web dev practices favoring interactive explanations."
wikilinks: ["agentic-ai-edge-cloud-continuum","multi-agent-fog-broker-coordination"]
---

# Bringing paper to life: A modern template for scientific writing

`;

  for (const file of CHAPTER_FILES) {
    const filePath = path.join(DEMO_DIR, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      // Strip imports from top
      content = content.replace(/^import\s+.*?;?\r?\n/gm, '').trim();
      fullBody += content + '\n\n---\n\n';
      console.log(`+ Added chapter: ${file}`);
    } else {
      console.warn(`File not found: ${filePath}`);
    }
  }

  fs.writeFileSync(TARGET_FILE, fullBody.trim() + '\n', 'utf-8');
  console.log(`✓ Successfully written all 10 demo chapters verbatim to ${TARGET_FILE}!`);
}

main();
