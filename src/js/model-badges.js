'use strict';

const AI_MODEL_PRESENTATION = Object.freeze({
  'image-1': Object.freeze({
    kind: 'banana', best: true,
    description: ['High precision, stable references and polished detail', '高精度与稳定参考图，细节表现出色', '높은 정밀도와 안정적인 참조 이미지']
  }),
  'image-2': Object.freeze({
    kind: 'banana',
    description: ['Fast creation with balanced quality', '快速创作，兼顾画质与响应速度', '빠른 생성과 균형 잡힌 품질']
  }),
  'image-6': Object.freeze({
    kind: 'flower',
    description: ['Strong text control and realistic rendering', '文字控制准确，真实感表现出色', '정확한 텍스트 제어와 사실적인 표현']
  }),
  'image-19': Object.freeze({
    kind: 'flower',
    description: ['Premium quality with refined image editing', '高品质生成，图像编辑能力更精细', '고품질 생성과 정교한 이미지 편집']
  }),
  'image-18': Object.freeze({
    kind: 'sail',
    description: ['Cinematic composition and expressive visual style', '电影感构图，视觉风格更具表现力', '시네마틱 구도와 풍부한 시각 표현']
  })
});

function aiModelPresentation(provider = {}) {
  if (AI_MODEL_PRESENTATION[provider.id]) return AI_MODEL_PRESENTATION[provider.id];
  const rawName = provider.name || provider.model || '';
  const visibleName = typeof publicModelLabel === 'function' ? publicModelLabel(rawName) : rawName;
  const name = String(visibleName).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (name === 'nanobananapro' || name === 'nanobanapro' || name === 'messnpro') return AI_MODEL_PRESENTATION['image-1'];
  if (name === 'nanobanana2' || name === 'messn2') return AI_MODEL_PRESENTATION['image-2'];
  if (name === 'gptimage2' || name === 'messimage2') return AI_MODEL_PRESENTATION['image-6'];
  if (name === 'gptimage25' || name === 'messimage25') return AI_MODEL_PRESENTATION['image-19'];
  if (name === 'midjourneyv82' || name === 'midjoureyv82' || name === 'messjennie') return AI_MODEL_PRESENTATION['image-18'];
  return null;
}

function aiModelBadgeKind(provider = {}) {
  return aiModelPresentation(provider)?.kind || null;
}

function aiModelIcon(kind) {
  const icons = {
    banana: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.1 5.3c.9 5.8 4.7 9.8 11.2 10.5-2.8 3.2-7.8 3.8-11.1 1.1C3.1 14.4 3 9.5 6.1 5.3Z"/><path d="M6.1 5.3 4.7 3.8"/></svg>',
    flower: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.1c2.5-2.2 5.4.7 3.2 3.2 3.3-.2 3.3 3.9 0 3.7 2.2 2.5-.7 5.4-3.2 3.2.2 3.3-3.9 3.3-3.7 0-2.5 2.2-5.4-.7-3.2-3.2-3.3.2-3.3-3.9 0-3.7-2.2-2.5.7-5.4 3.2-3.2-.2-3.3 3.9-3.3 3.7 0Z"/><circle cx="12" cy="9.2" r="2.1"/></svg>',
    sail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v12.2H5.2L12 3.5Z"/><path d="M13.5 6.2v9.5h5.3l-5.3-9.5Z"/><path d="M4 18.1c3.7 2.4 12.3 2.4 16 0"/></svg>'
  };
  return icons[kind] || '';
}

function localizedModelDescription(values) {
  const language = document.documentElement?.dataset.language || 'en';
  return language === 'zh' ? values[1] : values[0];
}

function appendAiModelLabel(container, provider, options = {}) {
  container.replaceChildren();
  const presentation = aiModelPresentation(provider);
  if (presentation && options.showIcon !== false) {
    const badge = document.createElement('span');
    badge.className = `ai-model-badge ai-model-badge-${presentation.kind}`;
    badge.innerHTML = aiModelIcon(presentation.kind);
    container.appendChild(badge);
    container.classList.add('has-model-presentation');
  } else {
    container.classList.remove('has-model-presentation');
  }
  const copy = document.createElement('span');
  if (options.details && presentation) copy.className = 'ai-model-option-copy';
  const titleRow = options.details && presentation ? document.createElement('span') : copy;
  if (options.details && presentation) titleRow.className = 'ai-model-option-title';
  const label = document.createElement('span');
  label.className = 'ai-model-label-text';
  label.textContent = typeof publicModelLabel === 'function'
    ? publicModelLabel(provider && (provider.name || provider.model) || '')
    : String(provider && (provider.name || provider.model) || '');
  titleRow.appendChild(label);
  if (presentation?.best) {
    const best = document.createElement('span');
    best.className = 'ai-model-best';
    best.textContent = 'Best';
    titleRow.appendChild(best);
  }
  if (options.details && presentation) {
    const description = document.createElement('span');
    description.className = 'ai-model-description';
    description.textContent = localizedModelDescription(presentation.description);
    copy.append(titleRow, description);
    container.appendChild(copy);
  } else {
    container.appendChild(copy);
  }
}
