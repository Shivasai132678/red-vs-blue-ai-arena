// Captures the README screenshots by playing a real match in the running app.
//
// Usage (app running on :8000, e.g. via ./run.command):
//   npm run screenshots
// Env: LAB_URL (default http://127.0.0.1:8000), CHROME_PATH (default: macOS Google Chrome).
//
// Note: this plays a live 15-round match, so it adds 15 evaluations to the history
// and makes real calls to the configured Azure resource.
import { execFileSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = process.env.LAB_URL ?? 'http://127.0.0.1:8000'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button, a')].find((el) => el.textContent?.trim().startsWith(t))
    b?.click()
    return Boolean(b)
  }, text)
  if (!ok) throw new Error(`Button not found: ${text}`)
}

async function shot(page, name, options = {}) {
  if (!options.fullPage) await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86, ...options })
  console.log(`  saved ${name}.jpg`)
}

async function waitForStage(page, selector, timeout = 120_000) {
  await page.waitForFunction((s) => document.querySelector(s) !== null, { timeout, polling: 50 }, selector)
}

/** Pause the match, let CSS animations settle, run the capture, then resume. */
async function frozen(page, capture) {
  await clickButton(page, 'Pause')
  await sleep(450)
  await capture()
  await clickButton(page, 'Resume')
}

function makeGif(input, output) {
  // Two-pass palette keeps the GIF small and the colors clean.
  const filter =
    'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', filter, '-loop', '0', output])
  console.log('  saved demo.gif')
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    args: ['--hide-scrollbars'],
  })
  try {
    const page = await browser.newPage()
    await page.goto(`${BASE}/#/arena`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)

    console.log('Setup')
    await clickButton(page, 'Test connection')
    await page.waitForFunction(() => document.body.innerText.includes('Verified'), { timeout: 15_000 })
    await sleep(300)
    await shot(page, '01-arena-setup', { fullPage: true })

    console.log('Match (recording the first attack rounds at 2x for the demo GIF)')
    await clickButton(page, 'Start match')
    await waitForStage(page, '.stage.phase-running')
    await clickButton(page, '2×')
    await page.evaluate(() => window.scrollTo(0, 0))
    // Record only the arena, starting with the first attack round.
    await waitForStage(page, '.stage.stage-charge.is-attack')
    const box = await (await page.$('.stage'))?.boundingBox()
    if (!box) throw new Error('Stage not found')
    const video = `${OUT}/demo.webm`
    const recorder = await page.screencast({
      path: video,
      crop: { x: box.x, y: box.y, width: box.width, height: box.height },
    })
    // Hands off while recording: any scroll or screenshot would shift the cropped area.
    await page.waitForFunction(
      () => document.querySelectorAll('.pip-blocked').length >= 3 && document.querySelector('.stage-charge'),
      { timeout: 90_000, polling: 50 },
    )
    await recorder.stop()

    // Stills: pause the match on each key frame so nothing moves during the capture.
    await waitForStage(page, '.stage.stage-scan.is-attack')
    await frozen(page, async () => shot(page, '02-scanning'))

    await waitForStage(page, '.stage.result-blocked.stage-result')
    await frozen(page, async () => {
      await shot(page, '03-blocked')
      const panel = await page.$('.console')
      await panel?.screenshot({ path: `${OUT}/04-round-console.jpg`, type: 'jpeg', quality: 86 })
      console.log('  saved 04-round-console.jpg')
    })

    await waitForStage(page, '.stage.result-got_through.stage-impact')
    await frozen(page, async () => shot(page, '05-got-through'))

    await waitForStage(page, '.stage.result-false_alarm.stage-result', 180_000)
    await frozen(page, async () => shot(page, '06-false-alarm'))

    console.log('Debrief')
    await waitForStage(page, '.debrief', 60_000)
    await sleep(800)
    const debrief = await page.$('.debrief')
    await debrief?.screenshot({ path: `${OUT}/07-debrief.jpg`, type: 'jpeg', quality: 86 })
    console.log('  saved 07-debrief.jpg')

    console.log('Evidence')
    await page.evaluate(() => document.querySelector('.evidence-links button')?.click())
    await waitForStage(page, '.drawer .detail')
    await sleep(500)
    await shot(page, '08-evidence-drawer')

    await page.goto(`${BASE}/?r=${Date.now()}#/log`, { waitUntil: 'networkidle0' })
    await waitForStage(page, '.log-table')
    await sleep(400)
    await shot(page, '09-evidence-log')

    // Encode last: ffmpeg blocks, and the match must not run unobserved meanwhile.
    makeGif(video, `${OUT}/demo.gif`)
    await rm(video)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
