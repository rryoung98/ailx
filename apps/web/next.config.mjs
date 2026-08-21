/** Static export for GitHub Pages. */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ailx";
export default {
  output: "export",
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
