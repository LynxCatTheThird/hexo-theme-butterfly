'use strict'

const { createHash } = require('node:crypto')

hexo.extend.filter.register('before_post_render', data => {
  if (!hexo.theme.config.echarts.enable) return data
  let index = 0
  const postId = createHash('sha256').update(data.source || data.path || '').digest('hex').slice(0, 12)
  data.content = data.content.replace(/^((`|~)\2{2,})([^\r\n]*)\r?\n([\s\S]*?)(?:^\1\2*[ \t]*$|$(?![\s\S]))/gm, (match, fence, marker, language, content) => {
    if (language.trim() !== 'echarts') return match
    try {
      let option = JSON.parse(content.trim())
      if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('expected a JSON object')
      option = { ...hexo.theme.config.echarts.option, ...option }
      const id = `echarts-${postId}-${index++}`
      const json = JSON.stringify(option).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/{/g, '&#123;').replace(/}/g, '&#125;')
      return `<div id="${id}" class="echarts-container"></div>\n<textarea hidden id="${id}-option">${json}</textarea>\n`
    } catch (error) {
      hexo.log.warn(`Invalid ECharts block in ${data.source || data.path}: ${error.message}`)
      return match
    }
  })
  return data
}, 9)
