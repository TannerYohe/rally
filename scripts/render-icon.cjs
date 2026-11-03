// Renders an SVG to a transparent 1024px PNG with Electron's Chromium: electron scripts/render-icon.cjs <in.svg> <out.png>
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [svgPath, outPath] = process.argv.slice(-2).map((p) => require('path').resolve(p))
const SIZE = 1024
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const svg = fs.readFileSync(svgPath).toString('base64')
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${svg}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  await new Promise((r) => setTimeout(r, 500))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(outPath, image.resize({ width: SIZE, height: SIZE }).toPNG())
  app.quit()
})
