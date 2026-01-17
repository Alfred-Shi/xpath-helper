// XPath 辅助工具 - 内容脚本
// 负责 DOM 交互、XPath 计算和元素高亮

// 全局状态
let captureMode = false;
let validateMode = false;
let currentHighlightedElement = null;
let validationHighlightedElements = [];
let isCtrlPressed = false; // 追踪 Ctrl 键状态
let lastHoveredElement = null; // 追踪最后悬停的元素

// 高亮样式类名
const HOVER_HIGHLIGHT_CLASS = 'xpath-helper-hover';
const CLICK_HIGHLIGHT_CLASS = 'xpath-helper-click';
const VALIDATE_HIGHLIGHT_CLASS = 'xpath-helper-validate';

/**
 * 生成元素的 XPath 路径
 * @param {Element} element - 目标元素
 * @returns {string} - 元素的 XPath 路径
 */
function getXPath(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  if (element === document.body) {
    return '/html/body';
  }

  let path = '';
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 0;
    let sibling = current.previousSibling;

    // 计算同名兄弟元素的索引
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = current.nodeName.toLowerCase();
    const pathIndex = index > 0 ? `[${index + 1}]` : '';
    path = `/${tagName}${pathIndex}${path}`;

    current = current.parentNode;
  }

  return path;
}

/**
 * 生成更智能的 XPath（优先使用 id、class、属性等）
 * @param {Element} element - 目标元素
 * @returns {string} - 优化后的 XPath 路径
 */
function getSmartXPath(element) {
  // 如果有 id，直接使用
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  // 如果有唯一的 class
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.trim().split(/\s+/);
    if (classes.length > 0 && classes[0]) {
      const xpath = `//${element.tagName.toLowerCase()}[@class="${classes[0]}"]`;
      // 验证是否唯一
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (result.snapshotLength === 1) {
        return xpath;
      }
    }
  }

  // 如果有 name 属性
  if (element.name) {
    const xpath = `//${element.tagName.toLowerCase()}[@name="${element.name}"]`;
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (result.snapshotLength === 1) {
      return xpath;
    }
  }

  // 否则返回完整路径
  return getXPath(element);
}

/**
 * 根据 XPath 查找元素
 * @param {string} xpath - XPath 表达式
 * @returns {Array} - 匹配的元素数组
 */
function getElementsByXPath(xpath) {
  const results = [];
  try {
    const query = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < query.snapshotLength; i++) {
      results.push(query.snapshotItem(i));
    }
  } catch (error) {
    console.error('XPath 查询错误:', error);
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

  // 移除验证高亮
  validationHighlightedElements.forEach(el => {
    if (el && el.classList) {
      el.classList.remove(VALIDATE_HIGHLIGHT_CLASS);
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

    // 如果按住 Ctrl 键（检查 event.ctrlKey 或 isCtrlPressed），自动捕获该元素
    if (event.ctrlKey || isCtrlPressed) {
      captureElement(element);
    }
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
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    className: element.className || '',
    text: element.textContent?.substring(0, 50) || ''
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
    captureElement(element);
  }
}

/**
 * 键盘按下事件处理器（追踪 Ctrl 键）
 */
function handleKeyDown(event) {
  if (event.key === 'Control' && !isCtrlPressed) {
    isCtrlPressed = true;
    // 如果当前有悬停的元素且在捕获模式下，立即捕获
    if (captureMode && lastHoveredElement) {
      captureElement(lastHoveredElement);
    }
  }
}

/**
 * 键盘释放事件处理器（追踪 Ctrl 键）
 */
function handleKeyUp(event) {
  if (event.key === 'Control') {
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
      const elements = getElementsByXPath(message.xpath);
      highlightValidationElements(elements);

      // 提取每个元素的详细信息
      const elementsInfo = elements.map((el, index) => {
        return {
          index: index + 1,
          tagName: el.tagName?.toLowerCase() || '',
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
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
