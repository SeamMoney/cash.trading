# Decibrrr Bot Runner (Digital Ocean)

A standalone bot execution service that runs persistently on a Digital Ocean droplet.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Decibrrr UI   │────▶│   Neon Postgres │◀────│  Bot Runner VM  │
│   (Vercel)      │     │   (Database)    │     │  (Digital Ocean)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │ Start/Stop bot                                │ Execute trades
        │ View status                                   │ every 3-5 seconds
        ▼                                               ▼
   User Interface                               Autonomous Trading
```

## How It Works

1. **User starts bot** via Decibrrr UI → Creates `BotInstance` in database
2. **Bot Runner** polls database every 3 seconds for active bots
3. **Executes trades** using the same `VolumeBotEngine` logic
4. **Updates database** with trade results, volume, PnL
5. **UI displays** real-time status from database

## Advantages Over Vercel Cron

| Aspect | Vercel Cron | Digital Ocean Bot Runner |
|--------|-------------|--------------------------|
| Frequency | 1 minute | 3-5 seconds |
| Reliability | Depends on cron trigger | Always running |
| Execution time | 60s max | Unlimited |
| Multiple bots | Processes sequentially | Parallel execution |
| Cost | Free tier limits | $5/month droplet |

## Setup

### 1. Create Digital Ocean Droplet

```bash
# Ubuntu 22.04, Basic, $6/month (1GB RAM, 1 vCPU)
# Enable monitoring
```

### 2. Install Dependencies

```bash
ssh root@your-droplet-ip

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# Install PM2 for process management
npm install -g pm2

# Clone and setup
git clone https://github.com/SeamMoney/decibrrr.git
cd decibrrr/bot-runner
npm install
```

### 3. Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
DATABASE_URL="postgresql://..."
BOT_OPERATOR_PRIVATE_KEY="ed25519-priv-0x..."
GEOMI_API_KEY="..."
EOF
```

### 4. Start Bot Runner

```bash
# Start with PM2 (auto-restart on crash)
pm2 start runner.js --name decibrrr-bot

# View logs
pm2 logs decibrrr-bot

# Auto-start on server reboot
pm2 startup
pm2 save
```

## Bot Runner Script

The `runner.js` script:
1. Connects to Neon PostgreSQL
2. Polls for bots where `isRunning = true`
3. For each bot, executes a trade cycle
4. Respects rate limits per strategy
5. Handles errors gracefully

## Monitoring

```bash
# View live logs
pm2 logs decibrrr-bot --lines 100

# Check status
pm2 status

# Restart
pm2 restart decibrrr-bot
```
