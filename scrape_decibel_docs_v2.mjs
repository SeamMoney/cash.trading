#!/usr/bin/env node

/**
 * Decibel Documentation Scraper V2
 *
 * Scrapes actual documentation content from correct URLs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://docs.decibel.trade';
const OUTPUT_DIR = path.join(__dirname, 'docs', 'decibel-complete');

// Actual documentation paths from navigation
const DOC_PATHS = [
  // Quick Start
  'quickstart/overview',
  'quickstart/api-reference',
  'quickstart/market-data',

  // Architecture
  'architecture/perps/perps-contract-overview',

  // TypeScript SDK
  'typescript-sdk/overview',
  'typescript-sdk/read-sdk',
  'typescript-sdk/write-sdk',

  // Transactions
  'transactions/overview',

  // REST API - User
  'api-reference/user/get-account-overview',
  'api-reference/user/get-active-twap-orders',
  'api-reference/user/get-delegations',
  'api-reference/user/get-user-funding-rate-history',
  'api-reference/user/get-users-open-orders',
  'api-reference/user/get-user-order-history',
  'api-reference/user/get-single-order-details',
  'api-reference/user/get-subaccounts',
  'api-reference/user/get-user-trade-history',
  'api-reference/user/get-twap-order-history',
  'api-reference/user/get-user-positions',

  // REST API - Market Data
  'api-reference/market-data/get-asset-contexts',
  'api-reference/market-data/get-candlestick-ohlc-data',
  'api-reference/market-data/get-order-book-depth',
  'api-reference/market-data/get-all-available-markets',
  'api-reference/market-data/get-market-prices',
  'api-reference/market-data/get-trades',

  // REST API - Bulk Orders
  'api-reference/bulk-orders/get-bulk-order-fills',
  'api-reference/bulk-orders/get-bulk-order-status',
  'api-reference/bulk-orders/get-bulk-orders',

  // REST API - Analytics
  'api-reference/analytics/get-leaderboard',
  'api-reference/analytics/get-portfolio-chart-data',

  // REST API - Vaults
  'api-reference/vaults/get-user-owned-vaults',
  'api-reference/vaults/get-user-vault-performance-for-all-vaults-where-user-has-deposits',
  'api-reference/vaults/get-public-vaults',

  // WebSocket APIs
  'api-reference/websockets/accountoverview',
  'api-reference/websockets/userswithpositions',
  'api-reference/websockets/bulkorderfills',
  'api-reference/websockets/bulkorders',
  'api-reference/websockets/markettrades',
  'api-reference/websockets/userpositions',
  'api-reference/websockets/orderupdate',
  'api-reference/websockets/userorderhistory',
  'api-reference/websockets/usertrades',
  'api-reference/websockets/useropenorders',
  'api-reference/websockets/allmarketprices',
  'api-reference/websockets/notifications',
  'api-reference/websockets/marketdepth',
  'api-reference/websockets/marketprice',
  'api-reference/websockets/userfundingratehistory',
  'api-reference/websockets/usertradehistory',
  'api-reference/websockets/useractivetwaps',
  'api-reference/websockets/marketcandlestick',
];

const DELAY_MS = 300;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Extract main content from HTML
 */
function extractContent(html, url) {
  // Try to find the main content area
  let content = html;

  // Remove everything before main content
  const mainMatch = content.match(/<main[^>]*>([\s\S]*)<\/main>/i);
  if (mainMatch) {
    content = mainMatch[1];
  } else {
    // Try article tag
    const articleMatch = content.match(/<article[^>]*>([\s\S]*)<\/article>/i);
    if (articleMatch) {
      content = articleMatch[1];
    }
  }

  // Convert to markdown
  let markdown = content;

  // Remove scripts, styles
  markdown = markdown.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  markdown = markdown.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  markdown = markdown.replace(/<!--[\s\S]*?-->/g, '');

  // Headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // Code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*class="language-(\w+)"[^>]*>(.*?)<\/code><\/pre>/gis, (match, lang, code) => {
    code = code.replace(/<[^>]*>/g, '');
    return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  });
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, (match, code) => {
    code = code.replace(/<[^>]*>/g, '');
    return `\`\`\`\n${code}\n\`\`\`\n\n`;
  });
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // Links
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Lists
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // Bold/Italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Tables
  markdown = markdown.replace(/<table[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/table>/gi, '\n');
  markdown = markdown.replace(/<tr[^>]*>/gi, '');
  markdown = markdown.replace(/<\/tr>/gi, '\n');
  markdown = markdown.replace(/<th[^>]*>(.*?)<\/th>/gi, '| $1 ');
  markdown = markdown.replace(/<td[^>]*>(.*?)<\/td>/gi, '| $1 ');

  // Line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining HTML
  markdown = markdown.replace(/<[^>]*>/g, '');

  // Decode entities
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&apos;/g, "'");
  markdown = markdown.replace(/&#x27;/g, "'");
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&amp;/g, '&');

  // Clean whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();

  // Add metadata
  const header = `---
source: ${url}
title: ${url.split('/').pop().replace(/-/g, ' ')}
scraped: ${new Date().toISOString()}
---

`;

  return header + markdown;
}

async function fetchPage(path) {
  const url = `${BASE_URL}/${path}`;
  console.log(`📄 ${path}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`   ❌ ${response.status}`);
      return null;
    }

    const html = await response.text();
    const markdown = extractContent(html, url);

    if (markdown.length < 200) {
      console.log(`   ⚠️  Too short (${markdown.length} chars)`);
      return null;
    }

    console.log(`   ✅ ${markdown.length} chars`);
    return markdown;

  } catch (error) {
    console.log(`   ❌ ${error.message}`);
    return null;
  }
}

function saveMarkdown(docPath, content) {
  const filename = docPath.replace(/\//g, '_') + '.md';
  const filepath = path.join(OUTPUT_DIR, filename);

  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log(`   💾 ${filename}`);
}

async function scrapeAll() {
  console.log('🚀 Decibel Docs Scraper V2\n');
  console.log(`Output: ${OUTPUT_DIR}\n`);

  ensureDir(OUTPUT_DIR);

  let success = 0;
  let failed = 0;

  for (const path of DOC_PATHS) {
    const content = await fetchPage(path);

    if (content) {
      saveMarkdown(path, content);
      success++;
    } else {
      failed++;
    }

    await delay(DELAY_MS);
  }

  console.log(`\n✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);

  // Create index
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  let index = `# Decibel API Documentation\n\nScraped: ${new Date().toISOString()}\nTotal: ${success} pages\n\n## Contents\n\n`;

  const sections = {};
  files.forEach(file => {
    const parts = file.replace('.md', '').split('_');
    const section = parts[0];
    if (!sections[section]) sections[section] = [];
    sections[section].push(file);
  });

  Object.entries(sections).forEach(([section, items]) => {
    index += `\n### ${section.toUpperCase()}\n\n`;
    items.forEach(file => {
      const name = file.replace('.md', '').replace(/_/g, ' / ');
      index += `- [${name}](./${file})\n`;
    });
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, '00_INDEX.md'), index);
  console.log('\n📋 Created index');
}

scrapeAll().catch(console.error);
