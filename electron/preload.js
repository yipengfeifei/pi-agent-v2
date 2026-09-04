// FLY preload：Electron 32+ 移除了渲染进程的 File.path，拖拽文件/文件夹的真实路径
// 只能通过 webUtils.getPathForFile 拿（需在 preload 的隔离上下文里跑），桥给页面
const { contextBridge, webUtils } = require("electron");

contextBridge.exposeInMainWorld("fly", {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
});
