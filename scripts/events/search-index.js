'use strict'

const { stripHTML, unescapeHTML, escapeHTML } = require('hexo-util')

const searchablePost = post => {
  const encrypted = post.encrypt || /\b(?:data-hbe-format|id=["']hbeData["'])/.test(post.content || '')
  const html = encrypted ? '' : (post.content || '')
  const text = unescapeHTML(stripHTML(html
    .replace(/<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')))
    .replace(/\s+/g, ' ').trim()
  // The search UI inserts highlighted snippets as HTML; keep literal code inert.
  // Escaping also prevents a literal CDATA terminator from breaking XML indexes.
  const content = escapeHTML(text)
  return {
    title: post.title,
    path: post.path,
    content,
    _content: content,
    categories: post.categories,
    tags: post.tags
  }
}

hexo.extend.filter.register('after_init', () => {
  if (!hexo.config.search) return
  const key = hexo.config.search.path.endsWith('.json') ? 'json' : 'xml'
  const generate = hexo.extend.generator.get(key)
  if (!generate) return
  hexo.extend.generator.register(key, function (locals) {
    const safeLocals = Object.create(locals)
    for (const field of ['posts', 'pages']) {
      if (locals[field]) safeLocals[field] = locals[field].map(searchablePost)
    }
    return generate.call(this, safeLocals)
  })
})
