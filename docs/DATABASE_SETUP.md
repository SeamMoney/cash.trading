# Database Setup for Vercel Deployment

## Problem

The app is currently configured to use SQLite (`file:./dev.db`), which doesn't work on Vercel's serverless platform because:
- Vercel has a read-only filesystem
- Each serverless function gets a fresh container
- SQLite requires a writable file

## FASTEST Solution: Vercel Postgres (2 minutes)

### Quick Steps:

1. Go to https://vercel.com/zionbet/decibrrr
2. Click the "Storage" tab
3. Click "Create Database"
4. Select "Postgres"
5. Click "Continue" (keep default settings)
6. **Important**: Check the box "Connect to project: decibrrr"
7. Click "Create & Continue"

That's it! Vercel automatically:
- Creates the database
- Sets the `DATABASE_URL` environment variable
- Connects it to your project
- Runs the migration on next deployment

### Alternative Options (if you prefer):

#### Option 1: Neon (Free Tier)
1. Go to https://neon.tech
2. Sign up and create a project
3. Copy connection string
4. Run: `vercel env add DATABASE_URL production`
5. Paste the connection string

#### Option 2: Supabase (Free Tier)
1. Go to https://supabase.com
2. Create project
3. Settings > Database > Connection Pooling
4. Copy connection string
5. Run: `vercel env add DATABASE_URL production`

## Steps to Deploy

### 1. Get Database URL

Choose one of the options above and get your PostgreSQL connection string.

### 2. Update Vercel Environment Variable

```bash
# Set the DATABASE_URL in Vercel
vercel env add DATABASE_URL production

# Paste your PostgreSQL connection string when prompted
# Example: postgresql://user:password@host/database?sslmode=require
```

### 3. Run Database Migration

The first time your app deploys with the new database, you need to create the tables:

```bash
# Option A: Run migration locally with production DATABASE_URL
DATABASE_URL="your-postgres-url-here" npx prisma migrate deploy

# Option B: Add a postbuild script to package.json (already done)
# The migration will run automatically on Vercel build
```

### 4. Redeploy

```bash
git add .
git commit -m "Switch to PostgreSQL for Vercel compatibility"
git push
```

## What Changed

1. `prisma/schema.prisma` - Changed provider from `sqlite` to `postgresql`
2. Added `@prisma/adapter-neon` and `@neondatabase/serverless` packages for better serverless performance
3. `.env` file updated with PostgreSQL example (you need to add real credentials)

## Local Development

For local development, you can either:
- Use the same PostgreSQL database (recommended for consistency)
- Keep using SQLite locally by temporarily changing DATABASE_URL in .env

## Current Status

The Prisma schema is ready for PostgreSQL. Once you add a DATABASE_URL to Vercel, the app will work in production.
