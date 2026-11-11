(() => {
  const settings = JSON.parse(document.currentScript.dataset.navigation)
  const emit = name => document.dispatchEvent(new Event(name, { bubbles: true }))
  const run = (key, clear = false) => {
    const functions = window.globalFn?.[key] || {}
    if (clear && window.globalFn) delete window.globalFn[key]
    Object.values(functions).forEach(fn => {
      try { fn() } catch (error) { console.error(`[${key}]`, error) }
    })
  }

  // Global bundles stay loaded; only replaced containers run their scripts.
  const runPageScripts = async () => {
    const scripts = document.querySelectorAll('#config-diff, #body-wrap script, .page-scripts script')
    for (const old of scripts) {
      if (!old.isConnected) continue
      const type = (old.type || '').toLowerCase()
      if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue
      const script = document.createElement('script')
      for (const { name, value } of old.attributes) script.setAttribute(name, value)
      script.textContent = old.textContent
      const loaded = (script.src || type === 'module') && !old.hasAttribute('async')
        ? new Promise(resolve => {
          const finish = () => { clearTimeout(timer); resolve() }
          const timer = settings.timeout ? setTimeout(() => {
            console.warn('Page script timed out:', script.src)
            resolve()
          }, settings.timeout) : undefined
          script.onload = script.onerror = finish
        })
        : Promise.resolve()
      old.replaceWith(script)
      await loaded
    }
  }

  const init = async () => {
    try {
      await btf.getScript(settings.assets.swup)
      await Promise.all([btf.getScript(settings.assets.head), btf.getScript(settings.assets.a11y)])
    } catch (error) {
      console.warn('[navigation]', error)
      return
    }
    const plugins = [
      new SwupHeadPlugin({ persistAssets: true, awaitAssets: true }),
      new SwupA11yPlugin({ announcements: { visit: '{title}', url: '{url}' } })
    ]
    if (settings.preload && settings.cache) {
      try {
        await btf.getScript(settings.assets.preload)
        plugins.push(new SwupPreloadPlugin({ throttle: 2, preloadVisibleLinks: false }))
      } catch (error) {
        console.warn('[preload]', error)
      }
    }
    const swup = window.swup = new Swup({
      plugins,
      containers: ['#config-diff', '#body-wrap', '#rightside-config-hide', '#rightside-config-show', '.page-scripts'],
      animationSelector: false,
      cache: settings.cache,
      timeout: settings.timeout,
      linkSelector: 'a[href]:not([data-fancybox])',
      ignoreVisit: (url, { el } = {}) => Boolean(el?.closest('[data-no-swup]')) || settings.exclude.includes(new URL(url, location.href).pathname)
    })

    swup.hooks.replace('fetch:request', async (visit, args, fetchPage) => {
      const response = await fetchPage(visit, args)
      if (!response.ok) visit.cache.write = false
      if (!response.ok && response.status !== 404) throw new Error(`Navigation request failed: ${response.status}`)
      const type = response.headers.get('content-type')
      if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('Navigation response is not HTML')
      return response
    })
    swup.hooks.on('visit:start', visit => {
      if (visit.a11y) visit.a11y.focus = { selector: '#content-inner', wait: true }
      run('navigationStart')
    })
    swup.hooks.before('content:replace', () => {
      emit('theme:page-leave')
      run('pageCleanup', true)
      document.body.classList.remove('read-mode')
    })
    swup.hooks.on('content:replace', async () => {
      await runPageScripts()
      run('pageLoad')
    })
    swup.hooks.on('page:view', () => {
      emit('theme:page-load')
      // hexo-blog-encrypt listens to this event when the replacement DOM is ready.
      emit('swup:contentReplaced')
    })
    for (const hook of ['visit:end', 'visit:abort', 'visit:fail']) swup.hooks.on(hook, () => run('navigationEnd'))
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})()
