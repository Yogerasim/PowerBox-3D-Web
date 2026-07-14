import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  /**
   * Локально:
   *   http://localhost:5173/
   *
   * GitHub Pages:
   *   https://yogerasim.github.io/PowerBox-3D-Web/
   */
  base:
    command === "build"
      ? "/PowerBox-3D-Web/"
      : "/",

  build: {
    target: "es2022",
    sourcemap: true,

    /**
     * Собираем обе страницы:
     * - основной сайт;
     * - технический Scene Lab.
     */
    rolldownOptions: {
      input: [
        "index.html",
        "viewer.html",
      ],
    },
  },
}));
