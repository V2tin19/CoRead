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
            }
        } catch (Exception ignored) {}
    }

    /**
     * 抑制 Android 原生浮动文本选择菜单（ActionMode），
     * 避免与 CoRead 自研划线、想法、AI 问书气泡面板冲突遮挡。
     */
    @Override
    public android.view.ActionMode onWindowStartingActionMode(android.view.ActionMode.Callback callback, int type) {
        return null;
    }

    @Override
    public android.view.ActionMode onWindowStartingActionMode(android.view.ActionMode.Callback callback) {
        return null;
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
