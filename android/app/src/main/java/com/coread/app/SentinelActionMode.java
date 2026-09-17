package com.coread.app;

import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.View;

/**
 * 「空壳」ActionMode —— 用来关掉 Android 原生的文本选择菜单。
 *
 * 背景：长按选中文字后弹出的那条「复制 / 全选 / 翻译 / 分享」是**原生 View 层的
 * ActionMode / floating toolbar**，不是网页里的 DOM。所以 CSS 的
 * `-webkit-touch-callout`、JS 的 `contextmenu` 全都管不到它，只能从原生层关。
 *
 * 关法：让 WebView「以为」它已经成功启动了一个 ActionMode，但那个 ActionMode
 * 什么都不做。于是原生菜单不出现，而**选中高亮和两端的拖拽游标完全保留** ——
 * 用户依然能拖选，只是弹出来的是 CoRead 自己的菜单（网页层 PopupMenu）。
 *
 * ⚠️ 反例（本项目原先就是这么写的，所以一直没生效）：
 * 从 `startActionMode` / `onWindowStartingActionMode` 里 `return null`。
 * null 的语义是「用系统默认的」，不是「取消」；而且在部分实现里 null 还会
 * 连带把这次选择一起取消掉 —— 菜单没了，选中也没了。
 *
 * ⚠️ `getMenu()` 返回 null 是本方案的既定写法（框架/Editor 拿到返回对象后
 * 只会在 finish() 时用到它），不要改成抛异常或返回别的。
 */
public class SentinelActionMode extends ActionMode {
    @Override
    public void setTitle(CharSequence title) {}

    @Override
    public void setTitle(int resId) {}

    @Override
    public void setSubtitle(CharSequence subtitle) {}

    @Override
    public void setSubtitle(int resId) {}

    @Override
    public void setCustomView(View view) {}

    @Override
    public void invalidate() {}

    @Override
    public void finish() {}

    @Override
    public Menu getMenu() {
        return null;
    }

    @Override
    public CharSequence getTitle() {
        return null;
    }

    @Override
    public CharSequence getSubtitle() {
        return null;
    }

    @Override
    public View getCustomView() {
        return null;
    }

    @Override
    public MenuInflater getMenuInflater() {
        return null;
    }
}
