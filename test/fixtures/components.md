---
title: Component integration test
date: 2026-01-01
abbrlink: component-integration-test
password: component-test-only
autoSave: false
comments: false
---

## Formula

$$\AuditSymbol + x^2$$

## ECharts

```echarts
{"title":{"text":"ECharts {% sample %}"},"xAxis":{"data":["A","B"]},"yAxis":{},"series":[{"type":"bar","data":[3,5]}]}
```

## Chart.js

{% chartjs 90,false,component-chart %}
<!-- chart -->
{"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"Test","data":[3,5]}]},"options":{}}
<!-- endchart -->
{% endchartjs %}

## Mermaid

{% mermaid %}
flowchart LR
  A[Start] --> B[Done]
{% endmermaid %}

## Image

![Pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==)
