import { prisma } from './lib/prisma.ts'

async function main() {
  const result = await prisma.botInstance.updateMany({
    where: { isRunning: true },
    data: { isRunning: false },
  })
  console.log(`Stopped ${result.count} bot(s)`)

  const bots = await prisma.botInstance.findMany()
  console.log('Bot status:', bots.map(b => ({ wallet: b.userWalletAddress.slice(0, 10), isRunning: b.isRunning })))

  await prisma.$disconnect()
}

main()
