/**
 * Find all event types in bot transactions
 *
 * Usage:
 *   BOT_OPERATOR=0x... SUBACCOUNT=0x... npx tsx scripts/find-event-types.ts
 */

// Get addresses from environment variables
const BOT_OPERATOR = process.env.BOT_OPERATOR
const SUBACCOUNT = process.env.SUBACCOUNT

async function main() {
  if (!BOT_OPERATOR || !SUBACCOUNT) {
    console.error('Error: BOT_OPERATOR and SUBACCOUNT environment variables are required')
    console.error('Usage: BOT_OPERATOR=0x... SUBACCOUNT=0x... npx tsx scripts/find-event-types.ts')
    process.exit(1)
  }

  console.log('Fetching transactions...')

  const res = await fetch(`https://api.testnet.aptoslabs.com/v1/accounts/${BOT_OPERATOR}/transactions?limit=500`)
  const txs = await res.json()

  console.log(`Found ${txs.length} transactions`)

  const eventTypes = new Map<string, number>()
  const eventsByType = new Map<string, any[]>()

  for (const tx of txs) {
    if (tx.success !== true) continue

    for (const event of tx.events || []) {
      const typeName = event.type?.split('::').slice(-1)[0] || event.type
      eventTypes.set(typeName, (eventTypes.get(typeName) || 0) + 1)

      // Store first example of each type
      if (!eventsByType.has(typeName)) {
        eventsByType.set(typeName, [])
      }
      if (eventsByType.get(typeName)!.length < 2) {
        eventsByType.get(typeName)!.push({
          tx: tx.hash.slice(0, 16) + '...',
          data: event.data
        })
      }
    }
  }

  console.log('\n=== EVENT TYPES ===')
  for (const [type, count] of [...eventTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(35)} ${count}`)
  }

  // Show examples of interesting events
  console.log('\n=== EXAMPLE EVENTS ===')
  const interestingTypes = ['TwapEvent', 'OrderFillEvent', 'TradeEvent', 'PositionUpdateEvent', 'TwapSliceEvent']

  for (const type of interestingTypes) {
    if (eventsByType.has(type)) {
      console.log(`\n--- ${type} ---`)
      for (const example of eventsByType.get(type)!) {
        console.log(`TX: ${example.tx}`)
        console.log(JSON.stringify(example.data, null, 2).slice(0, 500))
      }
    }
  }

  // Look specifically for events that mention our subaccount
  console.log('\n=== EVENTS FOR OUR SUBACCOUNT ===')
  let subaccountEvents = 0

  for (const tx of txs) {
    if (tx.success !== true) continue

    for (const event of tx.events || []) {
      const data = event.data || {}
      const account = data.account || data.user || data.subaccount || ''

      if (account.toLowerCase() === SUBACCOUNT.toLowerCase()) {
        subaccountEvents++
        if (subaccountEvents <= 5) {
          const typeName = event.type?.split('::').slice(-1)[0] || event.type
          console.log(`\n${typeName} in ${tx.hash.slice(0, 20)}...`)
          console.log(JSON.stringify(data, null, 2).slice(0, 400))
        }
      }
    }
  }

  console.log(`\nTotal events for subaccount: ${subaccountEvents}`)
}

main().catch(console.error)
