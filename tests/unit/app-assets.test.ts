import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const iconPaths = [
  resolve(process.cwd(), 'resources', 'icon.png'),
  resolve(process.cwd(), 'src', 'renderer', 'src', 'assets', 'app-logo.png')
]

describe('application icons', () => {
  it.each(iconPaths)('uses a transparent square canvas without a white edge: %s', async (path) => {
    const metadata = await sharp(path).metadata()
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBe(512)
    expect(metadata.hasAlpha).toBe(true)

    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number): number =>
      data[(y * info.width + x) * 4 + 3] ?? 255

    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(info.width - 1, 0)).toBe(0)
    expect(alphaAt(0, info.height - 1)).toBe(0)
    expect(alphaAt(info.width - 1, info.height - 1)).toBe(0)

    let opaqueWhiteEdgePixels = 0
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (x >= 2 && y >= 2 && x < info.width - 2 && y < info.height - 2) continue
        const offset = (y * info.width + x) * 4
        if (
          data[offset + 3]! > 200 &&
          data[offset]! > 245 &&
          data[offset + 1]! > 245 &&
          data[offset + 2]! > 245
        ) {
          opaqueWhiteEdgePixels += 1
        }
      }
    }
    expect(opaqueWhiteEdgePixels).toBe(0)
  })

  it('keeps the Windows icon container valid', () => {
    const ico = readFileSync(resolve(process.cwd(), 'resources', 'icon.ico'))
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  })
})
