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
    const pathIndex = index > 0 ? `[${index + 1}]` : '';
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
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0 && classes[0]) {
      const xpath = `//${tagNameStr}[contains(concat(' ', normalize-space(@class), ' '), ' ${classes[0]} ')]`;
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

  // 移除悬停高亮，添加点击高亮
  element.classList.remove(HOVER_HIGHLIGHT_CLASS);
  element.classList.add(CLICK_HIGHLIGHT_CLASS);

  // 生成 XPath
  const xpath = getSmartXPath(element);

  // 发送 XPath 到 popup/sidepanel
  chrome.runtime.sendMessage({
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
 * 计算多个元素的相似 XPath
 */
function getSimilarityXPath(elements) {
  if (elements.length === 0) return '';
  if (elements.length === 1) return getSmartXPath(elements[0]);

  const allSteps = elements.map(getElementPathSteps);
  const minLen = Math.min(...allSteps.map(steps => steps.length));
  
  let pivotIndex = -1;
  let pivotType = ''; // 'id' 或 'class'
  let pivotValue = '';

  // 从右往左（从叶子到根）寻找第一个公共的 ID 或 Class 作为优化锚点
  for (let i = minLen - 1; i >= 0; i--) {
    const levelSteps = allSteps.map(steps => steps[i]);
    const firstStep = levelSteps[0];
    
    // 检查是否全都有相同的 ID，且不是动态 ID
    const sameId = firstStep.id && !isDynamicId(firstStep.id) && levelSteps.every(step => step.id === firstStep.id);
    if (sameId) {
      pivotIndex = i;
      pivotType = 'id';
      pivotValue = firstStep.id;
      break;
    }
    
    // 检查是否全都有相同的 Class
    const classesList = levelSteps.map(step => {
      const cls = step.className;
      if (!cls) return [];
      const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');
      return clsStr.trim().split(/\s+/).filter(Boolean);
    });
    
    let commonClasses = [];
    if (classesList.length > 0) {
      commonClasses = classesList[0].filter(cls => 
        classesList.every(clsList => clsList.includes(cls))
      );
    }
    
    if (commonClasses.length > 0) {
      pivotIndex = i;
      pivotType = 'class';
      pivotValue = commonClasses[0];
      break;
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
      xpathParts.push(`//${tagNameStr}[contains(@class, "${pivotValue}")]`);
    }
    startIdx = pivotIndex + 1;
  } else {
    xpathParts.push(''); // 代表绝对路径开头 '/'
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
        classesList.every(clsList => clsList.includes(cls))
      );
    }
    
    // 检查所有元素的兄弟索引是否完全相同
    const sameIndex = levelSteps.every(step => step.index === firstStep.index);
    
    let stepStr = tagNameStr;
    if (commonClasses.length > 0) {
      stepStr += `[contains(@class, "${commonClasses[0]}")]`;
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
  chrome.runtime.sendMessage({
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
      if (!captureMode) {
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
      if (!captureMode) {
        removeAllHighlights();
      }
      sendResponse({ success: true, enabled: captureMode });
      break;

    case 'CLEAR_HIGHLIGHTS':
      removeAllHighlights();
      sendResponse({ success: true });
      break;

    case 'DISABLE_ALL':
      captureMode = false;
      validateMode = false;
      removeAllHighlights();
      ctrlSelectedElements = [];
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: '未知的消息类型' });
  }

  return true; // 保持消息通道开启
});

// 添加事件监听器
document.addEventListener('mousemove', handleMouseMove, true);
document.addEventListener('click', handleClick, true);
document.addEventListener('keydown', handleKeyDown, true);
document.addEventListener('keyup', handleKeyUp, true);

// 初始化完成
console.log('XPath 辅助工具已加载');
