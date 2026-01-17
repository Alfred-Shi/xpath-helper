// XPath 辅助工具 - 后台服务脚本
// 负责扩展的生命周期管理和消息路由

// 监听扩展安装或更新
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('XPath 辅助工具已安装');

        // 设置默认配置
        chrome.storage.local.set({
            captureMode: false,
            validateMode: false,
            lastXPath: ''
        });

        // 可选：打开欢迎页面
        // chrome.tabs.create({ url: 'welcome.html' });
    } else if (details.reason === 'update') {
        console.log('XPath 辅助工具已更新到版本:', chrome.runtime.getManifest().version);
    }

    // 设置点击图标时切换侧边栏可见性 (Toggle)
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error('setPanelBehavior error:', error));
});

// 监听扩展图标点击事件 - 打开侧边栏
// 监听扩展图标点击事件 - 由 setPanelBehavior 自动处理，无需手动 open
// chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }) 已在 onInstalled 中设置

// 监听来自 content script 或 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('后台接收到消息:', message);

    // 这里可以添加需要在后台处理的逻辑
    // 例如：跨标签页通信、数据持久化等

    switch (message.type) {
        case 'BACKGROUND_PING':
            sendResponse({ status: 'pong' });
            break;

        default:
            // 其他消息可以转发或处理
            break;
    }

    return true; // 保持消息通道开启
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        console.log('标签页加载完成:', tabId);

        // 页面加载完成后，可以重置某些状态
        // 例如：关闭捕获模式和验证模式
    }
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
    // open-side-panel 命令已移除，使用 _execute_action 原生处理

    if (command === 'toggle-capture') {
        // 获取当前活动标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab) {
            // 向 content script 发送切换捕获模式的消息
            try {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'TOGGLE_CAPTURE_MODE_SHORTCUT'
                });

                if (response?.success) {
                    console.log('捕获模式已通过快捷键切换:', response.enabled);
                }
            } catch (error) {
                console.error('快捷键切换失败:', error);
            }
        }
    }
});

console.log('XPath 辅助工具后台服务已启动');

// 监听长连接（用于检测 Side Panel 关闭）
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel-connection') {
        let currentTabId = null;

        port.onMessage.addListener((msg) => {
            if (msg.type === 'INIT' && msg.tabId) {
                currentTabId = msg.tabId;
            }
        });

        port.onDisconnect.addListener(async () => {
            if (currentTabId) {
                console.log('Side Panel 关闭，正在清理 Tab:', currentTabId);
                // 重置该 Tyab 的状态
                try {
                    await chrome.tabs.sendMessage(currentTabId, { type: 'DISABLE_ALL' });
                    // 同时清除 storage 中的状态，以免下次打开时误判
                    await chrome.storage.local.set({ 
                        captureMode: false, 
                        validateMode: false 
                    });
                } catch (error) {
                    // Tab 可能已经关闭了，忽略错误
                    console.log('无法清理 Tab (可能已关闭):', error);
                }
            }
        });
    }
});
