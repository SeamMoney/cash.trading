#!/usr/bin/env node

/**
 * Decibel Documentation Scraper
 *
 * Recursively scrapes all documentation from https://docs.decibel.trade
 * and saves to markdown files organized by section.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://docs.decibel.trade';
const OUTPUT_DIR = path.join(__dirname, 'docs', 'decibel-api-reference');

// Known documentation sections from the sidebar
const DOC_SECTIONS = [
  // Main sections
  '',  // Welcome/home
  'quick-start',
  'architecture',
  'typescript-sdk',

  // REST APIs
  'api-reference/rest',
  'api-reference/rest/transactions',

  // WebSocket APIs
  'api-reference/websockets',
  'api-reference/websockets/account-overview',
  'api-reference/websockets/userswithpositions',
  'api-reference/websockets/bulk-order-fills',
  'api-reference/websockets/bulk-orders',
  'api-reference/websockets/market-trades',
  'api-reference/websockets/user-positions',
  'api-reference/websockets/order-update',
  'api-reference/websockets/user-order-history',
  'api-reference/websockets/user-trades',
  'api-reference/websockets/user-open-orders',
  'api-reference/websockets/all-market-prices',
  'api-reference/websockets/notifications',
  'api-reference/websockets/market-depth',
  'api-reference/websockets/market-price',
  'api-reference/websockets/user-funding-rate-history',
  'api-reference/websockets/user-trade-history',
  'api-reference/websockets/user-active-twaps',
  'api-reference/websockets/market-candlestick',
];

// Additional REST API endpoints to try
const REST_ENDPOINTS = [
  'api-reference/rest/markets',
  'api-reference/rest/orderbook',
  'api-reference/rest/trades',
  'api-reference/rest/orders',
  'api-reference/rest/positions',
  'api-reference/rest/account',
  'api-reference/rest/funding',
  'api-reference/rest/candles',
  'api-reference/rest/ticker',
  'api-reference/rest/stats',
];

// Combine all sections
const ALL_SECTIONS = [...new Set([...DOC_SECTIONS, ...REST_ENDPOINTS])];

// Rate limiting
const DELAY_MS = 500; // 500ms between requests to be polite

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Convert HTML to Markdown (basic conversion)
 */
function htmlToMarkdown(html, url) {
  let markdown = html;

  // Remove script tags
  markdown = markdown.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags
  markdown = markdown.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML comments
  markdown = markdown.replace(/<!--[\s\S]*?-->/g, '');

  // Convert headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // Convert code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*class="language-(\w+)"[^>]*>(.*?)<\/code><\/pre>/gis, '```$1\n$2\n```\n\n');
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '```\n$1\n```\n\n');
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // Convert links
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Convert bold and italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Convert tables
  markdown = markdown.replace(/<table[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/table>/gi, '\n');
  markdown = markdown.replace(/<thead[^>]*>/gi, '');
  markdown = markdown.replace(/<\/thead>/gi, '');
  markdown = markdown.replace(/<tbody[^>]*>/gi, '');
  markdown = markdown.replace(/<\/tbody>/gi, '');
  markdown = markdown.replace(/<tr[^>]*>/gi, '');
  markdown = markdown.replace(/<\/tr>/gi, '\n');
  markdown = markdown.replace(/<th[^>]*>(.*?)<\/th>/gi, '| $1 ');
  markdown = markdown.replace(/<td[^>]*>(.*?)<\/td>/gi, '| $1 ');

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&apos;/g, "'");
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&amp;/g, '&');

  // Clean up whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();

  // Add metadata header
  const header = `---
source: ${url}
scraped: ${new Date().toISOString()}
---

`;

  return header + markdown;
}

/**
 * Fetch a single page
 */
async function fetchPage(section) {
  const url = section ? `${BASE_URL}/${section}` : BASE_URL;

  console.log(`📄 Fetching: ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`   ⚠️  Status ${response.status} - skipping`);
      return null;
    }

    const html = await response.text();

    // Convert to markdown
    const markdown = htmlToMarkdown(html, url);

    if (markdown.length < 100) {
      console.log(`   ⚠️  Too short (${markdown.length} chars) - might be empty`);
      return null;
    }

    console.log(`   ✅ Fetched ${markdown.length} chars`);
    return markdown;

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Save markdown to file
 */
function saveMarkdown(section, content) {
  const filename = section
    ? section.replace(/\//g, '_') + '.md'
    : 'index.md';

  const filepath = path.join(OUTPUT_DIR, filename);

  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(filepath, content, 'utf-8');

  console.log(`   💾 Saved to: ${filename}`);
}

/**
 * Main scraper function
 */
async function scrapeAll() {
  console.log('🚀 Decibel Documentation Scraper\n');
  console.log(`📂 Output directory: ${OUTPUT_DIR}\n`);

  ensureDir(OUTPUT_DIR);

  let successCount = 0;
  let failCount = 0;

  for (const section of ALL_SECTIONS) {
    const content = await fetchPage(section);

    if (content) {
      saveMarkdown(section, content);
      successCount++;
    } else {
      failCount++;
    }

    // Rate limiting - be polite to the server
    await delay(DELAY_MS);
  }

  console.log('\n📊 Summary:');
  console.log(`   ✅ Success: ${successCount} pages`);
  console.log(`   ❌ Failed: ${failCount} pages`);
  console.log(`   📁 Saved to: ${OUTPUT_DIR}`);

  // Create index file
  createIndexFile(successCount, failCount);
}

/**
 * Create index file with all scraped pages
 */
function createIndexFile(successCount, failCount) {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.md') && f !== 'INDEX.md')
    .sort();

  let index = `# Decibel API Documentation

**Scraped**: ${new Date().toISOString()}
**Total Pages**: ${successCount}
**Failed**: ${failCount}

---

## Table of Contents

`;

  // Organize by section
  const sections = {
    'General': [],
    'REST APIs': [],
    'WebSocket APIs': [],
  };

  files.forEach(file => {
    const name = file.replace('.md', '').replace(/_/g, '/');
    if (file.includes('api-reference_rest')) {
      sections['REST APIs'].push(`- [${name}](./${file})`);
    } else if (file.includes('api-reference_websockets')) {
      sections['WebSocket APIs'].push(`- [${name}](./${file})`);
    } else {
      sections['General'].push(`- [${name}](./${file})`);
    }
  });

  Object.entries(sections).forEach(([section, items]) => {
    if (items.length > 0) {
      index += `\n### ${section}\n\n${items.join('\n')}\n`;
    }
  });

  index += `\n---

**Note**: This documentation was automatically scraped from https://docs.decibel.trade

For the most up-to-date information, always refer to the official documentation.
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'INDEX.md'), index, 'utf-8');
  console.log('\n📋 Created INDEX.md');
}

// Run the scraper
scrapeAll().catch(console.error);
