import { prisma } from './lib/prisma.ts'

async function main() {
  const bots = await prisma.botInstance.findMany()
  console.log('All bots in database:')
  console.log(JSON.stringify(bots, null, 2))
  await prisma.$disconnect()
}

main()
