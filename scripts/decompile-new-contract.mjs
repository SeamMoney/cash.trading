#!/usr/bin/env node
/**
 * Decompile Decibel v3 contract (Jan 21, 2026)
 * New address: 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const CONTRACT_ADDRESS = '0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88';
const OUTPUT_DIR = join(process.cwd(), 'decompiled_contracts/v3_jan21_2026');
const BYTECODE_DIR = join(OUTPUT_DIR, 'bytecode');
const SOURCE_DIR = join(OUTPUT_DIR, 'source');

// Create directories
[OUTPUT_DIR, BYTECODE_DIR, SOURCE_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

async function main() {
  console.log('Fetching modules from:', CONTRACT_ADDRESS);

  // Fetch modules from Aptos API
  const response = await fetch(`https://api.testnet.aptoslabs.com/v1/accounts/${CONTRACT_ADDRESS}/modules`);
  const modulesJson = await response.json();
  console.log(`Found ${modulesJson.length} modules`);

  for (const mod of modulesJson) {
    const name = mod.abi.name;
    const bytecode = mod.bytecode;

    // Remove '0x' prefix and convert to binary
    const bytecodeHex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
    const bytecodeBuffer = Buffer.from(bytecodeHex, 'hex');

    // Write bytecode to file
    const bytecodePath = join(BYTECODE_DIR, `${name}.mv`);
    writeFileSync(bytecodePath, bytecodeBuffer);

    // Decompile with revela (outputs to stdout, redirect to file)
    const outputPath = join(SOURCE_DIR, `${name}.move`);
    try {
      const output = execSync(`revela -b "${bytecodePath}"`, { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
      writeFileSync(outputPath, output);
      console.log(`✓ Decompiled: ${name}`);
    } catch (err) {
      console.error(`✗ Failed: ${name}`, err.message);
    }
  }

  console.log('\nDone! Output in:', SOURCE_DIR);
}

main().catch(console.error);
