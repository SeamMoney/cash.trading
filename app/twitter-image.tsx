import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'Decibrrr - Farm Decibel Points on Aptos'
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
          backgroundImage: 'radial-gradient(circle at 25% 25%, #1a1a1a 0%, #000 50%)',
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
          <span style={{ fontSize: 120 }}>🔊💵</span>
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            fontStyle: 'italic',
            background: 'linear-gradient(90deg, #fff600, #ffff00, #fff600)',
            backgroundClip: 'text',
            color: 'transparent',
            letterSpacing: '-0.05em',
          }}
        >
          DECIBRRR
        </div>
        <div
          style={{
            fontSize: 32,
            color: '#888',
            marginTop: 20,
            textAlign: 'center',
          }}
        >
          Farm Points on Decibel Perp DEX
        </div>
        <div
          style={{
            fontSize: 24,
            color: '#fff600',
            marginTop: 30,
            padding: '10px 30px',
            border: '2px solid #fff600',
            borderRadius: 8,
          }}
        >
          Aptos Blockchain
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
