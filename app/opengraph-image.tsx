import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'cash.trading - Aptos perps on Decibel'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 40,
          }}
        >
          <span style={{ fontSize: 120, color: '#39ff14', fontWeight: 900 }}>$</span>
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            color: '#39ff14',
          }}
        >
          cash.trading
        </div>
        <div
          style={{
            fontSize: 32,
            color: '#888',
            marginTop: 20,
            textAlign: 'center',
          }}
        >
          Decibel perps, analytics, bots, and CASH rewards
        </div>
        <div
          style={{
            fontSize: 24,
            color: '#39ff14',
            marginTop: 30,
            padding: '10px 30px',
            border: '2px solid #39ff14',
            borderRadius: 8,
          }}
        >
          Aptos Mainnet
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
