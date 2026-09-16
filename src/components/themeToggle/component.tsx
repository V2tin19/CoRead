import React from "react";
import "./themeToggle.css";
import { isDarkModeNow, toggleSkin } from "../../utils/theme";

interface ThemeToggleProps {
  /** 额外类名（比如外层要定位） */
  className?: string;
  /** 图标大小，默认 20px */
  size?: number;
  title?: string;
}

/**
 * 右上角「白天 / 黑夜」开关
 * ------------------------------------------------------------
 * 设置里「外观」原本有三档（追随系统 / 白天 / 黑夜），切换要进设置、
 * 还要刷新页面。这个项目只要两种外观，所以把开关提到右上角常驻。
 */
const ThemeToggle: React.FC<ThemeToggleProps> = ({
  className = "",
  size = 20,
  title,
}) => {
  const isDark = isDarkModeNow();
  return (
    <button
      type="button"
      className={`coread-theme-toggle ${isDark ? "is-night" : "is-day"} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleSkin();
      }}
      title={
        title || (isDark ? "切换到白天模式" : "切换到黑夜模式")
      }
      aria-label={isDark ? "切换到白天模式" : "切换到黑夜模式"}
    >
      {isDark ? (
        // 月亮
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M21.64 13a1 1 0 0 0-1.05-.14 8.05 8.05 0 0 1-3.37.73 8.15 8.15 0 0 1-8.14-8.1 8.59 8.59 0 0 1 .25-2A1 1 0 0 0 8 2.36a10.14 10.14 0 1 0 13.75 13.75 1 1 0 0 0-.11-1.11z" />
        </svg>
      ) : (
        // 太阳
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
          <path d="M12 4a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1zm0 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H5a1 1 0 0 1-1-1zm14 0a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1zM6.34 6.34a1 1 0 0 1 1.41 0l.7.71a1 1 0 0 1-1.41 1.41l-.71-.7a1 1 0 0 1 0-1.42zm10.91 10.91a1 1 0 0 1 1.41 0l.71.71a1 1 0 0 1-1.41 1.41l-.71-.7a1 1 0 0 1 0-1.42zm1.41-10.91a1 1 0 0 1 0 1.42l-.7.7a1 1 0 0 1-1.42-1.41l.71-.71a1 1 0 0 1 1.41 0zM8.46 18.66a1 1 0 0 1 0 1.41l-.71.71a1 1 0 0 1-1.41-1.41l.7-.71a1 1 0 0 1 1.42 0zM12 18a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1z" />
        </svg>
      )}
    </button>
  );
};

export default ThemeToggle;
