package com.coread.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.webkit.JavascriptInterface;

import com.getcapacitor.CapacitorWebView;

/**
 * CoRead 自己的 WebView 子类。**唯一目的：关掉 Android 原生的文本选择菜单。**
 *
 * 为什么必须换掉 WebView 的类：原生长按选词的菜单是 `View.startActionMode` 这条
 * 链上产生的，而 `startActionMode` 是 WebView 自己的方法 —— 在 Activity 上
 * （`onWindowStartingActionMode`）拦是不稳的，实测那条路对现代 WebView 的
 * **浮动工具栏**根本不走。只有在 WebView 子类上覆写才稳。
 *
 * 怎么让 Capacitor 用上这个子类：Capacitor 的 WebView 是从布局
 * `capacitor_bridge_layout_main.xml` 里 inflate 出来的，我们在应用模块放一份
 * **同名布局**（应用资源优先级高于库资源）把它换掉即可，见
 * `res/layout/capacitor_bridge_layout_main.xml`。
 *
 * ⚠️ 不能无脑全拦：网页里的输入框（写笔记的 textarea、AI 助手的输入框、
 * 搜索框）在手机上**唯一的粘贴入口**就是这条原生菜单，拦掉就没法粘贴了。
 * 所以这里留一个 `editableFocused` 开关，由网页侧通过 `AndroidTextSelection`
 * JS 桥上报「当前焦点是不是在输入框上」，是的话就放行系统默认行为。
 */
public class CoreadWebView extends CapacitorWebView {

    /** 复用同一个空壳实例即可，它没有任何状态。 */
    private final ActionMode sentinelActionMode = new SentinelActionMode();

    /**
     * 焦点是否在网页的 input / textarea / contenteditable 上（由 JS 桥上报）。
     * volatile：写入发生在 JS 桥的线程，读取发生在主线程，不能让它停在 CPU 缓存里。
     */
    private volatile boolean editableFocused = false;

    public CoreadWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
        // ⚠️ JS 桥必须在**构造函数**里登记，不能放到 MainActivity.onCreate 里。
        // 时序：BridgeActivity.onCreate 先 setContentView（= 这里被 inflate），
        // 再 Bridge.Builder.create() → loadUrl()。也就是说 MainActivity.onCreate 里
        // 那行 addJavascriptInterface 跑在 loadUrl **之后**，首屏那个 JS 上下文
        // 里可能根本没有这个对象（本项目里 AndroidStatusBar 就是同样的问题）。
        // 放在构造函数里，天然早于 loadUrl，一定有。
        addJavascriptInterface(new EditableFocusBridge(this), "AndroidTextSelection");
    }

    /**
     * 网页 → 原生的上报通道：当前焦点是不是在输入框上。
     * 对象在 JS 里的名字是 `AndroidTextSelection`（见 mobileRuntime.ts）。
     */
    public static class EditableFocusBridge {
        private final CoreadWebView view;

        EditableFocusBridge(CoreadWebView view) {
            this.view = view;
        }

        @JavascriptInterface
        public void setEditableFocused(boolean focused) {
            view.setEditableFocused(focused);
        }
    }

    public void setEditableFocused(boolean focused) {
        this.editableFocused = focused;
    }

    public boolean isEditableFocused() {
        return editableFocused;
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        if (shouldSuppress()) {
            return sentinelActionMode;
        }
        return super.startActionMode(callback);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        if (shouldSuppress()) {
            return sentinelActionMode;
        }
        return super.startActionMode(callback, type);
    }

    /**
     * 只有「不在输入框里」的时候才压掉原生菜单。
     * 正文选区 → 压掉，交给 CoRead 自己的 PopupMenu；
     * 输入框选区 → 放行，保留系统的粘贴 / 全选。
     */
    private boolean shouldSuppress() {
        return !editableFocused;
    }
}
