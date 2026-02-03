#!/usr/bin/env node
/**
 * Decibel Documentation Scraper v3
 * Scrapes all pages from docs.decibel.trade sitemap
 * Preserves mermaid diagrams, code examples, and full content
 *
 * Created: Feb 3, 2026
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

const OUTPUT_DIR = './docs/decibel-docs-v3';
const SITEMAP_URL = 'https://docs.decibel.trade/sitemap.xml';
const RATE_LIMIT_MS = 300;

// Configure turndown for better markdown conversion
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Preserve code blocks
turndown.addRule('codeBlocks', {
  filter: ['pre', 'code'],
  replacement: function(content, node) {
    if (node.nodeName === 'PRE') {
      const code = node.querySelector('code');
      const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
      const text = code?.textContent || node.textContent;
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }
    if (node.parentNode?.nodeName === 'PRE') return content;
    return `\`${content}\``;
  }
});

// Preserve mermaid diagrams
turndown.addRule('mermaid', {
  filter: function(node) {
    return node.className?.includes('mermaid') ||
           node.getAttribute?.('data-mermaid') ||
           node.querySelector?.('.mermaid');
  },
  replacement: function(content, node) {
    const mermaidContent = node.textContent || content;
    return `\n\`\`\`mermaid\n${mermaidContent.trim()}\n\`\`\`\n`;
  }
});

async function fetchSitemap() {
  console.log('Fetching sitemap...');
  const response = await fetch(SITEMAP_URL);
  const xml = await response.text();
  const urls = xml.match(/<loc>([^<]+)<\/loc>/g)?.map(m => m.replace(/<\/?loc>/g, '')) || [];
  console.log(`Found ${urls.length} pages`);
  return urls;
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DocScraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    if (!response.ok) {
      console.error(`  Failed: ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return null;
  }
}

function extractContent(html, url) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Get page title
  const title = doc.querySelector('h1')?.textContent ||
                doc.querySelector('title')?.textContent?.split('|')[0]?.trim() ||
                'Untitled';

  // Find main content area (try various selectors)
  const mainContent = doc.querySelector('main') ||
                      doc.querySelector('article') ||
                      doc.querySelector('.docs-content') ||
                      doc.querySelector('[class*="content"]') ||
                      doc.body;

  // Remove navigation, headers, footers
  mainContent.querySelectorAll('nav, header, footer, [class*="sidebar"], [class*="nav"]').forEach(el => el.remove());

  // Extract mermaid diagrams before conversion
  const mermaidDiagrams = [];
  mainContent.querySelectorAll('.mermaid, [data-mermaid], pre.mermaid').forEach((el, i) => {
    const placeholder = `__MERMAID_${i}__`;
    mermaidDiagrams.push({ placeholder, content: el.textContent });
    el.textContent = placeholder;
  });

  // Convert to markdown
  let markdown = turndown.turndown(mainContent.innerHTML);

  // Restore mermaid diagrams
  mermaidDiagrams.forEach(({ placeholder, content }) => {
    markdown = markdown.replace(placeholder, `\`\`\`mermaid\n${content.trim()}\n\`\`\``);
  });

  // Clean up
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/gm, '')
    .trim();

  return { title, markdown, url };
}

function urlToFilePath(url) {
  const path = new URL(url).pathname;
  if (path === '/' || path === '') return 'index.md';

  // Convert URL path to file path
  let filePath = path
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/[^a-zA-Z0-9\/\-_]/g, '-');

  return filePath + '.md';
}

async function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function savePage(content, url) {
  const filePath = join(OUTPUT_DIR, urlToFilePath(url));
  await ensureDir(filePath);

  const header = `---
title: "${content.title}"
url: "${url}"
scraped: "${new Date().toISOString()}"
---

# ${content.title}

`;

  await writeFile(filePath, header + content.markdown);
  return filePath;
}

async function createIndex(pages) {
  const indexContent = `# Decibel Documentation Index

Scraped: ${new Date().toISOString()}
Total Pages: ${pages.length}

## Pages by Section

${pages.map(p => `- [${p.title}](${urlToFilePath(p.url).replace('.md', '')})`).join('\n')}
`;

  await writeFile(join(OUTPUT_DIR, '_INDEX.md'), indexContent);
}

async function main() {
  console.log('=== Decibel Docs Scraper v3 ===\n');

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  // Fetch sitemap
  const urls = await fetchSitemap();

  // Scrape each page
  const pages = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);

    const html = await fetchPage(url);
    if (html) {
      const content = extractContent(html, url);
      const filePath = await savePage(content, url);
      pages.push({ ...content, filePath });
      console.log(`  -> ${filePath}`);
    }

    // Rate limit
    if (i < urls.length - 1) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  // Create index
  await createIndex(pages);
  console.log(`\nCreated index with ${pages.length} pages`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total pages scraped: ${pages.length}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log('Done!');
}

main().catch(console.error);
