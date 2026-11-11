// Run against a generated Hexo site: npm run test:browser -- /path/to/public
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')

const root = path.resolve(process.argv[2] || '../../public')
const htmlFiles = fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.html'))
const chartFile = htmlFiles.find(f => /class=["']echarts-container/.test(fs.readFileSync(path.join(root, f), 'utf8')))
assert.ok(chartFile, 'Include at least one article with an ECharts block')
const chartPath = '/' + chartFile.replace(/index\.html$/, '').split(path.sep).join('/')
const forbidden = /\/pjax\/|instant\.page|busuanzi|googletagmanager|google-analytics|cloudflareinsights|hm\.baidu\.com|clarity\.ms|pagead2\.googlesyndication|addtoany|social-share|chatra\.io|tidio\.co|client\.crisp\.chat|trtc\.io\/knocket/
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.xml': 'application/xml', '.json': 'application/json', '.woff2': 'font/woff2' }
const mathTheme = structuredClone(require('../scripts/common/default_config'))
mathTheme.navigation.enable = true
mathTheme.asset = { mathjax: 'https://registry.npmmirror.com/mathjax/4.1.3/files/tex-mml-chtml.js' }
mathTheme.math.mathjax.tex = { macros: { Probe: '\\mathbb{R}' } }
let headHelper
require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/helpers/inject_head_js.js'), 'utf8'), {
  hexo: { theme: { config: mathTheme }, extend: { helper: { register: (_, fn) => { headHelper = fn } } } }
})
const mathFixture = '<html><head><meta name="theme-color" content="#fff">' + headHelper.call({ theme: mathTheme }) + '</head><body><div id="article-container"><script type="math/tex; mode=display">\\Probe + x^2</script></div>' + require('pug').renderFile(path.join(__dirname, '../layout/includes/third-party/math/mathjax.pug'), { theme: mathTheme, url_for: v => v }) + '</body></html>'
const server = http.createServer((req, res) => {
  if (req.url === '/__mathjax_test__/') { res.setHeader('Content-Type', 'text/html'); res.end(mathFixture); return }
  let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    res.end(fs.readFileSync(file))
  } catch { res.writeHead(404).end(fs.readFileSync(path.join(root, '404.html'))) }
})

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    const context = await browser.newContext()
    let counterCalls = 0
    if (process.env.MOCK_VISITOR_COUNTER) {
      await context.route('https://events.vercount.one/**', route => {
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
        counterCalls++
        return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ status: 'success', data: { site_uv: 77, site_pv: 100, page_pv: 19 } }) })
      })
    }
    if (process.env.NAV_VENDOR_DIR) {
      const vendors = {
        '**/swup/4.10.0/**': 'swup/package/dist/Swup.umd.js',
        '**/@swup/head-plugin/2.3.1/**': '@swup_head-plugin/package/dist/index.umd.js',
        '**/@swup/preload-plugin/3.2.12/**': '@swup_preload-plugin/package/dist/index.umd.js',
        '**/@swup/a11y-plugin/5.2.1/**': '@swup_a11y-plugin/package/dist/index.umd.js'
      }
      for (const [pattern, file] of Object.entries(vendors)) await context.route(pattern, route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(process.env.NAV_VENDOR_DIR, file), 'utf8') }))
    }
    if (process.env.COMPONENT_VENDOR_DIR) {
      const vendors = {
        '**/echarts/6.1.0/**': 'echarts.js',
        '**/chart.js/4.6.1/**': 'chartjs.js',
        '**/mermaid/12.3.0/**': 'mermaid.js',
        '**/katex/0.19.1/files/dist/katex.min.css': 'katex.css',
        '**/katex/0.19.1/files/dist/contrib/copy-tex.min.js': 'copy-tex.js'
      }
      for (const [pattern, file] of Object.entries(vendors)) await context.route(pattern, route => route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(process.env.COMPONENT_VENDOR_DIR, file), 'utf8') }))
    }
    const page = await context.newPage()
    const errors = [], forbiddenRequests = []
    let chartRequests = 0
    page.on('pageerror', e => errors.push(e.message))
    page.on('request', r => {
      if (forbidden.test(r.url())) forbiddenRequests.push(r.url())
      if (/\/echarts\//.test(r.url())) chartRequests++
    })
    await page.route('**/*', r => r.request().resourceType() === 'image' ? r.abort() : r.fallback())
    await page.addInitScript(() => {
      window.__resizeListeners = new Set()
      const add = window.addEventListener, remove = window.removeEventListener
      window.addEventListener = function (type, fn, options) {
        if (type === 'resize' && !options?.signal?.aborted) {
          window.__resizeListeners.add(fn)
          options?.signal?.addEventListener('abort', () => window.__resizeListeners.delete(fn), { once: true })
        }
        return add.call(this, type, fn, options)
      }
      window.removeEventListener = function (type, fn, options) {
        if (type === 'resize') window.__resizeListeners.delete(fn)
        return remove.call(this, type, fn, options)
      }
    })
    const go = async pathname => {
      await page.evaluate(p => new Promise(resolve => {
        document.addEventListener('theme:page-load', resolve, { once: true })
        swup.navigate(p)
      }), pathname)
    }
    const ready = () => page.waitForFunction(() => {
      const els = [...document.querySelectorAll('.echarts-container')]
      return els.length > 0 && typeof window.echarts?.getInstanceByDom === 'function' && els.every(el => echarts.getInstanceByDom(el))
    })
    const meta = () => page.evaluate(() => ({
      canonical: document.querySelector('link[rel=canonical]').href,
      description: document.querySelector('meta[name=description]')?.content,
      og: document.querySelector('meta[property="og:url"]')?.content,
      json: [...document.querySelectorAll('script[type="application/ld+json"]')].map(e => JSON.parse(e.textContent))
    }))
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => typeof window.swup?.navigate === 'function')
    if (process.env.MOCK_VISITOR_COUNTER) {
      await page.waitForFunction(() => document.getElementById('custom-uv')?.textContent === '77' && document.getElementById('custom-site-pv')?.textContent === '100')
      assert.ok(await page.locator('#custom-uv').evaluate(el => el.classList.contains('custom-count')))
      assert.equal(counterCalls, 1)
    }
    const homeMeta = await meta()
    const baseline = await page.evaluate(() => window.__resizeListeners.size)
    assert.equal(chartRequests, 0, 'Home must not load the chart library')
    await go(chartPath)
    await ready()
    if (process.env.MOCK_VISITOR_COUNTER) {
      await page.waitForFunction(() => document.getElementById('custom-page-pv')?.textContent === '19')
      assert.equal(counterCalls, 2, 'One counter request per successful page navigation')
      console.log('PASS: Vercount API, custom IDs/classes and Swup counters (mocked API)')
    }
    if (process.env.MOCK_VISITOR_COUNTER) {
      const beforeMissing = counterCalls
      const countedMissing = page.waitForResponse(r => r.url().includes('/api/v2/log') && r.request().method() === 'POST')
      await go('/__missing_audit_page__/')
      await countedMissing
      await page.waitForTimeout(200)
      assert.equal(new URL(page.url()).pathname, '/__missing_audit_page__/')
      assert.equal(counterCalls - beforeMissing, 1, `Failed navigation counter update; page errors: ${errors.join('; ')}`)
      await go(chartPath)
      await ready()
    }
    const chartMeta = await meta()
    assert.ok(chartMeta.canonical.includes(chartPath))
    assert.equal(chartMeta.json[0]['@type'], 'BlogPosting')
    assert.notEqual(chartMeta.canonical, homeMeta.canonical)
    await page.evaluate(() => { window.__oldCharts = [...document.querySelectorAll('.echarts-container')].map(el => echarts.getInstanceByDom(el)) })
    await page.evaluate(() => window.scrollTo(0, 600))
    await page.locator('#rightside-config').click()
    await page.locator('#darkmode').click()
    await page.waitForFunction(() => window.__oldCharts.every(chart => chart.isDisposed()))
    await ready()
    await page.evaluate(() => { window.__oldCharts = [...document.querySelectorAll('.echarts-container')].map(el => echarts.getInstanceByDom(el)) })
    await go('/')
    assert.deepEqual(await meta(), homeMeta)
    assert.ok(await page.evaluate(() => window.__oldCharts.every(chart => chart.isDisposed())))
    for (let i = 0; i < 3; i++) { await go(chartPath); await ready(); await go('/') }
    assert.equal(await page.evaluate(() => window.__resizeListeners.size), baseline, 'Navigation must not accumulate resize listeners')
    assert.equal(chartRequests, 1, 'Only one download across page visits')
    await page.evaluate(() => window.scrollTo(0, 500))
    const savedScroll = await page.evaluate(() => window.scrollY)
    await go('/tags/')
    await page.evaluate(() => new Promise(resolve => { document.addEventListener('theme:page-load', resolve, { once: true }); history.back() }))
    await page.waitForFunction(y => Math.abs(window.scrollY - y) < 3, savedScroll)
    assert.deepEqual(await meta(), homeMeta)
    await page.evaluate(() => new Promise(resolve => { document.addEventListener('theme:page-load', resolve, { once: true }); history.forward() }))
    assert.deepEqual((await meta()).json, [], 'Non-article pages must not retain old JSON-LD')
    await go(chartPath)
    await ready()
    await page.reload({ waitUntil: 'networkidle' })
    await ready()
    assert.deepEqual(await meta(), chartMeta, 'Swup metadata must match a direct page load')
    await page.evaluate(() => { window.__oldCharts = [...document.querySelectorAll('.echarts-container')].map(el => echarts.getInstanceByDom(el)) })
    await page.evaluate(() => window.dispatchEvent(new Event('hexo-blog-decrypt')))
    await ready()
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.echarts-container')].every((el, i) => echarts.getInstanceByDom(el) === window.__oldCharts[i])), 'Repeated init after decryption must reuse instances')
    assert.deepEqual(errors, [])
    assert.deepEqual(forbiddenRequests, [])
    console.log('PASS: first navigation, metadata, dark mode, disposal, repeated navigation, direct load, decryption init, removed integrations')

    // Pending and failed downloads must not render into a page that has been left.
    const race = await context.newPage()
    await race.route('**/*', r => r.request().resourceType() === 'image' ? r.abort() : r.fallback())
    let release
    const gate = new Promise(resolve => { release = resolve })
    await race.route('**/echarts/**', async r => { await gate; await r.fallback() })
    await race.goto(origin, { waitUntil: 'networkidle' })
    const requested = race.waitForRequest(r => /\/echarts\//.test(r.url()))
    await race.evaluate(p => swup.navigate(p), chartPath)
    await requested
    await race.evaluate(() => { window.__departedChart = document.querySelector('.echarts-container') })
    await race.evaluate(() => swup.navigate('/'))
    await race.waitForURL(origin + '/')
    release()
    await race.waitForFunction(() => typeof window.echarts?.init === 'function')
    assert.ok(await race.evaluate(() => !echarts.getInstanceByDom(window.__departedChart)))
    assert.equal(await race.locator('canvas').count(), 0)
    await race.close()
    console.log('PASS: navigation cancels pending chart initialization')

    const retryPage = await context.newPage()
    await retryPage.route('**/*', r => r.request().resourceType() === 'image' ? r.abort() : r.fallback())
    let attempts = 0
    await retryPage.route('**/echarts/**', r => ++attempts === 1 ? r.abort() : r.fallback())
    await retryPage.goto(origin + chartPath, { waitUntil: 'networkidle' })
    await retryPage.locator('.echarts-error').first().click()
    await retryPage.waitForFunction(() => [...document.querySelectorAll('.echarts-container')].every(el => typeof window.echarts?.getInstanceByDom === 'function' && echarts.getInstanceByDom(el)))
    assert.equal(attempts, 2)
    await retryPage.close()
    console.log('PASS: chart library loads after a failed request and retry')
    await page.setViewportSize({ width: 390, height: 844 })
    await go('/tags/')
    await go(chartPath)
    await ready()
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.echarts-container')].every(el => echarts.getInstanceByDom(el).getWidth() <= innerWidth)))
    assert.deepEqual(errors, [])
    console.log('PASS: chart navigation at mobile viewport width')
    const fallback = await context.newPage()
    const fallbackErrors = []
    fallback.on('pageerror', error => fallbackErrors.push(error.message))
    await fallback.route('**/swup/4.10.0/**', route => route.abort())
    await fallback.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback())
    await fallback.goto(origin + chartPath, { waitUntil: 'networkidle' })
    await fallback.waitForFunction(() => typeof window.echarts?.getInstanceByDom === 'function' && [...document.querySelectorAll('.echarts-container')].every(el => echarts.getInstanceByDom(el)))
    assert.equal(await fallback.evaluate(() => typeof window.swup), 'undefined')
    assert.deepEqual(fallbackErrors, [])
    await fallback.close()
    console.log('PASS: a failed Swup CDN request preserves direct page rendering')

    await page.setViewportSize({ width: 1280, height: 900 })
    const beforePreload = counterCalls
    await page.evaluate(() => swup.preload('/about/'))
    assert.equal(counterCalls, beforePreload, 'Prefetch must not execute the counter')
    assert.ok(await page.evaluate(() => swup.cache.has('/about/')))
    await go('/about/')
    await page.waitForFunction(() => document.activeElement?.id === 'content-inner')
    assert.ok(await page.evaluate(() => {
      const external = document.createElement('a'); external.href = 'https://example.org/'
      const download = document.createElement('a'); download.href = '/file.zip'; download.download = ''
      const blank = document.createElement('a'); blank.href = '/'; blank.target = '_blank'
      return [external, download, blank].every(el => swup.shouldIgnoreVisit(el.href, { el }))
    }))
    const beforeAnchor = counterCalls
    await page.evaluate(() => {
      const target = document.createElement('div'); target.id = 'audit-anchor'; target.style.marginTop = '1000px'; target.textContent = 'Anchor'
      document.getElementById('content-inner').appendChild(target)
      const link = document.createElement('a'); link.id = 'audit-anchor-link'; link.href = '#audit-anchor'; link.textContent = 'Go to anchor'
      document.body.appendChild(link)
    })
    await page.locator('#audit-anchor-link').click()
    await page.waitForURL('**/#audit-anchor')
    assert.equal(counterCalls, beforeAnchor, 'Same-page anchors must not count a new page')
    await go('/')
    await page.locator('#search-button .search').click()
    await page.locator('.local-search-input input').fill(chartMeta.json[0].headline)
    const searchLink = page.locator(`.local-search-hit-item a[href*="${chartPath}"]`).first()
    await searchLink.click()
    await ready()
    assert.equal(new URL(page.url()).pathname, chartPath)
    assert.deepEqual(errors, [])
    await page.evaluate(() => {
      btf.addGlobalFn('encrypt', () => { window.__persistentCalls = (window.__persistentCalls || 0) + 1 }, 'testPersistent')
      btf.addPageFn('encrypt', () => { window.__pageCalls = (window.__pageCalls || 0) + 1 }, 'testScoped')
    })
    await go('/about/')
    await page.evaluate(() => window.dispatchEvent(new Event('hexo-blog-decrypt')))
    assert.equal(await page.evaluate(() => window.__persistentCalls), 1)
    assert.equal(await page.evaluate(() => window.__pageCalls || 0), 0)
    await page.evaluate(() => { delete window.globalFn.encrypt.testPersistent })
    console.log('PASS: prefetch, focus, native links, anchors, search and callback scopes')

    if (process.env.TEST_MATHJAX) {
      const math = await context.newPage()
      const mathErrors = []
      math.on('pageerror', error => mathErrors.push(error.message))
      await math.goto(origin + '/__mathjax_test__/', { waitUntil: 'domcontentloaded' })
      await math.waitForSelector('#article-container mjx-container', { timeout: 45000 })
      assert.ok(await math.locator('mjx-container mjx-mi').count() > 0)
      assert.equal(await math.locator('mjx-merror').count(), 0)
      assert.deepEqual(mathErrors, [])
      await math.close()
      console.log('PASS: MathJax client options and real CHTML rendering')
    }

    if (process.env.MOCK_VISITOR_COUNTER) {
      const slowCounter = await context.newPage()
      await slowCounter.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback())
      let releaseCounter
      const gate = new Promise(resolve => { releaseCounter = resolve })
      const urls = []
      await slowCounter.route('https://events.vercount.one/api/v2/log', async route => {
        if (route.request().method() === 'POST') urls.push(route.request().postDataJSON().url)
        await gate
        await route.fallback()
      })
      await slowCounter.goto(origin, { waitUntil: 'domcontentloaded' })
      await slowCounter.waitForFunction(() => typeof window.swup?.navigate === 'function')
      await slowCounter.evaluate(() => swup.navigate('/tags/'))
      await slowCounter.waitForFunction(() => location.pathname === '/tags/' && !swup.navigating)
      assert.ok(urls.some(url => new URL(url).pathname === '/'))
      releaseCounter()
      await slowCounter.waitForFunction(() => document.getElementById('custom-uv')?.textContent === '77')
      assert.ok(urls.some(url => new URL(url).pathname === '/tags/'))
      await slowCounter.close()
      console.log('PASS: slow counters preserve page URLs and do not block navigation')
    }

    const delayedNavigation = await context.newPage()
    await delayedNavigation.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback())
    let releaseNavigation
    const navigationGate = new Promise(resolve => { releaseNavigation = resolve })
    await delayedNavigation.route('**/swup/4.10.0/**', async route => { await navigationGate; await route.fallback() })
    await delayedNavigation.goto(origin, { waitUntil: 'domcontentloaded' })
    assert.ok(await delayedNavigation.evaluate(() => typeof window.globalFn.pageLoad.refreshFn === 'function'))
    assert.equal(await delayedNavigation.evaluate(() => typeof window.swup?.navigate), 'undefined')
    releaseNavigation()
    await delayedNavigation.waitForFunction(() => typeof window.swup?.navigate === 'function')
    await delayedNavigation.close()
    console.log('PASS: navigation dependencies do not block initial page setup')

    const encryptedFile = htmlFiles.find(file => file.startsWith('article/') && /<title>Component integration test/.test(fs.readFileSync(path.join(root, file), 'utf8')))
    if (encryptedFile) {
      const encryptedPath = '/' + encryptedFile.replace(/index\.html$/, '')
      const encrypted = await context.newPage()
      const componentErrors = []
      encrypted.on('pageerror', error => componentErrors.push(error.message))
      await encrypted.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback())
      await encrypted.goto(origin + encryptedPath, { waitUntil: 'networkidle' })
      assert.equal(await encrypted.locator('.echarts-container').count(), 0)
      assert.equal(await encrypted.evaluate(() => typeof window.echarts), 'undefined')
      await encrypted.locator('input[type=password]').fill('component-test-only')
      await encrypted.locator('input[type=password]').press('Enter')
      await encrypted.waitForFunction(() => {
        const chart = document.querySelector('.echarts-container')
        return chart && typeof window.echarts?.getInstanceByDom === 'function' && window.echarts.getInstanceByDom(chart) && document.querySelector('.chartjs-wrap canvas') && typeof window.Chart?.getChart === 'function' && window.Chart.getChart(document.querySelector('.chartjs-wrap canvas')) && document.querySelector('.mermaid-wrap svg') && document.querySelector('.katex-show')
      })
      assert.equal(await encrypted.locator('.katex-error').count(), 0)
      assert.ok((await encrypted.locator('.katex').first().textContent()).includes('X'), 'KaTeX macro from site config must render')
      assert.ok(await encrypted.evaluate(() => {
        const el = document.querySelector('.echarts-container')
        return !!el.querySelector('svg') && echarts.getInstanceByDom(el).getHeight() === 320 && Chart.getChart(document.querySelector('.chartjs-wrap canvas')).options.animation === false
      }))
      await encrypted.locator('#article-container a[data-fancybox]').click()
      await encrypted.waitForFunction(() => !!Fancybox.getInstance())
      assert.equal(await encrypted.evaluate(() => Fancybox.getInstance().getOptions().dragToClose), false)
      assert.equal(new URL(encrypted.url()).pathname, encryptedPath)
      await encrypted.evaluate(() => {
        window.__componentState = {
          echarts: echarts.getInstanceByDom(document.querySelector('.echarts-container')),
          chart: Chart.getChart(document.querySelector('.chartjs-wrap canvas')),
          mermaid: document.querySelector('.mermaid-wrap').__mermaidAbortController
        }
      })
      await encrypted.evaluate(() => new Promise(resolve => { document.addEventListener('theme:page-load', resolve, { once: true }); swup.navigate('/') }))
      assert.equal(await encrypted.evaluate(() => !!Fancybox.getInstance()), false)
      assert.ok(await encrypted.evaluate(() => __componentState.echarts.isDisposed() && __componentState.chart.ctx === null && __componentState.mermaid.signal.aborted))
      await encrypted.evaluate(path => new Promise(resolve => { document.addEventListener('theme:page-load', resolve, { once: true }); swup.navigate(path) }), encryptedPath)
      assert.equal(await encrypted.locator('input[type=password]').count(), 1, 'Cached navigation must not restore decrypted HTML')
      assert.equal(await encrypted.locator('.echarts-container').count(), 0)
      assert.deepEqual(componentErrors, [])
      await encrypted.close()
      console.log('PASS: encrypted ECharts, Chart.js, Mermaid, KaTeX, lightbox options and cleanup')
    }


  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => server.close())
