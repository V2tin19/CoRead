package com.coread.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;

    /** 复用一个空壳 ActionMode 实例（见 SentinelActionMode）。 */
    private final android.view.ActionMode sentinelActionMode = new SentinelActionMode();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.addJavascriptInterface(new Object() {
                    @JavascriptInterface
                    public void setStatusBarVisible(boolean visible) {
                        runOnUiThread(() -> {
                            try {
                                WindowInsetsControllerCompat controller =
                                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                                if (controller != null) {
                                    if (visible) {
                                        controller.show(WindowInsetsCompat.Type.statusBars());
                                    } else {
                                        controller.hide(WindowInsetsCompat.Type.statusBars());
                                        controller.setSystemBarsBehavior(
                                            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                                        );
                                    }
                                }
                            } catch (Exception ignored) {}
                        });
                    }
                }, "AndroidStatusBar");

                // 注：输入框焦点上报的桥（AndroidTextSelection）不在这里登记 ——
                // 这里已经晚于 loadUrl 了，见 CoreadWebView 构造函数的注释。
            }
        } catch (Exception ignored) {}
    }

    /**
     * 当前是否可以压掉原生文本选择菜单。
     *
     * 拿不到 WebView、或 WebView 不是我们的子类时**保守返回 false**（= 放行原生菜单）：
     * 宁可多出一条系统菜单，也不要造成「输入框里没法粘贴」这种硬伤。
     */
    private boolean shouldSuppressTextSelectionMenu() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView instanceof CoreadWebView) {
                return !((CoreadWebView) webView).isEditableFocused();
            }
        } catch (Exception ignored) {}
        return false;
    }

    /**
     * 抑制 Android 原生浮动文本选择菜单（ActionMode），
     * 让选中正文后只出现 CoRead 自己的划线 / 想法 / AI 问书面板。
     *
     * ⚠️ 这里返回的是**空壳 ActionMode**，不是 null。
     * 本项目原先这两处写的是 `return null`，语义是「用系统默认的」，等于完全没拦
     * —— 这就是「系统菜单照旧出现」的直接原因；且在某些实现里 null 还会连带
     * 把本次选择一起取消掉。返回空壳才是「菜单不出现、选中照旧保留」。
     *
     * 这一层是**兜底**：真正的主力是 CoreadWebView 里对 startActionMode 的覆写。
     * 现代 WebView 的浮动工具栏不一定走 Activity 这条链，所以两层都留着。
     */
    @Override
    public android.view.ActionMode onWindowStartingActionMode(android.view.ActionMode.Callback callback, int type) {
        if (shouldSuppressTextSelectionMenu()) {
            return sentinelActionMode;
        }
        return super.onWindowStartingActionMode(callback, type);
    }

    @Override
    public android.view.ActionMode onWindowStartingActionMode(android.view.ActionMode.Callback callback) {
        if (shouldSuppressTextSelectionMenu()) {
            return sentinelActionMode;
        }
        return super.onWindowStartingActionMode(callback);
    }

    /**
     * 第二层兜底：个别 OEM WebView 不吃上面那层覆写，这里再把菜单项清空。
     * 空菜单在 Android 6+ 上不会渲染出浮动条，而选中状态依然保留。
     */
    @Override
    public void onActionModeStarted(android.view.ActionMode mode) {
        if (shouldSuppressTextSelectionMenu() && mode != null) {
            try {
                android.view.Menu menu = mode.getMenu();
                if (menu != null) {
                    menu.clear();
                }
            } catch (Exception ignored) {}
        }
        super.onActionModeStarted(mode);
    }

    /**
     * 拦截系统物理/手势返回键：
     * 1. 优先交由前端 window.handleAndroidBack() 处理（关闭抽屉、退出阅读回到书架等）；
     * 2. 前端返回 false（处于书架根目录且无弹窗）时，两秒内双击退出并弹出「再按一次退出应用」提示。
     */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.evaluateJavascript(
                "(function() { return !!(window.handleAndroidBack && window.handleAndroidBack()); })()",
                value -> {
                    if ("true".equals(value)) {
                        return;
                    }
                    runOnUiThread(() -> {
                        long now = System.currentTimeMillis();
                        if (now - lastBackPressTime < 2000) {
                            finish();
                        } else {
                            lastBackPressTime = now;
                            android.widget.Toast.makeText(this, "再按一次退出应用", android.widget.Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            );
            return;
        }
        super.onBackPressed();
    }
}
