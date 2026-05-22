// XPath 辅助工具 - 弹出窗口脚本
// 负责用户界面交互和与 content script 通信

// DOM 元素
const toggleCaptureBtn = document.getElementById('toggleCapture');
const toggleValidateBtn = document.getElementById('toggleValidate');
const xpathInput = document.getElementById('xpathInput');
const copyBtn = document.getElementById('copyBtn');
const validateBtn = document.getElementById('validateBtn');
const clearBtn = document.getElementById('clearBtn');
const clearExpressionBtn = document.getElementById('clearExpressionBtn');
const infoSection = document.getElementById('infoSection');
const matchCount = document.getElementById('matchCount');
const toast = document.getElementById('toast');
const matchesSection = document.getElementById('matchesSection');
const matchesList = document.getElementById('matchesList');
const toggleMatchesBtn = document.getElementById('toggleMatchesBtn');

// 状态管理
let captureMode = false;
let validateMode = false;
let currentTabId = null;
let capturedFrameId = 0; // 记录捕获 XPath 时来源的 Frame ID

/**
 * 检查 URL 是否受支持
 */
function isSupportedUrl(url) {
    if (!url) return false;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

/**
 * 同步状态到目标标签页，并检查是否支持该页面
 */
async function syncStateWithTab(tab) {
    if (!tab) return;
    currentTabId = tab.id;

    const overlayId = 'unsupported-page-overlay';
    let overlay = document.getElementById(overlayId);

    if (!isSupportedUrl(tab.url)) {
        // 显示不支持的遮罩层
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = 'var(--overlay-bg)';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '9999';
            overlay.style.padding = '20px';
            overlay.style.textAlign = 'center';
            
            overlay.innerHTML = `
                <div style="font-size: 3rem; margin-bottom: 15px;">⚠️</div>
                <h3 style="margin-bottom: 10px; color: var(--text-primary);">当前页面不支持 XPath 捕获</h3>
                <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 20px;">
                    Chrome 限制了在系统页面 (如 chrome://)、扩展程序商店 (Chrome Web Store) 或空白页上运行脚本。
                </p>
                <p style="font-size: 0.8rem; color: var(--primary-solid); font-weight: 600;">
                    请在普通的网页上使用本工具。
                </p>
            `;
            document.body.appendChild(overlay);
        }
        return;
    } else {
        // 移除遮罩层
        if (overlay) {
            overlay.remove();
        }
    }

    // 同步当前状态到所有标签页的 frame
    try {
        await sendMessageToAllFrames({ type: 'TOGGLE_CAPTURE_MODE', enabled: captureMode });
        await sendMessageToAllFrames({ type: 'TOGGLE_VALIDATE_MODE', enabled: validateMode });
        if (validateMode && xpathInput.value.trim()) {
            validateXPath();
        }
    } catch (e) {
        console.error('同步状态到 Tab 失败:', e);
    }
}

/**
 * 初始化 - 获取当前标签页
 */
async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        currentTabId = tab.id;
        await syncStateWithTab(tab);
    }

    // 建立与后台的长连接，用于检测侧边栏关闭
    try {
        const port = chrome.runtime.connect({ name: 'sidepanel-connection' });
        port.postMessage({ type: 'INIT', tabId: currentTabId });
    } catch (e) {
        console.error('无法连接后台:', e);
    }

    // 从存储中恢复状态并同步至 Tab 页面
    chrome.storage.local.get(['captureMode', 'validateMode', 'lastXPath'], async (data) => {
        if (data.lastXPath) {
            xpathInput.value = data.lastXPath;
        }

        if (data.captureMode) {
            captureMode = true;
            updateButtonState(toggleCaptureBtn, true, '停止', '启动');
        }

        if (data.validateMode) {
            validateMode = true;
            updateButtonState(toggleValidateBtn, true, '停止', '启动');
        }

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
            await syncStateWithTab(activeTab);
        }
    });
}

/**
 * 向当前标签页发送消息
 */
async function sendMessageToTab(message, silent = false, frameId = null) {
    if (!currentTabId) return null;
    try {
        const options = {};
        if (frameId !== null) {
            options.frameId = frameId;
        }
        const response = await chrome.tabs.sendMessage(currentTabId, message, options);
        return response;
    } catch (error) {
        if (!silent) {
            console.error('发送消息失败:', error);
            showToast('无法与页面通信，请刷新页面后重试', 'error');
        } else {
            console.warn('与页面通信静默失败:', error);
        }
        return null;
    }
}

/**
 * 向当前标签页的所有 frame 发送消息
 */
async function sendMessageToAllFrames(message) {
    if (!currentTabId) return [];
    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
        const promises = frames.map(frame => {
            return chrome.tabs.sendMessage(currentTabId, message, { frameId: frame.frameId })
                .catch(err => {
                    // 忽略未注入或不可达 frame 的错误
                    return null;
                });
        });
        return await Promise.all(promises);
    } catch (error) {
        console.error('广播消息失败:', error);
        const res = await sendMessageToTab(message, true);
        return [res];
    }
}

/**
 * 显示提示消息
 */
function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

/**
 * 更新按钮状态
 */
function updateButtonState(button, isActive, activeText, inactiveText) {
    if (isActive) {
        button.classList.add('active');
        button.querySelector('.btn-text').textContent = activeText;
        button.querySelector('.btn-icon').textContent = '⏸';
    } else {
        button.classList.remove('active');
        button.querySelector('.btn-text').textContent = inactiveText;
        button.querySelector('.btn-icon').textContent = '▶';
    }
}

/**
 * 切换捕获模式
 */
async function toggleCaptureMode() {
    captureMode = !captureMode;

    // 如果启用捕获模式，关闭验证模式
    if (captureMode && validateMode) {
        validateMode = false;
        updateButtonState(toggleValidateBtn, false, '启动', '启动');
        await sendMessageToAllFrames({ type: 'TOGGLE_VALIDATE_MODE', enabled: false });
    }

    updateButtonState(toggleCaptureBtn, captureMode, '停止', '启动');

    const responses = await sendMessageToAllFrames({
        type: 'TOGGLE_CAPTURE_MODE',
        enabled: captureMode
    });

    const anySuccess = responses.some(res => res?.success);
    if (anySuccess || responses.length > 0) {
        showToast(
            captureMode ? '✅ 捕获模式已启动，点击页面元素获取 XPath' : '⏸️ 捕获模式已停止',
            'success'
        );

        // 保存状态
        chrome.storage.local.set({ captureMode });
    }
}

/**
 * 切换验证模式
 */
async function toggleValidateMode() {
    validateMode = !validateMode;

    // 如果启用验证模式，关闭捕获模式
    if (validateMode && captureMode) {
        captureMode = false;
        updateButtonState(toggleCaptureBtn, false, '启动', '启动');
        await sendMessageToAllFrames({ type: 'TOGGLE_CAPTURE_MODE', enabled: false });
    }

    updateButtonState(toggleValidateBtn, validateMode, '停止', '启动');

    const responses = await sendMessageToAllFrames({
        type: 'TOGGLE_VALIDATE_MODE',
        enabled: validateMode
    });

    const anySuccess = responses.some(res => res?.success);
    if (anySuccess || responses.length > 0) {
        showToast(
            validateMode ? '✅ 验证模式已启动，输入 XPath 查看匹配' : '⏸️ 验证模式已停止',
            'success'
        );

        // 保存状态
        chrome.storage.local.set({ validateMode });

        // 如果启用验证模式且输入框有内容，自动验证
        if (validateMode && xpathInput.value.trim()) {
            validateXPath();
        }
    }
}

/**
 * 验证 XPath
 */
async function validateXPath() {
    const xpath = xpathInput.value.trim();

    if (!xpath) {
        showToast('请输入 XPath 表达式', 'error');
        return;
    }

    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
        
        const validationPromises = frames.map(async (frame) => {
            try {
                const response = await chrome.tabs.sendMessage(currentTabId, {
                    type: 'VALIDATE_XPATH',
                    xpath: xpath
                }, { frameId: frame.frameId });
                
                if (response) {
                    if (response.success) {
                        return {
                            success: true,
                            frameId: frame.frameId,
                            count: response.count,
                            elements: (response.elements || []).map(el => ({ ...el, frameId: frame.frameId }))
                        };
                    } else {
                        return {
                            success: false,
                            error: response.error,
                            frameId: frame.frameId
                        };
                    }
                }
            } catch (e) {
                // 忽略未注入或不可达 frame 的错误
            }
            return { success: false, frameId: frame.frameId, count: 0, elements: [] };
        });

        const results = await Promise.all(validationPromises);
        
        let totalCount = 0;
        let allElements = [];
        let hasSuccess = false;
        let syntaxErrorMsg = null;

        results.forEach(res => {
            if (res.success) {
                hasSuccess = true;
                totalCount += res.count;
                allElements.push(...res.elements);
            } else if (res.error) {
                syntaxErrorMsg = res.error;
            }
        });

        if (hasSuccess) {
            matchCount.textContent = `${totalCount} 个匹配`;

            if (totalCount === 0) {
                showToast('⚠️ 未找到匹配的元素', 'error');
                matchesSection.style.display = 'none';
            } else {
                showToast(`✅ 找到 ${totalCount} 个匹配 of 元素`, 'success');
                displayMatchedElements(allElements);
            }
            // 保存 XPath
            chrome.storage.local.set({ lastXPath: xpath });
        } else if (syntaxErrorMsg) {
            matchCount.textContent = '语法错误';
            showToast(`❌ ${syntaxErrorMsg}`, 'error');
            matchesSection.style.display = 'none';
        } else {
            matchCount.textContent = '0 个匹配';
            showToast('⚠️ 未找到匹配的元素', 'error');
            matchesSection.style.display = 'none';
        }
    } catch (err) {
        console.error('获取所有 frame 失败:', err);
        // 退回到单框架验证
        const response = await sendMessageToTab({
            type: 'VALIDATE_XPATH',
            xpath: xpath
        });
        if (response?.success) {
            const count = response.count;
            const elements = (response.elements || []).map(el => ({ ...el, frameId: 0 }));
            matchCount.textContent = `${count} 个匹配`;
            if (count === 0) {
                matchesSection.style.display = 'none';
            } else {
                displayMatchedElements(elements);
            }
            chrome.storage.local.set({ lastXPath: xpath });
        } else {
            const errMsg = response?.error || 'XPath 语法错误';
            matchCount.textContent = '语法错误';
            showToast(`❌ ${errMsg}`, 'error');
            matchesSection.style.display = 'none';
        }
    }
}

/**
 * 复制 XPath 到剪贴板
 */
async function copyXPath() {
    const xpath = xpathInput.value.trim();

    if (!xpath) {
        showToast('没有可复制的 XPath', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(xpath);
        showToast('✅ XPath 已复制到剪贴板', 'success');

        // 复制按钮动画
        copyBtn.style.transform = 'scale(0.9)';
        setTimeout(() => {
            copyBtn.style.transform = 'scale(1)';
        }, 150);
    } catch (error) {
        showToast('❌ 复制失败', 'error');
    }
}

/**
 * 清除所有高亮
 */
async function clearHighlights() {
    await sendMessageToAllFrames({ type: 'CLEAR_HIGHLIGHTS' });

    showToast('✅ 已清除所有高亮', 'success');
    matchCount.textContent = '';
    infoSection.style.display = 'none';
    matchesSection.style.display = 'none';
    matchesList.innerHTML = '';
}

/**
 * 显示元素信息
 */
function showElementInfo(data) {
    document.getElementById('tagName').textContent = data.tagName || '-';
    document.getElementById('elementId').textContent = data.id || '-';
    document.getElementById('className').textContent = data.className || '-';
    document.getElementById('textContent').textContent = data.text || '-';

    infoSection.style.display = 'block';
}

/**
 * 显示匹配元素列表
 */
function displayMatchedElements(elements) {
    if (!elements || elements.length === 0) {
        matchesSection.style.display = 'none';
        return;
    }

    // 清空之前的列表
    matchesList.innerHTML = '';

    // 生成元素列表
    elements.forEach(el => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'match-item';

        // 构建HTML内容
        let html = `
            <div class="match-item-header">
                <span class="match-index">#${el.index}</span>
                <span class="match-tag">&lt;${el.tagName}&gt;</span>
            </div>
            <div class="match-details">
        `;

        // 添加 ID
        if (el.id) {
            html += `
                <div class="match-detail-row">
                    <span class="match-detail-label">ID:</span>
                    <span class="match-detail-value">${escapeHtml(el.id)}</span>
                </div>
            `;
        }

        // 添加 Class
        if (el.className) {
            html += `
                <div class="match-detail-row">
                    <span class="match-detail-label">Class:</span>
                    <span class="match-detail-value">${escapeHtml(el.className)}</span>
                </div>
            `;
        }

        html += `</div>`;

        // 添加文本内容
        if (el.text) {
            html += `<div class="match-text">"${escapeHtml(el.text)}"</div>`;
        }

        // 添加属性列表（如果有）
        if (el.attributes && el.attributes.length > 0) {
            html += '<div class="match-attributes">';
            el.attributes.forEach(attr => {
                html += `
                    <div class="match-attr">
                        <span class="match-attr-name">${escapeHtml(attr.name)}:</span>
                        <span class="match-attr-value">${escapeHtml(attr.value)}</span>
                    </div>
                `;
            });
            html += '</div>';
        }

        itemDiv.innerHTML = html;
        // 绑定点击事件以滚动并闪烁网页上的目标元素
        itemDiv.addEventListener('click', () => {
            sendMessageToTab({
                type: 'SCROLL_TO_ELEMENT',
                index: el.index
            }, false, el.frameId);
        });
        matchesList.appendChild(itemDiv);
    });

    // 显示匹配元素区域
    matchesSection.style.display = 'block';
}

/**
 * 转义HTML特殊字符
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 切换匹配列表的折叠/展开
 */
function toggleMatchesList() {
    matchesList.classList.toggle('collapsed');
    toggleMatchesBtn.classList.toggle('collapsed');
}

/**
 * 监听来自 content script 或 background 的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TAB_RELOADED' && message.tabId === currentTabId) {
        // 重置侧边栏状态以保持同步
        captureMode = false;
        validateMode = false;
        updateButtonState(toggleCaptureBtn, false, '启动', '启动');
        updateButtonState(toggleValidateBtn, false, '启动', '启动');
        matchCount.textContent = '';
        infoSection.style.display = 'none';
        matchesSection.style.display = 'none';
        matchesList.innerHTML = '';
        showToast('ℹ️ 页面已重新加载，状态已重置', 'info');
    } else if (message.type === 'XPATH_CAPTURED') {
        capturedFrameId = (sender && typeof sender.frameId !== 'undefined') ? sender.frameId : 0;

        if (message.isMultiSelect) {
            xpathInput.value = message.xpath;
            showElementInfo(message);
            matchCount.textContent = `${message.count} 个匹配`;
            
            const elementsWithFrame = (message.elements || []).map(el => ({
                ...el,
                frameId: capturedFrameId
            }));

            if (message.count === 0) {
                matchesSection.style.display = 'none';
            } else {
                displayMatchedElements(elementsWithFrame);
            }
            
            showToast(`✅ 相似元素 XPath 已生成 (${message.count} 个匹配)`, 'success');
        } else {
            xpathInput.value = message.xpath;
            showElementInfo(message);
            matchCount.textContent = '';
            matchesSection.style.display = 'none';
            showToast('✅ XPath 已生成', 'success');
        }

        // 保存 XPath
        chrome.storage.local.set({ lastXPath: message.xpath });
    }
});

/**
 * XPath 输入实时验证（验证模式下）
 */
let validateTimeout = null;
xpathInput.addEventListener('input', () => {
    if (!validateMode) return;

    // 防抖处理
    clearTimeout(validateTimeout);
    validateTimeout = setTimeout(() => {
        if (xpathInput.value.trim()) {
            validateXPath();
        }
    }, 500);
});


/**
 * 清除输入框表达式
 */
function clearExpression() {
    xpathInput.value = '';
    xpathInput.focus();
    showToast('已清除表达式', 'info');
}

// 事件监听器
toggleCaptureBtn.addEventListener('click', toggleCaptureMode);
toggleValidateBtn.addEventListener('click', toggleValidateMode);
validateBtn.addEventListener('click', validateXPath);
copyBtn.addEventListener('click', copyXPath);
clearExpressionBtn.addEventListener('click', clearExpression);
clearBtn.addEventListener('click', clearHighlights);
toggleMatchesBtn.addEventListener('click', toggleMatchesList);

// 输入框回车验证
xpathInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        validateXPath();
    }
});

// 初始化
init();

// 监测 tab 切换以动态更新 activeTabId 并同步状态
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.windowId === chrome.windows.WINDOW_ID_CURRENT) {
            await syncStateWithTab(tab);
        }
    } catch (e) {
        console.error(e);
    }
});

// 监测 tab 更新 (如刷新或跳转新页面)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === currentTabId && changeInfo.status === 'complete') {
        await syncStateWithTab(tab);
    }
});

// 监测窗口焦点切换
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
        const [tab] = await chrome.tabs.query({ active: true, windowId: windowId });
        if (tab) {
            await syncStateWithTab(tab);
        }
    } catch (e) {
        console.error(e);
    }
});
