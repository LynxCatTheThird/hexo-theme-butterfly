const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

function load (relative, hexo) {
  const file = path.resolve(__dirname, '..', relative)
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { hexo, require: createRequire(file) })
}

test('ECharts preserves stable IDs, escaped data and invalid fences', () => {
  let render
  const warnings = []
  load('scripts/filters/echarts.js', {
    theme: { config: { echarts: { enable: true, option: { animation: false } } } },
    log: { warn: message => warnings.push(message) },
    extend: { filter: { register: (_, callback) => { render = callback } } }
  })
  const fence = '```echarts\n{"title":{"text":"</textarea><script>bad</script>"}}\n```'
  const input = { source: 'post.md', content: `${fence}\n\n${fence}` }
  const first = render({ ...input }).content
  assert.equal(first, render({ ...input }).content)
  assert.notEqual(first, render({ ...input, source: 'other.md' }).content)
  assert.equal(new Set([...first.matchAll(/id="(echarts-[^"]+)" class/g)].map(m => m[1])).size, 2)
  assert.ok(first.includes('&lt;/textarea&gt;'))
  assert.ok(!first.includes('<script'))
  for (const value of ['null', '[]', 'invalid']) {
    const content = `\`\`\`echarts\n${value}\n\`\`\``
    assert.equal(render({ source: 'bad.md', content }).content, content)
  }
  assert.equal(warnings.length, 3)
  const literal = '````markdown\n' + fence + '\n````'
  assert.equal(render({ source: 'example.md', content: literal }).content, literal)
  const template = render({ source: 'template.md', content: '```echarts\n{"title":{"text":"{% sample %}"}}\n```' }).content
  assert.ok(!template.includes('{%'))
})

test('search data excludes encrypted text and hidden chart payloads without mutating posts', () => {
  let install, generate
  const original = { title: 'Visible', path: 'visible/', content: '<p>Hello &amp; world</p><textarea>{"secret":42}</textarea><script>payload</script>' }
  const locked = { title: 'Locked', path: 'locked/', encrypt: true, content: 'never index private body', _content: 'private markdown' }
  load('scripts/events/search-index.js', {
    config: { search: { path: 'search.xml' } },
    extend: {
      filter: { register: (_, callback) => { install = callback } },
      generator: { get: () => locals => locals, register: (_, callback) => { generate = callback } }
    }
  })
  install()
  const result = generate({ posts: [original, locked], pages: [] })
  assert.equal(result.posts[0].content, 'Hello &amp; world')
  assert.equal(result.posts[1].content, '')
  assert.equal(result.posts[1]._content, '')
  assert.equal(result.posts[1].title, 'Locked')
  assert.ok(original.content.includes('secret'))
  assert.equal(locked._content, 'private markdown')
  const edge = generate({ posts: [{ title: 'Code', content: '<code>]]&gt; &lt;img src=x onerror=alert(1)&gt;</code>' }], pages: [] }).posts[0].content
  assert.ok(!edge.includes(']]>'))
  assert.ok(!edge.includes('<img'))
  assert.ok(edge.includes(']]&gt;'))
})

test('structured data respects disable, emits valid JSON and does not mutate alternate names', () => {
  const pug = require('pug')
  const file = path.resolve(__dirname, '../layout/includes/head/structured_data.pug')
  const theme = { structured_data: { enable: true, alternate_name: ['One'] }, avatar: { img: '' }, post_copyright: {} }
  const locals = {
    theme, config: { url: 'https://example.test/', title: 'Site', author: 'Author', subtitle: 'Sub' },
    page: { layout: 'post', title: '</script><img>', permalink: 'https://example.test/post/', date: new Date('2026-01-01') },
    full_url_for: value => value, url_for: value => value, is_home: () => false
  }
  const html = pug.renderFile(file, locals)
  const body = html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]
  assert.equal(JSON.parse(body).headline, locals.page.title)
  assert.ok(!body.includes('</script>'))
  assert.equal(pug.renderFile(file, { ...locals, theme: { ...theme, structured_data: { enable: false } } }), '')
  assert.equal(pug.renderFile(file, { ...locals, page: { layout: 'page' } }), '')
  const home = { ...locals, page: {}, is_home: () => true }
  assert.equal(pug.renderFile(file, home), pug.renderFile(file, home))
  assert.deepEqual(theme.structured_data.alternate_name, ['One'])
})

test('all retained JavaScript files parse', () => {
  for (const dir of ['scripts', 'source/js']) {
    const base = path.resolve(__dirname, '..', dir)
    for (const file of fs.readdirSync(base, { recursive: true }).filter(f => f.endsWith('.js'))) {
      new vm.Script(fs.readFileSync(path.join(base, file), 'utf8'), { filename: file })
    }
  }
})

test('the three retained comment systems render their integrations', () => {
  const pug = require('pug')
  const defaults = require('../scripts/common/default_config')
  for (const name of ['Artalk', 'Twikoo', 'Waline']) {
    const theme = structuredClone(defaults)
    theme.comments.use = [name]
    theme.asset = {}
    theme.waline.serverURL = "https://comments.invalid"
    theme.artalk.server = "https://comments.invalid"
    theme.twikoo.envId = "https://comments.invalid"
    const locals = { theme, page: {}, _p: key => key, url_for: value => value || '', partial: () => '' }
    const root = path.resolve(__dirname, '../layout/includes/third-party')
    const html = pug.renderFile(path.join(root, 'comments/index.pug'), locals)
    assert.ok(html.includes(`id="${name.toLowerCase()}-wrap"`))
    for (const part of [`comments/${name.toLowerCase()}.pug`, 'card-post-count/index.pug', 'newest-comments/index.pug']) {
      assert.ok(pug.renderFile(path.join(root, part), locals).includes('<script'))
    }
  }
})

test('retained comment systems keep comment counts and their own page views', () => {
  const pug = require('pug')
  const defaults = require('../scripts/common/default_config')
  const file = path.resolve(__dirname, '../layout/includes/header/post-info.pug')
  for (const [name, view, count] of [['Artalk', 'ArtalkPV', 'ArtalkCount'], ['Twikoo', 'twikoo_visitors', 'twikoo-count'], ['Waline', 'waline-pageview-count', 'waline-comment-count']]) {
    const theme = structuredClone(defaults)
    theme.comments.use = [name]
    theme.comments.count = true
    theme[name.toLowerCase()][name === 'Waline' ? 'pageview' : 'visitor'] = true
    theme.post_meta.post.date_type = false
    theme.post_meta.post.categories = false
    const html = pug.renderFile(file, { theme, page: { title: 'Test', path: 'post/', categories: { data: [] } }, _p: key => key, url_for: v => v })
    assert.ok(html.includes(view))
    assert.ok(html.includes(count))
  }
})

test('Waline preserves option overrides and destroys regular page instances once', () => {
  const pug = require('pug')
  const theme = structuredClone(require('../scripts/common/default_config'))
  theme.comments.use = ['Waline']
  theme.waline.option = { pageview: true }
  theme.asset = {}
  const html = pug.renderFile(path.resolve(__dirname, '../layout/includes/third-party/comments/waline.pug'), { theme, url_for: value => value || '' })
  const script = html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]
  let config, destroyCount = 0, cleanup
  const target = { isConnected: true }
  const document = { querySelector: () => target }
  vm.runInNewContext(script, {
    window: { location: { pathname: '/post/' }, walineFn: options => { config = options; return { destroy: () => destroyCount++ } } },
    document,
    GLOBAL_CONFIG_SITE: { pageType: 'post' }, GLOBAL_CONFIG: { lightbox: 'null' },
    btf: { addGlobalFn: (key, fn) => { if (key === 'pageCleanup') cleanup = fn }, addPageFn () {} },
    setTimeout: fn => fn()
  })
  assert.equal(config.pageview, true)
  assert.equal(config.el, target)
  cleanup()
  cleanup()
  assert.equal(destroyCount, 1)
})

test('Artalk binds theme counters and registers cleanup without a lightbox', async () => {
  const pug = require('pug')
  const theme = structuredClone(require('../scripts/common/default_config'))
  theme.comments.use = ['Artalk']
  theme.asset = {}
  const html = pug.renderFile(path.resolve(__dirname, '../layout/includes/third-party/comments/artalk.pug'), { theme, url_for: value => value || '' })
  const script = html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]
  let config, destroyed = 0
  const functions = {}, target = { isConnected: true }
  const Artalk = { init: options => { config = options; return { destroy: () => destroyed++, setDarkMode () {} } } }
  const document = { querySelector: () => target, documentElement: { getAttribute: () => 'light' } }
  vm.runInNewContext(script, { window: { Artalk, swup: {} }, Artalk, document, location: { pathname: '/post/' }, GLOBAL_CONFIG_SITE: { pageType: 'post' }, GLOBAL_CONFIG: { lightbox: 'null' }, btf: { addGlobalFn: (key, fn) => { functions[key] = fn }, addPageFn: (key, fn) => { functions[key] = fn } }, setTimeout: fn => fn() })
  await Promise.resolve()
  assert.equal(config.pvEl, '#ArtalkPV')
  assert.equal(config.countEl, '#ArtalkCount')
  assert.equal(config.pageVote, false)
  assert.equal(typeof functions.themeChange, 'function')
  functions.pageCleanup()
  functions.pageCleanup()
  assert.equal(destroyed, 1)
})

test('visitor counter captures the page URL, keeps the UV flag and ignores departed elements', async () => {
  const pug = require('pug')
  const theme = structuredClone(require('../scripts/common/default_config'))
  theme.visitor_counter.element_id = { site_uv: 'uv', site_pv: 'pv', page_pv: 'page' }
  const html = pug.renderFile(path.resolve(__dirname, '../layout/includes/third-party/visitor-counter.pug'), { theme })
  const script = html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]
  const targets = { uv: { isConnected: true }, pv: { isConnected: true }, page: { isConnected: true } }
  const document = { cookie: '', getElementById: id => targets[id] }
  const location = { href: 'https://site.test/first/', host: 'site.test', protocol: 'https:' }
  const calls = []
  let resolveRequest
  const context = { document, location, AbortController, setTimeout: () => 0, clearTimeout () {}, console,
    fetch: (_, options) => { calls.push(JSON.parse(options.body)); return new Promise(resolve => { resolveRequest = resolve }) }
  }
  const pending = vm.runInNewContext(script, context)
  location.href = 'https://site.test/second/'
  targets.page.isConnected = false
  const response = { ok: true, json: async () => ({ status: 'success', data: { site_uv: 0, site_pv: 12, page_pv: 2 } }) }
  resolveRequest(response)
  await pending
  assert.equal(calls[0].url, 'https://site.test/first/')
  assert.equal(calls[0].isNewUv, true)
  assert.equal(targets.uv.textContent, 0)
  assert.equal(targets.page.textContent, undefined)
  const second = vm.runInNewContext(script, context)
  resolveRequest(response)
  await second
  assert.equal(calls[1].isNewUv, false)
})

test('comment labels follow comments.text while the switch remains named', () => {
  const pug = require('pug')
  const theme = structuredClone(require('../scripts/common/default_config'))
  theme.comments.use = ['Artalk', 'Waline']
  theme.comments.text = false
  const html = pug.renderFile(path.resolve(__dirname, '../layout/includes/third-party/comments/index.pug'), { theme, _p: key => key })
  assert.ok(!html.includes('first-comment'))
  assert.ok(html.includes('aria-label="Artalk / Waline"'))
  assert.ok(html.includes('<button'))
})

test('TOC anchor updates preserve navigation history and query parameters', () => {
  const window = { addEventListener () {}, location: { href: 'https://site.test/post/?highlight=x', pathname: '/post/', search: '?highlight=x', hash: '' } }
  let result
  window.history = { state: { source: 'swup', index: 3, random: 0.5 }, replaceState: (state, title, url) => { result = { state, title, url } } }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../source/js/utils.js'), 'utf8'), { window, URL, location: window.location, GLOBAL_CONFIG_SITE: { title: 'Post' } })
  window.btf.updateAnchor('#section')
  assert.equal(result.state.source, 'swup')
  assert.equal(result.state.index, 3)
  assert.equal(result.state.url, 'https://site.test/post/?highlight=x#section')
})

test('MathJax configuration forwards loader, font, TeX and document options', () => {
  const pug = require('pug')
  const theme = structuredClone(require('../scripts/common/default_config'))
  theme.asset = { mathjax: '/mathjax.js' }
  Object.assign(theme.math.mathjax, { loader: { load: ['[tex]/physics'] }, output: { font: 'mathjax-tex' }, tex: { macros: { R: '\\mathbb{R}' } }, chtml: { scale: 1.5 }, options: { lazyMargin: '400px' } })
  const html = pug.renderFile(path.resolve(__dirname, '../layout/includes/third-party/math/mathjax.pug'), { theme, url_for: value => value })
  const window = {}
  const article = { querySelector: () => null, querySelectorAll: () => [], isConnected: true }
  vm.runInNewContext(html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1], { window, document: { readyState: 'complete', getElementById: () => article }, btf: { addGlobalFn () {}, addPageFn () {}, getScript: () => new Promise(() => {}) } })
  assert.equal(window.MathJax.loader.load[0], '[tex]/physics')
  assert.equal(window.MathJax.output.font, 'mathjax-tex')
  assert.equal(window.MathJax.tex.macros.R, '\\mathbb{R}')
  assert.equal(window.MathJax.chtml.scale, 1.5)
  assert.equal(window.MathJax.options.lazyMargin, '400px')
})

test('internal CDN configuration serves fork assets rather than upstream bundles', () => {
  let configure
  const config = { CDN: { internal_provider: 'jsdelivr', third_party_provider: 'custom', custom_format: 'https://assets.test/${file}', version: false, option: {} } }
  load('scripts/events/cdn.js', { theme: { config }, theme_dir: '/unused/', render: { renderSync: () => ({}) }, extend: { filter: { register: (_, fn) => { configure = fn } } } })
  assert.throws(configure, /this fork/)
  config.CDN.internal_provider = 'custom'
  configure()
  assert.equal(config.asset.navigation, 'https://assets.test/source/js/navigation.js')
  assert.equal(config.asset.echarts_runtime, 'https://assets.test/source/js/echarts.js')
})

test('local search preserves literal title markup and excludes executable links', () => {
  const context = { window: { addEventListener () {} }, URL, location: { origin: 'https://site.test' } }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../source/js/search/local-search.js'), 'utf8') + '\nglobalThis.Search = LocalSearch', context)
  const search = new context.Search({})
  search.datas = [
    { title: 'vector<int> & "example"', content: 'vector', url: '/post/' },
    { title: 'vector', content: '', url: 'javascript:alert(1)' }
  ]
  const items = search.getResultItems(['vector'])
  assert.equal(items.length, 1)
  assert.ok(items[0].item.includes('&lt;int&gt; &amp; &quot;example&quot;'))
  assert.ok(!items[0].item.includes('<int>'))
})
