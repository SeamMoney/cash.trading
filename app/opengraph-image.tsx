import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'Decibel Market Making Bot'
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
          fontSize: 128,
          background: 'black',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
        }}
      >
        <div style={{ fontSize: 256 }}>🤑</div>
        <div
          style={{
            fontSize: 64,
            color: '#ffff00',
            fontWeight: 'bold',
          }}
        >
          Decibel Market Making Bot
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
