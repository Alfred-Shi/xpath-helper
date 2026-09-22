// XPath 辅助工具 - 内容脚本
// 负责 DOM 交互、XPath 计算和元素高亮

// 全局状态
let captureMode = false;
let validateMode = false;
let currentHighlightedElement = null;
let validationHighlightedElements = [];
let isCtrlPressed = false; // 追踪 Ctrl 键状态
let lastHoveredElement = null; // 追踪最后悬停的元素
let ctrlSelectedElements = []; // 存储按住 Ctrl 点击的多选元素

// 高亮样式类名
const HOVER_HIGHLIGHT_CLASS = 'xpath-helper-hover';
const CLICK_HIGHLIGHT_CLASS = 'xpath-helper-click';
const VALIDATE_HIGHLIGHT_CLASS = 'xpath-helper-validate';

/**
 * 判断是否为动态生成的 ID (如 React, Vue, Guid 或大量数字等)
 * @param {string} id - 待校验的 ID
 * @returns {boolean} - 是否为动态 ID
 */
function isDynamicId(id) {
  if (!id || typeof id !== 'string') return true;
  // GUID/UUID (例如: 531e1d66-4728-4db7-a827-e389a6bedfc8)
  if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(id)) return true;
  // React 18 / floating-ui 自动生成的 ID，形如 ":r0:", ":r1:"
  if (/^:r[0-9a-zA-Z_]+:$/.test(id)) return true;
  // 包含 5 个及以上连续数字的 ID (往往是数据库自增 ID 或时间戳)
  if (/\d{5,}/.test(id)) return true;
  // 带有长数字后缀的框架生成 ID (例如: ember12345)
  if (/[a-zA-Z_]+\d{4,}$/.test(id)) return true;
  return false;
}

/**
 * 判断是否为 CSS 框架的通用布局或辅助原子类 (如 Tailwind CSS 的 flex, grid, w-full 等)
 * @param {string} cls - 待校验的类名
 * @returns {boolean} - 是否为通用辅助类
 */
function isUtilityClass(cls) {
  if (!cls || typeof cls !== 'string') return true;
  const c = cls.trim();
  if (c.length <= 2) return true; // 太短的直接视为无业务意义的类名
  
  // 匹配常用布局、内边距、外边距、颜色、字号、边框、阴影、圆角、定位等 Tailwind 风格的原子类
  const utilityRegex = /^(flex|grid|hidden|block|inline|absolute|relative|fixed|static|sticky|items-\w+|justify-\w+|flex-\w+|grid-\w+|space-[xy]-\w+|gap-\w+|p[tblrxy]?-\d+|m[tblrxy]?-\d+|w-\w+|h-\w+|min-w-\w+|min-h-\w+|max-w-\w+|max-h-\w+|text-\w+|bg-\w+|border-\w+|rounded-\w+|shadow-\w+|opacity-\d+|z-\d+|transition|duration-\d+|ease-\w+|delay-\d+|pointer-events-\w+|select-\w+|overflow-\w+|cursor-\w+|col-\w+|row-\w+|align-\w+|valign-\w+|float-\w+|clear-\w+|box-\w+|font-\w+|leading-\w+|tracking-\w+|whitespace-\w+|break-\w+|outline-\w+|visible|invisible|sr-only|not-sr-only)$/;
  return utilityRegex.test(c);
}

/**
 * 安全地发送消息到后台/Popup，如果扩展被重新加载导致上下文失效，则自动清理高亮和监听器
 * @param {object} message - 待发送的消息
 */
function safeSendMessage(message) {
  try {
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(message);
    } else {
      // 扩展已被重新加载，上下文失效，执行自我销毁清理
      stopCaptureListeners();
      removeAllHighlights();
    }
  } catch (error) {
    // 捕获 Extension context invalidated 异常，静默清理并退出
    stopCaptureListeners();
    removeAllHighlights();
  }
}

/**
 * 获取元素过滤掉 xpath-helper- 内部样式后的纯净 Class 列表与字符串
 * @param {Element} element - 目标元素
 * @returns {{ classes: string[], classStr: string }}
 */
function getCleanElementClasses(element) {
  if (!element || typeof element.getAttribute !== 'function') {
    return { classes: [], classStr: '' };
  }
  const rawClass = element.getAttribute('class');
  if (!rawClass || typeof rawClass !== 'string') {
    return { classes: [], classStr: '' };
  }
  const classes = rawClass.trim().split(/\s+/).filter(cls => cls && !cls.startsWith('xpath-helper-'));
  return {
    classes: classes,
    classStr: classes.join(' ')
  };
}

/**
 * 获取节点的视觉关联元素（针对 Text 或 Attr 节点定位其宿主元素）
 * @param {Node} node - 目标节点
 * @returns {Element|null}
 */
function getVisualElement(node) {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node;
  if (node.nodeType === Node.ATTRIBUTE_NODE) return node.ownerElement;
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) return node.parentElement;
  return null;
}

/**
 * 生成元素的 XPath 路径（支持祖先稳定 ID 向上截断短化）
 * @param {Element} element - 目标元素
 * @returns {string} - 元素的 XPath 路径
 */
function getXPath(element) {
  const id = element.getAttribute('id');
  if (id && id.trim() && !isDynamicId(id.trim())) {
    return `//*[@id="${id.trim()}"]`;
  }

  if (element === document.body) {
    return '/html/body';
  }

  let path = '';
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    // 祖先节点拥有稳定且唯一的 ID 时直接截断短化
    if (current !== element && current !== document.body && current !== document.documentElement) {
      const ancestorId = current.getAttribute('id');
      if (ancestorId && ancestorId.trim() && !isDynamicId(ancestorId.trim())) {
        try {
          const testXPath = `//*[@id="${ancestorId.trim()}"]${path}`;
          const res = document.evaluate(testXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (res.snapshotLength === 1) {
            return testXPath;
          }
        } catch (e) {}
      }
    }

    let index = 0;
    // 使用 localName 以更好地支持 SVG 和 HTML
    const currentTagName = current.localName;
    const isSVG = current.namespaceURI === 'http://www.w3.org/2000/svg';

    let sibling = current.previousSibling;

    // 计算同名兄弟元素的索引
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.localName === currentTagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagNameStr = isSVG ? `*[local-name()='${currentTagName}']` : currentTagName;
    const pathIndex = (currentTagName === 'html' || currentTagName === 'body') ? '' : `[${index + 1}]`;
    path = `/${tagNameStr}${pathIndex}${path}`;

    current = current.parentNode;
  }

  return path;
}

/**
 * 生成更智能的 XPath（优先使用现代测试属性、唯一稳定 id、唯一语义 class 等）
 * @param {Element} element - 目标元素
 * @returns {string} - 优化后的 XPath 路径
 */
function getSmartXPath(element) {
  const isSVG = element.namespaceURI === 'http://www.w3.org/2000/svg';
  const tagNameStr = isSVG ? `*[local-name()='${element.localName}']` : element.localName;

  // 1. 优先使用现代测试/定位属性
  const testAttrs = ['data-testid', 'data-qa', 'data-cy', 'data-target'];
  for (const attr of testAttrs) {
    const val = element.getAttribute(attr);
    if (val && val.trim()) {
      const xpath = `//${tagNameStr}[@${attr}="${val.trim()}"]`;
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (result.snapshotLength === 1) {
          return xpath;
        }
      } catch (e) {}
    }
  }

  // 2. 如果有唯一的稳定 ID，直接使用
  const id = element.getAttribute('id');
  if (id && id.trim() && !isDynamicId(id.trim())) {
    return `//*[@id="${id.trim()}"]`;
  }

  // 3. 提取纯净 class，优先使用非原子类的业务语义 class 匹配
  const { classes } = getCleanElementClasses(element);
  if (classes.length > 0) {
    const semanticClasses = classes.filter(cls => !isUtilityClass(cls));
    const candidateClasses = semanticClasses.length > 0 ? semanticClasses : classes;

    // 3.1 尝试寻找列表中任意一个本身就唯一的 class
    for (const cls of candidateClasses) {
      const xpath = `//${tagNameStr}[contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')]`;
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (result.snapshotLength === 1) {
          return xpath;
        }
      } catch (e) {}
    }

    // 3.2 尝试组合前几个 class 进行唯一定位
    if (candidateClasses.length > 1) {
      const conditions = candidateClasses.slice(0, 3)
        .map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`)
        .join(' and ');
      const xpath = `//${tagNameStr}[${conditions}]`;
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (result.snapshotLength === 1) {
          return xpath;
        }
      } catch (e) {}
    }
  }

  // 4. 如果有唯一的 name 属性
  const name = element.getAttribute('name');
  if (name && name.trim()) {
    const xpath = `//${tagNameStr}[@name="${name.trim()}"]`;
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (result.snapshotLength === 1) {
        return xpath;
      }
    } catch (e) {}
  }

  // 4.5 尝试基于唯一的短文本内容定位 (改用 normalize-space 增强兼容)
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length <= 25 && !text.includes('\n') && !text.includes('\r')) {
    if (element.children.length <= 1) {
      let quoteChar = '"';
      if (text.includes('"')) {
        if (text.includes("'")) {
          quoteChar = null;
        } else {
          quoteChar = "'";
        }
      }
      if (quoteChar) {
        const xpath = `//${tagNameStr}[normalize-space(.)=${quoteChar}${text}${quoteChar}]`;
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (result.snapshotLength === 1) {
            return xpath;
          }
        } catch (e) {}
      }
    }
  }

  // 5. 否则返回优化后的绝对路径
  return getXPath(element);
}

/**
 * 根据 XPath 查找元素
 * @param {string} xpath - XPath 表达式
 * @returns {Array} - 匹配的元素数组
 */
function getElementsByXPath(xpath) {
  const results = [];
  const query = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let i = 0; i < query.snapshotLength; i++) {
    results.push(query.snapshotItem(i));
  }
  return results;
}

/**
 * 移除所有高亮效果
 */
function removeAllHighlights() {
  // 移除悬停高亮
  const hoverElements = document.querySelectorAll(`.${HOVER_HIGHLIGHT_CLASS}`);
  hoverElements.forEach(el => el.classList.remove(HOVER_HIGHLIGHT_CLASS));

  // 移除点击高亮
  const clickElements = document.querySelectorAll(`.${CLICK_HIGHLIGHT_CLASS}`);
  clickElements.forEach(el => el.classList.remove(CLICK_HIGHLIGHT_CLASS));

  // 移除验证和相似多选高亮
  validationHighlightedElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove(VALIDATE_HIGHLIGHT_CLASS);
      el.classList.remove(CLICK_HIGHLIGHT_CLASS);
    }
  });
  validationHighlightedElements = [];

  currentHighlightedElement = null;
}

/**
 * 高亮单个元素（悬停效果）
 * @param {Element} element - 要高亮的元素
 */
function highlightElement(element) {
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove(HOVER_HIGHLIGHT_CLASS);
  }

  element.classList.add(HOVER_HIGHLIGHT_CLASS);
  currentHighlightedElement = element;
}

/**
 * 高亮多个元素（验证模式）
 * @param {Array} elements - 要高亮的元素数组
 */
function highlightValidationElements(elements) {
  // 清除之前的验证高亮
  validationHighlightedElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove(VALIDATE_HIGHLIGHT_CLASS);
    }
  });
  validationHighlightedElements = [];

  // 添加新的验证高亮（支持属性与文本节点的宿主元素）
  elements.forEach(node => {
    const visualEl = getVisualElement(node);
    if (visualEl && visualEl.classList) {
      visualEl.classList.add(VALIDATE_HIGHLIGHT_CLASS);
      validationHighlightedElements.push(visualEl);
    }
  });
}

/**
 * 鼠标移动事件处理器（捕获模式）
 */
function handleMouseMove(event) {
  if (!captureMode) return;

  const element = event.target;
  if (element && element !== document.body && element !== document.documentElement) {
    highlightElement(element);
    lastHoveredElement = element; // 保存当前悬停的元素
  }
}

/**
 * 捕获元素的 XPath（提取为独立函数）
 */
function captureElement(element) {
  if (!element) return;

  // 清除先前所有高亮，确保单选时旧的高亮不会残留
  removeAllHighlights();

  // 移除悬停高亮，添加点击高亮
  element.classList.remove(HOVER_HIGHLIGHT_CLASS);
  element.classList.add(CLICK_HIGHLIGHT_CLASS);

  // 生成 XPath
  const xpath = getSmartXPath(element);

  // 获取干净的 Class 字符串
  const cleanClassName = getCleanElementClasses(element).classStr;

  // 发送 XPath 到 popup/sidepanel
  safeSendMessage({
    type: 'XPATH_CAPTURED',
    xpath: xpath,
    tagName: element.localName,
    id: element.getAttribute('id') || '',
    className: cleanClassName,
    text: element.textContent?.substring(0, 50) || ''
  });
}

/**
 * 提取元素的路径步骤，供相似 XPath 计算使用
 */
function getElementPathSteps(element) {
  const steps = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 0;
    const tagName = current.localName;
    const isSVG = current.namespaceURI === 'http://www.w3.org/2000/svg';
    
    let sibling = current.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.localName === tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    
    steps.unshift({
      tagName: tagName,
      isSVG: isSVG,
      index: index + 1,
      id: current.getAttribute('id') || '',
      className: current.getAttribute('class') || ''
    });
    
    current = current.parentNode;
  }
  return steps;
}

/**
 * 获取元素集合的最近公共祖先 (Lowest Common Ancestor, LCA)
 */
function getLCA(elements) {
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0].parentNode;

  function getAncestors(el) {
    const ancestors = [];
    let curr = el;
    while (curr) {
      ancestors.push(curr);
      curr = curr.parentNode;
    }
    return ancestors.reverse();
  }

  const allAncestors = elements.map(getAncestors);
  const minLen = Math.min(...allAncestors.map(a => a.length));

  let lca = null;
  for (let i = 0; i < minLen; i++) {
    const node = allAncestors[0][i];
    const allSame = allAncestors.every(a => a[i] === node);
    if (allSame) {
      lca = node;
    } else {
      break;
    }
  }
  return lca;
}

/**
 * 获取元素相对于其某个祖先节点的路径步骤
 */
function getRelativePathSteps(element, ancestor) {
  const steps = [];
  let current = element;
  while (current && current !== ancestor) {
    let index = 0;
    const tagName = current.localName;
    const isSVG = current.namespaceURI === 'http://www.w3.org/2000/svg';
    
    let sibling = current.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.localName === tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    
    steps.unshift({
      tagName: tagName,
      isSVG: isSVG,
      index: index + 1,
      id: current.getAttribute('id') || '',
      className: current.getAttribute('class') || ''
    });
    
    current = current.parentNode;
  }
  return steps;
}

/**
 * 计算多个元素的相似 XPath (支持同深/跨深度归纳，避免错位)
 */
function getSimilarityXPath(elements) {
  if (elements.length === 0) return '';
  if (elements.length === 1) return getSmartXPath(elements[0]);

  // 1. 优先使用最近公共祖先 (LCA) 算法
  const lca = getLCA(elements);
  if (lca && lca !== document.body && lca !== document.documentElement && lca.nodeType === Node.ELEMENT_NODE) {
    const lcaXPath = getSmartXPath(lca);
    if (lcaXPath) {
      const relativeStepsList = elements.map(el => getRelativePathSteps(el, lca));
      const minSubLen = Math.min(...relativeStepsList.map(s => s.length));
      const maxSubLen = Math.max(...relativeStepsList.map(s => s.length));

      // 1.1 若相对深度完全相同，按层级推导公共标签与 Class
      if (minSubLen === maxSubLen) {
        const subParts = [];
        for (let i = 0; i < minSubLen; i++) {
          const levelSteps = relativeStepsList.map(s => s[i]);
          const firstStep = levelSteps[0];
          const sameTagName = levelSteps.every(step => step.tagName === firstStep.tagName);

          if (!sameTagName) {
            subParts.push('*');
            continue;
          }

          const tagNameStr = firstStep.isSVG ? `*[local-name()='${firstStep.tagName}']` : firstStep.tagName;

          // 寻找该层级的纯净公共 Class
          const classesList = levelSteps.map(step => {
            const cls = step.className;
            if (!cls) return [];
            const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');
            return clsStr.trim().split(/\s+/).filter(c => c && !c.startsWith('xpath-helper-'));
          });

          let commonClasses = [];
          if (classesList.length > 0) {
            commonClasses = classesList[0].filter(cls => classesList.every(clsList => clsList.includes(cls)));
          }

          const sameIndex = levelSteps.every(step => step.index === firstStep.index);

          let stepStr = tagNameStr;
          if (commonClasses.length > 0) {
            const specificClasses = commonClasses.filter(cls => !isUtilityClass(cls));
            const chosenClasses = specificClasses.length > 0 ? specificClasses.slice(0, 2) : commonClasses.slice(0, 2);
            if (chosenClasses.length > 0) {
              const conditions = chosenClasses.map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`).join(' and ');
              stepStr += `[${conditions}]`;
            }
          } else if (sameIndex) {
            stepStr += `[${firstStep.index}]`;
          }

          subParts.push(stepStr);
        }

        const candidateXPath = lcaXPath + '/' + subParts.join('/');
        try {
          const matchResult = document.evaluate(candidateXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (matchResult.snapshotLength >= elements.length) {
            return candidateXPath;
          }
        } catch (e) {}
      }

      // 1.2 若存在跨深度或层级非对称，通过 // 后代轴归纳目标叶子特征
      const targetTagNames = elements.map(el => el.localName);
      const allSameTargetTag = targetTagNames.every(t => t === targetTagNames[0]);
      const targetTagStr = allSameTargetTag ? (elements[0].namespaceURI === 'http://www.w3.org/2000/svg' ? `*[local-name()='${targetTagNames[0]}']` : targetTagNames[0]) : '*';

      const targetClassesList = elements.map(el => getCleanElementClasses(el).classes);
      let commonTargetClasses = [];
      if (targetClassesList.length > 0) {
        commonTargetClasses = targetClassesList[0].filter(cls => targetClassesList.every(list => list.includes(cls)));
      }

      const specificTargetClasses = commonTargetClasses.filter(cls => !isUtilityClass(cls));
      const chosenTargetClasses = specificTargetClasses.length > 0 ? specificTargetClasses.slice(0, 2) : commonTargetClasses.slice(0, 2);

      let targetCondition = '';
      if (chosenTargetClasses.length > 0) {
        targetCondition = `[${chosenTargetClasses.map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`).join(' and ')}]`;
      }

      const lcaDescendantXPath = `${lcaXPath}//${targetTagStr}${targetCondition}`;
      try {
        const matchResult = document.evaluate(lcaDescendantXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (matchResult.snapshotLength >= elements.length) {
          return lcaDescendantXPath;
        }
      } catch (e) {}
    }
  }

  // 2. 兜底方案：自根部向下寻找公共锚点，结合叶子特征生成
  const allSteps = elements.map(getElementPathSteps);
  const minLen = Math.min(...allSteps.map(steps => steps.length));

  let commonPrefixLen = 0;
  for (let i = 0; i < minLen; i++) {
    const nodesAtI = allSteps.map(steps => steps[i]);
    const firstNode = nodesAtI[0];
    const allSameTag = nodesAtI.every(n => n.tagName === firstNode.tagName);
    const allSameIndex = nodesAtI.every(n => n.index === firstNode.index);
    if (allSameTag && allSameIndex) {
      commonPrefixLen = i + 1;
    } else {
      break;
    }
  }

  const prefixParts = [];
  for (let i = 0; i < commonPrefixLen; i++) {
    const step = allSteps[0][i];
    if (step.id && !isDynamicId(step.id)) {
      prefixParts.length = 0;
      prefixParts.push(`//*[@id="${step.id}"]`);
      continue;
    }
    const tagStr = step.isSVG ? `*[local-name()='${step.tagName}']` : step.tagName;
    const idxStr = (step.tagName === 'html' || step.tagName === 'body') ? '' : `[${step.index}]`;
    if (prefixParts.length === 0) {
      prefixParts.push(`/${tagStr}${idxStr}`);
    } else {
      prefixParts.push(`${tagStr}${idxStr}`);
    }
  }

  const leafStepList = allSteps.map(steps => steps[steps.length - 1]);
  const leafSameTag = leafStepList.every(s => s.tagName === leafStepList[0].tagName);
  const leafTagStr = leafSameTag ? (leafStepList[0].isSVG ? `*[local-name()='${leafStepList[0].tagName}']` : leafStepList[0].tagName) : '*';

  const leafClassesList = elements.map(el => getCleanElementClasses(el).classes);
  let commonLeafClasses = [];
  if (leafClassesList.length > 0) {
    commonLeafClasses = leafClassesList[0].filter(cls => leafClassesList.every(list => list.includes(cls)));
  }
  const specificLeafClasses = commonLeafClasses.filter(cls => !isUtilityClass(cls));
  const chosenLeafClasses = specificLeafClasses.length > 0 ? specificLeafClasses.slice(0, 2) : commonLeafClasses.slice(0, 2);

  let leafCondition = '';
  if (chosenLeafClasses.length > 0) {
    leafCondition = `[${chosenLeafClasses.map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`).join(' and ')}]`;
  }

  const basePrefix = prefixParts.length > 0 ? prefixParts.join('/') : '';
  return `${basePrefix}//${leafTagStr}${leafCondition}`;
}

/**
 * 处理多选元素并计算相似 XPath
 */
function processMultiSelection() {
  if (ctrlSelectedElements.length === 0) return;

  const similarityXpath = getSimilarityXPath(ctrlSelectedElements);
  if (!similarityXpath) return;

  const matchedElements = getElementsByXPath(similarityXpath);
  
  // 清除前一次的多选和悬停高亮
  removeAllHighlights();
  
  // 将匹配到的所有相似元素高亮为蓝色
  matchedElements.forEach(el => {
    if (el && el.classList) {
      el.classList.add(CLICK_HIGHLIGHT_CLASS);
      validationHighlightedElements.push(el);
    }
  });

  // 获取这些匹配元素的详细属性，供 Side Panel 展示
  const elementsInfo = matchedElements.map((el, index) => {
    return {
      index: index + 1,
      tagName: el.tagName?.toLowerCase() || '',
      id: el.getAttribute('id') || '',
      className: getCleanElementClasses(el).classStr,
      text: el.textContent?.trim().substring(0, 100) || '',
      attributes: Array.from(el.attributes || []).map(attr => ({
        name: attr.name,
        value: attr.value
      })).slice(0, 5)
    };
  });

  const cleanHeadClass = getCleanElementClasses(ctrlSelectedElements[0]).classStr;

  // 发送 XPath 到 popup/sidepanel，携带多选标记
  safeSendMessage({
    type: 'XPATH_CAPTURED',
    xpath: similarityXpath,
    tagName: `${ctrlSelectedElements[0].localName} (相似元素组)`,
    id: `已选中 ${ctrlSelectedElements.length} 个元素`,
    className: cleanHeadClass,
    text: `当前 XPath 共匹配 ${matchedElements.length} 个相似元素`,
    isMultiSelect: true,
    count: matchedElements.length,
    elements: elementsInfo
  });
}

/**
 * 鼠标点击事件处理器（捕获模式）
 */
function handleClick(event) {
  if (!captureMode) return;

  event.preventDefault();
  event.stopPropagation();

  const element = event.target;
  if (element) {
    if (event.ctrlKey || event.metaKey || isCtrlPressed) {
      // 多选模式：支持追加与反选撤销
      const existingIndex = ctrlSelectedElements.indexOf(element);
      if (existingIndex !== -1) {
        ctrlSelectedElements.splice(existingIndex, 1);
        if (ctrlSelectedElements.length === 0) {
          removeAllHighlights();
          safeSendMessage({
            type: 'CLEAR_HIGHLIGHTS'
          });
          return;
        }
      } else {
        ctrlSelectedElements.push(element);
      }
      processMultiSelection();
    } else {
      // 单选模式：清空之前的多选，进行单选捕获
      ctrlSelectedElements = [];
      captureElement(element);
    }
  }
}

/**
 * 键盘按下事件处理器（追踪 Ctrl 键和 Mac Command 键）
 */
function handleKeyDown(event) {
  if ((event.key === 'Control' || event.key === 'Meta') && !isCtrlPressed) {
    isCtrlPressed = true;
  }
}

/**
 * 键盘释放事件处理器（追踪 Ctrl 键和 Mac Command 键）
 */
function handleKeyUp(event) {
  if (event.key === 'Control' || event.key === 'Meta') {
    isCtrlPressed = false;
  }
}

/**
 * 窗口失焦事件处理器（防止按住按键切窗口导致的 Ctrl 状态粘滞）
 */
function handleWindowBlur() {
  isCtrlPressed = false;
}

/**
 * 监听来自 popup/sidepanel 的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'TOGGLE_CAPTURE_MODE':
      captureMode = message.enabled;
      if (captureMode) {
        startCaptureListeners();
      } else {
        stopCaptureListeners();
        removeAllHighlights();
        ctrlSelectedElements = [];
      }
      sendResponse({ success: true });
      break;

    case 'TOGGLE_VALIDATE_MODE':
      validateMode = message.enabled;
      if (!validateMode) {
        removeAllHighlights();
      }
      sendResponse({ success: true });
      break;

    case 'VALIDATE_XPATH':
      try {
        const elements = getElementsByXPath(message.xpath);
        highlightValidationElements(elements);

        // 提取每个节点的详细信息，兼容 Element / Text / Attr 等不同类型节点
        const elementsInfo = elements.map((node, index) => {
          if (!node) return null;

          if (node.nodeType === Node.ELEMENT_NODE) {
            return {
              index: index + 1,
              tagName: node.tagName?.toLowerCase() || '',
              id: node.getAttribute('id') || '',
              className: getCleanElementClasses(node).classStr,
              text: node.textContent?.trim().substring(0, 100) || '',
              attributes: Array.from(node.attributes || []).map(attr => ({
                name: attr.name,
                value: attr.value
              })).slice(0, 5)
            };
          } else if (node.nodeType === Node.ATTRIBUTE_NODE) {
            return {
              index: index + 1,
              tagName: `@${node.name}`,
              id: '',
              className: '',
              text: node.value || '',
              attributes: [{ name: node.name, value: node.value }]
            };
          } else if (node.nodeType === Node.TEXT_NODE) {
            return {
              index: index + 1,
              tagName: '#text',
              id: '',
              className: '',
              text: node.nodeValue?.trim().substring(0, 100) || '',
              attributes: []
            };
          } else {
            return {
              index: index + 1,
              tagName: node.nodeName?.toLowerCase() || '',
              id: '',
              className: '',
              text: (node.nodeValue || node.textContent || '').trim().substring(0, 100),
              attributes: []
            };
          }
        }).filter(Boolean);

        sendResponse({
          success: true,
          count: elements.length,
          elements: elementsInfo
        });
      } catch (error) {
        console.error('XPath 验证错误:', error);
        sendResponse({
          success: false,
          error: error.message || 'XPath 语法错误'
        });
      }
      break;

    case 'SCROLL_TO_ELEMENT':
      // validationHighlightedElements 包含了当前匹配或捕获的高亮元素
      const targetElement = validationHighlightedElements[message.index - 1];
      if (targetElement && typeof targetElement.scrollIntoView === 'function') {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetElement.classList.add('xpath-helper-flash');
        setTimeout(() => {
          targetElement.classList.remove('xpath-helper-flash');
        }, 1500);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '未找到该元素，或该元素已不再处于高亮状态' });
      }
      break;

    case 'TOGGLE_CAPTURE_MODE_SHORTCUT':
      captureMode = !captureMode;
      if (captureMode) {
        startCaptureListeners();
      } else {
        stopCaptureListeners();
        removeAllHighlights();
        ctrlSelectedElements = [];
      }
      sendResponse({ success: true, enabled: captureMode });
      break;

    case 'CLEAR_HIGHLIGHTS':
      removeAllHighlights();
      ctrlSelectedElements = [];
      sendResponse({ success: true });
      break;

    case 'DISABLE_ALL':
      captureMode = false;
      validateMode = false;
      stopCaptureListeners();
      removeAllHighlights();
      ctrlSelectedElements = [];
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: '未知的消息类型' });
  }

  return true; // 保持消息通道开启
});

let listenersActive = false;

/**
 * 开始监听 DOM 事件（开启捕获模式时）
 */
function startCaptureListeners() {
  if (listenersActive) return;
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', handleWindowBlur);
  listenersActive = true;
}

/**
 * 停止监听 DOM 事件（关闭捕获模式时）
 */
function stopCaptureListeners() {
  if (!listenersActive) return;
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('keyup', handleKeyUp, true);
  window.removeEventListener('blur', handleWindowBlur);
  isCtrlPressed = false;
  listenersActive = false;
}

// 初始化完成
console.log('XPath 辅助工具已加载');

