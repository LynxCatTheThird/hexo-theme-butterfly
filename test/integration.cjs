// Build temporary component posts in an existing Hexo site, then run the browser checks.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const site = path.resolve(process.argv[2] || path.join(__dirname, '../../..'))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'butterfly-test-'))
const created = []
const run = (file, args, env = process.env) => {
  const result = spawnSync(file, args, { cwd: site, env, encoding: 'utf8', timeout: 120000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0 || /^ERROR\b/m.test((result.stdout || '') + (result.stderr || ''))) throw result.error || new Error(`${path.basename(file)} exited with ${result.status}`)
}

;(async () => {
  try {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/components.md'), 'utf8')
    for (const encrypted of [false, true]) {
      const slug = `component-test-${encrypted ? 'private' : 'public'}-${process.pid}`
      const content = fixture.replace(/^abbrlink:.*$/m, `abbrlink: ${slug}`)
        .replace(/^title:.*$/m, `title: ${encrypted ? '' : 'Public '}Component integration test`)
      const file = path.join(site, 'source/_posts', `${slug}.md`)
      fs.writeFileSync(file, encrypted ? content : content.replace(/^password:.*\n/m, ''), { flag: 'wx' })
      created.push(file)
    }
    const output = path.join(temp, 'public')
    const config = path.join(temp, 'config.json')
    fs.writeFileSync(config, JSON.stringify({
      public_dir: output,
      markdown: { katex: { macros: { '\\AuditSymbol': '\\mathbf{X}' } } },
      theme_config: {
        navigation: { enable: true, cache: true, preload: true, exclude: ['/policy/'] },
        visitor_counter: { site_uv: true, site_pv: true, page_pv: true, element_id: { site_uv: 'custom-uv', site_pv: 'custom-site-pv', page_pv: 'custom-page-pv' }, element_class: { site_uv: 'custom-count', site_pv: 'custom-count', page_pv: 'custom-count' } },
        darkmode: { enable: true, button: true },
        structured_data: { enable: true },
        search: { use: 'local_search' },
        lightbox: 'fancybox', lightbox_options: { dragToClose: false },
        echarts: { enable: true, height: 320, init_options: { renderer: 'svg' } },
        chartjs: { enable: true, options: { animation: false } },
        mermaid: { enable: true, options: { fontFamily: 'monospace' } },
        math: { use: 'katex', per_page: true }
      }
    }))
    run(path.join(site, 'node_modules/.bin/hexo'), ['generate', '--config', `${path.join(site, '_config.yml')},${config}`])
    run(process.execPath, [path.join(__dirname, 'browser.cjs'), output], { ...process.env, MOCK_VISITOR_COUNTER: '1' })
  } finally {
    created.forEach(file => fs.unlinkSync(file))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
