export const backgroundList = [
  "rgba(255,255,255,1)",
  "rgba(44,47,49,1)",
  "rgba(233, 216, 188,1)",
  "rgba(197, 231, 207,1)",
];
export const textList = [
  "rgba(0,0,0,1)",
  "rgba(255,255,255,1)",
  "rgba(89, 68, 41,1)",
  "rgba(54, 80, 62,1)",
];
// 只保留「默认」一种预设主题色。
// 原来还有 Blue/Green/Red/… 共 10 个彩色预设，属于本次要清理的「多余外观色」：
// 冷暖两套外观已经由右上角白天/黑夜开关承担，主题色不再提供额外档位。
// 需要个性色时仍然可以用设置里的「自定义」取色器。
export const themeList = [{ id: 0, color: "default", title: "Default" }];
