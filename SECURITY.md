# Security Best Practices

## 🔐 Private Key Management

### CRITICAL: Never Commit Private Keys

**NEVER** commit private keys, mnemonics, or seed phrases to version control. This includes:

- ❌ Private keys in any format (`0x...`, `ed25519-priv-0x...`)
- ❌ Wallet seed phrases/mnemonics
- ❌ API keys or authentication tokens
- ❌ Environment variable files (`.env`, `.env.local`)
- ❌ Wallet keystore files

### Use Environment Variables

All sensitive data should be stored in environment variables:

```bash
# .env (NEVER commit this file!)
APTOS_PRIVATE_KEY="ed25519-priv-0x<YOUR_PRIVATE_KEY>"
```

See `.env.example` for a template of required environment variables.

### Testnet vs Mainnet

This project uses **Aptos Testnet** for development. Key differences:

- ✅ **Testnet**: Safe to experiment, funds have no real value
- ⚠️ **Mainnet**: Real funds at risk, requires production security practices

**If you deploy to mainnet:**
1. Never use the same private keys from testnet
2. Use a hardware wallet or secure key management service
3. Implement proper access controls and monitoring
4. Conduct security audits before handling significant funds

## 📁 Protected Files

The following file patterns are automatically ignored by `.gitignore`:

- `*.key`, `*.pem` - Key files
- `*private*key*` - Any files mentioning private keys
- `.env*` - Environment variable files
- `test_*.mjs`, `query_*.mjs` - Test scripts that may contain addresses
- `wallets/`, `.aptos/` - Wallet directories

## 🔒 Safe Coding Practices

### 1. Input Validation

Always validate user input, especially addresses:

```typescript
function isValidAptosAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(address);
}
```

### 2. Never Log Sensitive Data

```typescript
// ❌ BAD
console.log('Private key:', privateKey);

// ✅ GOOD
console.log('Wallet connected:', address);
```

### 3. Use Read-Only Operations When Possible

When displaying balances or data, use view functions that don't require signatures:

```typescript
// Read-only - no private key needed
const balance = await aptos.view({
  function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
  functionArguments: [subaccountAddress],
});
```

### 4. Verify Transactions Before Signing

Always show users what they're signing:

```typescript
// Display transaction details
console.log('You are about to sign:');
console.log('- Action: Place TWAP order');
console.log('- Size:', orderSize);
console.log('- Duration:', duration);

// Then sign
const signature = await wallet.signAndSubmitTransaction(txn);
```

## 🚨 What to Do If Keys Are Compromised

If you accidentally commit a private key or suspect it's been compromised:

1. **Immediately stop using that key**
2. **Transfer all funds** to a new wallet (if testnet, not critical)
3. **Rotate the key** - generate a new one
4. **Review git history** for the leaked key:
   ```bash
   git log --all --source --full-history -S "ed25519-priv"
   ```
5. **Consider rewriting git history** if mainnet keys were exposed:
   ```bash
   # Use with caution - rewrites history
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch path/to/file' \
     --prune-empty --tag-name-filter cat -- --all
   ```

## 📚 Additional Resources

- [Aptos Security Best Practices](https://aptos.dev/guides/security-best-practices)
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)

## 🐛 Reporting Security Issues

If you discover a security vulnerability in this project, please:

1. **Do NOT** open a public issue
2. Email the maintainer directly (see package.json for contact)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We take security seriously and will respond promptly to legitimate reports.

---

**Remember**: Security is a journey, not a destination. Stay vigilant! 🛡️
