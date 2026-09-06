import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

/* v4.6.3：加 plugin-legacy，让较旧的 Android 浏览器（微信／LINE 内建浏览器、没更新的系统浏览器）也能开。
   - modernTargets：主程式转译成 Chrome 64 / iOS 12 起就看得懂的语法（原本预设是 Chrome 87 起，太旧的会整页空白）
   - targets：更旧的浏览器（不支援 module）会拿到另一份加了 polyfill 的旧版程式；新手机完全不受影响 */
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ["defaults", "not IE 11", "chrome >= 55", "android >= 5", "ios >= 10"],
      modernTargets: "chrome >= 64, chromeAndroid >= 64, edge >= 79, firefox >= 67, safari >= 12, ios >= 12",
      modernPolyfills: true,
    }),
  ],
});
