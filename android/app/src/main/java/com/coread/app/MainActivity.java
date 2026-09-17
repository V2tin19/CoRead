package com.coread.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
}
