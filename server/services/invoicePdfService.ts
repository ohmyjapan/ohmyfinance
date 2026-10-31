// server/services/invoicePdfService.ts — the invoice PDF attached to a Gmail send (plan omf-invoice-tnumber-20261030 C3): the print HTML
// (server/utils/invoiceHtml.ts) rendered to A4 by the installed Chrome through puppeteer-core, JavaScript off, one render at a time,
// with a throwaway profile; the browser is closed and the profile removed in finally. puppeteer-core is loaded only here, so a server
// without it still starts and every send fails 「PDF を作れませんでした」.
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateInvoiceHTML } from '../utils/invoiceHtml'

export function chromeExecutable(): string | null {
  const configured = process.env.OMF_CHROME_PATH
  if (configured) return existsSync(configured) ? configured : null
  return [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')].find(p => existsSync(p)) || null
}

let renders: Promise<unknown> = Promise.resolve()
export function renderInvoicePdf(invoice: any): Promise<Buffer> {
  const run = renders.then(() => render(invoice))
  renders = run.catch(() => {})
  return run
}

async function render(invoice: any): Promise<Buffer> {
  const executablePath = chromeExecutable()
  if (!executablePath) throw new Error('Chrome not found')
  const { default: puppeteer }: any = await import('puppeteer-core')
  const profile = await mkdtemp(path.join(os.tmpdir(), 'omf-invoice-pdf-'))
  let browser: any = null
  try {
    browser = await puppeteer.launch({ executablePath, userDataDir: profile, headless: true, pipe: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-gpu'] })
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setContent(generateInvoiceHTML(invoice), { waitUntil: 'load' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true })
    return Buffer.from(pdf)
  } finally {
    if (browser) await browser.close().catch(() => {})
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}
