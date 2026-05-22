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
 * 生成元素的 XPath 路径
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
 * 生成更智能的 XPath（优先使用现代测试属性、唯一稳定 id、唯一包含 class 等）
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

  // 3. 如果有唯一的 class（支持包含匹配以处理多类名）
  const className = element.getAttribute('class');
  if (className && className.trim()) {
    // 过滤掉包含 xpath-helper 样式类的类名
    const classes = className.trim().split(/\s+/)
      .filter(cls => cls && !cls.startsWith('xpath-helper-'));
    
    if (classes.length > 0) {
      // 3.1 尝试寻找列表中任意一个本身就唯一的 class
      for (const cls of classes) {
        const xpath = `//${tagNameStr}[contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')]`;
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (result.snapshotLength === 1) {
            return xpath;
          }
        } catch (e) {}
      }

      // 3.2 尝试组合前几个 class 进行唯一定位
      if (classes.length > 1) {
        const conditions = classes.slice(0, 3) // 最多取前3个进行组合，避免表达式过长
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

  // 4.5 尝试基于唯一的短文本内容定位
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length <= 15 && !text.includes('\n') && !text.includes('\r')) {
    if (element.children.length <= 1) {
      let quoteChar = '"';
      if (text.includes('"')) {
        if (text.includes("'")) {
          // 如果同时包含单双引号，为了安全跳过 text 匹配
          quoteChar = null;
        } else {
          quoteChar = "'";
        }
      }
      if (quoteChar) {
        const xpath = `//${tagNameStr}[text()=${quoteChar}${text}${quoteChar}]`;
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (result.snapshotLength === 1) {
            return xpath;
          }
        } catch (e) {}
      }
    }
  }

  // 5. 否则返回完整绝对路径
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

  // 添加新的验证高亮
  elements.forEach(el => {
    if (el && el.classList) {
      el.classList.add(VALIDATE_HIGHLIGHT_CLASS);
      validationHighlightedElements.push(el);
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

  // 发送 XPath 到 popup/sidepanel
  safeSendMessage({
    type: 'XPATH_CAPTURED',
    xpath: xpath,
    tagName: element.localName,
    id: element.getAttribute('id') || '',
    className: element.getAttribute('class') || '', // 修复 SVG class 显示问题
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
 * 计算多个元素的相似 XPath
 */
function getSimilarityXPath(elements) {
  if (elements.length === 0) return '';
  if (elements.length === 1) return getSmartXPath(elements[0]);

  // 1. 尝试使用最近公共祖先 (LCA) 唯一定位算法
  const lca = getLCA(elements);
  if (lca && lca !== document.body && lca !== document.documentElement && lca.nodeType === Node.ELEMENT_NODE) {
    const lcaXPath = getSmartXPath(lca);
    if (lcaXPath) {
      const relativeStepsList = elements.map(el => getRelativePathSteps(el, lca));
      const minSubLen = Math.min(...relativeStepsList.map(s => s.length));
      
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
        
        // 寻找该层级的公共 Class
        const classesList = levelSteps.map(step => {
          const cls = step.className;
          if (!cls) return [];
          const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');
          return clsStr.trim().split(/\s+/).filter(Boolean);
        });
        
        let commonClasses = [];
        if (classesList.length > 0) {
          commonClasses = classesList[0].filter(cls => 
            !cls.startsWith('xpath-helper-') && classesList.every(clsList => clsList.includes(cls))
          );
        }
        
        // 检查所有元素的兄弟索引是否完全相同
        const sameIndex = levelSteps.every(step => step.index === firstStep.index);
        
        let stepStr = tagNameStr;
        if (commonClasses.length > 0) {
          const specificClasses = commonClasses.filter(cls => !isUtilityClass(cls));
          let chosenClasses = [];
          if (specificClasses.length > 0) {
            chosenClasses = specificClasses.slice(0, 2);
          } else {
            chosenClasses = [...commonClasses].sort((a, b) => b.length - a.length).slice(0, 2);
          }
          if (chosenClasses.length > 0) {
            const conditions = chosenClasses.map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`).join(' and ');
            stepStr += `[${conditions}]`;
          }
        } else if (sameIndex) {
          stepStr += `[${firstStep.index}]`;
        }
        
        subParts.push(stepStr);
      }
      
      return lcaXPath + '/' + subParts.join('/');
    }
  }

  // 2. 兜底方案：退回到原有的自下而上的全局 Pivot 算法
  const allSteps = elements.map(getElementPathSteps);
  const minLen = Math.min(...allSteps.map(steps => steps.length));
  
  let pivotIndex = -1;
  let pivotType = ''; // 'id' 或 'class'
  let pivotValue = []; // 保存选中的公共类名数组，或 ID 字符串

  for (let i = minLen - 1; i >= 0; i--) {
    const levelSteps = allSteps.map(steps => steps[i]);
    const firstStep = levelSteps[0];
    
    const sameId = firstStep.id && !isDynamicId(firstStep.id) && levelSteps.every(step => step.id === firstStep.id);
    if (sameId) {
      pivotIndex = i;
      pivotType = 'id';
      pivotValue = firstStep.id;
      break;
    }
    
    const classesList = levelSteps.map(step => {
      const cls = step.className;
      if (!cls) return [];
      const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');
      return clsStr.trim().split(/\s+/).filter(Boolean);
    });
    
    let commonClasses = [];
    if (classesList.length > 0) {
      commonClasses = classesList[0].filter(cls => 
        !cls.startsWith('xpath-helper-') && classesList.every(clsList => clsList.includes(cls))
      );
    }
    
    if (commonClasses.length > 0) {
      const specificClasses = commonClasses.filter(cls => !isUtilityClass(cls));
      let chosenClasses = [];
      
      if (specificClasses.length > 0) {
        chosenClasses = specificClasses.slice(0, 2);
      } else {
        chosenClasses = [...commonClasses].sort((a, b) => b.length - a.length).slice(0, 2);
      }

      if (chosenClasses.length > 0) {
        pivotIndex = i;
        pivotType = 'class';
        pivotValue = chosenClasses;
        break;
      }
    }
  }

  const xpathParts = [];
  let startIdx = 0;

  if (pivotIndex !== -1) {
    if (pivotType === 'id') {
      xpathParts.push(`//*[@id="${pivotValue}"]`);
    } else if (pivotType === 'class') {
      const firstStep = allSteps[0][pivotIndex];
      const tagNameStr = firstStep.isSVG ? `*[local-name()='${firstStep.tagName}']` : firstStep.tagName;
      const conditions = pivotValue.map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`).join(' and ');
      xpathParts.push(`//${tagNameStr}[${conditions}]`);
    }
    startIdx = pivotIndex + 1;
  } else {
    xpathParts.push('');
  }

  for (let i = startIdx; i < minLen; i++) {
    const levelSteps = allSteps.map(steps => steps[i]);
    const firstStep = levelSteps[0];
    const sameTagName = levelSteps.every(step => step.tagName === firstStep.tagName);
    
    if (!sameTagName) {
      xpathParts.push('*');
      continue;
    }
    
    const tagNameStr = firstStep.isSVG ? `*[local-name()='${firstStep.tagName}']` : firstStep.tagName;
    
    const classesList = levelSteps.map(step => {
      const cls = step.className;
      if (!cls) return [];
      const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');
      return clsStr.trim().split(/\s+/).filter(Boolean);
    });
    
    let commonClasses = [];
    if (classesList.length > 0) {
      commonClasses = classesList[0].filter(cls => 
        !cls.startsWith('xpath-helper-') && classesList.every(clsList => clsList.includes(cls))
      );
    }
    
    const sameIndex = levelSteps.every(step => step.index === firstStep.index);
    
    let stepStr = tagNameStr;
    if (commonClasses.length > 0) {
      const specificClasses = commonClasses.filter(cls => !isUtilityClass(cls));
      let chosenClasses = [];
      if (specificClasses.length > 0) {
        chosenClasses = specificClasses.slice(0, 2);
      } else {
        chosenClasses = [...commonClasses].sort((a, b) => b.length - a.length).slice(0, 2);
      }
      if (chosenClasses.length > 0) {
        const conditions = chosenClasses.map(cls => `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`).join(' and ');
        stepStr += `[${conditions}]`;
      }
    } else if (sameIndex) {
      stepStr += `[${firstStep.index}]`;
    }
    
    xpathParts.push(stepStr);
  }

  return xpathParts.join('/');
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
      className: typeof el.getAttribute('class') === 'string' ? el.getAttribute('class') : '',
      text: el.textContent?.trim().substring(0, 100) || '',
      attributes: Array.from(el.attributes || []).map(attr => ({
        name: attr.name,
        value: attr.value
      })).slice(0, 5)
    };
  });

  // 发送 XPath 到 popup/sidepanel，携带多选标记
  safeSendMessage({
    type: 'XPATH_CAPTURED',
    xpath: similarityXpath,
    tagName: `${ctrlSelectedElements[0].localName} (相似元素组)`,
    id: `已选中 ${ctrlSelectedElements.length} 个元素`,
    className: ctrlSelectedElements[0].getAttribute('class') || '',
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
      // 多选模式
      if (!ctrlSelectedElements.includes(element)) {
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

        // 提取每个元素的详细信息
        const elementsInfo = elements.map((el, index) => {
          return {
            index: index + 1,
            tagName: el.tagName?.toLowerCase() || '',
            id: el.getAttribute('id') || '',
            className: typeof el.getAttribute('class') === 'string' ? el.getAttribute('class') : '',
            text: el.textContent?.trim().substring(0, 100) || '',
            attributes: Array.from(el.attributes || []).map(attr => ({
              name: attr.name,
              value: attr.value
            })).slice(0, 5) // 只取前5个属性
          };
        });

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
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 添加闪烁样式类
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
      // 通过快捷键切换捕获模式
      captureMode = !captureMode;
      if (captureMode) {
        startCaptureListeners();
      } else {
        stopCaptureListeners();
        removeAllHighlights();
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
  listenersActive = false;
}

// 移除默认的全局监听，改为动态加载
// 初始化完成
console.log('XPath 辅助工具已加载');
